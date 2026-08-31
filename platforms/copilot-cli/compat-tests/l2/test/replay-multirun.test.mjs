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

import { persistDirFor, persistTraceBundle } from '../run.mjs';

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
