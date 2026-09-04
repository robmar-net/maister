// Credit-free N>1 PERSISTENCE + per-run REPLAY test (#63 item 3).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/replay-multirun.test.mjs
//
// Stage 4 persisted a replay bundle ONLY for N=1 (flat reports/<ts>/). This extends persistence to
// EVERY drive of an N>1 run: each drive writes reports/<ts>/run-<i>/{events.json, rundir/,
// replay-meta.json}, and `--replay` accepts a run-<i>/ bundle exactly like a flat one. This file proves
// all three, WITHOUT the SDK (no seat, no credit), over a SYNTHETIC N=2 persist:
//   (1) persistDirFor()   — N=1 -> flat reports/<ts>/; N>1 -> reports/<ts>/run-<i>/ (path math).
//   (2) persistTraceBundle() — the production bundle writer, called twice as an N=2 run would, yields
//       two distinct run-1/ + run-2/ bundles each carrying the three artifacts + self-identifying meta
//       (runIndex/runs). This is the "synthetic N=2 persist" the ticket calls for.
//   (3) `node run.mjs --replay=<reports/<ts>/run-2/>` reproduces the recorded verdict credit-free — the
//       real operator surface, proving replay resolves a per-run bundle (bogus sdkPath = never imported).
//   (4) G3 (#122): buildReplayMeta (the production meta builder driveOnce persists) + persistTraceBundle
//       round-trip a v2 meta: the 12 legacy keys come FIRST in their historical order, the new keys follow
//       `cost`, metaSchema is 2 (R2.1/R2.2; audit W1).
//
// Zero-dependency: node: builtins only. Self-cleaning: os.tmpdir() mkdtemp tree + the two side-effect
// reports removed in finally.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { persistDirFor, persistTraceBundle, buildReplayMeta } from '../run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const RUN_MJS = path.join(L2_DIR, 'run.mjs');
const REPORTS_DIR = path.resolve(L2_DIR, '..', 'reports');
const FIX = path.join(__dirname, 'fixtures', 'research');

// A substantial research report the RE-RUN oracle accepts (mirrors replay.test.mjs GOOD_REPORT).
const GOOD_REPORT = [
  '# Research Report: L2 N=2 Per-run Replay',
  '',
  '## Findings',
  'An N>1 live run now persists one replay bundle per drive under reports/<ts>/run-<i>/, INCOMPLETE',
  'drives included. `--replay` accepts a run-<i>/ bundle exactly like a flat reports/<ts>/ one and',
  'reproduces the recorded verdict without importing the SDK, so the whole round-trip spends no seat.',
  'The sample CLI implements `frobnicate` but leaves it unreachable from the dispatcher (dead code).',
  '',
  '## Conclusion',
  'Per-run persistence is deterministic and credit-free.',
  '',
].join('\n');

// Build a live-shaped rundir tree (research task) under `root`, returning its path. Mirrors what a live
// driveOnce hands persistTraceBundle as `rundir`.
function stageRundir(root) {
  const rundir = path.join(root, 'rundir-src');
  const taskDir = path.join(rundir, '.maister', 'tasks', 'research', '2026-08-30-l2-n2-replay');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.cpSync(path.join(FIX, 'task-tree'), taskDir, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'orchestrator-state.sample.yml'), path.join(taskDir, 'orchestrator-state.yml'));
  fs.writeFileSync(path.join(taskDir, 'outputs', 'research-report.md'), GOOD_REPORT);
  return rundir;
}

test('persistDirFor: N=1 -> flat reports/<ts>/; N>1 -> reports/<ts>/run-<i>/', () => {
  const ts = '20990101T000000Z';
  assert.equal(persistDirFor('/r', ts, 1, 1), path.join('/r', ts), 'N=1 must stay a flat bundle');
  assert.equal(persistDirFor('/r', ts, 1, 2), path.join('/r', ts, 'run-1'), 'N>1 run 1 -> run-1/');
  assert.equal(persistDirFor('/r', ts, 2, 2), path.join('/r', ts, 'run-2'), 'N>1 run 2 -> run-2/');
  // Distinct dests => no per-run collision on a single ts.
  assert.notEqual(persistDirFor('/r', ts, 1, 2), persistDirFor('/r', ts, 2, 2));
});

test('persistTraceBundle x2 (synthetic N=2): two run-<i>/ bundles, each with the 3 artifacts + self-identifying meta', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-n2-persist-'));
  try {
    const rundir = stageRundir(root);
    const ts = '20990101T010101Z';
    const N = 2;
    const events = [{ type: 'subagent.started', data: { agentName: 'maister-copilot:research-planner' } }];

    const dests = [];
    for (let i = 1; i <= N; i++) {
      const dest = persistDirFor(root, ts, i, N);
      const meta = { scenario: 'research', taskType: 'research', ts, runIndex: i, runs: N, originalMode: 'live' };
      dests.push(persistTraceBundle(dest, { events, rundir, meta }));
    }

    // Two DISTINCT per-run bundles exist, nested under the single ts.
    assert.equal(dests[0], path.join(root, ts, 'run-1'));
    assert.equal(dests[1], path.join(root, ts, 'run-2'));
    for (let i = 1; i <= N; i++) {
      const d = path.join(root, ts, `run-${i}`);
      assert.ok(fs.existsSync(path.join(d, 'events.json')), `run-${i}/events.json must exist`);
      assert.ok(fs.existsSync(path.join(d, 'replay-meta.json')), `run-${i}/replay-meta.json must exist`);
      assert.ok(fs.existsSync(path.join(d, 'rundir', '.maister')), `run-${i}/rundir/ must be a full copy`);
      const meta = JSON.parse(fs.readFileSync(path.join(d, 'replay-meta.json'), 'utf8'));
      assert.equal(meta.runIndex, i, `run-${i} meta.runIndex must self-identify the drive`);
      assert.equal(meta.runs, N, `run-${i} meta.runs must record N`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('T-REPLAY-N: node run.mjs --replay=<reports/<ts>/run-2/> reproduces the verdict CREDIT-FREE (AS-EXPECTED / exit 0)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-n2-replay-'));
  const ts = '20990202T020202Z'; // fixed -> predictable report filename to clean up (meta.ts fallback path)
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const rundir = stageRundir(root);
    const events = JSON.parse(fs.readFileSync(path.join(FIX, 'events.sample.json'), 'utf8'));
    // Persist a per-run bundle exactly as an N=2 drive would (run 2 of 2), with a BOGUS sdkPath to prove
    // replay never imports the SDK.
    const dest = persistDirFor(root, ts, 2, 2);
    const meta = {
      scenario: 'research', taskType: 'research', ts, runIndex: 2, runs: 2, originalMode: 'live',
      copilotVersion: '1.0.81', maisterVersion: '0.0.0',
      sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs',
    };
    persistTraceBundle(dest, { events, rundir, meta });
    assert.equal(path.basename(dest), 'run-2', 'guard: the replay source is a per-run run-<i>/ bundle');

    const res = spawnSync(process.execPath, [RUN_MJS, `--replay=${dest}`], { cwd: L2_DIR, encoding: 'utf8', env: { ...process.env } });
    assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
    const out = `${res.stdout}${res.stderr}`;

    assert.equal(res.status, 0, `expected exit 0 (AS-EXPECTED) from a run-2/ bundle, got ${res.status}\n${out}`);
    assert.match(res.stdout ?? '', /L2: AS-EXPECTED/, `stdout must carry the reproduced AS-EXPECTED verdict\n${out}`);
    // meta.ts fallback: a run-<i>/ basename is NOT a timestamp, so the report ts comes from meta.ts.
    assert.ok(fs.existsSync(reportPath), `expected a report at ${reportPath} (meta.ts fallback)\n${out}`);
    const report = fs.readFileSync(reportPath, 'utf8');
    assert.match(report, /\*\*Mode:\*\* replayed \(from /, 'report Mode line must read "replayed (from <dir>)"');
    assert.match(report, /outcome\(report-produced\)=pass/, 'the RE-RUN oracle must land outcome(report-produced)=pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

test('persistTraceBundle with a v2 meta round-trips; the first 12 keys are the legacy keys in order; new keys follow cost', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-meta-v2-'));
  try {
    const rundir = stageRundir(root);
    const ts = '20990303T030303Z';
    const events = [
      { type: 'session.model_change', data: { source: 'startup', newModel: 'gpt-5.6-luna' } },
      { type: 'subagent.started', data: { agentName: 'maister-copilot:research-planner', model: 'gpt-5.6-mini' } },
    ];
    const armManifest = { arm: 'lean', sessionOptions: { skipCustomInstructions: true }, sandboxSeeds: { hookContextAppend: 'lean-hook' } };
    const meta = buildReplayMeta({
      sc: { id: 'research', taskType: 'research' },
      runIndex: 1,
      persistMeta: {
        copilotVersion: 'GitHub Copilot CLI 1.0.82.\nRun \'copilot update\' to check for updates.',
        sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs',
        maisterVersion: '0.0.0', model: 'gpt-5.6-luna', ts, runIndex: 1, runs: 1,
        variant: 'lean', mutation: null,
        pluginDigest: `sha256:${'a'.repeat(64)}`,
        pluginSource: { commit: 'c'.repeat(40), commitRef: 'HEAD', treeOid: 't'.repeat(40), forkVersion: '2.2.3+fork.4', method: 'git-archive' },
        referenceHash: 'r'.repeat(64),
        armManifest,
      },
      modelActual: 'gpt-5.6-luna',
      cost: { aiu: 1.5, weightedRequests: 8, source: 'session-store.db' },
      events,
      sessionOptions: { skipCustomInstructions: true, model: 'gpt-5.6-luna' },
      sandboxSeeds: { configYml: { html_output: true, mockup_format: 'html' }, note: null, hookContextAppend: 'lean-hook' },
    });

    const dest = persistTraceBundle(persistDirFor(root, ts, 1, 1), { events, rundir, meta });
    const json = JSON.parse(fs.readFileSync(path.join(dest, 'replay-meta.json'), 'utf8'));

    // R2.1 (strict): the 12 legacy keys FIRST, in the historical :981-999 order (audit W1).
    const LEGACY = ['scenario', 'taskType', 'copilotVersion', 'sdkPath', 'ts', 'runIndex', 'runs', 'originalMode', 'maisterVersion', 'model', 'modelActual', 'cost'];
    assert.deepEqual(Object.keys(json).slice(0, 12), LEGACY, 'the first 12 keys are the legacy keys in their original order');
    // Legacy VALUES unchanged: copilotVersion stays verbatim (the two-line string), cliVersion is the normalized twin.
    assert.equal(json.copilotVersion, 'GitHub Copilot CLI 1.0.82.\nRun \'copilot update\' to check for updates.', 'copilotVersion stays verbatim');
    assert.equal(json.originalMode, 'live', 'originalMode unchanged');
    assert.deepEqual(json.cost, { aiu: 1.5, weightedRequests: 8, source: 'session-store.db' }, 'cost value unchanged');

    // R2.2: the new keys follow `cost`, in the table order, with metaSchema 2.
    const NEW = ['metaSchema', 'variant', 'mutation', 'pluginDir', 'pluginName', 'pluginDigest', 'pluginSource', 'sessionOptions', 'sandboxSeeds', 'referenceHash', 'cliVersion', 'servedModels', 'armManifest'];
    assert.deepEqual(Object.keys(json).slice(12), NEW, 'the new keys follow cost in the R2.2 table order');
    assert.equal(json.metaSchema, 2, 'metaSchema is the const 2');
    assert.equal(json.variant, 'lean', 'variant from persistMeta');
    assert.equal(json.mutation, null, 'no --mutation -> null');
    assert.equal(typeof json.pluginDir, 'string', 'pluginDir is the drive-time PLUGIN_DIR');
    assert.ok(path.isAbsolute(json.pluginDir), 'pluginDir is absolute');
    assert.equal(json.pluginName, 'maister-copilot', 'pluginName const');
    assert.equal(json.pluginDigest, `sha256:${'a'.repeat(64)}`, 'pluginDigest passed through verbatim');
    assert.deepEqual(json.pluginSource, { commit: 'c'.repeat(40), commitRef: 'HEAD', treeOid: 't'.repeat(40), forkVersion: '2.2.3+fork.4', method: 'git-archive' }, 'pluginSource verbatim');
    assert.deepEqual(Object.keys(json.pluginSource), ['commit', 'commitRef', 'treeOid', 'forkVersion', 'method'], 'pluginSource carries the 5-key shape (commitRef included) on every v2 meta');
    assert.deepEqual(json.sessionOptions, { skipCustomInstructions: true, model: 'gpt-5.6-luna' }, 'sessionOptions = the createSession spread, verbatim');
    assert.deepEqual(json.sandboxSeeds, { configYml: { html_output: true, mockup_format: 'html' }, note: null, hookContextAppend: 'lean-hook' }, 'sandboxSeeds round-trip');
    assert.equal(json.referenceHash, 'r'.repeat(64), 'referenceHash verbatim');
    assert.equal(json.cliVersion, '1.0.82', 'cliVersion = normalizeCliVersion(copilotVersion)');
    assert.deepEqual(json.servedModels, { main: 'gpt-5.6-luna', 'maister-copilot:research-planner': 'gpt-5.6-mini' }, 'servedModels derived from the persisted events');
    assert.deepEqual(json.armManifest, armManifest, 'armManifest = the parsed manifest, verbatim');

    // R2.5: a --mutation drive records mutation, variant:null, working-tree, armManifest:null; minimal
    // persistMeta (the null discipline) never throws and every new key is present.
    const m1 = buildReplayMeta({
      sc: { id: 'development', taskType: 'development' }, runIndex: 2,
      persistMeta: { mutation: 'M1', pluginSource: { commit: null, commitRef: null, treeOid: null, forkVersion: '2.2.3+fork.4', method: 'working-tree' } },
      modelActual: 'unknown', cost: null, events: [], sessionOptions: { skipCustomInstructions: true }, sandboxSeeds: { configYml: null, note: null, hookContextAppend: null },
    });
    assert.deepEqual(Object.keys(m1), [...LEGACY, ...NEW], 'mutation drive: identical key set + order');
    assert.equal(m1.mutation, 'M1', 'mutation recorded');
    assert.equal(m1.variant, null, 'mutation drive: variant null');
    assert.equal(m1.pluginSource.method, 'working-tree', 'mutation drive: working-tree');
    assert.deepEqual(Object.keys(m1.pluginSource), ['commit', 'commitRef', 'treeOid', 'forkVersion', 'method'], 'mutation drive: the same 5-key pluginSource shape');
    // The buildReplayMeta DEFAULT (no pluginSource in persistMeta at all) has the same 5-key shape too.
    const bare = buildReplayMeta({ sc: { id: 'development', taskType: 'development' }, runIndex: 1, persistMeta: {}, modelActual: 'unknown', cost: null, events: [], sessionOptions: null, sandboxSeeds: null });
    assert.deepEqual(bare.pluginSource, { commit: null, commitRef: null, treeOid: null, forkVersion: null, method: 'working-tree' }, 'default pluginSource: 5 keys, all null, working-tree');
    assert.equal(m1.armManifest, null, 'mutation drive: no arm manifest');
    assert.equal(m1.runIndex, 2, 'runIndex falls back to the drive index when persistMeta omits it');
    assert.equal(m1.cliVersion, null, 'no copilotVersion -> cliVersion null (never a string)');
    assert.deepEqual(m1.servedModels, { main: null }, 'no events -> servedModels { main: null }');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
