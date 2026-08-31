// Credit-free `--replay` ROUND-TRIP CLI test (Stage 4, issue #48 / plan 7.1).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/replay.test.mjs
//
// Where run.test.mjs unit-checks the replay REPORT MARKERS (`Mode: replayed`) and outcome-rundir.test.mjs
// proves the functional oracle over a live rundir, THIS file proves the whole `--replay` PROCESS contract
// end to end: `node run.mjs --replay=<dir>` reconstructs extract()'s inputs from a persisted bundle,
// RE-EXECUTES the outcome oracle against the persisted rundir copy, reuses finalizeSingleRun, and lands
// the SAME verdict / exit code / report a live N=1 run would — WITHOUT importing the SDK (no seat, no
// credit). It invokes the real entrypoint as a subprocess (check-reference.test.mjs idiom) and asserts
// the PROCESS EXIT CODE + the stdout verdict line + the report `Mode:` marker — the real operator surface.
//
// CREDIT-FREE BY CONSTRUCTION: `--replay` RETURNS in main() before any `import(sdkPath)` (exactly like
// `--check-reference`). We PROVE it here by writing a DELIBERATELY BOGUS `sdkPath` into the bundle's
// replay-meta.json — if the replay path ever tried to import it, the run would throw; instead it lands a
// clean verdict, so no SDK was ever loaded.
//
// FAITHFUL DETERMINISTIC FIXTURE: the bundle reuses the committed research fixtures
//   test/fixtures/research/{events.sample.json, orchestrator-state.sample.yml, task-tree/}
// (the same inputs the pipeline-research pipeline test conforms to AS-EXPECTED), staged into the bundle's
// `rundir/.maister/tasks/research/<dir>/` exactly as a live run persists them. The committed fixture
// research-report.md is an 18-byte stub (the tree-profile only cares it EXISTS); the outcome oracle,
// however, RE-RUNS and requires a substantial report (>=200 bytes, >=5 non-blank lines, heading, +
// synthesis) — so the bundle writes a real report into the rundir, yielding outcome(report-produced)=pass
// and a clean AS-EXPECTED / exit 0 round-trip. This is the headline claim: a persisted bundle reproduces
// its recorded conformant verdict, credit-free.
//
// Zero-dependency: `node:` builtins only. Self-cleaning: the bundle is an os.tmpdir() mkdtemp tree and the
// side-effect report (reports/l2-trace-equivalence-<ts>.md) is removed in `finally`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const RUN_MJS = path.join(L2_DIR, 'run.mjs');
const REPORTS_DIR = path.resolve(L2_DIR, '..', 'reports');
const FIX = path.join(__dirname, 'fixtures', 'research');

// A substantial research report the RE-RUN oracle accepts: >=200 bytes, >=5 non-blank lines, a heading,
// and (alongside the fixture's committed analysis/synthesis.md) the synthesis corroboration it demands.
// It also names the planted `frobnicate` and concludes it is unreachable, so the now-REQUIRED
// outcome(research-answer)=pass lands (#88 promotion).
const GOOD_REPORT = [
  '# Research Report: L2 Replay Round-Trip',
  '',
  '## Findings',
  'The --replay path reconstructs extract()\'s inputs from a persisted bundle and re-executes the',
  'outcome oracle against the persisted rundir copy, then reuses finalizeSingleRun so the verdict,',
  'exit code, and report are byte-identical to a live N=1 run. It dispatches before any SDK import,',
  'so the whole round-trip spends no Copilot seat and no AI credit.',
  'The sample CLI also implements `frobnicate` but leaves it unreachable from the dispatcher (dead code).',
  '',
  '## Conclusion',
  'A persisted bundle reproduces its recorded verdict deterministically and credit-free.',
  '',
].join('\n');

// Stage a live-shaped replay bundle <root>/<ts>/{events.json, rundir/, replay-meta.json} from the committed
// research fixtures. `sdkPath` is intentionally bogus to assert the credit-free (no-import) contract.
function stageBundle(root, ts) {
  const bundleDir = path.join(root, ts);
  const taskDir = path.join(bundleDir, 'rundir', '.maister', 'tasks', 'research', '2026-08-29-l2-replay');
  fs.mkdirSync(taskDir, { recursive: true });

  // events.json + the full research task tree (analysis/planning/outputs) + state, exactly where a live
  // driveOnce persist would place them (findTaskDirs / findStateYaml / the outcome oracle all key off
  // rundir/.maister/tasks/research/<dir>/).
  fs.copyFileSync(path.join(FIX, 'events.sample.json'), path.join(bundleDir, 'events.json'));
  fs.cpSync(path.join(FIX, 'task-tree'), taskDir, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'orchestrator-state.sample.yml'), path.join(taskDir, 'orchestrator-state.yml'));

  // Overwrite the committed 18-byte stub report with a real one so the RE-RUN oracle passes.
  fs.writeFileSync(path.join(taskDir, 'outputs', 'research-report.md'), GOOD_REPORT);

  fs.writeFileSync(
    path.join(bundleDir, 'replay-meta.json'),
    JSON.stringify({
      scenario: 'research',
      taskType: 'research',
      copilotVersion: '1.0.81',
      sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs', // credit-free proof: never loaded
      ts,
      originalMode: 'live',
      maisterVersion: '0.0.0',
    }, null, 2),
  );
  return bundleDir;
}

function runReplay(dir) {
  const res = spawnSync(process.execPath, [RUN_MJS, `--replay=${dir}`], {
    cwd: L2_DIR,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
  return { status: res.status, stdout: res.stdout ?? '', out: `${res.stdout}${res.stderr}` };
}

test('T-REPLAY: --replay=<bundle> reproduces the recorded verdict CREDIT-FREE (AS-EXPECTED / exit 0 / Mode: replayed)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-replay-'));
  const ts = '20990101T000000Z'; // fixed, distinctive -> predictable report filename to clean up
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const bundleDir = stageBundle(root, ts);
    const { status, stdout, out } = runReplay(bundleDir);

    // (a) Credit-free round-trip landed a real verdict — a bogus sdkPath never blocked it, proving no
    //     import(sdkPath) was ever reached (the run would have thrown otherwise).
    assert.equal(status, 0, `expected exit 0 (AS-EXPECTED), got ${status}\n${out}`);
    // (b) The stdout verdict line matches the bundle's reproduced verdict.
    assert.match(stdout, /L2: AS-EXPECTED/, `stdout must carry the reproduced AS-EXPECTED verdict\n${out}`);

    // (c) The persisted report Mode line reads "replayed (from <bundle>)".
    assert.ok(fs.existsSync(reportPath), `expected a report at ${reportPath}\n${out}`);
    const report = fs.readFileSync(reportPath, 'utf8');
    assert.match(report, /\*\*Mode:\*\* replayed \(from /, 'report Mode line must read "replayed (from <dir>)"');
    assert.match(report, /outcome\(report-produced\)=pass/, 'the RE-RUN oracle must land outcome(report-produced)=pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

test('T-REPLAY negative: --replay=<nonexistent dir> is a precondition failure -> exit 2 (INCOMPLETE), no verdict', () => {
  const missing = path.join(os.tmpdir(), 'l2-replay-does-not-exist-1a2b3c4d');
  assert.ok(!fs.existsSync(missing), 'guard: the negative path must genuinely be absent');
  const { status, out } = runReplay(missing);
  assert.equal(status, 2, `a missing --replay dir must exit 2 (precondition), got ${status}\n${out}`);
  assert.match(out, /--replay directory not found/, 'the error must name the missing replay directory');
});
