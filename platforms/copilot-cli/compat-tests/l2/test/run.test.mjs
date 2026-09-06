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
// G6a (#122) — session options seam + config.yml seeding, six credit-free checks:
//   * buildSessionOptions — default is exactly { skipCustomInstructions: true }; manifest wins over
//     the env seam and the default; env seams (COMPAT_L2_SKIP_INSTR / _EXCLUDED_TOOLS / _EFFORT);
//     a null resolution NEVER emits the key (the createSession conditional-spread rule).
//   * seedConfigYml — writes the exact two-line /maister:init-shaped config.yml; skipped for `init`
//     (the init-structure oracle needs a bare template); a pre-existing config.yml is a precondition.
//   All in-process on mkdtemp dirs removed in `finally`; no SDK, no session, no credits.
//
// G3 (#122) — replay-meta.json v2 provenance, five credit-free checks:
//   * normalizeCliVersion — first `\d+.\d+.\d+` of the two-line `copilot --version`; no match -> null.
//   * digestTree — sha256 over the LC_ALL=C-sorted file list + contents, asserted EQUAL to the shell
//     idiom (`find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`) on a mkdtemp tree.
//   * servedModelsFromEvents — main from the startup model_change; an agent seen with two models is a
//     sorted array (never last-wins); no startup event -> main:null.
//   * computeRunProvenance — bogus COMPAT_ARM_MANIFEST / bad COMPAT_VARIANT_COMMIT are preconditions
//     (exit 2, nothing spent); a valid working-tree call yields digest + pluginSource + referenceHash.
//   * deriveVerdict — in-process extractFromBundle + deriveVerdict on the staged research fixture lands
//     the SAME overall + PASS/LIMITATION/SKIP/FAIL counts the `--replay` subprocess prints (R7.1).
//
// G3 (#122) — replay-from-meta + legacy map + header rendering (R3.1-R3.3), three credit-free checks:
//   * provenanceForReplay — a v2 meta WITHOUT pluginDir falls back to the literal
//     `UNATTRIBUTED (v2 meta missing pluginDir)` (audit I8) and never renders `undefined`; meta wins over
//     a legacy-map row for the same ts.
//   * buildReport — the R3.3 table, all three columns: legacy-map hit with pluginDirRecovered:null ->
//     `UNATTRIBUTED (pre-provenance bundle; legacy map — no path-bearing event)`; no provenance -> the
//     `cost-report --recover` hint; v2 -> variant / `none (mutation <id>)` / `none`, git-archive vs
//     working-tree source, sha256 digest, compact sessionOptions JSON. Line order pinned.
//   * legacy-arms.json — schema 1, exactly the six pre-#122 ts keys (all <= 20260903T004846Z), every row
//     legacyArm/scenario/maisterVersion/pluginDirRecovered/comparable:false/note. 2099-series ts only in
//     the map tests — a real six-bundle ts is never staged or replayed (it would overwrite the operator's
//     report).
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
  resolveModel, modelActualFromUsage, runWindow, driveOnce, SCENARIOS, loadReference,
  buildSessionOptions, loadArmManifest, seedConfigYml, resolveHtmlOutput,
  normalizeCliVersion, digestTree, servedModelsFromEvents, computeRunProvenance,
  extractFromBundle, deriveVerdict,
  provenanceForReplay, loadLegacyArms, parseArgs,
} from '../run.mjs';
import developmentScenario from '../scenarios/development.mjs';
import { EXIT, computeHash } from '../compare.mjs';

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

// #63 item 4 — bidirectional choice<->label matching + honest `matched`.
test('chooseAnswer (#63.4): terse map value resolves a longer real label (exact, case-insensitive)', () => {
  const answerMap = [{ re: /brainstorm/i, choice: 'No, skip', phase: 4 }];
  const r = chooseAnswer({ question: 'Explore solution alternatives (brainstorming)?', choices: ['Yes (Recommended)', 'No, skip'] }, answerMap);
  assert.equal(r.answer, 'No, skip');
  assert.equal(r.matched, true);
  assert.equal(r.fallback, false);
  assert.equal(r.mappedPhase, 4);
});

test('chooseAnswer (#63.4): "No, skip" against terse ["Yes","No"] resolves to "No" (the fixed bug — was "Yes")', () => {
  const answerMap = [{ re: /enable e2e/i, choice: 'No, skip', phase: 12 }];
  const r = chooseAnswer({ question: 'Enable E2E testing?', choices: ['Yes', 'No'] }, answerMap);
  assert.equal(r.answer, 'No', 'either-side substring: "No, skip" includes "No" -> the intended skip, NOT choices[0]');
  assert.equal(r.matched, true, 'a real (bidirectional) resolution is a genuine match');
  assert.equal(r.fallback, false);
});

test('chooseAnswer (#63.4): "Yes" against ["Yes, enable","No"] resolves to "Yes, enable" (either-side substring)', () => {
  const answerMap = [{ re: /enable/i, choice: 'Yes', phase: 12 }];
  const r = chooseAnswer({ question: 'Enable user docs?', choices: ['Yes, enable', 'No'] }, answerMap);
  assert.equal(r.answer, 'Yes, enable');
  assert.equal(r.matched, true);
  assert.equal(r.fallback, false);
});

test('chooseAnswer (#63.4): a regex hit whose choice matches NO offered label is an honest responder-fallback', () => {
  const answerMap = [{ re: /enable e2e/i, choice: 'Maybe later', phase: 12 }];
  const r = chooseAnswer({ question: 'Enable E2E testing?', choices: ['Yes', 'No'] }, answerMap);
  assert.equal(r.answer, 'Yes', 'unresolvable choice -> choices[0] floor so the run proceeds');
  assert.equal(r.matched, false, 'but it is NOT a deliberate match');
  assert.equal(r.fallback, true, 'surfaces as responder-fallback, not "mapped"');
});

test('chooseAnswer (#63.4): first-token match resolves a paraphrased choice', () => {
  const answerMap = [{ re: /continue/i, choice: 'continue to design', phase: 5 }];
  const r = chooseAnswer({ question: 'Continue?', choices: ['Continue', 'Stop'] }, answerMap);
  assert.equal(r.answer, 'Continue');
  assert.equal(r.matched, true);
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
  // Fix pass 2: `resolved` is REQUIRED — built here exactly as runLive builds it, over an EXPLICIT env object
  // (never the ambient shell env, so a COMPAT_L2_* seam in the test runner's environment cannot leak in).
  const resolvedWith = (model) => ({
    sessionOptions: { ...buildSessionOptions(null, {}), ...(model != null ? { model } : {}) },
    htmlOutput: resolveHtmlOutput(null, {}),
  });
  await assert.rejects(
    () => driveOnce(makeSdk(), '/runtime', developmentScenario, opts, 1, null, null, false, null, undefined),
    /resolved/,
    'no `resolved` -> driveOnce refuses before touching the filesystem (no silent process.env re-derivation)',
  );

  // A resolved model -> the key is present with its value. persistTs=null so no readCost/persist.
  captured = undefined;
  await driveOnce(makeSdk(), '/runtime', developmentScenario, opts, 1, null, null, false, null, resolvedWith('gpt-5-codex'));
  assert.equal(captured.model, 'gpt-5-codex', 'a resolved model is spread into the createSession config');

  // No model -> the key is ABSENT entirely (never model:null — a strict SDK could reject that in the
  // catch-less driveOnce try, turning every live run INCOMPLETE).
  captured = undefined;
  await driveOnce(makeSdk(), '/runtime', developmentScenario, opts, 1, null, null, false, null, resolvedWith(null));
  assert.equal('model' in captured, false, 'no requested model -> the model key is absent (not null)');
  // G6a (#122): skipCustomInstructions rides the SAME spread and is present on EVERY drive (true by
  // default, ADR-001) — no manifest, no env seam, still there.
  assert.equal(captured.skipCustomInstructions, true, 'skipCustomInstructions:true is spread into createSession on a default drive');
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
    'The sample CLI implements `frobnicate` but leaves it unreachable from the dispatcher (dead code).',
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

// --------------------------------------------------------------------------- issue #48: destructive-guard replay
//
// hook_effect(destructive_guard=ask) is emitted by the EXTRACTOR directly from the live
// permission.requested event (permissionRequest.kind==="hook" + the "Maister guard" hookMessage) — there
// is no custom responder or persisted hookDecisions sink. A --replay therefore reproduces hook_effect
// straight from the bundle's events.json. This end-to-end replay test injects a kind:"hook" guard
// permission into a research bundle's events.json and asserts the replayed observed skeleton carries the
// token (credit-free — the bogus sdkPath is never imported). The injected event makes hook_effect an
// EXTRA vs the research reference (-> REGRESSED verdict), but the assertion surface is the token's
// presence in the persisted+replayed observed skeleton.
test('runReplay: a kind:"hook" permission.requested in events.json replays hook_effect(destructive_guard=ask)', () => {
  const GOOD_REPORT = [
    '# Research Report: issue #48 event-stream hook_effect replay',
    '',
    '## Findings',
    'The --replay path re-derives hook_effect directly from the bundle events.json (the kind:"hook"',
    'permission.requested), so a destructive-guard bundle reproduces its token faithfully and credit-free.',
    '',
    '## Conclusion',
    'Event-stream hook_effect replays deterministically from events.json.',
    '',
  ].join('\n');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-hookeffect-replay-'));
  const ts = '20990301T000000Z';
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const bundleDir = path.join(root, ts);
    const taskDir = path.join(bundleDir, 'rundir', '.maister', 'tasks', 'research', '2026-08-29-l2-hookeffect');
    fs.mkdirSync(taskDir, { recursive: true });
    // Splice a live kind:"hook" guard permission into the research bundle's events.json so replay
    // witnesses it (the token comes from the EVENT, not a persisted sink).
    const baseEvents = JSON.parse(fs.readFileSync(path.join(RESEARCH_FIX, 'events.sample.json'), 'utf8'));
    baseEvents.push({
      type: 'permission.requested',
      data: {
        requestId: 'req-dg-001',
        permissionRequest: {
          kind: 'hook', toolName: 'bash',
          toolArgs: { command: 'rm -rf ./.tmp-scratch' },
          hookMessage: 'Maister guard: destructive command — confirm before running: rm -rf ./.tmp-scratch',
        },
      },
    });
    fs.writeFileSync(path.join(bundleDir, 'events.json'), JSON.stringify(baseEvents));
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
      }, null, 2),
    );

    const r = spawnSync(process.execPath, [RUN_MJS, `--replay=${bundleDir}`], { cwd: L2_DIR, encoding: 'utf8', env: { ...process.env } });
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`);
    assert.notEqual(r.status, EXIT.INCOMPLETE, `replay must produce a verdict, not INCOMPLETE\n${r.stdout}${r.stderr}`);

    const md = fs.readFileSync(reportPath, 'utf8');
    assert.match(md, /\*\*Mode:\*\* replayed \(from /, 'replay mode marker');
    assert.match(md, /hook_effect\(destructive_guard=ask\)/, 'the kind:"hook" event in events.json replays the hook_effect token into the observed skeleton');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

// --------------------------------------------------------------------------- G6a (#122): session options seam
// Empty env on every call: the resolution table (manifest -> env seam -> default) must be exercised
// with NO leakage from the developer's shell (a stray COMPAT_L2_* would silently change the expected
// object). `buildSessionOptions` takes env explicitly, so nothing here touches process.env.

test('buildSessionOptions: default is exactly { skipCustomInstructions: true }', () => {
  const r = buildSessionOptions(null, {});
  assert.deepEqual(r, { skipCustomInstructions: true }, 'null manifest + empty env -> ONLY the ADR-001 default key');
  assert.equal('excludedTools' in r, false, 'excludedTools absent by default (never key: null)');
  assert.equal('reasoningEffort' in r, false, 'reasoningEffort absent by default (never key: null)');
  assert.equal('model' in r, false, 'model is NOT resolved here (resolveModel merges it in the caller)');
});

test('buildSessionOptions: manifest false wins over default and env (first non-null in R1.1 order)', () => {
  const manifest = { sessionOptions: { skipCustomInstructions: false, excludedTools: null, reasoningEffort: null } };
  const r = buildSessionOptions(manifest, { COMPAT_L2_SKIP_INSTR: '1' });
  assert.equal(r.skipCustomInstructions, false, 'manifest false beats the env seam (=1) and the default (true)');
  assert.deepEqual(r, { skipCustomInstructions: false }, 'a plain-legacy-shaped manifest yields ONLY the false key');
});

test('buildSessionOptions: env seams COMPAT_L2_SKIP_INSTR / COMPAT_L2_EXCLUDED_TOOLS / COMPAT_L2_EFFORT', () => {
  const r = buildSessionOptions(null, {
    COMPAT_L2_SKIP_INSTR: '0',
    COMPAT_L2_EXCLUDED_TOOLS: 'mcp:playwright,foo',
    COMPAT_L2_EFFORT: 'low',
  });
  assert.equal(r.skipCustomInstructions, false, 'COMPAT_L2_SKIP_INSTR=0 -> false');
  assert.deepEqual(r.excludedTools, ['mcp:playwright', 'foo'], 'comma-separated env -> string[]');
  assert.equal(r.reasoningEffort, 'low', 'COMPAT_L2_EFFORT -> reasoningEffort');
  assert.deepEqual(Object.keys(r), ['skipCustomInstructions', 'excludedTools', 'reasoningEffort'], 'stable key order (the meta persists this object verbatim)');
  assert.equal(buildSessionOptions(null, { COMPAT_L2_SKIP_INSTR: '1' }).skipCustomInstructions, true, 'COMPAT_L2_SKIP_INSTR=1 -> true');
});

test('buildSessionOptions: null never emits a key (manifest excludedTools:null / reasoningEffort:null)', () => {
  const manifest = { sessionOptions: { skipCustomInstructions: true, excludedTools: null, reasoningEffort: null } };
  const r = buildSessionOptions(manifest, {});
  assert.equal('excludedTools' in r, false, 'manifest excludedTools:null -> key absent, not key: null');
  assert.equal('reasoningEffort' in r, false, 'manifest reasoningEffort:null -> key absent, not key: null');
  assert.deepEqual(r, { skipCustomInstructions: true }, 'nothing but the explicit boolean survives');
  // A manifest null must NOT shadow the env seam: null = "no opinion", the next source resolves.
  const r2 = buildSessionOptions(manifest, { COMPAT_L2_EFFORT: 'high' });
  assert.equal(r2.reasoningEffort, 'high', 'manifest null falls through to the env seam (first NON-null wins)');
});

// --------------------------------------------------------------------------- G6a (#122): config.yml seeding

test('seedConfigYml: writes the exact two lines (html_output true by default, false via seeds)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-seed-'));
  try {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    fs.mkdirSync(a); fs.mkdirSync(b);

    // No manifest seeds, empty env -> html_output: true; `.maister/` is created (template without one).
    const ra = seedConfigYml(a, developmentScenario, resolveHtmlOutput(null, {}));
    assert.equal(fs.readFileSync(path.join(a, '.maister', 'config.yml'), 'utf8'), 'html_output: true\nmockup_format: html\n', 'exact /maister:init-shaped two-line file');
    assert.deepEqual(ra, { configYml: { html_output: true, mockup_format: 'html' }, note: null }, 'seed return for the meta (default)');

    // Manifest seeds win (html_output:false) even when the env seam says 1.
    const rb = seedConfigYml(b, developmentScenario, resolveHtmlOutput({ configYml: { html_output: false }, hookContextAppend: null }, { COMPAT_L2_HTML_OUTPUT: '1' }));
    assert.equal(fs.readFileSync(path.join(b, '.maister', 'config.yml'), 'utf8'), 'html_output: false\nmockup_format: html\n', 'manifest html_output:false is written verbatim');
    assert.deepEqual(rb, { configYml: { html_output: false, mockup_format: 'html' }, note: null }, 'seed return for the meta (manifest)');

    // Env seam alone (no manifest) -> COMPAT_L2_HTML_OUTPUT=0 -> false.
    const c = path.join(root, 'c'); fs.mkdirSync(c);
    seedConfigYml(c, developmentScenario, resolveHtmlOutput(null, { COMPAT_L2_HTML_OUTPUT: '0' }));
    assert.equal(fs.readFileSync(path.join(c, '.maister', 'config.yml'), 'utf8'), 'html_output: false\nmockup_format: html\n', 'COMPAT_L2_HTML_OUTPUT=0 -> false');

    // Fix pass 2: the seed takes ONLY a resolved boolean — an unresolved value is a precondition, nothing written.
    const d = path.join(root, 'd'); fs.mkdirSync(d);
    assert.throws(
      () => seedConfigYml(d, developmentScenario, undefined),
      (err) => err.code === 'L2_PRECONDITION' && err.exitCode === EXIT.INCOMPLETE && /html_output/.test(err.message),
      'an unresolved html_output -> L2_PRECONDITION (no process.env fallback inside the seed)',
    );
    assert.equal(fs.existsSync(path.join(d, '.maister')), false, 'nothing written on the precondition');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('seedConfigYml: init is skipped with a note; a pre-existing config.yml is a precondition (exit 2)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-seed-'));
  try {
    // init: the template must stay bare (init-structure oracle) -> nothing written, note returned.
    const initDir = path.join(root, 'init'); fs.mkdirSync(initDir);
    const r = seedConfigYml(initDir, { id: 'init' }, true);
    assert.deepEqual(r, { configYml: null, note: 'init: template must stay bare (init-structure oracle)' }, 'init -> skipped with the documented note');
    assert.equal(fs.existsSync(path.join(initDir, '.maister')), false, 'init -> no .maister/ created at all');

    // A template that already ships .maister/config.yml -> precondition error mapped to exit 2, and the
    // shipped file is left untouched (never silently mask a future template edit).
    const dupDir = path.join(root, 'dup', '.maister'); fs.mkdirSync(dupDir, { recursive: true });
    const shipped = path.join(dupDir, 'config.yml');
    fs.writeFileSync(shipped, 'html_output: false\n');
    assert.throws(
      () => seedConfigYml(path.join(root, 'dup'), developmentScenario, true),
      (err) => err.code === 'L2_PRECONDITION' && err.exitCode === EXIT.INCOMPLETE && /config\.yml/.test(err.message),
      'existing config.yml -> L2_PRECONDITION with exitCode 2 naming the file',
    );
    assert.equal(fs.readFileSync(shipped, 'utf8'), 'html_output: false\n', 'the shipped file is not overwritten');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------- G3 (#122): replay-meta v2 provenance
// Pure helpers + the fail-closed provenance chain (R2.2–R2.4) and the deriveVerdict refactor (R7.1).
// Every check is credit-free: no SDK import, no session; mkdtemp trees + the one side-effect report are
// removed in `finally`. The shell idiom is spawned via `sh -c` so the digest is proven byte-equal to what
// an operator would compute by hand.

test('normalizeCliVersion: two-line copilot --version -> "1.0.82"; "unknown …" -> null', () => {
  const twoLine = 'GitHub Copilot CLI 1.0.82.\nRun \'copilot update\' to check for updates.';
  assert.equal(normalizeCliVersion(twoLine), '1.0.82', 'the first \\d+.\\d+.\\d+ match of the real two-line output');
  assert.equal(normalizeCliVersion('unknown (copilot not on PATH)'), null, 'the detectCopilotVersion fallback has no version -> null');
  assert.equal(normalizeCliVersion(null), null, 'null input -> null (never throws)');
  assert.equal(normalizeCliVersion('1.0.82'), '1.0.82', 'an already-bare version is returned verbatim');
});

// Run the shell idiom inside `dir` and return its `sha256:<hex>`. `nullSafe` swaps in the -print0 /
// sort -z / xargs -0 form (byte-identical per-file lines, so the same digest) — the ONLY form that is
// well-defined for a file name containing a space (plain xargs would split it into two missing files).
function shellDigest(dir, nullSafe = false) {
  const cmd = nullSafe
    ? 'find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256'
    : 'find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256';
  const r = spawnSync('sh', ['-c', cmd], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `shell idiom must succeed: ${r.stderr}`);
  const m = /^([0-9a-f]{64})/.exec(r.stdout);
  assert.ok(m, `shell idiom must print a sha256: ${r.stdout}`);
  return `sha256:${m[1]}`;
}

test('digestTree equals the shell idiom on a 3-file mkdtemp tree (nested dir + a file with a space)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-digest-'));
  try {
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha\n');
    fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sub', 'deep', 'b.md'), '# beta\n\nbody\n');
    // Two files (no whitespace in any name): the exact R2.3 idiom, verbatim.
    const two = digestTree(root);
    assert.match(two, /^sha256:[0-9a-f]{64}$/, 'digest shape sha256:<64 hex>');
    assert.equal(two, shellDigest(root), 'node digest must equal the R2.3 shell idiom byte-for-byte');

    // Third file, name with a space: the digest changes and equals the null-safe form of the idiom.
    fs.writeFileSync(path.join(root, 'sub', 'c d.txt'), 'gamma delta\n');
    const three = digestTree(root);
    assert.notEqual(three, two, 'adding a file changes the digest');
    assert.equal(three, shellDigest(root, true), 'node digest must equal the null-safe shell idiom with a space in a name');

    // Content change (same names) re-stamps; deterministic on repeat.
    fs.writeFileSync(path.join(root, 'a.txt'), 'alpha2\n');
    const four = digestTree(root);
    assert.notEqual(four, three, 'a content change re-stamps the digest');
    assert.equal(digestTree(root), four, 'deterministic across calls');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('servedModelsFromEvents: main from startup model_change; agent seen with two models -> sorted array', () => {
  const events = [
    { type: 'session.model_change', data: { source: 'startup', newModel: 'gpt-5.6-luna' } },
    { type: 'subagent.started', data: { agentName: 'maister-copilot:research-planner', model: 'gpt-5.6-luna' } },
    { type: 'subagent.started', data: { agentName: 'maister-copilot:information-gatherer', model: 'gpt-5.6-mini' } },
    { type: 'subagent.started', data: { agentName: 'maister-copilot:information-gatherer', model: 'gpt-5.6-luna' } },
    { type: 'subagent.started', data: { agentName: 'maister-copilot:information-gatherer', model: 'gpt-5.6-mini' } },
    { type: 'subagent.started', data: { agentName: 'maister-copilot:no-model' } },
  ];
  const r = servedModelsFromEvents(events);
  assert.equal(r.main, 'gpt-5.6-luna', 'main = the startup session.model_change newModel');
  assert.equal(r['maister-copilot:research-planner'], 'gpt-5.6-luna', 'an agent seen with ONE model -> the string');
  assert.deepEqual(r['maister-copilot:information-gatherer'], ['gpt-5.6-luna', 'gpt-5.6-mini'], 'two distinct models -> SORTED array, de-duplicated, never last-wins');
  assert.equal('maister-copilot:no-model' in r, false, 'an agent with no model field contributes nothing (null-never-0)');
  assert.equal(Object.keys(r)[0], 'main', 'main is the first key');

  // No startup event -> main:null; a non-startup model_change is NOT main.
  const none = servedModelsFromEvents([{ type: 'session.model_change', data: { source: 'user', newModel: 'x' } }]);
  assert.deepEqual(none, { main: null }, 'no startup model_change -> { main: null } only');
  assert.deepEqual(servedModelsFromEvents([]), { main: null }, 'empty events -> { main: null }');
});

test('computeRunProvenance: unreadable manifest / bad commit are preconditions before spend', () => {
  const reference = JSON.parse(fs.readFileSync(path.join(L2_DIR, 'reference', 'research.skeleton.json'), 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-prov-'));
  try {
    const pluginDir = path.join(root, 'plugin');
    fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'maister-copilot', version: '9.9.9+fork.1' }));
    fs.writeFileSync(path.join(pluginDir, 'README.md'), 'plugin\n');
    const isPre = (err) => err.code === 'L2_PRECONDITION' && err.exitCode === EXIT.INCOMPLETE;

    // (1) bogus COMPAT_ARM_MANIFEST path -> the manifest parse is the FIRST link and throws a precondition.
    assert.throws(
      () => computeRunProvenance({ manifestPath: path.join(root, 'no-such-arm.json'), pluginDir, commit: null, variant: 'plain', reference }),
      (err) => isPre(err) && /COMPAT_ARM_MANIFEST/.test(err.message),
      'unreadable manifest -> L2_PRECONDITION (exit 2) naming COMPAT_ARM_MANIFEST',
    );
    // (2) bad COMPAT_VARIANT_COMMIT -> git rev-parse fails -> precondition, never a null treeOid.
    assert.throws(
      () => computeRunProvenance({ manifestPath: null, pluginDir, commit: 'deadbeef', variant: 'plain', reference }),
      (err) => isPre(err) && /deadbeef/.test(err.message),
      'bad commit -> L2_PRECONDITION (exit 2) naming the commit',
    );
    // (3) unreadable plugin tree -> precondition (pluginDigest is never null).
    assert.throws(
      () => computeRunProvenance({ manifestPath: null, pluginDir: path.join(root, 'absent'), commit: null, variant: null, reference }),
      isPre,
      'missing plugin dir -> L2_PRECONDITION (exit 2)',
    );

    // (4) valid working-tree call (no variant, no commit): digest + pluginSource + referenceHash.
    const prov = computeRunProvenance({ manifestPath: null, pluginDir, commit: null, variant: null, reference });
    assert.equal(prov.pluginDigest, digestTree(pluginDir), 'pluginDigest = digestTree(pluginDir)');
    assert.deepEqual(prov.pluginSource, { commit: null, commitRef: null, treeOid: null, forkVersion: '9.9.9+fork.1', method: 'working-tree', origin: null }, 'working-tree pluginSource shape (commitRef added by the fix pass; origin appended after method by #138)');
    assert.equal(prov.referenceHash, computeHash(reference), 'referenceHash = compare.mjs computeHash(reference), never re-implemented');
    assert.equal(prov.armManifest, null, 'no manifest -> armManifest null');
    // variant set -> method git-archive; commit against the real repo -> a 40-hex tree oid.
    const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: L2_DIR, encoding: 'utf8' });
    if (head.status === 0) {
      const p2 = computeRunProvenance({ manifestPath: null, pluginDir, commit: head.stdout.trim(), variant: 'plain', reference });
      assert.equal(p2.pluginSource.method, 'git-archive', 'COMPAT_VARIANT set -> method git-archive');
      assert.equal(p2.pluginSource.commit, head.stdout.trim(), 'a 40-hex pin resolves to itself');
      assert.equal(p2.pluginSource.commitRef, head.stdout.trim(), 'commitRef = the operator spelling');
      assert.match(p2.pluginSource.treeOid, /^[0-9a-f]{40}$/, 'treeOid = git rev-parse <commit>:plugins/maister-copilot');
      // Fix pass (reality W2): a symbolic / short spelling is RESOLVED to the same 40-hex oid (one identity),
      // the spelling kept as commitRef, the tree oid identical.
      const p2b = computeRunProvenance({ manifestPath: null, pluginDir, commit: 'HEAD', variant: 'plain', reference });
      assert.equal(p2b.pluginSource.commit, head.stdout.trim(), '"HEAD" resolves to the 40-hex commit oid');
      assert.equal(p2b.pluginSource.commitRef, 'HEAD', 'the spelling is preserved as commitRef');
      assert.equal(p2b.pluginSource.treeOid, p2.pluginSource.treeOid, 'same tree oid under either spelling');
      const p2c = computeRunProvenance({ manifestPath: null, pluginDir, commit: head.stdout.trim().slice(0, 7), variant: 'plain', reference });
      assert.equal(p2c.pluginSource.commit, head.stdout.trim(), 'a 7-hex prefix resolves to the full oid');
      assert.deepEqual(Object.keys(p2b.pluginSource), ['commit', 'commitRef', 'treeOid', 'forkVersion', 'method', 'origin'], 'pluginSource key order pinned (origin APPENDED after method — the existing keys never move)');
    }
    // (5) unreadable plugin.json -> forkVersion null (warning, NOT a precondition).
    fs.rmSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
    const p3 = computeRunProvenance({ manifestPath: null, pluginDir, commit: null, variant: null, reference });
    assert.equal(p3.pluginSource.forkVersion, null, 'unreadable plugin.json -> forkVersion null, still a valid provenance');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Stage the committed research fixture as a live-shaped bundle (mirrors replay.test.mjs stageBundle;
// 2099-series ts so no real six-bundle report is ever overwritten).
function stageResearchBundle(root, ts) {
  const GOOD_REPORT = [
    '# Research Report: G3 deriveVerdict / --replay agreement',
    '',
    '## Findings',
    'deriveVerdict is the single verdict authority: finalizeSingleRun consumes it for the report + exit',
    'code, and an in-process caller (cost-report --verdict) gets exactly the same overall and counts.',
    'The bundle is reconstructed by extractFromBundle, which never imports the SDK (credit-free).',
    'The sample CLI implements `frobnicate` but leaves it unreachable from the dispatcher (dead code).',
    '',
    '## Conclusion',
    'One verdict function, two surfaces, identical output.',
    '',
  ].join('\n');
  const bundleDir = path.join(root, ts);
  const taskDir = path.join(bundleDir, 'rundir', '.maister', 'tasks', 'research', '2026-09-03-l2-g3-verdict');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.copyFileSync(path.join(RESEARCH_FIX, 'events.sample.json'), path.join(bundleDir, 'events.json'));
  fs.cpSync(path.join(RESEARCH_FIX, 'task-tree'), taskDir, { recursive: true });
  fs.copyFileSync(path.join(RESEARCH_FIX, 'orchestrator-state.sample.yml'), path.join(taskDir, 'orchestrator-state.yml'));
  fs.writeFileSync(path.join(taskDir, 'outputs', 'research-report.md'), GOOD_REPORT);
  fs.writeFileSync(path.join(bundleDir, 'replay-meta.json'), JSON.stringify({
    scenario: 'research', taskType: 'research', copilotVersion: '1.0.81',
    sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs',
    ts, originalMode: 'live', maisterVersion: '0.0.0',
  }, null, 2));
  return bundleDir;
}

test('deriveVerdict on the research fixture equals what --replay reports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-g3-verdict-'));
  const ts = '20990401T000000Z';
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const bundleDir = stageResearchBundle(root, ts);

    // The operator surface: the --replay subprocess verdict line (finalizeSingleRun's stdout).
    const r = spawnSync(process.execPath, [RUN_MJS, `--replay=${bundleDir}`], { cwd: L2_DIR, encoding: 'utf8', env: { ...process.env } });
    assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`);
    const line = /L2: (AS-EXPECTED|REGRESSED) — (\d+) PASS · (\d+) LIMITATION · (\d+) FAIL/.exec(r.stdout ?? '');
    assert.ok(line, `--replay must print a counted verdict line\n${r.stdout}${r.stderr}`);
    const spawned = { overall: line[1], pass: Number(line[2]), limitation: Number(line[3]), fail: Number(line[4]), exit: r.status };

    // The in-process surface: extractFromBundle + deriveVerdict (what cost-report --verdict will call).
    const bundle = extractFromBundle(bundleDir);
    assert.equal(bundle.dir, bundleDir, 'extractFromBundle echoes the bundle dir');
    assert.equal(bundle.sc.id, 'research', 'scenario resolved from meta.scenario');
    assert.equal(bundle.meta.ts, ts, 'meta parsed verbatim');
    assert.ok(Array.isArray(bundle.events) && bundle.events.length > 0, 'events.json parsed');
    assert.equal(bundle.res.status, 'ok', 'a conformant fixture yields a status:ok driveOnce-shaped res');
    const reference = JSON.parse(fs.readFileSync(path.join(L2_DIR, 'reference', 'research.skeleton.json'), 'utf8'));
    const v = deriveVerdict(bundle.res, reference);

    assert.deepEqual(Object.keys(v).sort(), ['counts', 'overall', 'reason', 'result'], 'deriveVerdict returns exactly { overall, counts, result, reason }');
    assert.equal(v.overall, spawned.overall, 'same overall as the --replay line');
    assert.equal(v.counts.pass, spawned.pass, 'same PASS count');
    assert.equal(v.counts.limitation, spawned.limitation, 'same LIMITATION count');
    assert.equal(v.counts.skip, 0, 'SKIP is 0 on the N=1 path (run.mjs count vocabulary)');
    assert.equal(v.counts.fail, spawned.fail, 'same FAIL count');
    assert.equal(v.reason, null, 'a real verdict carries no INCOMPLETE reason');
    assert.equal(v.result.exitCode, spawned.exit, 'compare exitCode = the --replay process exit code');
    assert.equal(spawned.overall, 'AS-EXPECTED', 'guard: the research fixture is the conformant oracle');

    // Pure: the same inputs derive the same verdict again; the timeout shape is INCOMPLETE with a reason.
    assert.deepEqual(deriveVerdict(bundle.res, reference), v, 'deterministic');
    const t = deriveVerdict({ status: 'incomplete', reason: 'sendAndWait did not complete (timeout)', run: 1 }, reference);
    assert.deepEqual(t, { overall: 'INCOMPLETE', counts: { pass: 0, limitation: 0, skip: 0, fail: 0 }, result: null, reason: 'sendAndWait did not complete (timeout)' }, 'timeout -> INCOMPLETE, zero counts, the reason');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

// --------------------------------------------------------------------------- G3 (#122): replay from meta, legacy map, header
function headerBlock(md) {
  // The header = everything before the blank line that precedes **Result:**; the four new lines live here.
  return md.split('\n**Result:**')[0];
}
function provCtx(prov, ts = '20990501T000000Z') {
  return baseCtx({ mode: 'replayed', replaySource: `/bundles/${ts}`, ts, pluginDir: undefined, pluginName: undefined, ...prov });
}

test('provenanceForReplay: v2 meta without pluginDir falls back to "UNATTRIBUTED (v2 meta missing pluginDir)", never undefined (audit I8)', () => {
  const ts = '20990501T000000Z';
  const bare = provenanceForReplay({ metaSchema: 2, variant: 'plain' }, ts, { bundles: {} });
  assert.equal(bare.provenance, 'meta', 'metaSchema >= 2 is attributed from the meta');
  assert.equal(bare.pluginDir, 'UNATTRIBUTED (v2 meta missing pluginDir)', 'the I8 fallback literal');
  assert.equal(bare.pluginName, 'maister-copilot', 'pluginName falls back to the fixed plugin name');
  assert.equal(bare.variant, 'plain', 'variant threaded from meta');
  for (const k of ['mutation', 'pluginSource', 'pluginDigest', 'sessionOptions']) {
    assert.equal(bare[k], null, `${k} absent in meta -> null (never undefined)`);
  }
  assert.ok(!Object.values(bare).includes(undefined), `no ctx field may be undefined: ${JSON.stringify(bare)}`);
  const hdr = headerBlock(buildReport(provCtx(bare, ts)));
  assert.match(hdr, /^- \*\*Plugin under test:\*\* `UNATTRIBUTED \(v2 meta missing pluginDir\)` \(name: `maister-copilot`\)$/m, 'the fallback renders in the unchanged v2 format');
  assert.match(hdr, /^- \*\*Variant:\*\* `plain`$/m, 'v2 variant renders fenced');
  assert.ok(!hdr.includes('undefined'), `a v2 header never renders "undefined":\n${hdr}`);

  // Meta wins over a legacy-map row for the same ts (the map is for pre-provenance bundles only).
  const mapped = provenanceForReplay(
    { metaSchema: 2, variant: 'lean', pluginDir: '/recorded/plugins/maister-copilot', pluginName: 'maister-copilot' },
    ts, { bundles: { [ts]: { legacyArm: 'upstream-control', pluginDirRecovered: '/legacy/dir' } } },
  );
  assert.equal(mapped.provenance, 'meta', 'a v2 meta is never re-attributed from the legacy map');
  assert.equal(mapped.pluginDir, '/recorded/plugins/maister-copilot', 'recorded pluginDir wins');
  assert.equal(mapped.variant, 'lean', 'recorded variant wins');

  // ts resolution: null ts falls back to meta.ts for the map lookup.
  const viaMetaTs = provenanceForReplay({ ts }, null, { bundles: { [ts]: { legacyArm: 'fork-legacy', pluginDirRecovered: null } } });
  assert.equal(viaMetaTs.provenance, 'legacy-map', 'a null ts falls back to meta.ts for the map lookup');
  assert.equal(viaMetaTs.legacyArm, 'fork-legacy');
});

test('buildReport: legacy-map hit with pluginDirRecovered null renders "UNATTRIBUTED (pre-provenance bundle; legacy map — no path-bearing event)"; no-provenance renders the cost-report --recover hint (R3.3)', () => {
  const ts = '20990502T000000Z';
  const legacyMeta = { scenario: 'research', ts }; // pre-provenance shape

  // Column 2: legacy map hit, no recovered path.
  const hit = provenanceForReplay(legacyMeta, ts, { bundles: { [ts]: { legacyArm: 'upstream-control', pluginDirRecovered: null, comparable: false } } });
  assert.equal(hit.provenance, 'legacy-map');
  assert.equal(hit.pluginDirRecovered, null);
  const hdr2 = headerBlock(buildReport(provCtx(hit, ts)));
  assert.match(hdr2, /^- \*\*Plugin under test:\*\* UNATTRIBUTED \(pre-provenance bundle; legacy map — no path-bearing event\)$/m, 'null recovered dir -> the no-path-bearing-event literal');
  assert.match(hdr2, /^- \*\*Variant:\*\* upstream-control \(legacy map — pre-provenance bundle\)$/m, 'legacy arm with the legacy-map label');
  assert.match(hdr2, /^- \*\*Plugin source:\*\* unknown \(pre-provenance bundle\)$/m, 'source unknown');
  assert.match(hdr2, /^- \*\*Plugin digest:\*\* unknown \(pre-provenance bundle\)$/m, 'digest unknown');
  assert.match(hdr2, /^- \*\*Session options:\*\* unknown \(pre-provenance bundle\)$/m, 'session options unknown');
  assert.ok(!hdr2.includes('undefined'), `legacy-map header never renders "undefined":\n${hdr2}`);

  // Column 2, recovered path present.
  const hitDir = provenanceForReplay(legacyMeta, ts, { bundles: { [ts]: { legacyArm: 'fork-legacy', pluginDirRecovered: '/rec/plugins/maister-copilot' } } });
  const hdr2b = headerBlock(buildReport(provCtx(hitDir, ts)));
  assert.match(hdr2b, /^- \*\*Plugin under test:\*\* `\/rec\/plugins\/maister-copilot` \(name: `maister-copilot`; legacy map — pre-provenance bundle\)$/m, 'recovered dir renders fenced with the legacy-map label');

  // Column 3: no provenance at all.
  const none = provenanceForReplay(legacyMeta, ts, { bundles: {} });
  assert.equal(none.provenance, 'none');
  assert.ok(!Object.values(none).includes(undefined), `no ctx field may be undefined: ${JSON.stringify(none)}`);
  const hdr3 = headerBlock(buildReport(provCtx(none, ts)));
  assert.match(hdr3, /^- \*\*Plugin under test:\*\* UNATTRIBUTED \(pre-provenance bundle; cost-report --recover shows the loaded path\)$/m, 'unmapped pre-provenance -> the --recover hint');
  assert.match(hdr3, /^- \*\*Variant:\*\* unknown \(pre-provenance bundle\)$/m, 'variant unknown');
  assert.match(hdr3, /^- \*\*Plugin source:\*\* unknown \(pre-provenance bundle\)$/m, 'source unknown');
  assert.match(hdr3, /^- \*\*Plugin digest:\*\* unknown \(pre-provenance bundle\)$/m, 'digest unknown');
  assert.match(hdr3, /^- \*\*Session options:\*\* unknown \(pre-provenance bundle\)$/m, 'session options unknown');
  assert.ok(!hdr3.includes('undefined'), `no-provenance header never renders "undefined":\n${hdr3}`);
  // An absent legacyMap argument behaves as an empty map.
  assert.equal(provenanceForReplay(legacyMeta, ts).provenance, 'none', 'missing legacyMap -> none');

  // Column 1: v2 with full provenance — variant, git-archive source, digest, compact session options.
  const digest = `sha256:${'ab'.repeat(32)}`;
  const v2 = provenanceForReplay({
    metaSchema: 2, variant: 'caveman', mutation: null, pluginDir: '/staged/plugins/maister-copilot', pluginName: 'maister-copilot',
    pluginDigest: digest, pluginSource: { commit: '66a523c', treeOid: '0123456789abcdef0123456789abcdef01234567', forkVersion: '2.2.3+fork.4', method: 'git-archive' },
    sessionOptions: { skipCustomInstructions: true, model: 'gpt-5.6-luna' },
  }, ts, { bundles: {} });
  const hdr1 = headerBlock(buildReport(provCtx(v2, ts)));
  const lines = hdr1.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  // Fix pass (reality W5): a git-archive bundle leads with the durable identity; the (vanished) staged path is secondary.
  assert.match(hdr1, /^- \*\*Plugin under test:\*\* `git-archive 66a523c \(tree 01234567\)` \(name: `maister-copilot`; staged at `\/staged\/plugins\/maister-copilot`\)$/m, 'git-archive: commit + tree first, staged path secondary');
  assert.match(hdr1, /^- \*\*Variant:\*\* `caveman`$/m, 'variant fenced');
  assert.match(hdr1, /^- \*\*Plugin source:\*\* `git-archive 66a523c \(tree 01234567, version 2\.2\.3\+fork\.4\)`$/m, 'git-archive source with 8-hex tree + fork version');
  // Fix pass (reality W2): a resolved 40-hex commit renders as its 8-hex short oid, with the operator's
  // spelling (commitRef) shown only when it differs.
  const resolved = provenanceForReplay({
    metaSchema: 2, variant: 'plain', pluginDir: '/staged/plugins/maister-copilot',
    pluginSource: { commit: '89abcdef0123456789abcdef0123456789abcdef', commitRef: 'v2.2.3', treeOid: '0123456789abcdef0123456789abcdef01234567', forkVersion: '2.2.3+fork.4', method: 'git-archive' },
  }, ts, { bundles: {} });
  const hdrR = headerBlock(buildReport(provCtx(resolved, ts)));
  assert.match(hdrR, /^- \*\*Plugin source:\*\* `git-archive 89abcdef \(ref v2\.2\.3; tree 01234567, version 2\.2\.3\+fork\.4\)`$/m, 'short oid + differing ref');
  assert.match(hdrR, /^- \*\*Plugin under test:\*\* `git-archive 89abcdef \(tree 01234567\)` \(name: `maister-copilot`; staged at `\/staged\/plugins\/maister-copilot`\)$/m, 'plugin-under-test line uses the short oid too');
  const same = provenanceForReplay({
    metaSchema: 2, variant: 'plain', pluginDir: '/p',
    pluginSource: { commit: '89abcdef0123456789abcdef0123456789abcdef', commitRef: '89abcdef0123456789abcdef0123456789abcdef', treeOid: null, forkVersion: null, method: 'git-archive' },
  }, ts, { bundles: {} });
  assert.match(headerBlock(buildReport(provCtx(same, ts))), /^- \*\*Plugin source:\*\* `git-archive 89abcdef \(tree unknown, version unknown\)`$/m, 'ref equal to the commit is not repeated; null tree/version -> unknown');
  // A working-tree bundle keeps the plain path line (T-PROV-1 shape: variant plain, no pluginSource).
  const wt = provenanceForReplay({ metaSchema: 2, variant: 'plain', pluginDir: '/wt/plugins/maister-copilot' }, ts, { bundles: {} });
  assert.match(headerBlock(buildReport(provCtx(wt, ts))), /^- \*\*Plugin under test:\*\* `\/wt\/plugins\/maister-copilot` \(name: `maister-copilot`\)$/m, 'working-tree / no pluginSource: the recorded path renders unchanged');
  assert.match(hdr1, new RegExp(`^- \\*\\*Plugin digest:\\*\\* \`${digest}\`$`, 'm'), 'digest fenced verbatim');
  assert.match(hdr1, /^- \*\*Session options:\*\* `\{"skipCustomInstructions":true,"model":"gpt-5\.6-luna"\}`$/m, 'compact JSON of sessionOptions');
  const order = [at(/Plugin under test/), at(/\*\*Variant:/), at(/\*\*Plugin source:/), at(/\*\*Plugin digest:/), at(/\*\*Session options:/), at(/Copilot SDK \(resolved\)/)];
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `the four lines sit between Plugin under test and Copilot SDK, in table order: ${order}`);
  assert.ok(order.every((i) => i >= 0) && order[5] - order[0] === 5, `the five lines are contiguous: ${order}`);

  // v2 variants of the Variant / source lines: mutation, plain working-tree, nothing.
  const mut = provenanceForReplay({ metaSchema: 2, variant: null, mutation: 'M1', pluginDir: '/p', pluginSource: { commit: null, treeOid: null, forkVersion: '2.2.3+fork.4', method: 'working-tree' } }, ts, { bundles: {} });
  const hdrM = headerBlock(buildReport(provCtx(mut, ts)));
  assert.match(hdrM, /^- \*\*Variant:\*\* none \(mutation M1\)$/m, 'mutant renders none (mutation <id>)');
  assert.match(hdrM, /^- \*\*Plugin source:\*\* `working-tree \(version 2\.2\.3\+fork\.4\)`$/m, 'working-tree source with fork version');
  const plainNone = provenanceForReplay({ metaSchema: 2, pluginDir: '/p' }, ts, { bundles: {} });
  const hdrN = headerBlock(buildReport(provCtx(plainNone, ts)));
  assert.match(hdrN, /^- \*\*Variant:\*\* none$/m, 'no variant, no mutation -> none');
  assert.ok(!hdrN.includes('undefined'), `v2 with null provenance fields never renders "undefined":\n${hdrN}`);
});

test('legacy-arms.json: schema 1, exactly the six pre-#122 ts keys, every row fully attributed and comparable:false (R3.1)', () => {
  const file = path.join(L2_DIR, 'variants', 'legacy-arms.json');
  assert.ok(fs.existsSync(file), `committed legacy map must exist at ${file}`);
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(map.schema, 1, 'schema 1');
  assert.equal(typeof map.note, 'string', 'top-level note is a string');
  const keys = Object.keys(map.bundles);
  assert.deepEqual(keys.sort(), ['20260831T022944Z', '20260831T022952Z', '20260831T024753Z', '20260903T000910Z', '20260903T003148Z', '20260903T004846Z'], 'exactly the six pre-provenance bundles');
  for (const ts of keys) {
    assert.match(ts, /^2026(08|09)\d{2}T\d{6}Z$/, `${ts}: key is a 2026-08/09 ts`);
    assert.ok(ts <= '20260903T004846Z', `${ts}: never a post-#122 ts (provenance must come from the bundle)`);
    const row = map.bundles[ts];
    assert.deepEqual(Object.keys(row).sort(), ['comparable', 'legacyArm', 'maisterVersion', 'note', 'pluginDirRecovered', 'scenario'], `${ts}: exact row keys`);
    assert.ok(['upstream-control', 'fork-legacy'].includes(row.legacyArm), `${ts}: legacyArm is one of the two legacy arms`);
    assert.equal(typeof row.scenario, 'string', `${ts}: scenario`);
    assert.equal(typeof row.maisterVersion, 'string', `${ts}: maisterVersion`);
    assert.ok(row.pluginDirRecovered === null || typeof row.pluginDirRecovered === 'string', `${ts}: pluginDirRecovered is a path or null`);
    assert.equal(row.comparable, false, `${ts}: comparable:false everywhere`);
    assert.equal(typeof row.note, 'string', `${ts}: note`);
  }
  assert.equal(map.bundles['20260831T022944Z'].pluginDirRecovered, null, 'destructive-guard has no path-bearing event');
  // loadLegacyArms reads exactly this file; an absent file is an empty map, never a throw.
  assert.deepEqual(loadLegacyArms(), map, 'loadLegacyArms() returns the committed map verbatim');
  assert.deepEqual(loadLegacyArms(path.join(os.tmpdir(), 'l2-no-such-legacy-arms.json')), { bundles: {} }, 'absent file -> { bundles: {} }');
});

// --------------------------------------------------------------------------- G4 (#122, R9): shared servedModelsFromEvents on the cost-report fixture
test('servedModelsFromEvents on the cost-report fixture (real 1.0.82 events): main gpt-5.6-luna, explore on gpt-5.4-mini', () => {
  // Fixture provenance: test/fixtures/cost-report/events.sample.json = bundle 20260903T000910Z filtered by
  // gen-fixture.mjs (this test reads the committed artefact only, never reports/).
  const events = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cost-report', 'events.sample.json'), 'utf8'));
  const served = servedModelsFromEvents(events);
  assert.equal(served.main, 'gpt-5.6-luna', 'main from the startup session.model_change');
  assert.equal(served.explore, 'gpt-5.4-mini', 'explore subagents ran on mini (single model -> string)');
  assert.ok(Object.keys(served).length > 2, 'one entry per subagent.started agentName carrying a model');
  for (const [name, model] of Object.entries(served)) {
    assert.ok(typeof model === 'string' || (Array.isArray(model) && model.length > 1), `${name}: a string or a multi-model sorted array, never 0/undefined`);
  }
});

test('help/registry parity (TG9 gap; #122 8.5): `run.mjs -h` names every scenarios/*.mjs id in the --scenario=ID flag text, and parseArgs accepts each', () => {
  // The on-disk registry IS what run.mjs imports (scenarios/<id>.mjs); the help string had drifted to four
  // ids after `work` and `init` were added (66a523c fixed run.sh -h, not run.mjs -h). Credit-free: -h exits 0
  // before any SDK import; parseArgs is pure.
  const ids = fs.readdirSync(path.join(L2_DIR, 'scenarios')).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
  assert.deepEqual(ids, ['destructive-guard', 'development', 'init', 'quick-bugfix', 'research', 'work'], 'the six scenario ids on disk');
  // Fix pass: the EXPORTED registry (the single authority cost-report.mjs imports) carries exactly these ids.
  assert.deepEqual(Object.keys(SCENARIOS).sort(), ids, 'exported SCENARIOS registry = the six scenarios/*.mjs ids (incl. work, init)');
  for (const id of ids) assert.equal(SCENARIOS[id]?.id, id, `SCENARIOS[${id}].id round-trips`);
  assert.equal(typeof loadReference, 'function', 'loadReference is exported (cost-report --verdict reads the reference through it)');
  for (const id of ids) assert.ok(loadReference(id).refPath.endsWith(`${id}.skeleton.json`), `loadReference(${id}) resolves reference/${id}.skeleton.json`);
  const r = spawnSync(process.execPath, [RUN_MJS, '-h'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `-h must exit 0 (stderr: ${r.stderr})`);
  const m = r.stdout.match(/--scenario=ID[\s\S]*?reads\./);
  assert.ok(m, '-h must carry the --scenario=ID paragraph ending in "reads."');
  for (const id of ids) {
    assert.ok(new RegExp(`\\b${id}\\b`).test(m[0]), `-h --scenario paragraph must name "${id}" (has: ${JSON.stringify(m[0])})`);
    assert.equal(parseArgs([`--scenario=${id}`]).scenario, id, `parseArgs must accept --scenario=${id}`);
  }
});

// Fix pass (code-review W4 / reality W1; spec R2.4 literal): the env seams are validated in runLive BEFORE the
// credit-spend confirm. Credit-free by construction twice over: the invalid seam is a precondition (exit 2)
// that returns before any SDK import, and even if it did not, COMPAT_L2_YES is unset on a non-TTY spawn so
// confirmCreditSpend fails closed. The assertion is the ORDER: the confirm text never reaches stdout.
test('runLive: an invalid env seam (COMPAT_L2_SKIP_INSTR=yes / COMPAT_L2_HTML_OUTPUT=maybe) is a precondition exit 2 BEFORE the credit-spend confirm (R2.4)', () => {
  const NODE_BIN_DIR = path.dirname(process.execPath);
  const NO_COPILOT_PATH = [NODE_BIN_DIR, '/usr/bin', '/bin'].join(':'); // copilot hidden: detectCopilotVersion degrades, nothing else changes
  const cases = [
    { env: { COMPAT_L2_SKIP_INSTR: 'yes' }, re: /COMPAT_L2_SKIP_INSTR must be 0 or 1, got "yes"/ },
    { env: { COMPAT_L2_HTML_OUTPUT: 'maybe' }, re: /COMPAT_L2_HTML_OUTPUT must be 0 or 1, got "maybe"/ },
  ];
  for (const c of cases) {
    const env = { ...process.env, PATH: NO_COPILOT_PATH, ...c.env };
    for (const k of ['COMPAT_L2_YES', 'COMPAT_ARM_MANIFEST', 'COMPAT_VARIANT', 'COMPAT_VARIANT_COMMIT', 'COMPAT_MUTATION']) delete env[k];
    const r = spawnSync(process.execPath, [RUN_MJS, '--scenario=research'], { cwd: L2_DIR, encoding: 'utf8', env, timeout: 60000 });
    const label = Object.entries(c.env).map(([k, v]) => `${k}=${v}`).join(' ');
    assert.equal(r.status, EXIT.INCOMPLETE, `${label}: precondition exit 2 (stdout: ${r.stdout}; stderr: ${r.stderr})`);
    assert.match(r.stderr, c.re, `${label}: stderr names the offending seam`);
    assert.doesNotMatch(r.stdout, /CONSUMES AI CREDITS|Proceed and spend|Refusing to spend/, `${label}: the credit-spend confirm text must NEVER appear — the seam is validated before the confirm`);
    assert.doesNotMatch(r.stdout, /AS-EXPECTED|REGRESSED/, `${label}: no verdict`);
  }
});

// ============================================================ #138 WP1 (A1.6) — origin is DECLARED
// Appended at the foot of the file so no pinned line number above it moves.
test('#138: run.mjs derives pluginSource.origin from the arm DECLARATION — no git-topology query anywhere (A1.6)', () => {
  const src = fs.readFileSync(path.join(L2_DIR, 'run.mjs'), 'utf8');
  // `git branch -r --contains f75ef4f` is useless for origin attribution NOT because it is empty but
  // because it matches BOTH repositories: f75ef4f is an ancestor of the fork's master too (153 commits
  // back). Ancestry cannot discriminate upstream from fork, so any such query would be a confident
  // wrong answer. The declaration is the only honest input; the staged tree then corroborates it (D8).
  const topology = src.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /branch -r|--contains/.test(line));
  assert.deepEqual(topology, [], `run.mjs must carry no git-topology origin query — found:\n${topology.map(([n, l]) => `${n}: ${l}`).join('\n')}`);

  // The positive half: origin IS computed, and ONLY from the manifest's declared opt-out.
  const reference = JSON.parse(fs.readFileSync(path.join(L2_DIR, 'reference', 'research.skeleton.json'), 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-origin-'));
  try {
    const pluginDir = path.join(root, 'plugin');
    fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'maister-copilot', version: '9.9.9+fork.1' }));
    fs.writeFileSync(path.join(pluginDir, 'README.md'), 'plugin\n');
    const originOf = (manifest, variant) => computeRunProvenance({ manifest, pluginDir, commit: null, variant, reference }).pluginSource.origin;
    assert.equal(originOf({ arm: 'upstream', manifestSchema: 1, expects: { hooksDir: false } }, 'upstream'), 'upstream',
      'an arm declaring expects.hooksDir:false is upstream code');
    assert.equal(originOf({ arm: 'plain', manifestSchema: 1 }, 'plain'), 'fork', 'every other staged arm is fork code');
    assert.equal(originOf({ arm: 'lean', manifestSchema: 1, expects: { hooksDir: true } }, 'lean'), 'fork',
      'declaring hooksDir:true is still a fork arm — the opt-out is the ONLY upstream signal');
    assert.equal(originOf(null, null), null, 'a working-tree drive stages no arm: origin null, never a guess');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
