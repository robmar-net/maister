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

// Stage 4 (issue #48): the extractor preserves observed names verbatim in its emitted records
// (normalization is normalize.mjs's job), BUT precedes/min_count must MATCH a scenario's bare
// canonical agent name (e.g. `gap-analyzer`) against an observed prefixed event name
// (`maister-copilot:gap-analyzer`). Stripping is applied ONLY to the internal firstIndex/counts
// map KEYS used for that match — never to an emitted record's payload.
const PLUGIN_PREFIX_RE = /^maister(?:-copilot)?:/;
const stripPluginPrefix = (name) => String(name).replace(PLUGIN_PREFIX_RE, '');

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
function phasesFromCompletedPhasesKey(lines, idx, warnings, divergences) {
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
    if (nums.length > 0) {
      // OFF-SCHEMA SERIALIZATION (Stage 4 §2.4a divergence site 1): bare-int completed_phases is a
      // documented tolerant-parse branch, NOT a legitimate absence -> record it as a schemaDivergence.
      const msg = 'completed_phases parsed as bare integers (no phase-N prefix)';
      warnings.push(msg);
      divergences.push(msg);
    }
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
function parseCompletedPhases(lines, warnings, divergences) {
  const set = new Set();
  const sources = [];

  const idx = lines.findIndex((l) => /^\s*completed_phases\s*:/.test(l));
  if (idx !== -1) {
    const arr = phasesFromCompletedPhasesKey(lines, idx, warnings, divergences);
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
    // OFF-SCHEMA SERIALIZATION (Stage 4 §2.4a divergence site 2): completed phases recovered from a
    // union of non-canonical sources (phase_summaries / phases: sequence, or no completed_phases key
    // at all) is a tolerant-parse branch, NOT a legitimate absence -> record it as a schemaDivergence.
    const msg = `completed_phases derived from union of [${sources.join(', ')}] (LLM serialization variance)`;
    warnings.push(msg);
    divergences.push(msg);
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
function parseTaskStatus(lines, warnings, divergences) {
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
        // OFF-SCHEMA SERIALIZATION (Stage 4 §2.4a divergence site 3): task status read from a
        // top-level status: key with NO task: block is a tolerant-parse branch, NOT a legitimate
        // absence -> record it as a schemaDivergence.
        const msg = 'task status read from a top-level status: key (no task: block — LLM serialization variance)';
        warnings.push(msg);
        divergences.push(msg);
        return v;
      }
    }
  }
  if (idx === -1) warnings.push('task: block not found for status');
  return null;
}

// Defensive targeted parser for the known orchestrator-state keys. No YAML library (zero-dep).
// Returns { phases:int[], characteristics:{...}, status:string|null, parseWarnings:string[],
//           schemaDivergences:string[] }.
//
// Stage 4 (issue #48) §2.4a: `parseWarnings` is a GRAB-BAG that mixes true off-schema-serialization
// signals with LEGITIMATE absences (task_characteristics block not found, missing characteristic,
// no task: block). `schemaDivergences` is the DEDICATED, absence-free signal: it is populated ONLY
// by the three tolerant OFF-SCHEMA-SERIALIZATION branches (bare-int completed_phases, union-from-
// non-canonical, top-level status: with no task: block). state_schema(conformant) keys on
// schemaDivergences.length===0 — NOT parseWarnings — so research's legitimately-absent
// task_characteristics never emits a false off-schema.
export function parseState(yamlText) {
  const parseWarnings = [];
  const schemaDivergences = [];
  const text = typeof yamlText === 'string' ? yamlText : '';
  const lines = text.split(/\r?\n/);
  return {
    phases: parseCompletedPhases(lines, parseWarnings, schemaDivergences),
    characteristics: parseCharacteristics(lines, parseWarnings),
    status: parseTaskStatus(lines, parseWarnings, schemaDivergences),
    parseWarnings,
    schemaDivergences,
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
export function extractFromEvents(events, gateMap = [], precedesChain = [], minCounts = []) {
  const records = [];
  if (!Array.isArray(events)) return records;

  const gates = Array.isArray(gateMap) ? gateMap : [];
  let sawIdleOrShutdown = false;
  let sawError = false;
  let askCount = 0; // count of user_input.requested — feeds the single gate_count(ask)=K emission.
  // WP-D (issue #76): cheap census counters. Emit ONCE after the loop (like askCount) so a token
  // never inflates per-event. `todos(created)` <- >=1 session.todos_changed; `standards(index_read)`
  // <- >=1 read-tool read of `.maister/docs/INDEX.md` (apply_patch writes that merely MENTION the
  // path in the state file are NOT reads — same READ_TOOLS filter as tools/parity-evidence.mjs).
  let todosChangedCount = 0;
  let indexReadCount = 0;
  const STANDARDS_READ_TOOLS = new Set(['view', 'read', 'rg', 'glob', 'cat', 'grep']);

  // Stage 4 (issue #48): order + fan-out aggregates. Keyed by the plugin-prefix-stripped name so a
  // scenario's bare chain matches an observed prefixed event. `firstIndex` records FIRST-sight event
  // order (never sorted — order IS the signal) over BOTH subagent.started AND skill.invoked, because
  // a precedes chain may reference a skill-invoked orchestrator (e.g. dev's implementation-verifier
  // surfaces as skill.invoked, not subagent.started — the terminal dev edge depends on it). `counts`
  // is subagent.started(delegated)-only, since min_count is over delegated(x).
  const firstIndex = new Map();
  const counts = new Map();

  let i = -1;
  for (const e of events) {
    i += 1;
    if (!e || typeof e.type !== 'string') continue;
    const data = e.data || {};

    switch (e.type) {
      case 'subagent.started': {
        const name = data.agentName || data.agentDisplayName;
        if (name) {
          records.push({ kind: 'delegated', name, source: 'events', evidence: `subagent.started agentName=${name}` });
          const bare = stripPluginPrefix(name);
          if (!firstIndex.has(bare)) firstIndex.set(bare, i); // first sight only — do NOT overwrite
          counts.set(bare, (counts.get(bare) || 0) + 1);       // every occurrence (delegated fan-out)
        }
        break;
      }
      case 'skill.invoked': {
        // HIGH-1: this is the ONLY source of invoked_skill.
        if (data.name) {
          records.push({ kind: 'invoked_skill', name: data.name, source: 'events', evidence: `skill.invoked name=${data.name}` });
          const bare = stripPluginPrefix(data.name);
          if (!firstIndex.has(bare)) firstIndex.set(bare, i); // order node for precedes (skill-invoked)
        }
        break;
      }
      case 'session.skills_loaded':
        // HIGH-1: deliberately IGNORED — lists resolved-but-not-invoked skills (~19), never invoked.
        break;
      case 'user_input.requested': {
        // Per-scenario gateMap ([{re, phase}], first-match-wins) places the gate on its phase by
        // matching the question text. On the FIRST matching re, emit the phase-placed gate.
        const q = data.question;
        if (typeof q === 'string') {
          for (const g of gates) {
            if (g && g.re instanceof RegExp && g.re.test(q)) {
              records.push({
                kind: 'gate_fired_at',
                name: 'phase-' + g.phase,
                source: 'events',
                evidence: `user_input.requested question=${q}`,
              });
              break; // first match wins
            }
          }
        }
        // ALWAYS also push the required gate_fired(ask) — unconditional, even on a gateMap match.
        records.push({ kind: 'gate_fired', name: 'ask', source: 'events', evidence: 'user_input.requested' });
        askCount += 1;
        break;
      }
      case 'permission.requested': {
        records.push({ kind: 'gate_fired', name: 'permission', source: 'events', evidence: 'permission.requested' });
        // hook_effect emit DIRECTLY from the event (issue #48). The live guard-originated permission is
        // distinguished by `permissionRequest.kind === "hook"` (an ordinary shell permission is
        // `kind:"shell"`). The command lives at `permissionRequest.toolArgs.command` and the guard marker
        // is `permissionRequest.hookMessage` (there is NO permissionDecision/hookSpecificOutput field on the
        // live shape — a kind:"hook" permission carrying the "Maister guard" hookMessage IS the `ask`). This
        // makes `=ask` a DIRECTLY-OBSERVED value, replayable from events.json (confirmed by the first live
        // run, reports/20260829T231857Z).
        // Verbatim mirror of block-destructive-commands.sh:54 (case-insensitive). Zero-touch — never re-authored.
        const DESTRUCTIVE = /git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*$|git\s+clean|git\s+push\s+(-f|--force)|rm\s+-rf/i;
        const pr = (e.data || {}).permissionRequest || {};
        // EMPTY/BENIGN-PERMISSION INVARIANT: an ordinary permission.requested with kind:"shell"
        // (dev/research fixtures) does NOT match kind==='hook' -> NO hook_effect -> the dev/research
        // pipeline snapshots stay byte-identical. Only a guard-originated kind:"hook" permission emits.
        if (pr.kind === 'hook') {
          const msgMatch = /Maister guard: destructive command/i.test(pr.hookMessage || '');
          const cmdMatch = DESTRUCTIVE.test((pr.toolArgs && pr.toolArgs.command) || '');
          if (msgMatch || cmdMatch) {
            records.push({
              kind: 'hook_effect',
              name: 'destructive_guard',
              value: 'ask',
              source: 'events',
              evidence: 'permission.requested kind=hook ' + (msgMatch ? 'hookMessage matched' : 'command matched'),
            });
          }
        }
        break;
      }
      case 'exit_plan_mode.requested':
        records.push({ kind: 'gate_fired', name: 'exit_plan_mode', source: 'events', evidence: 'exit_plan_mode.requested' });
        break;
      case 'session.todos_changed':
        // WP-D (issue #76). The SDK emits this each time the task list mutates — the observable
        // effect of maister's TaskCreate/TaskUpdate -> todos transform. Census only; emit once below.
        todosChangedCount += 1;
        break;
      case 'tool.execution_start': {
        // WP-D (issue #76). Standards lazy-load: a READ-tool read of `.maister/docs/INDEX.md`. The
        // args JSON is probed (path shape varies by tool); apply_patch is excluded by the tool
        // allowlist so state-file MENTIONS of the path never count as a read. Census only.
        const tool = data.toolName;
        if (STANDARDS_READ_TOOLS.has(tool)) {
          const args = JSON.stringify(data.arguments ?? {});
          if (/\.maister\/docs\/INDEX\.md/.test(args)) indexReadCount += 1;
        }
        break;
      }
      case 'session.idle':
      case 'session.shutdown':
        sawIdleOrShutdown = true;
        break;
      case 'session.error':
        sawError = true;
        break;
      default:
        // Everything else (assistant.message, other tool.execution_*, turn/ordering events) is noise.
        break;
    }
  }

  // Report-only gate census: emit gate_count(ask)=K exactly ONCE (never per-event, or K inflates),
  // only when >=1 user_input.requested was seen. K = the number of those events. source:'events' keeps
  // it consistent with every other event-derived record (and out of the tree/state source buckets).
  if (askCount >= 1) {
    records.push({ kind: 'gate_count', name: 'ask', value: askCount, source: 'events', evidence: `user_input.requested count=${askCount}` });
  }

  // WP-D (issue #76): single-shot census predicates (never per-event). Presence, not count.
  if (todosChangedCount >= 1) {
    records.push({ kind: 'todos', name: 'created', source: 'events', evidence: `session.todos_changed count=${todosChangedCount}` });
  }
  if (indexReadCount >= 1) {
    records.push({ kind: 'standards', name: 'index_read', source: 'events', evidence: `.maister/docs/INDEX.md read-tool reads=${indexReadCount}` });
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

  // Stage 4 (issue #48) — precedes ORDER edges. One token per ADJACENT chain pair (a,b), emitted
  // IFF both endpoints were observed AND a precedes b in first-sight order. A present-but-out-of-order
  // pair, or a pair with either endpoint absent, is SILENT (truth table §2.2): the out-of-order case
  // leaves the required edge missing => REGRESSED (order violated); an absent delegation already
  // REGRESSES via its own missing delegated(x), so the edge is not double-counted. The emitted payload
  // uses the chain's own (bare) names, so the token is bare regardless of the observed prefix.
  for (let k = 0; k + 1 < precedesChain.length; k++) {
    const a = precedesChain[k];
    const b = precedesChain[k + 1];
    if (firstIndex.has(a) && firstIndex.has(b) && firstIndex.get(a) < firstIndex.get(b)) {
      records.push({
        kind: 'precedes',
        name: `${a},${b}`,
        source: 'events',
        evidence: `firstIndex(${a})<firstIndex(${b})`,
      });
    }
  }

  // Stage 4 (issue #48) — min_count token-expansion (Option b). For each requested name, emit
  // min_count(delegated(name))=k for k=1..observedCount; the reference asserts the exact =K by SET
  // MEMBERSHIP (present iff observed>=K), so compare needs no `>=` logic. c=0 emits nothing.
  for (const name of minCounts) {
    const c = counts.get(name) || 0;
    for (let k = 1; k <= c; k++) {
      records.push({
        kind: 'min_count',
        name: `delegated(${name})`,
        value: k,
        source: 'events',
        evidence: `observed ${c} delegated(${name})`,
      });
    }
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
      // WP-D (issue #76): operator dashboard, produced at task root when html_output=true (default).
      // Modelled OPTIONAL in the reference (config-gated), so a markdown-only run does not fail.
      'dashboard.html',
      'dashboard-data.js',
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
  work: {
    // `work` (#85) is a routing ENTRY POINT — the routed workflow owns whatever tree it writes, and the
    // route is task-dependent. An empty, no-match profile keeps the `work` reference route-INVARIANT
    // (events-only: invoked_skill(work) + delegated(task-classifier) + outcome + terminal); any routed
    // orchestrator artifacts stay unmodelled here and, if observed, are calibrated into the reference's
    // optional/allowlist from the live run rather than fitted blindly. Mirrors the quick-bugfix profile.
    taskType: 'work',
    exactArtifacts: [],
    collapseDirs: [],
    fallbackDirs: [],
  },
  init: {
    // `init` (#85) bootstraps a DOCS tree at `.maister/docs/**` (not `.maister/tasks/`), so it uses the
    // `rootRel` override. INDEX.md is the always-created core artifact (init/SKILL.md :167 "Verify INDEX.md
    // exists"); the per-category project docs are conditional on the standards selection, so only INDEX.md
    // is modelled here as `created_artifact(INDEX.md)` — the rest, if observed, calibrate into optional.
    taskType: 'init',
    rootRel: path.join('.maister', 'docs'),
    exactArtifacts: ['INDEX.md'],
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
  // #85 `init` writes a docs tree at `.maister/docs/**`, NOT `.maister/tasks/<taskType>/*`. A profile
  // with an explicit `rootRel` treats that path (under the rundir) as its single "task dir" so
  // exactArtifacts resolve relative to it — bypassing the tasks/<taskType> convention entirely.
  if (profile.rootRel) {
    const r = path.join(root, profile.rootRel);
    return isDir(r) ? [r] : [];
  }
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
  if (hasAssert
    && spec.assert !== 'research-deliverables'
    && spec.assert !== 'artifact-headings'
    && spec.assert !== 'report-contains') {
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
  // Informational per-check tally (issue #88): the sample-cli runners print "<k> passed, <m> failed";
  // surface k/N in the evidence so a multi-check oracle is not reported as a single opaque bit. The
  // pass/fail VERDICT is still exit-code only — the tally never changes it.
  const tallyMatch = stdout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const tally = tallyMatch ? ` (${Number(tallyMatch[1])}/${Number(tallyMatch[1]) + Number(tallyMatch[2])} checks)` : '';
  if (typeof spec.expect === 'string') {
    const ok = code === 0 && stdout.trim() === spec.expect;
    return mk(ok ? 'pass' : 'fail',
      `${spec.command} exited ${code}; stdout ${ok ? 'matched' : 'did not match'} expect${tally}`);
  }
  const ok = code === 0;
  return mk(ok ? 'pass' : 'fail', `${spec.command} exited ${code}${tally}`);
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

// assertion-type ('artifact-headings'): a STRUCTURE oracle over ONE produced artifact. Asserts the
// maister Artifact Summary Contract (orchestrator-patterns.md § 7:408 — "every artifact opens with a
// TL;DR"): the artifact's FIRST markdown heading is `## TL;DR`, and the file is non-stub (>= minBytes).
// Body-section headings are deliberately NOT asserted: the templates mandate them but their WORDING
// legitimately varies per task (e.g. spec "## Goal" vs a run's "## Goal and User Journey"), so a
// wording match would fit-to-run; the § 7 opener is the stable, uniformly-mandated invariant. This is
// content/structure, NOT mere existence (the created_artifact tree records already prove existence).
// params: { file (task-dir-relative), taskType (default 'development'), requiredHeading (default
// '## TL;DR'), minBytes (default 0) }. Any unmet condition -> fail naming it (surfaced VISIBLY; the
// reference allowlists the matching `=fail` as a tracked LIMITATION until >=2 runs promote `=pass`).
function runArtifactHeadingsOutcome(spec, rundir) {
  const id = spec.id;
  const mk = (value, evidence) => ({ kind: 'outcome', name: id, value, source: 'outcome', evidence });
  const params = spec.params || {};
  const rel = String(params.file ?? '');
  const taskType = String(params.taskType ?? 'development');
  const requiredHeading = String(params.requiredHeading ?? '## TL;DR');
  const minBytes = Number(params.minBytes ?? 0);
  if (!rel) return mk('fail', 'artifact-headings spec missing params.file');

  // Newest task dir under rundir/.maister/tasks/<taskType>/*.
  const typeRoot = path.join(String(rundir ?? ''), '.maister', 'tasks', taskType);
  let taskDir = null;
  try {
    const dirs = fs.readdirSync(typeRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(typeRoot, e.name));
    taskDir = dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch { taskDir = null; }
  if (!taskDir) return mk('fail', `no ${taskType} task dir under .maister/tasks/${taskType}/*`);

  const file = path.join(taskDir, rel);
  if (!isFile(file)) return mk('fail', `${rel} missing`);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return mk('fail', `${rel} unreadable: ${err.message}`); }

  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes < minBytes) return mk('fail', `${rel} ${bytes} bytes < minBytes ${minBytes}`);

  // FIRST markdown heading (any level) must be the § 7 opener. Trailing whitespace tolerated.
  const firstHeading = (text.match(/^#{1,6}\s+.*$/m) || [null])[0];
  if (firstHeading == null) return mk('fail', `${rel} has no markdown heading`);
  if (firstHeading.trim() !== requiredHeading) {
    return mk('fail', `${rel} opens with "${firstHeading.trim()}", not the § 7 contract "${requiredHeading}"`);
  }
  return mk('pass', `${rel} opens with "${requiredHeading}" (§ 7 Artifact Summary Contract), ${bytes}B`);
}

// assertion-type ('report-contains'): a PRODUCT-CORRECTNESS oracle (issue #88) over ONE produced
// artifact. Unlike 'artifact-headings' (form) and 'research-deliverables' (existence + size), this
// asserts the deliverable ANSWERED the planted question: the report must mention EVERY token in
// params.tokens (case-insensitive substring) AND match at least ONE of params.anyOf (regex sources,
// case-insensitive). Ground truth is planted OFFLINE in the sandbox (no network, no LLM judge), and the
// token/anyOf grader is authored from the TASK SPEC before the first live run — a cheap, deterministic
// FLOOR (a one-token grep can false-pass; documented as such in the derivation), never a rubric.
// params: { file (task-dir-relative, default 'outputs/research-report.md'), taskType (default
// 'research'), tokens (string[], ALL required), anyOf (string[] regex sources, >=1 required) }.
// Any unmet condition -> fail naming it (surfaced VISIBLY; the reference allowlists the matching
// `=fail` as a tracked LIMITATION until >=2 runs promote `=pass`).
function runReportContainsOutcome(spec, rundir) {
  const id = spec.id;
  const mk = (value, evidence) => ({ kind: 'outcome', name: id, value, source: 'outcome', evidence });
  const params = spec.params || {};
  const rel = String(params.file ?? 'outputs/research-report.md');
  const taskType = String(params.taskType ?? 'research');
  const tokens = Array.isArray(params.tokens) ? params.tokens.map(String) : [];
  const anyOf = Array.isArray(params.anyOf) ? params.anyOf.map(String) : [];

  // Newest task dir under rundir/.maister/tasks/<taskType>/*.
  const typeRoot = path.join(String(rundir ?? ''), '.maister', 'tasks', taskType);
  let taskDir = null;
  try {
    const dirs = fs.readdirSync(typeRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(typeRoot, e.name));
    taskDir = dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch { taskDir = null; }
  if (!taskDir) return mk('fail', `no ${taskType} task dir under .maister/tasks/${taskType}/*`);

  const file = path.join(taskDir, rel);
  if (!isFile(file)) return mk('fail', `${rel} missing`);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return mk('fail', `${rel} unreadable: ${err.message}`); }
  const hay = text.toLowerCase();

  const missingToken = tokens.find((t) => !hay.includes(t.toLowerCase()));
  if (missingToken != null) return mk('fail', `${rel} does not mention required token "${missingToken}"`);

  if (anyOf.length > 0) {
    const matched = anyOf.some((src) => { try { return new RegExp(src, 'i').test(text); } catch { return false; } });
    if (!matched) return mk('fail', `${rel} mentions ${tokens.map((t) => `"${t}"`).join('+')} but matches none of the required conclusion patterns`);
  }
  return mk('pass', `${rel} mentions ${tokens.map((t) => `"${t}"`).join('+')}${anyOf.length ? ' + a conclusion pattern' : ''}`);
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
        : spec.assert === 'artifact-headings'
          ? runArtifactHeadingsOutcome(spec, rundir)
          : spec.assert === 'report-contains'
            ? runReportContainsOutcome(spec, rundir)
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
export function extract({ events = [], taskDirRoot = null, stateYaml = null, taskType = 'development', outcome = null, sandboxTemplateDir = null, gateMap = [], precedesChain = [], minCounts = [] } = {}) {
  const state = stateYaml != null
    ? parseState(stateYaml)
    : { phases: [], characteristics: {}, status: null, parseWarnings: ['no stateYaml provided'], schemaDivergences: [] };

  const profile = TREE_PROFILES[taskType] || DEFAULT_TREE_PROFILE;
  const stateRecords = stateToRecords(state);
  const eventRecords = extractFromEvents(events, gateMap, precedesChain, minCounts);
  const treeRecords = taskDirRoot ? extractFromTree(taskDirRoot, profile) : [];
  // Functional oracle (source d): runs the scenario deliverable in the rundir. A bad-shape spec throws
  // here (fail-fast); a runtime/assertion failure is a `value:'fail'` record, never an exception.
  const outcomeRecords = extractFromOutcome(outcome, taskDirRoot, sandboxTemplateDir);

  const records = [...stateRecords, ...eventRecords, ...treeRecords, ...outcomeRecords];

  // Stage 4 (issue #48) §2.4b — state_schema conformance token. Emitted ONLY when state actually
  // exists (stateYaml != null); quick-bugfix has no orchestrator state -> NO record (no predicate).
  // conformant iff schemaDivergences is empty (dedicated off-schema-serialization signal), NOT
  // parseWarnings (which also carries legitimate absences). It is state-sourced by NAME but is a
  // conformance token, NOT a downgrade-eligible floor predicate.
  if (stateYaml != null) {
    records.push({
      kind: 'state_schema',
      name: state.schemaDivergences.length === 0 ? 'conformant' : 'off-schema',
      source: 'state',
      evidence: `schemaDivergences=${state.schemaDivergences.length}`,
    });
  }

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
