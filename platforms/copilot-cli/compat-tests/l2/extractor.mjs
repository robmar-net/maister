// L2 predicate extractor + defensive state parser (zero-dependency, node: builtins only).
//
// Reduces one Copilot workflow run to an array of RAW predicate records from three sources:
//   (a) orchestrator-state.yml  -> phase_completed / task_characteristic / task_status
//   (b) the run's task-dir tree -> created_artifact
//   (c) the typed SessionEvent[] -> delegated / invoked_skill / gate_fired / reached_terminal
// Normalization (verb canonicalization, prefix stripping, verification-path collapse, allowlist)
// is a LATER stage's job (normalize.mjs); records here preserve the payload AS OBSERVED.
//
// Raw record shape: { kind, name, value?, source, evidence }  (see the Shared Data Contract).
//   kind    - one of the grammar heads below
//   name    - payload as observed (agent/skill names may still carry maister:/maister-copilot: prefixes)
//   value   - boolean, only for task_characteristic
//   source  - 'state' | 'tree' | 'events'
//   evidence- short human string for the report
//
// DESIGN NOTES (binding rationale — do not "simplify" away):
//  * HIGH-1: invoked_skill derives from `skill.invoked` events ONLY. `session.skills_loaded` lists
//    ~19 resolved-but-not-invoked skills; deriving invoked_skill from it would flood the skeleton and
//    cause a false REGRESSED. It is deliberately IGNORED here.
//  * MEDIUM-2: parseState is a TARGETED, not general, YAML reader (zero-dep; no YAML library). It is
//    intentionally tolerant of the LLM-authored serialization: inline flow arrays
//    (`completed_phases: ["phase-1", ...]`) AND block `- "phase-N"` sequences; `phase-` or `phase_`
//    separators; `task_characteristics` nested under `task_context`; and `task.status` disambiguated
//    from `verification_context.last_status` by key path. Targeted parsing is fragile by nature — the
//    committed real-format fixture (`orchestrator-state.sample.yml`) is the guard against drift.
//  * SANITY FLOOR (MEDIUM-2): if the state parse yields ZERO completed phases while task-tree
//    artifacts exist, `extract()` raises an INCOMPLETE flag rather than emitting a silent
//    all-phases-missing set — that would look like a catastrophic REGRESSED when it is really a
//    parse failure or a stalled run. Never silent.
//  * No SDK import: operates on plain data (events array + file paths + yaml text) so the whole
//    module is fixture-testable without a Copilot seat.

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// State parsing (source a) — MEDIUM-2
// ---------------------------------------------------------------------------

export const KNOWN_CHARACTERISTICS = [
  'has_reproducible_defect',
  'modifies_existing_code',
  'creates_new_entities',
  'involves_data_operations',
  'ui_heavy',
];

const indentOf = (line) => {
  const i = line.search(/\S/);
  return i === -1 ? Infinity : i;
};

// Extract the completed-phase integers, bounded to the `completed_phases` value region only, so
// unrelated `phase-N` occurrences (`started_phase: phase-1`, the `task_ids:` mapping) are never
// captured. Tolerant of inline flow arrays and block `- "phase-N"` sequences.
function parseCompletedPhases(lines, warnings) {
  const idx = lines.findIndex((l) => /^\s*completed_phases\s*:/.test(l));
  if (idx === -1) {
    warnings.push('completed_phases key not found');
    return [];
  }
  const keyLine = lines[idx];
  const afterColon = keyLine.slice(keyLine.indexOf(':') + 1).trim();
  let region = '';

  if (afterColon.startsWith('[')) {
    // Inline flow array — may (rarely) wrap across lines; collect until the closing bracket.
    region = afterColon;
    if (!afterColon.includes(']')) {
      for (let i = idx + 1; i < lines.length; i++) {
        region += ' ' + lines[i];
        if (lines[i].includes(']')) break;
      }
    }
  } else if (afterColon === '' || afterColon === '[]') {
    // Block sequence: subsequent `- ...` lines indented deeper than the key.
    const keyIndent = indentOf(keyLine);
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') continue;
      if (indentOf(l) <= keyIndent) break; // dedent -> end of this block
      if (/^\s*-\s*/.test(l)) region += ' ' + l;
      else break; // a deeper non-sequence line is not part of the list
    }
  } else {
    // Unexpected inline scalar; take the remainder of the line defensively.
    region = afterColon;
  }

  const nums = [];
  const re = /phase[-_](\d+)/gi;
  let m;
  while ((m = re.exec(region)) !== null) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n) && !nums.includes(n)) nums.push(n);
  }
  nums.sort((a, b) => a - b);
  return nums;
}

// Read the 5 known booleans anchored under the `task_characteristics:` block (which itself lives
// under `task_context`). Restricting to the known keys keeps a stray `foo: true` elsewhere in the
// block out of the result.
function parseCharacteristics(lines, warnings) {
  const out = {};
  const idx = lines.findIndex((l) => /^\s*task_characteristics\s*:/.test(l));
  if (idx === -1) {
    warnings.push('task_characteristics block not found');
    return out;
  }
  const keyIndent = indentOf(lines[idx]);
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (indentOf(l) <= keyIndent) break; // dedent -> end of the characteristics block
    const mm = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(true|false)\s*$/i);
    if (mm && KNOWN_CHARACTERISTICS.includes(mm[1])) {
      out[mm[1]] = /^true$/i.test(mm[2]);
    }
  }
  for (const k of KNOWN_CHARACTERISTICS) {
    if (!(k in out)) warnings.push(`task_characteristic missing: ${k}`);
  }
  return out;
}

// Read `task.status` from within the top-level `task:` block. The block anchor disambiguates it from
// `verification_context.last_status`; additionally `^\s*status\s*:` cannot match `last_status:`.
function parseTaskStatus(lines, warnings) {
  const idx = lines.findIndex((l) => /^task\s*:\s*$/.test(l));
  if (idx === -1) {
    warnings.push('task: block not found for status');
    return null;
  }
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (indentOf(l) === 0) break; // next top-level key -> end of the task: block
    const mm = l.match(/^\s*status\s*:\s*(.+?)\s*$/);
    if (mm) {
      const v = mm[1].trim().replace(/^["']|["']$/g, '');
      if (v === '' || v.toLowerCase() === 'null' || v === '~') {
        warnings.push('task.status is null/empty');
        return null;
      }
      return v;
    }
  }
  warnings.push('task.status not found within task: block');
  return null;
}

// Defensive targeted parser for the known orchestrator-state keys. No YAML library (zero-dep).
// Returns { phases:int[], characteristics:{...}, status:string|null, parseWarnings:string[] }.
export function parseState(yamlText) {
  const parseWarnings = [];
  const text = typeof yamlText === 'string' ? yamlText : '';
  const lines = text.split(/\r?\n/);
  return {
    phases: parseCompletedPhases(lines, parseWarnings),
    characteristics: parseCharacteristics(lines, parseWarnings),
    status: parseTaskStatus(lines, parseWarnings),
    parseWarnings,
  };
}

function stateToRecords(state) {
  const records = [];
  for (const n of state.phases) {
    records.push({ kind: 'phase_completed', name: n, source: 'state', evidence: `completed_phases contains phase-${n}` });
  }
  for (const k of KNOWN_CHARACTERISTICS) {
    if (k in state.characteristics) {
      const v = state.characteristics[k];
      records.push({ kind: 'task_characteristic', name: k, value: v, source: 'state', evidence: `task_characteristics.${k}=${v}` });
    }
  }
  if (state.status != null) {
    records.push({ kind: 'task_status', name: state.status, source: 'state', evidence: `task.status=${state.status}` });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Event reduction (source c)
// ---------------------------------------------------------------------------

// Reduce the typed SessionEvent[] to raw records. `invoked_skill` is pinned to `skill.invoked`
// ONLY (HIGH-1); `session.skills_loaded` is never a source. Excluded/noise events (assistant
// messages, tool executions, ordering/counts) yield no records.
export function extractFromEvents(events) {
  const records = [];
  if (!Array.isArray(events)) return records;

  let sawIdleOrShutdown = false;
  let sawError = false;

  for (const e of events) {
    if (!e || typeof e.type !== 'string') continue;
    const data = e.data || {};

    switch (e.type) {
      case 'subagent.started': {
        const name = data.agentName || data.agentDisplayName;
        if (name) {
          records.push({ kind: 'delegated', name, source: 'events', evidence: `subagent.started agentName=${name}` });
        }
        break;
      }
      case 'skill.invoked': {
        // HIGH-1: this is the ONLY source of invoked_skill.
        if (data.name) {
          records.push({ kind: 'invoked_skill', name: data.name, source: 'events', evidence: `skill.invoked name=${data.name}` });
        }
        break;
      }
      case 'session.skills_loaded':
        // HIGH-1: deliberately IGNORED — lists resolved-but-not-invoked skills (~19), never invoked.
        break;
      case 'user_input.requested':
        records.push({ kind: 'gate_fired', name: 'ask', source: 'events', evidence: 'user_input.requested' });
        break;
      case 'permission.requested':
        records.push({ kind: 'gate_fired', name: 'permission', source: 'events', evidence: 'permission.requested' });
        break;
      case 'exit_plan_mode.requested':
        records.push({ kind: 'gate_fired', name: 'exit_plan_mode', source: 'events', evidence: 'exit_plan_mode.requested' });
        break;
      case 'session.idle':
      case 'session.shutdown':
        sawIdleOrShutdown = true;
        break;
      case 'session.error':
        sawError = true;
        break;
      default:
        // Everything else (assistant.message, tool.execution_*, turn/ordering/count events) is noise.
        break;
    }
  }

  // Terminal success = the session reached idle/shutdown with no error. Emitted exactly once.
  if (sawIdleOrShutdown && !sawError) {
    records.push({
      kind: 'reached_terminal',
      name: 'completion',
      source: 'events',
      evidence: 'session.idle/session.shutdown with no session.error',
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Tree reduction (source b)
// ---------------------------------------------------------------------------

// created_artifact is restricted to these three exact files plus any file under `verification/`.
const EXACT_ARTIFACTS = [
  'implementation/spec.md',
  'implementation/implementation-plan.md',
  'implementation/work-log.md',
];

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

// Resolve the development task directory/directories under `root`. Robust to `root` being the
// sandbox rundir (contains `.maister/tasks/development/*/`) OR a single task dir directly.
function findTaskDirs(root) {
  const dirs = [];
  const devDir = path.join(root, '.maister', 'tasks', 'development');
  if (isDir(devDir)) {
    for (const e of fs.readdirSync(devDir, { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(path.join(devDir, e.name));
    }
    if (dirs.length) return dirs;
  }
  // Fallback: root is itself a task dir.
  if (isDir(path.join(root, 'implementation')) || isDir(path.join(root, 'verification'))) {
    return [root];
  }
  return dirs;
}

// Walk the task-dir tree; emit created_artifact records for the allowed artifact set only. The
// verification-path collapse (any verification report -> the single canonical token) is normalize's
// job, so here we emit the concrete `verification/<file>` relpath as observed.
export function extractFromTree(taskDirRoot) {
  const records = [];
  if (!taskDirRoot || !isDir(taskDirRoot)) return records;

  for (const taskDir of findTaskDirs(taskDirRoot)) {
    for (const rel of EXACT_ARTIFACTS) {
      if (isFile(path.join(taskDir, rel))) {
        records.push({ kind: 'created_artifact', name: rel, source: 'tree', evidence: `file present: ${rel}` });
      }
    }
    const vDir = path.join(taskDir, 'verification');
    if (isDir(vDir)) {
      for (const e of fs.readdirSync(vDir, { withFileTypes: true })) {
        if (e.isFile()) {
          const rel = `verification/${e.name}`;
          records.push({ kind: 'created_artifact', name: rel, source: 'tree', evidence: `file present: ${rel}` });
        }
      }
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Top-level merge + sanity floor
// ---------------------------------------------------------------------------

// Merge all three sources into one raw-record array. Applies the MEDIUM-2 sanity floor and surfaces
// state parse warnings. No SDK import — plain data in, plain data out.
//
// Returns { records, incomplete, incompleteReason, parseWarnings }.
export function extract({ events = [], taskDirRoot = null, stateYaml = null } = {}) {
  const state = stateYaml != null
    ? parseState(stateYaml)
    : { phases: [], characteristics: {}, status: null, parseWarnings: ['no stateYaml provided'] };

  const stateRecords = stateToRecords(state);
  const eventRecords = extractFromEvents(events);
  const treeRecords = taskDirRoot ? extractFromTree(taskDirRoot) : [];

  const records = [...stateRecords, ...eventRecords, ...treeRecords];

  // SANITY FLOOR: zero completed phases while task-tree artifacts exist is not a clean "everything
  // missing" — it is a parse failure / stalled run. Flag INCOMPLETE rather than a silent REGRESSED.
  const artifactsExist = treeRecords.some((r) => r.kind === 'created_artifact');
  const incomplete = state.phases.length === 0 && artifactsExist;
  const incompleteReason = incomplete
    ? 'State parse yielded ZERO completed phases while task-tree artifacts exist; refusing to emit a '
      + 'silent all-phases-missing set (which would false-alarm as REGRESSED). Treat as INCOMPLETE.'
    : null;

  return { records, incomplete, incompleteReason, parseWarnings: state.parseWarnings };
}
