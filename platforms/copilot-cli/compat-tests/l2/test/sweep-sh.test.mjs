// sweep-sh.test.mjs — #138 WP2 (Task Group 4): 7 credit-free scripted checks for l2/sweep.sh, the
// repo-resident promotion of the three off-repo tier runners
// (.maister/tasks/research/2026-09-03-copilot-cost-savings/sweeps/{round1,tier2,tier3}/).
//
// These are SHELL-level assertions wrapped in node:test so `node --test l2/test/*.test.mjs` runs them
// beside the pure-module tests. EVERY check here is CREDIT-FREE and NEVER drives a live Copilot
// session. Three independent guarantees make an accidental spend impossible:
//   1. `copilot` is hidden from PATH (NO_COPILOT_PATH), asserted absent up front — the run-sh.test.mjs
//      idiom.
//   2. The drives that do "run" are executed by a SYNTHETIC RUNNER handed to the sweep via
//      COMPAT_SWEEP_RUNNER; it writes a synthetic replay-meta.json into a throwaway
//      COMPAT_SWEEP_REPORTS tree and exits. l2/run.sh is never invoked.
//   3. Every bash child gets a PRIVATE TMPDIR, so residue assertions cannot race the concurrently
//      running mutations.test.mjs / variants.test.mjs (which stage l2-mutant-* / l2-variant-* into the
//      shared os.tmpdir()) — the run-sh.test.mjs:196-201 rule.
//
// Why the seams are COMPAT_SWEEP_* and not COMPAT_L2_SWEEP_*: sweep.sh's env-hygiene precondition (T5,
// spec R15) refuses when the INHERITED environment carries any COMPAT_L2_* other than COMPAT_L2_MODEL.
// A seam named COMPAT_L2_SWEEP_RUNNER would therefore make every test here trip the very check it is
// trying to exercise. COMPAT_-without-L2 is the established spelling for a test/operator seam
// (COMPAT_PLUGIN_DIR, COMPAT_NO_SEAT, COMPAT_KEEP_RUNDIR, COMPAT_ARMS_DIR, COPILOT_CONFIG).
//
//   T1 — `--plan` is credit-free (A2.1): exit 0, matrix + estimate on stdout, NO staging dir created.
//   T2 — `--cap` pre-first-drive refusal (A2.2): exit 2, nothing created, EMPTY stdout.
//   T3 — `--cap` mid-sweep clean stop (A2.2b): exit 0, `STOP:` on stderr, manifest and logs intact.
//   T4 — `--gate-max` (A2.2c): over-limit drive 1 aborts with exit 1; a PASSING drive 1 re-seeds the
//        per-drive estimate to ceil(measured × 1.4) and the next cap check demonstrably uses it.
//   T5 — env hygiene (A2.3): an inherited COMPAT_L2_* other than COMPAT_L2_MODEL refuses; the sweep's
//        OWN `export COMPAT_L2_YES=1` does not trip its own check.
//   T6 — cost-bands.json provenance (A2.4, regex half): every evidence string matches the provenance
//        regex and every estAiu is derivable from that scenario's own observed array.
//   T7 — round-1 reproducibility (A2.5): round 1 is ONE `--plan` invocation whose matrix matches the
//        archived manifest.tsv shape — 12 rows over plain, plain-legacy, lean, caveman.
//
// T6/T7 scope, stated rather than hidden. T6 asserts the SHAPE and derivability of every citation; it
// deliberately does NOT resolve them, because `sweeps/*` lives off-repo and `reports/<ts>` is
// per-worktree and git-ignored — a resolving test would be red in CI and on every other machine (the
// standing `audit #9` rule: only the generator ever reads reports/). Resolution is A2.4's other half:
// a recorded MANUAL check against those two absolute paths, in the PR body. T7 is scoped to round 1 on
// purpose: tier2's corpus is 1 drive / 1 log and tier3 is missing 4-lean.log, so "reproduce all three
// tiers" is not honestly checkable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..'); // l2/
const SWEEP_SH = path.join(L2_DIR, 'sweep.sh');
const COST_BANDS = path.join(L2_DIR, 'reference', 'cost-bands.json');

// A PATH that keeps node + coreutils + git (for the pin resolve) but HIDES `copilot`. Derived, not
// hardcoded, so the check tracks the toolchain — run-sh.test.mjs:48-51.
const NODE_BIN_DIR = path.dirname(process.execPath);
const NO_COPILOT_PATH = [NODE_BIN_DIR, '/usr/bin', '/bin'].join(':');

function copilotVisibleUnder(p) {
  return p.split(':').some((d) => {
    try { fs.accessSync(path.join(d, 'copilot'), fs.constants.X_OK); return true; } catch { return false; }
  });
}

// Everything the sweep is allowed to inherit. Every COMPAT_* key is scrubbed from process.env first:
// an operator shell pin (COMPAT_VARIANT_COMMIT) or a stray COMPAT_L2_DEEP must not decide a test.
function sweepEnv(tmp, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('COMPAT_')) delete env[k];
  env.PATH = NO_COPILOT_PATH;
  env.TMPDIR = tmp;
  for (const [k, v] of Object.entries(extra)) { if (v == null) delete env[k]; else env[k] = v; }
  return env;
}

function runSweep(args, tmp, extra = {}) {
  return spawnSync('bash', [SWEEP_SH, ...args], { encoding: 'utf8', env: sweepEnv(tmp, extra) });
}

// Anything the sweep stages lands in its private TMPDIR under the l2-sweep- prefix — the same prefix
// run-sh.test.mjs:200 now watches for, so a leak is loud in BOTH files (A2.6).
const sweptEntries = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('l2-sweep-'));

function withTmp(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-sweeptest-'));
  try { return fn(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// A synthetic `run.sh` stand-in. Per invocation it mints one bundle under $COMPAT_SWEEP_REPORTS whose
// replay-meta.json carries the next AIU from FAKE_AIU, and prints a real-shaped verdict line. This
// keeps the sweep's OWN ts-discovery and AIU-extraction code on the live path — only the credit spend
// is replaced.
function writeFakeRunner(tmp, aiuList) {
  const p = path.join(tmp, 'fake-run.sh');
  fs.writeFileSync(p, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'n=0; [ ! -f "$FAKE_STATE" ] || n=$(cat "$FAKE_STATE")',
    'n=$((n+1)); echo "$n" > "$FAKE_STATE"',
    'aiu=$(echo "$FAKE_AIU" | cut -d\' \' -f"$n")',
    'ts=$(printf \'20260901T%06dZ\' "$n")',
    'mkdir -p "$COMPAT_SWEEP_REPORTS/$ts"',
    'printf \'{"scenario":"fake","cost":{"aiu":%s}}\\n\' "$aiu" > "$COMPAT_SWEEP_REPORTS/$ts/replay-meta.json"',
    'echo "L2: AS-EXPECTED — 4 PASS · 0 LIMITATION · 0 FAIL"',
    '',
  ].join('\n'));
  fs.chmodSync(p, 0o755);
  return { runner: p, state: path.join(tmp, 'fake-state'), aiu: aiuList.join(' ') };
}

// A drive-capable spawn: private reports tree + synthetic runner, still under NO_COPILOT_PATH.
function runSweepDriven(args, tmp, aiuList, extra = {}) {
  const reports = path.join(tmp, 'reports');
  fs.mkdirSync(reports, { recursive: true });
  const f = writeFakeRunner(tmp, aiuList);
  return {
    reports,
    res: runSweep(args, tmp, {
      COMPAT_SWEEP_RUNNER: f.runner,
      COMPAT_SWEEP_REPORTS: reports,
      FAKE_STATE: f.state,
      FAKE_AIU: f.aiu,
      ...extra,
    }),
  };
}

// The single stdout line of a driven sweep is its absolute output directory (stdout is sacred).
function outDirOf(res) {
  const lines = res.stdout.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `driven sweep stdout must be EXACTLY one line (the output dir), got:\n${res.stdout}`);
  assert.match(lines[0], /^\//, 'the one stdout line must be an ABSOLUTE path');
  return lines[0];
}

// -------------------------------------------------------------------------- T1 (A2.1)
test('T1 (#138 A2.1): --plan is credit-free — exit 0, matrix + estimate on stdout, nothing staged', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  withTmp((tmp) => {
    const before = sweptEntries(tmp);
    assert.deepEqual(before, [], 'test setup: the private TMPDIR starts empty');

    const res = runSweep(
      ['--tier=t1', '--scenario=quick-bugfix', '--arms=plain,lean', '--runs=2', '--cap=25', '--pin=HEAD', '--plan'],
      tmp,
    );
    assert.equal(res.status, 0, `--plan must exit 0\n${res.stdout}\n${res.stderr}`);

    const rows = res.stdout.split('\n').filter((l) => l.length > 0 && !l.startsWith('#'));
    assert.equal(rows.length, 4, `--plan must print one matrix row per drive (2 arms x 2 runs)\n${res.stdout}`);
    assert.deepEqual(
      rows.map((l) => l.split('\t')),
      [['1', 'plain', 'quick-bugfix'], ['2', 'lean', 'quick-bugfix'],
       ['3', 'plain', 'quick-bugfix'], ['4', 'lean', 'quick-bugfix']],
      'the matrix is interleaved arm x N, one N=1 drive per row',
    );
    const summary = res.stdout.split('\n').find((l) => l.startsWith('#'));
    assert.ok(summary, `--plan must print an estimate summary line\n${res.stdout}`);
    assert.match(summary, /\bdrives=4\b/, 'the estimate names the drive count');
    assert.match(summary, /\best-per-drive=1\.600507\b/, 'the per-drive estimate comes from cost-bands.json');
    assert.match(summary, /\best-total=6\.402028\b/, 'the total estimate is drives x per-drive');
    assert.match(summary, /\bcap=25\b/, 'the estimate is reported against the cap it will be checked against');

    // The whole point of A2.1: no seat was needed and NOTHING was created.
    assert.deepEqual(sweptEntries(tmp), [], '--plan must create no staging directory (rejected at parse time, before any mktemp)');
    assert.deepEqual(
      fs.readdirSync(tmp).filter((n) => n.startsWith('l2-variant-') || n.startsWith('l2-mutant-')),
      [], '--plan must stage neither an arm nor a mutant',
    );
    assert.doesNotMatch(res.stderr, /SKIP/, '--plan must not reach the seat preflight at all');
  });
});

// -------------------------------------------------------------------------- T2 (A2.2)
test('T2 (#138 A2.2): --cap below drive 1\'s own seed estimate refuses BEFORE the first drive — exit 2, nothing created, empty stdout', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  withTmp((tmp) => {
    // research seeds at 105.006005 AIU (one measured drive, sweeps/tier2/manifest.tsv#1). A cap of 10
    // cannot pay for even the first drive, so the sweep must refuse as a PRECONDITION, not stop later.
    const res = runSweep(
      ['--tier=t2', '--scenario=research', '--arms=plain,lean', '--runs=2', '--cap=10', '--pin=HEAD'],
      tmp,
    );
    assert.equal(res.status, 2, `a cap below drive 1's estimate is a precondition refusal (exit 2), not a stop\n${res.stdout}\n${res.stderr}`);
    assert.equal(res.stdout, '', 'a precondition refusal writes NOTHING to stdout');
    assert.match(res.stderr, /cap/, 'the refusal names the cap');
    assert.match(res.stderr, /105\.006005/, 'the refusal names the seed estimate it could not pay for');
    assert.deepEqual(sweptEntries(tmp), [], 'a precondition refusal creates nothing (every preflight runs before mktemp)');
    assert.doesNotMatch(res.stderr, /STOP:/, 'pre-first-drive is a refusal, never the mid-sweep STOP');
  });
});

// -------------------------------------------------------------------------- T3 (A2.2b)
test('T3 (#138 A2.2b): --cap stops cleanly mid-sweep — exit 0, STOP: on stderr, manifest and logs intact', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  withTmp((tmp) => {
    // quick-bugfix seeds at 1.600507. cap=2.5 pays for drive 1 (0 + 1.600507 <= 2.5) but not drive 2
    // once drive 1 measures 1.2 (1.2 + 1.600507 = 2.800507 > 2.5). This is the tier3 shape: the real
    // sweep stopped at `cum 151.843044` against `cap 220` with `est 93`, and that partial corpus is a
    // VALID result, so the exit status is 0.
    const { res } = runSweepDriven(
      ['--tier=t3', '--scenario=quick-bugfix', '--arms=plain,lean', '--runs=2', '--cap=2.5', '--pin=HEAD'],
      tmp, ['1.2', '9.9', '9.9', '9.9'],
    );
    assert.equal(res.status, 0, `a mid-sweep cap stop is CLEAN (exit 0) — the budget worked\n${res.stdout}\n${res.stderr}`);
    assert.match(
      res.stderr,
      /STOP: next drive \(est 1\.600507\) would exceed cap 2\.5 at cum 1\.2\b/,
      `the STOP line names est, cap and cum — the sweeps/tier3/sweep.log wording\n${res.stderr}`,
    );

    const out = outDirOf(res);
    const manifest = path.join(out, 'manifest.tsv');
    assert.ok(fs.existsSync(manifest), 'the manifest survives the stop — a partial corpus is the deliverable');
    const lines = fs.readFileSync(manifest, 'utf8').split('\n').filter((l) => l.length > 0);
    assert.equal(lines.length, 2, `manifest keeps its header + the ONE drive that ran\n${lines.join('\n')}`);
    assert.match(lines[0], /^idx\tarm\tts\trc\tverdict\taiu\tcum_aiu$/, 'the manifest header is the round1/tier3 column set');
    const row = lines[1].split('\t');
    assert.equal(row[0], '1');
    assert.equal(row[1], 'plain');
    assert.equal(row[5], '1.2', 'the measured AIU is recorded, not the estimate');
    assert.equal(row[6], '1.2', 'cum_aiu after one drive is that drive');
    assert.ok(fs.existsSync(path.join(out, 'logs', '1-plain.log')), 'the per-drive log survives the stop');
    assert.ok(!fs.existsSync(path.join(out, 'logs', '2-lean.log')), 'drive 2 never ran, so it left no log');
  });
});

// -------------------------------------------------------------------------- T4 (A2.2c)
test('T4 (#138 A2.2c): --gate-max aborts on an over-limit drive 1 (exit 1); a passing drive 1 re-seeds the estimate to ceil(measured x 1.4)', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  // (a) ABORT. Drive 1 measures 5.0 against --gate-max=1. Credits are ALREADY SPENT, so this is a
  //     post-staging miss: exit 1, never the exit 2 of a precondition.
  withTmp((tmp) => {
    const { res } = runSweepDriven(
      ['--tier=t4a', '--scenario=quick-bugfix', '--arms=plain,lean', '--runs=2', '--cap=100', '--gate-max=1', '--pin=HEAD'],
      tmp, ['5.5', '0.1', '0.1', '0.1'],
    );
    assert.equal(res.status, 1, `--gate-max fires AFTER a paid drive, so it is exit 1 (post-staging miss), never 2\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /ABORT:/, 'the abort is announced as ABORT:');
    assert.match(res.stderr, /ABORT: first drive cost 5\.5 AIU \(> 1\)/,
      `the ABORT line names measured-vs-limit\n${res.stderr}`);
    const out = outDirOf(res);
    assert.ok(fs.existsSync(path.join(out, 'logs', '1-plain.log')), 'the paid drive is kept — it is evidence, not garbage');
    assert.ok(!fs.existsSync(path.join(out, 'logs', '2-lean.log')), 'drive 2 must never start once the gate fires');
  });

  // (b) PASS + RE-SEED. Drive 1 measures 1.2 against --gate-max=10 -> EST becomes ceil(1.2*1.4) = 2.
  //     cap=3 is then the discriminator: with the RE-SEEDED 2 the next check is 1.2 + 2 = 3.2 > 3 and
  //     stops; with the ORIGINAL seed 1.600507 it would be 2.800507 <= 3 and would NOT stop. So the
  //     stop itself proves the later cap check used the measured band, not the seed.
  withTmp((tmp) => {
    const { res } = runSweepDriven(
      ['--tier=t4b', '--scenario=quick-bugfix', '--arms=plain,lean', '--runs=2', '--cap=3', '--gate-max=10', '--pin=HEAD'],
      tmp, ['1.2', '0.1', '0.1', '0.1'],
    );
    assert.equal(res.status, 0, `a passing gate followed by a cap stop is clean\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /cost gate PASSED \(1\.2 AIU\)/, 'a passing gate is announced with the measured cost');
    assert.match(res.stderr, /per-drive estimate updated to 2 AIU/, 'EST is re-seeded to ceil(measured x 1.4) = ceil(1.68) = 2');
    assert.match(res.stderr, /STOP: next drive \(est 2\) would exceed cap 3 at cum 1\.2\b/,
      'the next cap check demonstrably used the RE-SEEDED estimate (1.600507 would not have stopped)');
    const lines = fs.readFileSync(path.join(outDirOf(res), 'manifest.tsv'), 'utf8').split('\n').filter((l) => l.length > 0);
    assert.equal(lines.length, 2, 'exactly one drive ran before the re-seeded estimate stopped the sweep');
  });
});

// -------------------------------------------------------------------------- T5 (A2.3)
test('T5 (#138 A2.3): an INHERITED COMPAT_L2_* other than COMPAT_L2_MODEL refuses the sweep; the sweep\'s own COMPAT_L2_YES export does not trip its own check', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  const ARGS = ['--tier=t5', '--scenario=quick-bugfix', '--arms=plain,lean', '--runs=1', '--cap=25', '--pin=HEAD', '--plan'];

  // (a) A stray operator pin in the inherited environment refuses — before anything is created.
  for (const v of ['COMPAT_L2_DEEP', 'COMPAT_L2_YES', 'COMPAT_L2_HTML_OUTPUT']) {
    withTmp((tmp) => {
      const res = runSweep(ARGS, tmp, { [v]: '1' });
      assert.equal(res.status, 2, `an inherited ${v} must refuse the sweep (exit 2)\n${res.stdout}\n${res.stderr}`);
      assert.equal(res.stdout, '', 'the hygiene refusal writes nothing to stdout');
      assert.match(res.stderr, new RegExp(v), `the refusal NAMES the offending variable (${v})`);
      assert.deepEqual(sweptEntries(tmp), [], 'the hygiene refusal creates nothing');
    });
  }

  // (b) COMPAT_L2_MODEL is the ONE allowed inheritance — it is how the operator pins the model.
  withTmp((tmp) => {
    const res = runSweep(ARGS, tmp, { COMPAT_L2_MODEL: 'gpt-5.6-luna' });
    assert.equal(res.status, 0, `COMPAT_L2_MODEL must be allowed through\n${res.stdout}\n${res.stderr}`);
  });

  // (c) The check reads what came IN, never the live environment. All three promoted runners export
  //     COMPAT_L2_YES=1 themselves (sweep-round1.sh:15, sweep-tier3.sh:11), so a check against the
  //     CURRENT environment would make the sweep refuse itself one line after its own export. Proven
  //     by sourcing (the run.sh:170-178 source guard suppresses main): snapshot, then export, then
  //     re-check.
  withTmp((tmp) => {
    const probe = path.join(tmp, 'probe.sh');
    fs.writeFileSync(probe, [
      '# shellcheck disable=SC1090',
      `source ${JSON.stringify(SWEEP_SH)}`,
      'check_env_hygiene || { echo "UNEXPECTED-REFUSAL-BEFORE-EXPORT"; exit 9; }',
      'export COMPAT_L2_YES=1',
      'unset COMPAT_L2_DEEP || true',
      'if check_env_hygiene; then echo "OK-OWN-EXPORT-DOES-NOT-TRIP"; else echo "SELF-REFUSAL"; exit 9; fi',
      '',
    ].join('\n'));
    const res = spawnSync('bash', [probe], { encoding: 'utf8', env: sweepEnv(tmp) });
    assert.equal(res.status, 0, `sourcing sweep.sh must not run main, and its own export must not trip its check\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /OK-OWN-EXPORT-DOES-NOT-TRIP/, 'check_env_hygiene reads the inherited SNAPSHOT, not the live environment');
  });
});

// -------------------------------------------------------------------------- T6 (A2.4, regex half)
test('T6 (#138 A2.4): every cost-bands.json evidence string matches the provenance regex and every estAiu is derivable from that scenario\'s own observed array', () => {
  assert.ok(fs.existsSync(COST_BANDS), 'l2/reference/cost-bands.json must exist — it is the ONLY input to the seed estimate');
  const raw = fs.readFileSync(COST_BANDS, 'utf8');
  const bands = JSON.parse(raw);

  // The provenance regex (spec R17a): a reports/<ts> bundle id, or a sweeps/<tier>/manifest.tsv#<idx>
  // row. Nothing else — so a design-document estimate reds this test rather than passing review, which
  // is exactly what #110's table lacked (research: budgeted 13.5, measured 105.01).
  const PROVENANCE = /^(reports\/[0-9]{8}T[0-9]{6}Z|sweeps\/[a-z0-9]+\/manifest\.tsv#[0-9]+)$/;

  const ids = Object.keys(bands);
  assert.ok(ids.length > 0, 'cost-bands.json must not be empty');
  assert.deepEqual(ids, [...ids].sort(), `scenario keys must be sorted, got:\n${ids.join(', ')}`);

  for (const id of ids) {
    const b = bands[id];
    assert.deepEqual(Object.keys(b), ['estAiu', 'note', 'observed'], `${id}: keys must be exactly estAiu, note, observed — sorted`);
    assert.equal(typeof b.estAiu, 'number', `${id}: estAiu must be a number`);
    assert.ok(Number.isFinite(b.estAiu) && b.estAiu > 0, `${id}: estAiu must be a finite positive AIU`);
    assert.ok(b.note === null || typeof b.note === 'string', `${id}: note is free text or null (null discipline) — never omitted`);
    assert.ok(Array.isArray(b.observed) && b.observed.length > 0, `${id}: observed must be a non-empty array — an estimate with no measurement is a design estimate`);

    for (const o of b.observed) {
      assert.deepEqual(Object.keys(o), ['aiu', 'evidence'], `${id}: each observation is exactly { aiu, evidence }, sorted`);
      assert.equal(typeof o.aiu, 'number', `${id}: observed aiu must be a number`);
      assert.ok(Number.isFinite(o.aiu) && o.aiu > 0, `${id}: observed aiu must be a finite positive AIU`);
      assert.equal(typeof o.evidence, 'string', `${id}: evidence must be a string`);
      assert.match(o.evidence, PROVENANCE,
        `${id}: evidence "${o.evidence}" must be a reports/<ts> bundle or a sweeps/<tier>/manifest.tsv#<idx> row — never prose, never a design document`);
      // 6-dp discipline: an AIU is reported to six decimal places, never more.
      const dp = (String(o.aiu).split('.')[1] || '').length;
      assert.ok(dp <= 6, `${id}: observed aiu ${o.aiu} carries ${dp} decimal places (max 6)`);
    }

    // Derivability: the seed is the WORST measured drive for that scenario. A hand-typed number that
    // is not one of this scenario's own measurements fails here.
    const max = b.observed.reduce((a, o) => (o.aiu > a ? o.aiu : a), 0);
    assert.equal(b.estAiu, max, `${id}: estAiu must be derivable from this scenario's OWN observed array (max = ${max})`);
    const estDp = (String(b.estAiu).split('.')[1] || '').length;
    assert.ok(estDp <= 6, `${id}: estAiu ${b.estAiu} carries ${estDp} decimal places (max 6)`);
  }

  // No entry may cite a design document. The regex already forbids it; this states the rule by name so
  // a future relaxation of the regex still trips something that says WHY.
  assert.doesNotMatch(raw, /"evidence":\s*"[^"]*(spec|plan|design|\.md)/i,
    'no evidence string may cite a spec, plan or design document — measurement only');

  // The research caveat is load-bearing: one drive, 7.8x its design estimate, and the tier stopped
  // there — so the band is a FLOOR, not a range. That caveat is the whole lesson of #110.
  assert.ok(bands.research, 'research must carry a band');
  assert.equal(bands.research.observed.length, 1, 'research is ONE measured drive');
  assert.equal(bands.research.estAiu, 105.006005, 'research seeds at the single measured drive');
  assert.match(bands.research.note, /floor/i, 'research must say its band is a FLOOR, not a range');
  assert.match(bands.research.note, /7\.8/, 'research must record that it came in 7.8x its design estimate');

  // cost-bands.json is NOT a reference skeleton: parity-coverage.mjs:51 globs *.skeleton.json, so this
  // file must never be named to fall into that glob.
  assert.ok(!COST_BANDS.endsWith('.skeleton.json'), 'cost-bands.json must not be picked up by parity-coverage.mjs\'s *.skeleton.json glob');
});

// -------------------------------------------------------------------------- T7 (A2.5)
test('T7 (#138 A2.5): round 1 is expressible as ONE --plan invocation whose matrix matches the archived manifest.tsv shape — 12 rows over plain, plain-legacy, lean, caveman', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  withTmp((tmp) => {
    // The archived round 1 (sweeps/round1/): quick-bugfix, 4 arms x N=3, interleaved, cap 25. Its
    // manifest.tsv holds 12 rows whose arm column cycles plain, plain-legacy, lean, caveman three
    // times. That shape is asserted here literally rather than by reading the archive: sweeps/ lives
    // off-repo, so a test that read it would be red in CI and on every other machine. Resolution
    // against the real archive is a recorded acceptance run, not a committed test.
    const res = runSweep(
      ['--tier=round1', '--scenario=quick-bugfix', '--arms=plain,plain-legacy,lean,caveman', '--runs=3',
       '--cap=25', '--pin=HEAD', '--plan'],
      tmp,
    );
    assert.equal(res.status, 0, `the round-1 plan must be a single credit-free invocation\n${res.stdout}\n${res.stderr}`);

    const rows = res.stdout.split('\n').filter((l) => l.length > 0 && !l.startsWith('#')).map((l) => l.split('\t'));
    assert.equal(rows.length, 12, 'round 1 is 12 drives (4 arms x N=3)');
    const cycle = ['plain', 'plain-legacy', 'lean', 'caveman'];
    assert.deepEqual(
      rows.map((r) => r[1]),
      [...cycle, ...cycle, ...cycle],
      'the arm column cycles plain, plain-legacy, lean, caveman three times — the archived manifest order',
    );
    assert.deepEqual(rows.map((r) => r[0]), Array.from({ length: 12 }, (_, i) => String(i + 1)), 'idx runs 1..12');
    assert.deepEqual(new Set(rows.map((r) => r[2])), new Set(['quick-bugfix']), 'every round-1 drive is quick-bugfix');

    // Round 1 actually cost 14.111669 AIU cumulative against its cap of 25, and the plan's estimate
    // must be in the same neighbourhood rather than a fiction: 12 x 1.600507 = 19.206084 <= 25.
    const summary = res.stdout.split('\n').find((l) => l.startsWith('#'));
    assert.match(summary, /\bdrives=12\b/);
    assert.match(summary, /\best-total=19\.206084\b/, 'the plan estimate is 12 x the measured worst quick-bugfix drive');
    assert.match(summary, /\bcap=25\b/, 'round 1 ran under cap 25 and the plan fits inside it');

    assert.deepEqual(sweptEntries(tmp), [], 'planning round 1 creates nothing');
  });
});
