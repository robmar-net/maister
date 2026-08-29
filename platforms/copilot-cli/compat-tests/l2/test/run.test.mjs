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

import { chooseAnswer, buildReport } from '../run.mjs';

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
