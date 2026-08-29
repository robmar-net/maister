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

// =========================================================================
// STAGE 4 (issue #48) — precedes / min_count / state_schema (Task Group 2)
// =========================================================================

const RESEARCH_EVENTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'research', 'events.sample.json'), 'utf8'),
);

// dev order spine (bare canonical names; the extractor strips the observed maister-copilot: prefix
// when keying its firstIndex/counts maps, and implementation-verifier surfaces as a skill.invoked).
const DEV_CHAIN = [
  'gap-analyzer',
  'specification-creator',
  'implementation-planner',
  'task-group-implementer',
  'implementation-verifier',
];

const minCountTokens = (records) =>
  new Set(records.filter((r) => r.kind === 'min_count').map((r) => `${r.name}=${r.value}`));
const stateSchemaOf = (records) => records.filter((r) => r.kind === 'state_schema');

// ---- T-PRECEDES ----------------------------------------------------------

test('T-PRECEDES: all 4 adjacent in-order edges emit over the dev fixture (prefix-stripped match)', () => {
  const records = extractFromEvents(EVENTS, [], DEV_CHAIN);
  const edges = setOf(records, 'precedes');
  assert.deepEqual(
    [...edges].sort(),
    [
      'gap-analyzer,specification-creator',
      'specification-creator,implementation-planner',
      'implementation-planner,task-group-implementer',
      'task-group-implementer,implementation-verifier', // 4th endpoint is a skill.invoked (e018)
    ].sort(),
  );

  // Token payload is the OPAQUE bare "a,b" (chain names, not the observed maister-copilot: prefix);
  // source + evidence carry the first-index ordering rationale.
  const rec = records.find((r) => r.kind === 'precedes' && r.name === 'gap-analyzer,specification-creator');
  assert.equal(rec.source, 'events');
  assert.match(rec.evidence, /firstIndex\(gap-analyzer\)<firstIndex\(specification-creator\)/);
});

test('T-PRECEDES truth table: (a) out-of-order -> no emit; (b) one absent -> no emit; (c) present+ordered -> emit', () => {
  const A = { type: 'subagent.started', id: 'a', data: { agentName: 'maister-copilot:alpha' } };
  const B = { type: 'subagent.started', id: 'b', data: { agentName: 'maister-copilot:beta' } };

  // (c) both present + a before b -> emitted.
  const ok = setOf(extractFromEvents([A, B], [], ['alpha', 'beta']), 'precedes');
  assert.deepEqual([...ok], ['alpha,beta']);

  // (a) present-but-out-of-order (b before a) -> NOT emitted (order violated -> required edge missing).
  const outOfOrder = setOf(extractFromEvents([B, A], [], ['alpha', 'beta']), 'precedes');
  assert.equal(outOfOrder.size, 0, 'out-of-order pair must not emit precedes');

  // (b) one endpoint absent -> NOT emitted (the missing delegation already REGRESSES on its own).
  const oneAbsent = setOf(extractFromEvents([A], [], ['alpha', 'beta']), 'precedes');
  assert.equal(oneAbsent.size, 0, 'edge with an absent endpoint must not emit');
});

test('T-PRECEDES: a skill.invoked endpoint (implementation-verifier) participates in the order spine', () => {
  // Isolates the reason firstIndex tracks skill.invoked too: the terminal dev edge ends at a skill.
  const events = [
    { type: 'subagent.started', id: 's', data: { agentName: 'maister-copilot:task-group-implementer' } },
    { type: 'skill.invoked', id: 'k', data: { name: 'implementation-verifier' } },
  ];
  const edges = setOf(extractFromEvents(events, [], ['task-group-implementer', 'implementation-verifier']), 'precedes');
  assert.deepEqual([...edges], ['task-group-implementer,implementation-verifier']);
});

// ---- T-MINCOUNT ----------------------------------------------------------

test('T-MINCOUNT: token-expansion =1..c; c=2 fixture -> {=1,=2}; c=1 -> {=1}; c=0 -> none', () => {
  // c=2: the research fixture delegates information-gatherer TWICE (e5, e6).
  const two = minCountTokens(extractFromEvents(RESEARCH_EVENTS, [], [], ['information-gatherer']));
  assert.ok(two.has('delegated(information-gatherer)=1'), 'missing =1 expansion');
  assert.ok(two.has('delegated(information-gatherer)=2'), 'missing =2 expansion');
  assert.ok(!two.has('delegated(information-gatherer)=3'), 'must not over-emit beyond observed count');
  assert.equal(two.size, 2);

  // c=1: the dev fixture delegates task-group-implementer once.
  const one = minCountTokens(extractFromEvents(EVENTS, [], [], ['task-group-implementer']));
  assert.deepEqual([...one], ['delegated(task-group-implementer)=1']);

  // c=0: an agent never delegated in the dev fixture -> no min_count at all.
  const zero = minCountTokens(extractFromEvents(EVENTS, [], [], ['information-gatherer']));
  assert.equal(zero.size, 0, '0-occurrence must emit no min_count');

  // Record shape: value is an integer K, name is the delegated(x) payload, evidence cites the count.
  const rec = extractFromEvents(RESEARCH_EVENTS, [], [], ['information-gatherer'])
    .find((r) => r.kind === 'min_count' && r.value === 2);
  assert.equal(rec.name, 'delegated(information-gatherer)');
  assert.equal(rec.source, 'events');
  assert.match(rec.evidence, /observed 2 delegated\(information-gatherer\)/);
});

// ---- T-STATESCHEMA -------------------------------------------------------

test('T-STATESCHEMA: schemaDivergences drives conformant/off-schema; legitimate absence stays conformant (C1)', () => {
  // parseState now returns a dedicated schemaDivergences array (absence-free off-schema signal).

  // (1) CONFORMANT: canonical completed_phases ["phase-N"] + top-level task: block + characteristics.
  const conformant = [
    'task:',
    '  status: completed',
    'task_context:',
    '  task_characteristics:',
    '    has_reproducible_defect: false',
    '    modifies_existing_code: true',
    '    creates_new_entities: false',
    '    involves_data_operations: false',
    '    ui_heavy: false',
    'completed_phases: ["phase-1", "phase-2", "phase-5"]',
  ].join('\n');
  const cs = parseState(conformant);
  assert.ok(Array.isArray(cs.schemaDivergences), 'parseState must return a schemaDivergences array');
  assert.deepEqual(cs.schemaDivergences, [], 'conformant state has zero divergences');
  const cRec = stateSchemaOf(extract({ stateYaml: conformant }).records);
  assert.equal(cRec.length, 1, 'exactly ONE state_schema record');
  assert.equal(cRec[0].name, 'conformant');
  assert.equal(cRec[0].source, 'state');
  assert.equal(cRec[0].evidence, 'schemaDivergences=0');

  // (2) LEGITIMATE ABSENCE (C1 regression guard): research-shaped, NO task_characteristics block ->
  // parseWarnings NON-EMPTY but schemaDivergences EMPTY -> MUST still be conformant.
  const absence = ['task:', '  status: completed', 'completed_phases: ["phase-1", "phase-2"]'].join('\n');
  const as_ = parseState(absence);
  assert.ok(as_.parseWarnings.length > 0, 'a legitimate absence still raises parseWarnings');
  assert.deepEqual(as_.schemaDivergences, [], 'legitimate absence must NOT set schemaDivergences (C1)');
  const aRec = stateSchemaOf(extract({ stateYaml: absence }).records);
  assert.equal(aRec.length, 1);
  assert.equal(aRec[0].name, 'conformant', 'parseWarnings must NOT drive off-schema (C1 regression guard)');

  // (3a) OFF-SCHEMA — bare-int completed_phases (divergence site 1).
  const bareInt = 'task:\n  status: completed\ncompleted_phases: [1, 2, 5]\n';
  const bi = parseState(bareInt);
  assert.ok(bi.schemaDivergences.some((d) => /bare integers/.test(d)), 'bare-int -> divergence');
  assert.equal(stateSchemaOf(extract({ stateYaml: bareInt }).records)[0].name, 'off-schema');

  // (3b) OFF-SCHEMA — top-level status: with NO task: block (divergence site 3).
  const topStatus = 'orchestrator:\n  status: completed\ncompleted_phases: ["phase-1"]\n';
  const ts = parseState(topStatus);
  assert.ok(ts.schemaDivergences.some((d) => /top-level status/.test(d)), 'top-level status -> divergence');
  assert.equal(stateSchemaOf(extract({ stateYaml: topStatus }).records)[0].name, 'off-schema');

  // (3c) OFF-SCHEMA — union-derived (no completed_phases key; phases from phase_summaries) (site 2).
  const union = [
    'research_context:',
    '  phase_summaries:',
    '    phase-1:',
    '      note: planned',
    '    phase-2:',
    '      note: gathered',
    'task:',
    '  status: completed',
  ].join('\n');
  const un = parseState(union);
  assert.deepEqual(un.phases, [1, 2], 'phases recovered from phase_summaries');
  assert.ok(un.schemaDivergences.some((d) => /union of/.test(d)), 'union-derived -> divergence');
  assert.equal(stateSchemaOf(extract({ stateYaml: union }).records)[0].name, 'off-schema');

  // (4) NO stateYaml (quick-bugfix): emit NO state_schema record at all.
  const none = stateSchemaOf(extract({ stateYaml: null, events: [] }).records);
  assert.equal(none.length, 0, 'no state -> no state_schema predicate');
});

test('T-STATESCHEMA: ONLY the three tolerant-serialization branches populate schemaDivergences', () => {
  // Absence/empty branches push to parseWarnings ONLY, never to schemaDivergences.
  const noState = parseState('');
  assert.deepEqual(noState.schemaDivergences, [], 'empty text -> no divergences (only absence warnings)');

  // completed_phases key absent + no task: block -> all-absence -> warnings only.
  const allAbsent = parseState('orchestrator:\n  note: nothing machine-readable here\n');
  assert.ok(allAbsent.parseWarnings.length > 0);
  assert.deepEqual(allAbsent.schemaDivergences, [], 'pure absence never sets schemaDivergences');
});
