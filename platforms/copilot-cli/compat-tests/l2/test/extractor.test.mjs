// Credit-free unit tests for the L2 predicate extractor + defensive state parser.
// Run ONLY this file:  node --test platforms/copilot-cli/compat-tests/l2/test/extractor.test.mjs
//
// Covers Task Group 2 acceptance:
//   - Events -> raw records (delegated / invoked_skill / gate_fired / reached_terminal)
//   - HIGH-1: invoked_skill derives from `skill.invoked` ONLY; `session.skills_loaded` is IGNORED
//   - EXCLUDED noise (arg values, counts, ordering, narration) produce NO records
//   - MEDIUM-2: defensive `parseState` over the REAL serialization (flow-array AND block-sequence
//     completed_phases; nested task_characteristics; task.status vs verification_context.last_status)
//   - MEDIUM-2 sanity floor: empty completed_phases while task-tree artifacts exist -> INCOMPLETE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract, parseState, extractFromEvents, extractFromTree } from '../extractor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, 'fixtures', 'extractor');

const EVENTS = JSON.parse(fs.readFileSync(path.join(FIX, 'events.sample.json'), 'utf8'));
const STATE_YAML = fs.readFileSync(path.join(FIX, 'orchestrator-state.sample.yml'), 'utf8');
const TASK_TREE = path.join(FIX, 'task-tree');

// ---- helpers -------------------------------------------------------------
const namesOf = (records, kind) =>
  records.filter((r) => r.kind === kind).map((r) => r.name);
const setOf = (records, kind) => new Set(namesOf(records, kind));

// =========================================================================
// EVENTS -> raw records (4 tests)
// =========================================================================

test('T1 events: subagent.started -> delegated(agentName), name preserved as observed', () => {
  const records = extractFromEvents(EVENTS);
  const delegated = setOf(records, 'delegated');

  // Every subagent.started in the fixture surfaces as a delegated record...
  const expected = [
    'maister-copilot:gap-analyzer',
    'maister-copilot:specification-creator',
    'maister-copilot:implementation-planner',
    'maister-copilot:task-group-implementer',
    'maister-copilot:implementation-completeness-checker',
    'maister-copilot:test-suite-runner',
    'maister-copilot:code-reviewer',
  ];
  for (const a of expected) assert.ok(delegated.has(a), `missing delegated(${a})`);
  assert.equal(delegated.size, expected.length, 'unexpected extra delegated records');

  // ...and the plugin prefix is preserved verbatim (normalization is a later stage's job).
  const rec = records.find((r) => r.kind === 'delegated' && r.name === 'maister-copilot:gap-analyzer');
  assert.equal(rec.source, 'events');
  assert.match(rec.evidence, /subagent\.started/);
});

test('T2 events HIGH-1: invoked_skill derives from skill.invoked ONLY; session.skills_loaded is IGNORED', () => {
  // Guard the fixture actually exercises the flooding risk: a skills_loaded event with ~19 entries.
  const loaded = EVENTS.find((e) => e.type === 'session.skills_loaded');
  assert.ok(loaded, 'fixture must contain a session.skills_loaded event');
  assert.ok(loaded.data.skills.length >= 19, `expected ~19 loaded skills, got ${loaded.data.skills.length}`);

  const records = extractFromEvents(EVENTS);
  const invoked = setOf(records, 'invoked_skill');

  // invoked_skill == exactly the four `skill.invoked` events, nothing more.
  assert.deepEqual(
    [...invoked].sort(),
    ['codebase-analyzer', 'development', 'implementation-plan-executor', 'implementation-verifier'],
  );

  // The ~19 loaded-but-not-invoked skills must NOT flood the record set (the HIGH-1 defect).
  for (const s of loaded.data.skills.map((k) => k.name)) {
    if (['development', 'codebase-analyzer', 'implementation-plan-executor', 'implementation-verifier'].includes(s)) continue;
    assert.ok(!invoked.has(s), `session.skills_loaded skill leaked as invoked_skill(${s}) — HIGH-1 regression`);
  }
  // e.g. `research` is loaded but never invoked -> must be absent.
  assert.ok(!invoked.has('research'), 'research is loaded-only and must not appear as invoked_skill');
});

test('T3 events: gate requests -> gate_fired(ask|permission|exit_plan_mode)', () => {
  const records = extractFromEvents(EVENTS);
  const gates = setOf(records, 'gate_fired');
  assert.deepEqual([...gates].sort(), ['ask', 'exit_plan_mode', 'permission']);

  // ask derives from user_input.requested specifically.
  const askRec = records.find((r) => r.kind === 'gate_fired' && r.name === 'ask');
  assert.match(askRec.evidence, /user_input\.requested/);
});

test('T4 events: reached_terminal(completion) on idle/shutdown w/o error; EXCLUDED noise -> no records', () => {
  const records = extractFromEvents(EVENTS);

  // Exactly one terminal record despite multiple idle events + a shutdown.
  const terminal = namesOf(records, 'reached_terminal');
  assert.deepEqual(terminal, ['completion']);

  // EXCLUDED noise: assistant.message (narration), tool.execution_* (arg values / results) produce
  // NO records. The only record kinds present come from the handled discriminators.
  const kinds = new Set(records.map((r) => r.kind));
  // gate_count is now ALWAYS emitted once when >=1 user_input.requested is seen (the fixture has one),
  // so it joins the kind set even with the default (empty) gateMap.
  assert.deepEqual([...kinds].sort(), ['delegated', 'gate_count', 'gate_fired', 'invoked_skill', 'reached_terminal']);
  // No record's evidence references a tool-execution or assistant-message event.
  for (const r of records) assert.doesNotMatch(r.evidence, /tool\.execution|assistant\.message/);

  // session.error suppresses terminal completion (never a false "reached_terminal").
  const errored = extractFromEvents([
    { type: 'session.idle', id: 'x1', data: {} },
    { type: 'session.error', id: 'x2', data: { errorType: 'query', message: 'boom' } },
  ]);
  assert.equal(namesOf(errored, 'reached_terminal').length, 0, 'session.error must suppress reached_terminal');
});

// =========================================================================
// GATES: gateMap placement + gate_count once (Stage 3, 3 tests)
// =========================================================================

// A slice of the development gateMap (first-match-wins, case-insensitive) — enough to exercise
// phase placement without depending on scenarios/*.mjs (Group 3's file).
const devGateMap = [
  { re: /continue to phase [345]:/i, phase: 2 },
  { re: /continue to specification audit/i, phase: 5 },
  { re: /which standard verifications/i, phase: 10 },
];

test('G1 events: gateMap places gate_fired_at(phase-N) on first match AND still pushes gate_fired(ask)', () => {
  const events = [
    { type: 'user_input.requested', id: 'u1', data: { question: 'Continue to Phase 5: Technical Approach?' } },
    { type: 'user_input.requested', id: 'u2', data: { question: 'Which standard verifications to run?' } },
  ];
  const records = extractFromEvents(events, devGateMap);

  // Each mapped question yields its phase-placed gate (phase-2 for the "Continue to Phase 5:" text,
  // phase-10 for the verifications text — first-match-wins over the gateMap order).
  const firedAt = namesOf(records, 'gate_fired_at').sort();
  assert.deepEqual(firedAt, ['phase-10', 'phase-2'].sort());

  // gate_fired(ask) is ALWAYS pushed (unconditional — even on a gateMap match); it is a required
  // predicate in every reference and must never be lost. One per user_input.requested.
  assert.equal(records.filter((r) => r.kind === 'gate_fired' && r.name === 'ask').length, 2);

  // The phase gate carries the question in its evidence.
  const p2 = records.find((r) => r.kind === 'gate_fired_at' && r.name === 'phase-2');
  assert.equal(p2.source, 'events');
  assert.match(p2.evidence, /Continue to Phase 5/);
});

test('G2 events: gate_count(ask)=K emitted EXACTLY ONCE with K = count of user_input.requested', () => {
  const events = [
    { type: 'user_input.requested', id: 'u1', data: { question: 'Continue to Phase 5: x?' } },
    { type: 'user_input.requested', id: 'u2', data: { question: 'Which standard verifications to run?' } },
    { type: 'user_input.requested', id: 'u3', data: { question: 'some unmapped question' } },
  ];
  const records = extractFromEvents(events, devGateMap);

  const counts = records.filter((r) => r.kind === 'gate_count');
  assert.equal(counts.length, 1, 'gate_count emitted exactly once, never per-event');
  assert.equal(counts[0].name, 'ask');
  assert.equal(counts[0].value, 3, 'K = number of user_input.requested events seen');
});

test('G3 events: empty gateMap -> NO gate_fired_at, only gate_fired(ask) + gate_count', () => {
  const events = [
    { type: 'user_input.requested', id: 'u1', data: { question: 'Continue to Phase 5: x?' } },
  ];
  const records = extractFromEvents(events); // default gateMap = []

  assert.equal(namesOf(records, 'gate_fired_at').length, 0, 'no phase gate without a gateMap');
  assert.equal(records.filter((r) => r.kind === 'gate_fired' && r.name === 'ask').length, 1);
  const counts = records.filter((r) => r.kind === 'gate_count');
  assert.equal(counts.length, 1);
  assert.equal(counts[0].value, 1);
});

// =========================================================================
// STATE -> raw records (MEDIUM-2, 3 tests)
// =========================================================================

test('T5 state: completed_phases parses inline flow-array AND block-sequence; phase[-_] stripped to int', () => {
  // (a) The committed real-format sample uses an inline flow array of quoted "phase-N".
  const flow = parseState(STATE_YAML);
  assert.deepEqual(flow.phases, [1, 2, 5, 6, 7, 8, 10, 11, 14]);
  assert.ok(Array.isArray(flow.parseWarnings));
  // Must NOT pick up unrelated `phase-N` occurrences (started_phase / task_ids mapping).

  // (b) Block-sequence form, tolerant of both `phase-` and `phase_` separators.
  const block = parseState(
    [
      'orchestrator:',
      '  completed_phases:',
      '    - "phase-1"',
      '    - "phase-2"',
      '    - "phase_10"',
      '  started_phase: phase-1',
      'task:',
      '  status: in_progress',
    ].join('\n'),
  );
  assert.deepEqual(block.phases, [1, 2, 10]);

  // (c) Empty inline array -> zero phases (feeds the sanity floor), no crash.
  const empty = parseState('orchestrator:\n  completed_phases: []\n');
  assert.deepEqual(empty.phases, []);
});

test('T5b state: completed_phases as BARE integers (LLM serialization variance) parses via fallback', () => {
  // A run may serialize completed_phases as bare ints instead of the maister "phase-N" convention
  // (observed once on Copilot 1.0.75). The fallback must still yield the phases so a format-only
  // difference does not read as zero phases -> false sanity-floor INCOMPLETE.
  const flow = parseState('orchestrator:\n  completed_phases: [1, 2, 5, 7, 8, 10, 11, 14]\ntask:\n  status: completed\n');
  assert.deepEqual(flow.phases, [1, 2, 5, 7, 8, 10, 11, 14]);
  assert.equal(flow.status, 'completed');
  // Block-sequence bare-int form too.
  const block = parseState('orchestrator:\n  completed_phases:\n    - 1\n    - 2\n    - 6\n');
  assert.deepEqual(block.phases, [1, 2, 6]);
  // The "phase-N" form is unaffected (the bare-int fallback fires ONLY when phase-N yields nothing).
  const pref = parseState('orchestrator:\n  completed_phases: ["phase-1", "phase-2"]\n');
  assert.deepEqual(pref.phases, [1, 2]);
});

test('T5c state: Copilot 1.0.75 real shape — all under orchestrator:, bare-int phases, orchestrator.status', () => {
  // Real-shape 1.0.75 state: NO top-level task: block; task status at orchestrator.status; a decoy
  // per-phase `phases:` map (each {status: completed}). parseState must still yield the phases (bare
  // int), the task status (from orchestrator.status, NOT a per-phase one), and the characteristics.
  const yaml = fs.readFileSync(path.join(FIX, 'orchestrator-state.copilot-1.0.75.sample.yml'), 'utf8');
  const s = parseState(yaml);
  assert.deepEqual(s.phases, [1, 2, 5, 6, 7, 8, 10, 11, 14], 'bare-int completed_phases under orchestrator');
  assert.equal(s.status, 'completed', 'task status from orchestrator.status (fallback: no top-level task: block)');
  assert.deepEqual(s.characteristics, {
    has_reproducible_defect: false,
    modifies_existing_code: true,
    creates_new_entities: false,
    involves_data_operations: false,
    ui_heavy: false,
  });
});

test('T5d state: Copilot 1.0.81 research shape — NO completed_phases key; phases derived from phase_summaries', () => {
  // Real-shape 1.0.81 research state: the model serialized NO `completed_phases` array at all —
  // completed phases live only as a `phase_summaries:` map with `phase-N:` entry keys (under
  // research_context), with `orchestrator.phase: complete`. Without the fallback, parseState yields
  // zero phases and the sanity floor trips to a false INCOMPLETE even though the workflow completed.
  const yaml = fs.readFileSync(path.join(FIX, 'orchestrator-state.copilot-1.0.81-research.sample.yml'), 'utf8');
  const s = parseState(yaml);
  assert.deepEqual(s.phases, [1, 2, 3, 4, 5], 'phases derived from phase_summaries phase-N keys (no completed_phases array)');
  // Research state carries no `status:` key and no task_characteristics block (task_status comes from
  // the event stream, characteristics are a development/gap-analyzer concept) — both legitimately absent.
  assert.equal(s.status, null, 'no state-sourced task status in this research shape');
  assert.deepEqual(s.characteristics, {}, 'no task_characteristics in the research shape');
});

test('T5e state: Copilot 1.0.81 development shape — NO completed_phases; phases from a phases: {id,status} sequence', () => {
  // Real-shape 1.0.81 development state (3rd serialization variant): no `completed_phases` array, and
  // `phase_summaries` is keyed by NAMED phases (codebase_analysis, …) not `phase-N`, so the only
  // machine-readable completion record is a `phases:` SEQUENCE of `{ id: N, name, status: completed }`.
  // parseState must derive the phases from those items (status == completed), else the sanity floor
  // trips to a false INCOMPLETE even though phases 1..14 ran.
  const yaml = fs.readFileSync(path.join(FIX, 'orchestrator-state.copilot-1.0.81-development.sample.yml'), 'utf8');
  const s = parseState(yaml);
  assert.deepEqual(s.phases, [1, 2, 5, 6, 7, 8, 10, 11, 14], 'phases derived from the phases: {id,status:completed} sequence');
  // Characteristics ARE present here (under task_context); task status is not at an indent the
  // fallback reads (it comes from the event stream in the skeleton), so state-sourced status is null.
  assert.deepEqual(s.characteristics, {
    has_reproducible_defect: false,
    modifies_existing_code: true,
    creates_new_entities: false,
    involves_data_operations: false,
    ui_heavy: false,
  });
});

test('T5f state: Copilot 1.0.81 dev — PARTIAL completed_phases + full phases: {number} sequence (union)', () => {
  // The model was inconsistent in one run: `completed_phases: [1]` (only phase 1) AND a full `phases:`
  // sequence keyed by `- number: N` (not `id:`), every item completed. parseState must UNION the signals
  // (completed_phases ∪ phase_summaries ∪ phases[]) and accept id|number|phase as the item key, else the
  // partial array wins and the run false-INCOMPLETEs. Recovers the full set.
  const yaml = fs.readFileSync(path.join(FIX, 'orchestrator-state.copilot-1.0.81-development-partial.sample.yml'), 'utf8');
  const s = parseState(yaml);
  assert.deepEqual(s.phases, [1, 2, 5, 6, 7, 8, 10, 11, 14], 'union of partial completed_phases + phases: number-keyed sequence');
});

test('T6 state: 5 task_characteristics under task_context; task.status disambiguated from last_status', () => {
  const s = parseState(STATE_YAML);

  assert.deepEqual(s.characteristics, {
    has_reproducible_defect: false,
    modifies_existing_code: true,
    creates_new_entities: true,
    involves_data_operations: false,
    ui_heavy: false,
  });

  // task.status must be the value under the top-level `task:` block ("completed"),
  // NOT verification_context.last_status ("as-expected").
  assert.equal(s.status, 'completed');
  assert.notEqual(s.status, 'as-expected');
});

test('T7 sanity floor: empty completed_phases while task-tree artifacts exist -> INCOMPLETE (never silent)', () => {
  // Committed fixture is a direct task dir (kept free of a literal `.maister/` so it stays trackable
  // — the repo root .gitignore ignores `.maister/`). It yields the four allowed artifacts and ONLY
  // those (the `analysis/requirements.md` + `implementation/spec.html` decoys are excluded).
  const treeRecords = extractFromTree(TASK_TREE);
  assert.deepEqual(
    setOf(treeRecords, 'created_artifact'),
    new Set([
      'implementation/spec.md',
      'implementation/implementation-plan.md',
      'implementation/work-log.md',
      'verification/verification-report.md',
    ]),
  );

  // Cover the PRODUCTION resolution path too: a rundir containing `.maister/tasks/development/<date>/`.
  // The real rundir is an mktemp dir OUTSIDE the repo, so its `.maister/` is not gitignored; built
  // here in os.tmpdir() to exercise the primary glob branch of findTaskDirs.
  const rundir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-extractor-'));
  try {
    const td = path.join(rundir, '.maister', 'tasks', 'development', '2026-07-24-add-greet');
    fs.mkdirSync(path.join(td, 'implementation'), { recursive: true });
    fs.mkdirSync(path.join(td, 'verification'), { recursive: true });
    fs.writeFileSync(path.join(td, 'implementation', 'spec.md'), '# spec');
    fs.writeFileSync(path.join(td, 'verification', 'report.md'), '# report');
    assert.deepEqual(
      setOf(extractFromTree(rundir), 'created_artifact'),
      new Set(['implementation/spec.md', 'verification/report.md']),
    );
  } finally {
    fs.rmSync(rundir, { recursive: true, force: true });
  }

  // Empty phases + artifacts present -> the extractor raises the INCOMPLETE flag rather than
  // silently emitting an all-phases-missing set (which would false-alarm as REGRESSED downstream).
  const emptyPhasesState = 'orchestrator:\n  completed_phases: []\ntask:\n  status: completed\n';
  const result = extract({ events: [], taskDirRoot: TASK_TREE, stateYaml: emptyPhasesState });
  assert.equal(result.incomplete, true);
  assert.match(result.incompleteReason, /phase|artifact/i);

  // Control: with phases present, the same tree does NOT trip the floor.
  const ok = extract({ events: EVENTS, taskDirRoot: TASK_TREE, stateYaml: STATE_YAML });
  assert.equal(ok.incomplete, false);
  // And the merged record array carries state + events + tree sources.
  assert.deepEqual(new Set(ok.records.map((r) => r.source)), new Set(['state', 'events', 'tree']));
});
