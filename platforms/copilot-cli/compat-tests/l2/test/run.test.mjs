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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  chooseAnswer, buildReport, finalizeSingleRun,
  resolveModel, modelActualFromUsage, runWindow, driveOnce,
  observeDestructiveGuard,
} from '../run.mjs';
import developmentScenario from '../scenarios/development.mjs';
import { EXIT } from '../compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const RUN_MJS = path.join(L2_DIR, 'run.mjs');
const REPORTS_DIR = path.resolve(L2_DIR, '..', 'reports');
const RESEARCH_FIX = path.join(__dirname, 'fixtures', 'research');

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

// --------------------------------------------------------------------------- Stage 5 (Group 2): model + cost
//
// Six credit-free checks for the model/cost report threading (spec §2 / §6c). All pure-helper or
// render/round-trip assertions — no SDK import, no seat, no credit.

// M-2 — runWindow: the N>1 whole-run cost window, SDK-free.
test('runWindow (M-2): whole-run window = first start .. last end; empty + singleton handled', () => {
  assert.deepEqual(
    runWindow([{ startIso: 'A', endIso: 'B' }, { startIso: 'C', endIso: 'D' }]),
    { startIso: 'A', endIso: 'D' },
    'first run start + last run end',
  );
  assert.deepEqual(runWindow([{ startIso: 'A', endIso: 'B' }]), { startIso: 'A', endIso: 'B' }, 'singleton = that run');
  assert.deepEqual(runWindow([]), { startIso: null, endIso: null }, 'empty -> null window');
});

// resolveModel precedence: opts.model ?? COMPAT_L2_MODEL ?? sc.model ?? null.
test('resolveModel: precedence opts ?? COMPAT_L2_MODEL ?? sc.model ?? null', () => {
  assert.equal(resolveModel({ model: 'a' }, { model: 'c' }, { COMPAT_L2_MODEL: 'b' }), 'a', 'opts wins');
  assert.equal(resolveModel({}, { model: 'c' }, { COMPAT_L2_MODEL: 'b' }), 'b', 'env over scenario');
  assert.equal(resolveModel({}, { model: 'c' }, {}), 'c', 'scenario default');
  assert.equal(resolveModel({}, {}, {}), null, 'nothing set -> null (SDK/account default)');
});

// modelActualFromUsage degrade — joins sorted keys; 'unknown' on the modelMetrics-absent shape.
test('modelActualFromUsage: sorted-joined keys; degrades to unknown', () => {
  assert.equal(modelActualFromUsage({ models: { 'gpt-5': {}, 'gpt-5-mini': {} } }), 'gpt-5+gpt-5-mini');
  assert.equal(modelActualFromUsage({ models: null }), 'unknown', '1.0.8x shutdown shape -> unknown');
  assert.equal(modelActualFromUsage(null), 'unknown', 'no usage -> unknown');
});

// M-1 — the createSession {model} CONDITIONAL SPREAD, via a mocked SDK spy (credit-free).
test('driveOnce (M-1): {model} threaded via conditional spread — present when resolved, ABSENT when null', async () => {
  let captured;
  const makeSdk = () => {
    const session = {
      async sendAndWait() { throw new Error('bail-immediately-after-create'); },
      async abort() {},
      async getEvents() { return []; },
      async disconnect() {},
    };
    class FakeClient {
      async start() {}
      async createSession(cfg) { captured = cfg; return session; }
      async stop() {}
      forceStop() {}
    }
    return { CopilotClient: FakeClient, RuntimeConnection: { forStdio: () => ({}) }, approveAll: () => ({}) };
  };
  const opts = { keepRundir: false };

  // A resolved model -> the key is present with its value. persistTs=null so no readCost/persist.
  captured = undefined;
  await driveOnce(makeSdk(), '/runtime', developmentScenario, opts, 1, null, null, 'gpt-5-codex');
  assert.equal(captured.model, 'gpt-5-codex', 'a resolved model is spread into the createSession config');

  // No model -> the key is ABSENT entirely (never model:null — a strict SDK could reject that in the
  // catch-less driveOnce try, turning every live run INCOMPLETE).
  captured = undefined;
  await driveOnce(makeSdk(), '/runtime', developmentScenario, opts, 1, null, null, null);
  assert.equal('model' in captured, false, 'no requested model -> the model key is absent (not null)');
});

// M-4 — buildReport header rows, source-labelled on every branch (success / unavailable / unknown).
test('buildReport (M-4): Model + AIU (session-store.db) rows render, source-labelled on every branch', () => {
  const known = buildReport(baseCtx({ model: 'gpt-5', modelActual: 'gpt-5', cost: { aiu: 4, weightedRequests: 4.5 } }));
  assert.match(known, /- \*\*Model \(requested \/ actual\):\*\* `gpt-5` \/ `gpt-5`/, 'requested/actual row');
  assert.match(known, /- \*\*AIU \/ weighted requests \(session-store\.db\):\*\* 4 AIU \/ 4\.5 req/, 'success figure, labelled');

  const degraded = buildReport(baseCtx({ model: null, modelActual: 'unknown', cost: { unavailable: true } }));
  assert.match(degraded, /- \*\*Model \(requested \/ actual\):\*\* `default` \/ `unknown`/, 'null model -> default/unknown');
  assert.match(degraded, /\(session-store\.db\):\*\* unavailable/, 'unavailable still carries the source label');

  const unknownCost = buildReport(baseCtx({ model: 'x', modelActual: 'unknown', cost: null }));
  assert.match(unknownCost, /\(session-store\.db\):\*\* unknown/, 'null cost -> unknown, still labelled');
});

// M-3 — cost is threaded onto the INCOMPLETE (timeout) branch too, via the shared base (not only ok).
test('finalizeSingleRun (M-3): threads real cost onto the INCOMPLETE (timeout) report via the shared base', () => {
  const reference = { required: [], optional: [], allowlist: [], rules: [] };
  const ctx = finalizerCtx(reference, { model: 'gpt-5', modelActual: 'unknown', cost: { aiu: 2, weightedRequests: 1 } });
  // Timeout-shaped result: status incomplete, NO ex -> the "no verdict" branch. usage null (session.shutdown
  // empty) but cost is known from the window read in driveOnce -> must still render.
  const res = { status: 'incomplete', reason: 'sendAndWait did not complete (timeout)', run: 1, usage: null, gateLog: [] };
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ctx.ts}.md`);
  try {
    const code = finalizeSingleRun(res, ctx);
    assert.equal(code, EXIT.INCOMPLETE, 'a timeout is INCOMPLETE (exit 2)');
    const md = fs.readFileSync(reportPath, 'utf8');
    assert.match(md, /## INCOMPLETE — no verdict/, 'the no-verdict branch');
    assert.match(md, /\(session-store\.db\):\*\* 2 AIU \/ 1 req/, 'a timed-out run STILL reports its real cost (M-3)');
  } finally {
    fs.rmSync(reportPath, { force: true });
  }
});

// replay-meta round-trip: a persisted bundle's model/cost render from meta (NOT a live read; replay
// res.usage is null). Exercises the real --replay entrypoint end-to-end (credit-free — a bogus sdkPath
// is never imported), reusing the committed research fixture like replay.test.mjs.
test('runReplay: renders the PERSISTED model + cost from replay-meta.json (round-trip, credit-free)', () => {
  const GOOD_REPORT = [
    '# Research Report: Stage-5 Replay Model/Cost Round-Trip',
    '',
    '## Findings',
    'The --replay path reconstructs extract() inputs from a persisted bundle and re-runs the outcome',
    'oracle against the persisted rundir copy, reusing finalizeSingleRun so the verdict and report match',
    'a live N=1 run. The model and cost render from replay-meta.json, never from a live readCost.',
    '',
    '## Conclusion',
    'A persisted bundle reproduces its recorded model + real cost deterministically and credit-free.',
    '',
  ].join('\n');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-stage5-replay-'));
  const ts = '20990201T000000Z';
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const bundleDir = path.join(root, ts);
    const taskDir = path.join(bundleDir, 'rundir', '.maister', 'tasks', 'research', '2026-08-29-l2-stage5');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.copyFileSync(path.join(RESEARCH_FIX, 'events.sample.json'), path.join(bundleDir, 'events.json'));
    fs.cpSync(path.join(RESEARCH_FIX, 'task-tree'), taskDir, { recursive: true });
    fs.copyFileSync(path.join(RESEARCH_FIX, 'orchestrator-state.sample.yml'), path.join(taskDir, 'orchestrator-state.yml'));
    fs.writeFileSync(path.join(taskDir, 'outputs', 'research-report.md'), GOOD_REPORT);
    fs.writeFileSync(
      path.join(bundleDir, 'replay-meta.json'),
      JSON.stringify({
        scenario: 'research', taskType: 'research', copilotVersion: '1.0.81',
        sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs',
        ts, originalMode: 'live', maisterVersion: '0.0.0',
        model: 'gpt-5-pinned', modelActual: 'gpt-5', cost: { aiu: 4, weightedRequests: 4.5, source: 'session-store.db' },
      }, null, 2),
    );

    const r = spawnSync(process.execPath, [RUN_MJS, `--replay=${bundleDir}`], { cwd: L2_DIR, encoding: 'utf8', env: { ...process.env } });
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`);
    assert.equal(r.status, 0, `expected AS-EXPECTED / exit 0, got ${r.status}\n${r.stdout}${r.stderr}`);

    const md = fs.readFileSync(reportPath, 'utf8');
    assert.match(md, /\*\*Mode:\*\* replayed \(from /, 'replay mode marker');
    assert.match(md, /- \*\*Model \(requested \/ actual\):\*\* `gpt-5-pinned` \/ `gpt-5`/, 'model from meta, not a live read');
    assert.match(md, /\(session-store\.db\):\*\* 4 AIU \/ 4\.5 req/, 'cost from meta.cost (res.usage is null on replay)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

// --------------------------------------------------------------------------- Stage 6 (Group 3): destructive-guard responder
//
// observeDestructiveGuard(sink) is the custom onPermissionRequest responder that OBSERVES the zero-touch
// block-destructive-commands.sh guard's `ask` decision and records it to a per-run hookDecisions sink
// (Option B). Pure, session-free, seat-free. It must (a) record ONLY a genuine destructive-guard `ask`,
// (b) read the decision defensively (top-level OR hookSpecificOutput.*), (c) fall back to the exact hook
// command-regex when the reason marker is absent, and (d) ALWAYS return the approve-shaped result
// approveAll yields (the credit-free tests double approveAll as `() => ({})`).

test('observeDestructiveGuard: top-level ask + guard reason -> records one sink entry AND approves', () => {
  const sink = [];
  const responder = observeDestructiveGuard(sink);
  const res = responder({
    permissionDecision: 'ask',
    permissionDecisionReason: 'Maister guard: destructive command — confirm before running: rm -rf ./.tmp-scratch',
    permissionRequest: { command: 'rm -rf ./x' },
    requestId: 'req-dg-001',
  });
  assert.equal(sink.length, 1, 'a destructive-guard ask records exactly one entry');
  assert.equal(sink[0].requestId, 'req-dg-001', 'carries the requestId for evidence correlation');
  assert.equal(sink[0].name, 'destructive_guard');
  assert.equal(sink[0].value, 'ask');
  assert.match(sink[0].reason, /Maister guard: destructive command/, 'carries the observed reason');
  assert.deepEqual(res, {}, 'returns the approve-shaped result (same shape approveAll yields)');
});

test('observeDestructiveGuard: DEFENSIVE read — decision under hookSpecificOutput.* is still recorded', () => {
  const sink = [];
  const responder = observeDestructiveGuard(sink);
  const res = responder({
    // The hook emits its decision under hookSpecificOutput (block-destructive-commands.sh:56-60); the
    // responder must nullish-coalesce into it when the top-level fields are absent.
    hookSpecificOutput: {
      permissionDecision: 'ask',
      permissionDecisionReason: 'Maister guard: destructive command — confirm before running: rm -rf ./.tmp-scratch',
    },
    permissionRequest: { command: 'rm -rf ./.tmp-scratch' },
    requestId: 'req-dg-002',
  });
  assert.equal(sink.length, 1, 'hookSpecificOutput decision is read defensively and recorded');
  assert.equal(sink[0].value, 'ask');
  assert.equal(sink[0].requestId, 'req-dg-002');
  assert.deepEqual(res, {}, 'still approves');
});

test('observeDestructiveGuard: command-regex FALLBACK — ask + no reason marker but destructive command -> recorded', () => {
  const sink = [];
  const responder = observeDestructiveGuard(sink);
  // decision ask, reason absent -> the exact hook command-regex mirror must still trigger the record.
  const res = responder({ permissionDecision: 'ask', command: 'rm -rf ./build', requestId: 'req-dg-003' });
  assert.equal(sink.length, 1, 'the command-regex fallback records the entry when the reason marker is absent');
  assert.equal(sink[0].name, 'destructive_guard');
  assert.equal(sink[0].value, 'ask');
  assert.deepEqual(res, {}, 'still approves');
});

test('observeDestructiveGuard: NON-destructive / non-ask reqs record NOTHING (and still approve)', () => {
  const sink = [];
  const responder = observeDestructiveGuard(sink);

  // (a) benign command, ask decision, no guard reason -> not destructive -> no record.
  assert.deepEqual(responder({ permissionDecision: 'ask', command: 'git status', requestId: 'r1' }), {});
  // (b) destructive command but decision is NOT ask (approved outright) -> no record.
  assert.deepEqual(responder({ permissionDecision: 'approve', command: 'rm -rf ./x', requestId: 'r2' }), {});
  // (c) decision entirely absent (a plain approve gate) -> no record.
  assert.deepEqual(responder({ permissionRequest: { command: 'ls -la' }, requestId: 'r3' }), {});

  assert.equal(sink.length, 0, 'no benign / non-ask permission request is ever recorded');
});

// replay-meta round-trip: a persisted bundle whose replay-meta.json carries hookDecisions is read back
// by runReplay and threaded into the replay extract() call, so the replayed skeleton carries
// hook_effect(destructive_guard=ask). Exercises the real --replay entrypoint end-to-end (credit-free —
// the bogus sdkPath is never imported), reusing the committed research fixture like the Stage-5 test.
// A research bundle is used (its committed reference exists pre-landing); the injected hookDecisions
// makes hook_effect an EXTRA vs the research reference -> the verdict is REGRESSED, but the assertion
// surface is the token's presence in the persisted+replayed observed skeleton.
test('runReplay: threads persisted meta.hookDecisions into extract() -> observed skeleton carries hook_effect(destructive_guard=ask)', () => {
  const GOOD_REPORT = [
    '# Research Report: Stage-6 hookDecisions Replay Round-Trip',
    '',
    '## Findings',
    'The --replay path reads meta.hookDecisions from the persisted bundle and threads it into extract(),',
    'so a destructive-guard bundle reproduces its hook_effect token faithfully and credit-free.',
    '',
    '## Conclusion',
    'Persisted observed hook decisions replay deterministically.',
    '',
  ].join('\n');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-stage6-replay-'));
  const ts = '20990301T000000Z';
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const bundleDir = path.join(root, ts);
    const taskDir = path.join(bundleDir, 'rundir', '.maister', 'tasks', 'research', '2026-08-29-l2-stage6');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.copyFileSync(path.join(RESEARCH_FIX, 'events.sample.json'), path.join(bundleDir, 'events.json'));
    fs.cpSync(path.join(RESEARCH_FIX, 'task-tree'), taskDir, { recursive: true });
    fs.copyFileSync(path.join(RESEARCH_FIX, 'orchestrator-state.sample.yml'), path.join(taskDir, 'orchestrator-state.yml'));
    fs.writeFileSync(path.join(taskDir, 'outputs', 'research-report.md'), GOOD_REPORT);
    fs.writeFileSync(
      path.join(bundleDir, 'replay-meta.json'),
      JSON.stringify({
        scenario: 'research', taskType: 'research', copilotVersion: '1.0.81',
        sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs',
        ts, originalMode: 'live', maisterVersion: '0.0.0',
        model: null, modelActual: 'unknown', cost: null,
        // Stage 6: the per-run observed decision, persisted for faithful replay.
        hookDecisions: [{ requestId: 'req-dg-001', name: 'destructive_guard', value: 'ask', reason: 'Maister guard: destructive command' }],
      }, null, 2),
    );

    const r = spawnSync(process.execPath, [RUN_MJS, `--replay=${bundleDir}`], { cwd: L2_DIR, encoding: 'utf8', env: { ...process.env } });
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`);
    assert.notEqual(r.status, EXIT.INCOMPLETE, `replay must produce a verdict, not INCOMPLETE\n${r.stdout}${r.stderr}`);

    const md = fs.readFileSync(reportPath, 'utf8');
    assert.match(md, /\*\*Mode:\*\* replayed \(from /, 'replay mode marker');
    assert.match(md, /hook_effect\(destructive_guard=ask\)/, 'the persisted hookDecisions replays the hook_effect token into the observed skeleton');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});
