// Credit-free unit checks for the Group 3 deterministic responder + report gates.
//
// Four focused checks (plan step 3.1):
//   1. chooseAnswer — a matched question returns the mapped choice resolved against
//      req.choices (matched:true, fallback:false, correct mappedPhase).
//   2. chooseAnswer — a matched question with NO choices returns the mapped answer as
//      freeform (wasFreeform:true, matched:true, fallback:false).
//   3. chooseAnswer — an unmatched question falls back to choices[0] ?? 'yes'
//      (matched:false, fallback:true, mappedPhase:null).
//   4. buildReport — a gateLog with a mapped row + a fallback row renders the
//      `## Gates` section, shows the mapped phase, and flags the fallback row
//      `responder-fallback`.
//
// Importing run.mjs is side-effect-free (the isMain guard) and NEVER imports the SDK
// (that is a dynamic import inside runLive only), so this file spends no credits.
//
// Zero-dependency: `node:` builtins only. Run with:
//   node --test l2/test/run.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chooseAnswer, buildReport, finalizeSingleRun } from '../run.mjs';
import { EXIT } from '../compare.mjs';

// Minimal buildReport ctx — every field it interpolates, with an empty diff/observed
// so the only interesting surface is the injected gateLog.
function baseCtx(overrides = {}) {
  return {
    scenarioId: 'development',
    mode: 'live',
    overall: 'AS-EXPECTED',
    counts: { pass: 1, limitation: 0, skip: 0, fail: 0 },
    observed: new Set(['reached_terminal(completion)']),
    reference: { required: [], optional: [] },
    result: { diffs: [] },
    incompleteReason: null,
    copilotVersion: '1.0.74',
    maisterVersion: '0.0.0',
    osStr: 'test-os',
    ts: '20260101T000000Z',
    isolationNote: 'unit-test',
    pluginDir: '/plugin',
    pluginName: 'maister-copilot',
    finalN: 1,
    sdkPath: '/sdk',
    parseWarnings: [],
    ...overrides,
  };
}

test('chooseAnswer: matched question -> mapped choice resolved against req.choices (matched, no fallback)', () => {
  const answerMap = [
    { re: /enable e2e/i, choice: 'No, skip', phase: 10 },
    { re: /continue to/i, choice: 'yes' },
  ];
  const req = { question: 'Enable E2E testing for this run?', choices: ['Yes, run E2E', 'No, skip E2E'] };
  const r = chooseAnswer(req, answerMap);

  assert.equal(r.matched, true, 'must be a mapped match');
  assert.equal(r.fallback, false, 'a mapped match is never a fallback');
  assert.equal(r.mappedPhase, 10, 'mappedPhase carries the answerMap entry phase');
  assert.equal(r.answer, 'No, skip E2E', 'mapped choice resolves to the real choice label');
  assert.equal(r.wasFreeform, false, 'a resolved choice is not freeform');
});

test('chooseAnswer: matched question with NO choices -> freeform mapped answer', () => {
  const answerMap = [{ re: /continue to/i, choice: 'yes' }];
  const req = { question: 'Continue to implementation?' }; // no choices offered
  const r = chooseAnswer(req, answerMap);

  assert.equal(r.matched, true);
  assert.equal(r.fallback, false);
  assert.equal(r.answer, 'yes');
  assert.equal(r.wasFreeform, true, 'no choices -> the mapped answer is freeform');
});

test('chooseAnswer: unmatched question -> choices[0] ?? \'yes\' fallback, flagged', () => {
  const answerMap = [{ re: /enable e2e/i, choice: 'No, skip', phase: 10 }];

  const withChoices = chooseAnswer({ question: 'A totally unmapped gate?', choices: ['first', 'second'] }, answerMap);
  assert.equal(withChoices.matched, false);
  assert.equal(withChoices.fallback, true, 'unmatched -> responder fallback');
  assert.equal(withChoices.answer, 'first', 'fallback picks choices[0]');
  assert.equal(withChoices.mappedPhase, null, 'a fallback has no mapped phase');

  const noChoices = chooseAnswer({ question: 'Unmapped and choiceless?' }, answerMap);
  assert.equal(noChoices.fallback, true);
  assert.equal(noChoices.answer, 'yes', 'no choices -> the \'yes\' floor');
  assert.equal(noChoices.wasFreeform, true);
});

test('buildReport: gateLog with mapped + fallback rows renders ## Gates with phases and flags the fallback', () => {
  const gateLog = [
    { question: 'Continue to implementation?', answer: 'yes', mappedPhase: 7, matched: true, fallback: false },
    { question: 'A weird unmapped gate?', answer: 'first', mappedPhase: null, matched: false, fallback: true },
  ];
  const md = buildReport(baseCtx({ gateLog }));

  assert.match(md, /## Gates/, 'renders the Gates section header');
  assert.match(md, /Continue to implementation\?/, 'lists the mapped gate question');
  assert.match(md, /\| 7 \|/, 'shows the mapped phase for the mapped row');
  assert.match(md, /responder-fallback/, 'flags the fallback row responder-fallback');
});

// --------------------------------------------------------------------------- Stage 4 (Group 3)
//
// Witness-aware floor narrowing + replay/persist report markers. These use SYNTHETIC INLINE
// references (not the committed reference/*.skeleton.json) so they pass pre-landing, independent of
// the reference edits. finalizeSingleRun writes a report + a stdout line as a side effect and
// returns the exit code (0 AS-EXPECTED / 1 REGRESSED / 2 INCOMPLETE) — the assertion surface.

let tsSeq = 0;
function finalizerCtx(reference, overrides = {}) {
  return {
    reference, N: 1, scenarioId: 'development',
    copilotVersion: '1.0.74', maisterVersion: '0.0.0', osStr: 'test-os',
    ts: `20260101T0000${String(tsSeq++).padStart(2, '0')}Z`, // unique per call (report filename)
    isolationNote: 'unit-test', pluginDir: '/plugin', pluginName: 'maister-copilot',
    sdkPath: '/sdk', ...overrides,
  };
}
// A verdict-eligible driveOnce-shaped result (status 'ok') with a non-empty parseWarnings + a
// created_artifact token (so `artifactsExist` and the parseWarnings gate are both satisfied — the
// floor's other two preconditions — leaving the witness logic as the deciding factor).
function okRes(observed, warnings = ['partial state parse']) {
  return { status: 'ok', observed, ex: { parseWarnings: warnings }, run: 1 };
}

test('T-FLOOR: missing WITNESSED phase with its witness ALSO absent -> REGRESSED (not downgraded)', () => {
  const reference = {
    required: ['phase_completed(5)'],
    optional: ['created_artifact(implementation/spec.md)'],
    allowlist: [],
    rules: [{ when: 'phase_completed(5)', require: 'delegated(specification-creator)' }],
  };
  // phase_completed(5) missing AND its witness delegated(specification-creator) also absent.
  const observed = new Set(['created_artifact(implementation/spec.md)']);
  const code = finalizeSingleRun(okRes(observed), finalizerCtx(reference));
  assert.equal(code, EXIT.REGRESSED, 'genuinely un-witnessed missing phase stays REGRESSED');
});

test('T-FLOOR: missing state-only predicate with witnesses present + parseWarnings -> INCOMPLETE', () => {
  const reference = {
    required: ['phase_completed(5)', 'task_characteristic(has_tests)', 'delegated(specification-creator)'],
    optional: ['created_artifact(implementation/spec.md)'],
    allowlist: [],
    rules: [{ when: 'phase_completed(5)', require: 'delegated(specification-creator)' }],
  };
  // phase_completed(5) missing BUT its witness delegated(specification-creator) IS present (eligible);
  // task_characteristic(has_tests) missing (state-only, eligible). Every candidate is downgrade-eligible.
  const observed = new Set(['delegated(specification-creator)', 'created_artifact(implementation/spec.md)']);
  const code = finalizeSingleRun(okRes(observed, ['task_characteristic missing: has_tests']), finalizerCtx(reference));
  assert.equal(code, EXIT.INCOMPLETE, 'witness-present phase + state-only miss downgrades to INCOMPLETE');
});

test('T-FLOOR-ISO: witness in optional (not required), phase+witness both absent -> REGRESSED (witness logic load-bearing)', () => {
  // The witness token is OPTIONAL, so its absence is NOT itself a candidate regression: the ONLY
  // candidate is the missing phase_completed(5). The OLD blanket floor (all-missing-state-sourced)
  // would have downgraded this to INCOMPLETE; the witness-aware floor keeps it REGRESSED because the
  // witness is absent. This proves the witness check is genuinely load-bearing, not merely redundant.
  const reference = {
    required: ['phase_completed(5)'],
    optional: ['delegated(specification-creator)', 'created_artifact(implementation/spec.md)'],
    allowlist: [],
    rules: [{ when: 'phase_completed(5)', require: 'delegated(specification-creator)' }],
  };
  const observed = new Set(['created_artifact(implementation/spec.md)']); // lacks BOTH phase and witness
  const code = finalizeSingleRun(okRes(observed), finalizerCtx(reference));
  assert.equal(code, EXIT.REGRESSED, 'witness-aware floor keeps REGRESSED where the old blanket floor downgraded');
});

test('T-FLOOR negative control (Stage-1 M1): a non-state-sourced missing predicate stays REGRESSED', () => {
  const reference = {
    required: ['delegated(gap-analyzer)'], // non-state-sourced -> never downgrade-eligible
    optional: ['created_artifact(implementation/spec.md)'],
    allowlist: [], rules: [],
  };
  const observed = new Set(['created_artifact(implementation/spec.md)']);
  const code = finalizeSingleRun(okRes(observed), finalizerCtx(reference));
  assert.equal(code, EXIT.REGRESSED, 'non-state-sourced missing -> floor never fires -> REGRESSED');
});

test('T-FLOOR negative control (Stage-2 failing outcome): missing outcome(tests-pass)=pass stays REGRESSED', () => {
  const reference = {
    required: ['outcome(tests-pass)=pass'], // non-state-sourced -> never downgrade-eligible
    optional: ['created_artifact(implementation/spec.md)'],
    allowlist: [], rules: [],
  };
  const observed = new Set(['created_artifact(implementation/spec.md)']);
  const code = finalizeSingleRun(okRes(observed), finalizerCtx(reference));
  assert.equal(code, EXIT.REGRESSED, 'a missing failing-outcome predicate is non-state-sourced -> REGRESSED');
});

test('buildReport: replayed mode renders "Mode: replayed (from <dir>)" and no persisted-trace line', () => {
  const md = buildReport(baseCtx({ mode: 'replayed', replaySource: '/tmp/reports/20260101T000000Z', finalN: 1 }));
  assert.match(md, /\*\*Mode:\*\* replayed \(from \/tmp\/reports\/20260101T000000Z\)/, 'renders the replay source');
  assert.doesNotMatch(md, /Persisted trace:/, 'a replay run does not emit a persisted-trace line');
});

test('buildReport: LIVE N=1 emits the persisted-trace path line', () => {
  const md = buildReport(baseCtx({ mode: 'live', finalN: 1, ts: '20260101T000000Z' }));
  assert.match(md, /Persisted trace:\*\* reports\/20260101T000000Z\//, 'live N=1 surfaces the reports/<ts>/ bundle path');
});
