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
import { spawnSync } from 'node:child_process';

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
// Derive completed-phase integers from a `phase_summaries:` map's `phase-N:` entry keys, bounded to
// that block so unrelated `phase-N` tokens elsewhere are never captured. Each entry key is a phase the
// orchestrator recorded a summary/artifacts/steps for = a completed phase. Used as the fallback when
// no `completed_phases` key exists at all.
function phasesFromPhaseSummaries(lines) {
  const psIdx = lines.findIndex((l) => /^\s*phase_summaries\s*:/.test(l));
  if (psIdx === -1) return [];
  const psIndent = indentOf(lines[psIdx]);
  const nums = [];
  for (let i = psIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (indentOf(l) <= psIndent) break; // dedent -> end of the phase_summaries block
    const mm = l.match(/^\s*phase[-_](\d+)\s*:/); // an entry key inside the block
    if (mm) {
      const n = parseInt(mm[1], 10);
      if (!Number.isNaN(n) && !nums.includes(n)) nums.push(n);
    }
  }
  nums.sort((a, b) => a - b);
  return nums;
}

// Derive completed-phase integers from a `phases:` SEQUENCE of `{ <id|number|phase>: N, name,
// status: completed }` items, bounded to that block. Copilot's development runs record completion here
// (1.0.81 used both `- id: N` and `- number: N` across runs) — a phase counts only when its item's
// status is `completed`. The item's phase integer may be keyed `id`, `number`, or `phase`.
function phasesFromPhasesSequence(lines) {
  const idx = lines.findIndex((l) => /^\s*phases\s*:\s*$/.test(l));
  if (idx === -1) return [];
  const baseIndent = indentOf(lines[idx]);
  const nums = [];
  let curId = null, curDone = false;
  const flush = () => { if (curId !== null && curDone && !nums.includes(curId)) nums.push(curId); };
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (indentOf(l) <= baseIndent) break; // dedent -> end of the phases: block
    if (/^\s*-/.test(l)) { flush(); curId = null; curDone = false; } // start of a new list item
    const idm = l.match(/\b(?:id|number|phase)\s*:\s*(\d+)/);
    if (idm && curId === null) curId = parseInt(idm[1], 10);
    if (/\bstatus\s*:\s*["']?completed\b/.test(l)) curDone = true;
  }
  flush();
  nums.sort((a, b) => a - b);
  return nums;
}

// Parse the `completed_phases` array VALUE (phase-N or bare-int), bounded to the key's value region.
function phasesFromCompletedPhasesKey(lines, idx, warnings) {
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
  // A run may serialize completed_phases as BARE integers (`[1, 2, 5]`) instead of the maister
  // `"phase-N"` convention. ONLY when the phase[-_]N form yielded nothing, extract bare integers.
  if (nums.length === 0) {
    const reInt = /\d+/g;
    let mi;
    while ((mi = reInt.exec(region)) !== null) {
      const n = parseInt(mi[0], 10);
      if (!Number.isNaN(n) && n >= 1 && !nums.includes(n)) nums.push(n);
    }
    if (nums.length > 0) warnings.push('completed_phases parsed as bare integers (no phase-N prefix)');
  }
  nums.sort((a, b) => a - b);
  return nums;
}

// Completed phases = the UNION of every completion signal the orchestrator may have serialized. Copilot's
// model is non-deterministic AND sometimes inconsistent across shapes — observed a PARTIAL
// `completed_phases: [1]` alongside a full `phases:` sequence in the same run. Unioning recovers the true
// set whichever shape(s) a run used; each source only ever marks genuinely-completed phases, so the union
// never over-reports. Sources:
//   (A) `completed_phases:` array (phase-N or bare-int),
//   (B) `phase_summaries:` map keyed by `phase-N:`,
//   (C) `phases:` sequence items with `status: completed` (item key id/number/phase).
function parseCompletedPhases(lines, warnings) {
  const set = new Set();
  const sources = [];

  const idx = lines.findIndex((l) => /^\s*completed_phases\s*:/.test(l));
  if (idx !== -1) {
    const arr = phasesFromCompletedPhasesKey(lines, idx, warnings);
    arr.forEach((n) => set.add(n));
    if (arr.length) sources.push('completed_phases');
  }
  let before = set.size;
  phasesFromPhaseSummaries(lines).forEach((n) => set.add(n));
  if (set.size > before) sources.push('phase_summaries');
  before = set.size;
  phasesFromPhasesSequence(lines).forEach((n) => set.add(n));
  if (set.size > before) sources.push('phases[]');

  if (set.size === 0) {
    warnings.push('completed_phases key not found');
    return [];
  }
  if (sources.length > 1 || idx === -1) {
    warnings.push(`completed_phases derived from union of [${sources.join(', ')}] (LLM serialization variance)`);
  }
  return [...set].sort((a, b) => a - b);
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

// Clean a raw status value: strip quotes; treat empty / null / ~ as absent.
function cleanStatusValue(raw, warnings) {
  const v = String(raw).trim().replace(/^["']|["']$/g, '');
  if (v === '' || v.toLowerCase() === 'null' || v === '~') {
    warnings.push('task.status is null/empty');
    return null;
  }
  return v;
}

// Read the task status. PRIMARY: `task.status` inside a top-level `task:` block (maister schema; the
// block anchor disambiguates from `verification_context.last_status`, and `^\s*status\s*:` cannot match
// `last_status:`). FALLBACK (LLM serialization variance — e.g. Copilot 1.0.75 nests everything under
// `orchestrator:` with NO top-level `task:` block): the FIRST line-anchored `status:` at indent <= 2
// (`orchestrator.status`). indent <= 2 excludes per-phase statuses (indent >= 4, or inline in a flow
// map), and the `status`-not-`last_status` anchor excludes verification_context.
function parseTaskStatus(lines, warnings) {
  // PRIMARY: the top-level `task:` block (maister schema).
  const idx = lines.findIndex((l) => /^task\s*:\s*$/.test(l));
  if (idx !== -1) {
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') continue;
      if (indentOf(l) === 0) break; // next top-level key -> end of the task: block
      const mm = l.match(/^\s*status\s*:\s*(.+?)\s*$/);
      if (mm) return cleanStatusValue(mm[1], warnings);
    }
    warnings.push('task.status not found within task: block');
    // fall through to the fallback (some serializations omit the task: block entirely)
  }
  // FALLBACK: `orchestrator.status` (or any top-level status:) — indent <= 2, first match wins.
  for (const l of lines) {
    if (!/^\s{0,2}status\s*:/.test(l)) continue;
    const mm = l.match(/^\s*status\s*:\s*(.+?)\s*$/);
    if (mm) {
      const v = cleanStatusValue(mm[1], warnings);
      if (v != null) {
        warnings.push('task status read from a top-level status: key (no task: block — LLM serialization variance)');
        return v;
      }
    }
  }
  if (idx === -1) warnings.push('task: block not found for status');
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
// Tree reduction (source b) — scenario-parameterized via TREE_PROFILES
// ---------------------------------------------------------------------------
//
// Each workflow lays its task dir out differently, so `created_artifact` extraction is driven by a
// per-scenario TREE PROFILE, not development-hardcoded constants:
//   taskType       - the `.maister/tasks/<taskType>/` subtree this workflow writes into
//   exactArtifacts - task-dir-relative files that each count as ONE created_artifact token
//   collapseDirs   - dirs whose EVERY file collapses to a single `<dir>/*` token at normalize time
//                    (development: `verification` -> `verification/*`; research: none)
//   fallbackDirs   - marker dirs proving `root` is ITSELF a single task dir (rundir-less fixtures)
// The default profile is `development`, so any caller that omits a profile (e.g. the direct
// extractFromTree / extract unit tests) gets byte-identical behavior to the pre-scenario harness.
export const TREE_PROFILES = Object.freeze({
  development: {
    taskType: 'development',
    exactArtifacts: [
      'implementation/spec.md',
      'implementation/implementation-plan.md',
      'implementation/work-log.md',
    ],
    collapseDirs: ['verification'],
    fallbackDirs: ['implementation', 'verification'],
  },
  research: {
    taskType: 'research',
    // Stable research deliverables (task-dir-relative). The Phase-1 report + synthesis are the
    // always-produced core (modelled `required`); planning/* and the brainstorming/design outputs
    // are legitimately conditional (modelled `optional`). `analysis/findings/*` is deliberately NOT
    // modelled — it is variable + category-prefixed and already implied by
    // delegated(information-gatherer); capturing it would need a normalize collapse rule for no gain.
    exactArtifacts: [
      'planning/research-brief.md',
      'planning/research-plan.md',
      'planning/sources.md',
      'analysis/synthesis.md',
      'outputs/research-report.md',
      'outputs/solution-exploration.md',
      'outputs/high-level-design.md',
      'outputs/decision-log.md',
    ],
    collapseDirs: [],
    fallbackDirs: ['outputs', 'analysis', 'planning'],
  },
  'quick-bugfix': {
    // The quick-bugfix skill writes NO `.maister/tasks/` tree and NO orchestrator state — its trace is
    // events-only. An empty profile that matches no task dir yields zero created_artifact records, so
    // the skeleton is events-only and the sanity floor (zero phases WHILE artifacts exist) never trips.
    taskType: 'quick-bugfix',
    exactArtifacts: [],
    collapseDirs: [],
    fallbackDirs: [],
  },
});

const DEFAULT_TREE_PROFILE = TREE_PROFILES.development;

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

// Resolve the task directory/directories under `root` for the profile's workflow type. Robust to
// `root` being the sandbox rundir (contains `.maister/tasks/<taskType>/*/`) OR a single task dir.
function findTaskDirs(root, profile) {
  const dirs = [];
  const typeDir = path.join(root, '.maister', 'tasks', profile.taskType);
  if (isDir(typeDir)) {
    for (const e of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(path.join(typeDir, e.name));
    }
    if (dirs.length) return dirs;
  }
  // Fallback: root is itself a task dir (proven by any of the profile's marker dirs).
  if (profile.fallbackDirs.some((d) => isDir(path.join(root, d)))) {
    return [root];
  }
  return dirs;
}

// Walk the task-dir tree; emit created_artifact records for the PROFILE's allowed artifact set only.
// Any collapse-dir file (e.g. development's `verification/<report>`) is emitted as its concrete
// relpath here; the single-token collapse (`verification/*`) is normalize's job.
export function extractFromTree(taskDirRoot, profile = DEFAULT_TREE_PROFILE) {
  const records = [];
  if (!taskDirRoot || !isDir(taskDirRoot)) return records;

  for (const taskDir of findTaskDirs(taskDirRoot, profile)) {
    for (const rel of profile.exactArtifacts) {
      if (isFile(path.join(taskDir, rel))) {
        records.push({ kind: 'created_artifact', name: rel, source: 'tree', evidence: `file present: ${rel}` });
      }
    }
    for (const dir of profile.collapseDirs) {
      const cDir = path.join(taskDir, dir);
      if (isDir(cDir)) {
        for (const e of fs.readdirSync(cDir, { withFileTypes: true })) {
          if (e.isFile()) {
            const rel = `${dir}/${e.name}`;
            records.push({ kind: 'created_artifact', name: rel, source: 'tree', evidence: `file present: ${rel}` });
          }
        }
      }
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Functional oracle (source d) — `outcome(<id>)=pass|fail`  (issue #48, Stage 2)
// ---------------------------------------------------------------------------
//
// The ONLY source that RUNS the scenario's produced deliverable in the live rundir and asserts it
// actually worked (not merely that the workflow moved). Two spec kinds, kept in distinct code paths
// so their failure evidence is distinguishable:
//   command-type   {id, command, restage?, expect?}  — dev / quick-bugfix (`sh run-tests.sh` exit 0)
//   assertion-type {id, assert:'research-deliverables', params:{minBytes,minNonBlankLines}} — research
//
// Rule of thumb (LOW-7): BAD SHAPE -> throw (fail-fast; specs are committed, trusted config);
//                        BAD RESULT -> `value:'fail'` record (a runtime exec/assertion failure never
//                        throws out of extract — it is fail-closed = REGRESSED, never a crash).

const OUTCOME_TIMEOUT_MS = 30000; // 30s fixed POSIX-sh timeout (MEDIUM: no network; commands are sh only).

// LOW-6: NAMESPACE HYGIENE ONLY (corrected rationale). Prevents outcome ids from shadowing the
// state-predicate namespaces in reports/derivations. It does NOT protect any floor: the emitted token
// always begins `outcome(`, which can never match the STATE_SOURCED / widened-F3 regex regardless of id.
const OUTCOME_ID_NAMESPACE_GUARD = /^(phase_completed|task_characteristic|task_status)/;

// Validate the SHAPE of one outcome spec. A structurally invalid spec is a developer error -> THROW.
function assertValidOutcomeSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('outcome spec entry must be an object');
  }
  if (typeof spec.id !== 'string' || spec.id.trim() === '') {
    throw new Error('outcome spec entry is missing a string `id`');
  }
  if (OUTCOME_ID_NAMESPACE_GUARD.test(spec.id)) {
    throw new Error(
      `outcome id "${spec.id}" shadows a state-predicate namespace prefix ` +
      '(phase_completed/task_characteristic/task_status) — reserved for namespace hygiene (LOW-6); ' +
      'this is NOT floor protection.',
    );
  }
  const hasCommand = typeof spec.command === 'string';
  const hasAssert = typeof spec.assert === 'string';
  if (!hasCommand && !hasAssert) {
    throw new Error(`outcome spec "${spec.id}" has neither a \`command\` nor an \`assert\``);
  }
  if (hasAssert && spec.assert !== 'research-deliverables') {
    throw new Error(`outcome spec "${spec.id}" has an unknown assert kind: ${spec.assert}`);
  }
}

// command-type: restage the trusted oracle (MEDIUM-5) then run it in the rundir. Any non-pass -> fail.
function runCommandOutcome(spec, rundir, sandboxTemplateDir) {
  const id = spec.id;
  const mk = (value, evidence) => ({ kind: 'outcome', name: id, value, source: 'outcome', evidence });

  // MEDIUM-5 restage: replace the model-touched rundir copy of each trusted file with the committed
  // template BEFORE the oracle runs, so the model cannot neuter its own test. Default: ['run-tests.sh'].
  const restage = Array.isArray(spec.restage) ? spec.restage : ['run-tests.sh'];
  for (const file of restage) {
    try {
      if (!sandboxTemplateDir) throw new Error('no sandboxTemplateDir provided for restage');
      fs.copyFileSync(path.join(sandboxTemplateDir, file), path.join(rundir, file));
    } catch (err) {
      // A failed restage copy is a runtime FAILURE (bad result), not a malformed spec -> fail record.
      return mk('fail', `restage of ${file} failed: ${err.message}`);
    }
  }

  let res;
  try {
    res = spawnSync('sh', ['-c', spec.command], {
      cwd: rundir,
      timeout: OUTCOME_TIMEOUT_MS,
      encoding: 'utf8',
    });
  } catch (err) {
    return mk('fail', `command threw: ${err.message}`);
  }
  // spawnSync reports spawn failure (ENOENT) AND timeout (ETIMEDOUT) via `error`.
  if (res.error) return mk('fail', `command failed to run: ${res.error.message}`);

  const code = res.status; // null on signal/timeout
  const stdout = String(res.stdout ?? '');
  if (typeof spec.expect === 'string') {
    const ok = code === 0 && stdout.trim() === spec.expect;
    return mk(ok ? 'pass' : 'fail',
      `${spec.command} exited ${code}; stdout ${ok ? 'matched' : 'did not match'} expect`);
  }
  const ok = code === 0;
  return mk(ok ? 'pass' : 'fail', `${spec.command} exited ${code}`);
}

// assertion-type ('research-deliverables'): a content assertion over the newest research task dir. Any
// unmet condition -> fail with evidence naming the FIRST failed condition.
function runAssertionOutcome(spec, rundir) {
  const id = spec.id;
  const mk = (value, evidence) => ({ kind: 'outcome', name: id, value, source: 'outcome', evidence });
  const params = spec.params || {};
  const minBytes = Number(params.minBytes ?? 0);
  const minNonBlankLines = Number(params.minNonBlankLines ?? 0);

  // Resolve the NEWEST research task dir under rundir/.maister/tasks/research/*/.
  const researchRoot = path.join(String(rundir ?? ''), '.maister', 'tasks', 'research');
  let taskDir = null;
  try {
    const dirs = fs.readdirSync(researchRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(researchRoot, e.name));
    taskDir = dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch { taskDir = null; }
  if (!taskDir) return mk('fail', 'no research task dir under .maister/tasks/research/*');

  const report = path.join(taskDir, 'outputs', 'research-report.md');
  if (!isFile(report)) return mk('fail', 'outputs/research-report.md missing');
  let text = '';
  try { text = fs.readFileSync(report, 'utf8'); } catch (err) { return mk('fail', `research-report.md unreadable: ${err.message}`); }

  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes < minBytes) return mk('fail', `research-report.md ${bytes} bytes < minBytes ${minBytes}`);
  const nonBlank = text.split(/\r?\n/).filter((l) => l.trim() !== '').length;
  if (nonBlank < minNonBlankLines) return mk('fail', `research-report.md ${nonBlank} non-blank lines < ${minNonBlankLines}`);
  if (!/^#{1,6}\s/m.test(text)) return mk('fail', 'research-report.md has no markdown heading');
  if (!isFile(path.join(taskDir, 'analysis', 'synthesis.md'))) return mk('fail', 'analysis/synthesis.md missing');

  return mk('pass', `research-report.md ${bytes}B, ${nonBlank} non-blank lines, heading + synthesis present`);
}

// Run each outcome spec (array) against the live rundir, returning one record per entry in array order.
// `outcome == null` (no spec) yields []. A bad-SHAPE spec throws; a bad-RESULT yields a fail record.
export function extractFromOutcome(outcomeSpec, rundir, sandboxTemplateDir = null) {
  const records = [];
  if (outcomeSpec == null) return records;
  if (!Array.isArray(outcomeSpec)) {
    throw new Error(`outcome spec must be an array, got ${typeof outcomeSpec}`);
  }
  for (const spec of outcomeSpec) {
    assertValidOutcomeSpec(spec); // bad shape -> throw (fail-fast, before any exec)
    records.push(
      typeof spec.command === 'string'
        ? runCommandOutcome(spec, rundir, sandboxTemplateDir)
        : runAssertionOutcome(spec, rundir),
    );
  }
  return records;
}

// ---------------------------------------------------------------------------
// Top-level merge + sanity floor
// ---------------------------------------------------------------------------

// Merge all three sources into one raw-record array. Applies the MEDIUM-2 sanity floor and surfaces
// state parse warnings. No SDK import — plain data in, plain data out.
//
// `taskType` selects the tree profile (default 'development' -> byte-identical to the pre-scenario
// harness; 'research' -> the research task layout). An unknown type falls back to the development
// profile. Returns { records, incomplete, incompleteReason, parseWarnings }.
export function extract({ events = [], taskDirRoot = null, stateYaml = null, taskType = 'development', outcome = null, sandboxTemplateDir = null } = {}) {
  const state = stateYaml != null
    ? parseState(stateYaml)
    : { phases: [], characteristics: {}, status: null, parseWarnings: ['no stateYaml provided'] };

  const profile = TREE_PROFILES[taskType] || DEFAULT_TREE_PROFILE;
  const stateRecords = stateToRecords(state);
  const eventRecords = extractFromEvents(events);
  const treeRecords = taskDirRoot ? extractFromTree(taskDirRoot, profile) : [];
  // Functional oracle (source d): runs the scenario deliverable in the rundir. A bad-shape spec throws
  // here (fail-fast); a runtime/assertion failure is a `value:'fail'` record, never an exception.
  const outcomeRecords = extractFromOutcome(outcome, taskDirRoot, sandboxTemplateDir);

  const records = [...stateRecords, ...eventRecords, ...treeRecords, ...outcomeRecords];

  // SANITY FLOOR (MEDIUM-2, now outcome-aware — MEDIUM-4): zero completed phases while task-tree
  // artifacts exist is normally a parse failure / stalled run -> INCOMPLETE, never a silent REGRESSED.
  // EXCEPTION: a FAILING outcome is the most trustworthy signal and must never be downgraded to
  // INCOMPLETE — suppressing the short-circuit lets `compare` produce REGRESSED.
  const artifactsExist = treeRecords.some((r) => r.kind === 'created_artifact');
  const incomplete = state.phases.length === 0 && artifactsExist && !outcomeRecords.some((r) => r.value === 'fail');
  const incompleteReason = incomplete
    ? 'State parse yielded ZERO completed phases while task-tree artifacts exist; refusing to emit a '
      + 'silent all-phases-missing set (which would false-alarm as REGRESSED). Treat as INCOMPLETE.'
    : null;

  return { records, incomplete, incompleteReason, parseWarnings: state.parseWarnings };
}
