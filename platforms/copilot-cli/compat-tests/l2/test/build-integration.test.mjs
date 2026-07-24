// build-integration.test.mjs — Task Group 9: credit-free make/git assertions for the operator
// entrypoint wiring (`make test-l2`) and the L2 report ignore rule (strict backward-compat).
//
// These are BUILD-INTEGRATION assertions wrapped in node:test so `node --test l2/test/*.test.mjs`
// (Group 10.1's pre-seat green gate) runs them alongside the pure-module + pipeline + run.sh tests.
// Every check is CREDIT-FREE and NEVER drives a live Copilot session:
//   1. AC5 wiring: `make test-l2` runs `$(MAKE) build` FIRST, then the harness; forced no-seat
//      (COMPAT_NO_SEAT=1) it ends in a loud SKIP, exit 0 — and never hands off to a live run.
//      GATED behind L2_BUILD_CHECKS=1 (it shells `make build`); skipped by default (F4).
//   2. `test-l2` is present in the `.PHONY` line (grep the Makefile).
//   3. AC5 backward-compat via DURABLE file-content checks (F4): the Makefile defines a `test-l2:`
//      target that invokes the L2 run.sh, `.PHONY` lists test-l2 + the kept targets, and the
//      test-copilot/test-hooks recipes stay verbatim. (The old `git diff HEAD` shape assert only
//      held PRE-commit — once the L2 work is committed the diff is empty and it fails permanently.)
//      `make check-deterministic` is a GATED subtest (L2_BUILD_CHECKS=1), skipped by default.
//   4. AC6: `reports/.gitignore` ignores `l2-trace-equivalence-*.md` (`git check-ignore` matches),
//      while `l2/reference/**` and `l2/sandbox/**` stay TRACKED (`git check-ignore` non-zero), and
//      `.gitkeep` is preserved.
//
// SAFETY: check 1 (when opted in) forces COMPAT_NO_SEAT=1 (run.sh's documented no-seat override,
// short-circuited at the preflight BEFORE any SDK session), so no live workflow — and therefore no
// AI credit — can be spent; it additionally asserts the "driving one live" handoff marker is ABSENT.
// Checks 2-4 only read files and query git; the gated `make check-deterministic` regenerates
// plugins/maister-copilot/ byte-identically (the determinism guard the target itself verifies).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// l2/test -> l2 -> compat-tests -> copilot-cli -> platforms -> <repo root>
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const MAKEFILE = path.join(REPO_ROOT, 'Makefile');
const REPORTS_DIR = 'platforms/copilot-cli/compat-tests/reports'; // repo-relative
const GITIGNORE = path.join(REPO_ROOT, REPORTS_DIR, '.gitignore');

// The phony targets that must remain declared after wiring test-l2 in — declaring test-l2 must not
// silently drop any pre-existing phony target. Used by checks 2 & 3 (durable file-content asserts).
const PHONY_TARGETS_KEPT = [
  'build', 'validate', 'check-deterministic', 'test-copilot', 'test-hooks', 'clean', 'watch',
];

function make(args, extraEnv = {}) {
  return spawnSync('make', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 120000,
  });
}

function git(args) {
  return spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// -------------------------------------------------------------------------- setup guard
assert.ok(fs.existsSync(MAKEFILE), `test setup: repo-root Makefile not found at ${MAKEFILE}`);

// -------------------------------------------------------------------------- Check 1 (9.1 / AC5)
test('check 1 (AC5): `make test-l2` builds FIRST, then no-seat SKIP exit 0 (no live run)', (t) => {
  // Make-invoking (shells `$(MAKE) build`) → GATED out of the pure-unit path; opt in with
  // L2_BUILD_CHECKS=1. Skipped by default so the credit-free gate never triggers a heavy build (F4).
  if (process.env.L2_BUILD_CHECKS !== '1') {
    t.skip('set L2_BUILD_CHECKS=1 to run the make-driven build-first check (it shells `make build`)');
    return;
  }

  // COMPAT_NO_SEAT=1 forces run.sh's preflight SKIP BEFORE any SDK session — bulletproof credit-free.
  const res = make(['test-l2'], { COMPAT_NO_SEAT: '1' });

  assert.equal(res.status, 0, `make test-l2 (no seat) must exit 0; got ${res.status}\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`);

  const out = res.stdout || '';
  // (a) the build recipe actually RAN first — build.sh's own completion line is on stdout.
  const buildAt = out.indexOf('Built Copilot CLI variant');
  assert.ok(buildAt !== -1, `test-l2 must run \`$(MAKE) build\` first (missing build output)\n${out}`);
  // (b) the harness then SKIPped loudly for want of a seat, exit 0.
  const skipAt = out.search(/\bL2 SKIP\b/);
  assert.ok(skipAt !== -1, `the harness must print a loud SKIP under no seat\n${out}`);
  assert.match(out, /COMPAT_NO_SEAT=1/, 'the SKIP reason should name the forced no-seat override');
  // (c) ORDER: build precedes the harness SKIP (build-first wiring, not the reverse).
  assert.ok(buildAt < skipAt, `\`$(MAKE) build\` must run BEFORE the harness (build@${buildAt} !< skip@${skipAt})\n${out}`);
  // (d) SAFETY: a SKIP is not a live run — the credit-spending handoff marker must be ABSENT.
  assert.doesNotMatch(out, /driving one live/i, 'a no-seat SKIP must never hand off to a live (credit-spending) run');
  // (e) a SKIP is not a conformance verdict.
  assert.doesNotMatch(out, /\b(AS-EXPECTED|REGRESSED)\b/, 'a no-seat SKIP must not masquerade as a verdict');
});

// -------------------------------------------------------------------------- Check 2 (9.1 / 9.3)
test('check 2: `test-l2` is present in the .PHONY line', () => {
  const mk = fs.readFileSync(MAKEFILE, 'utf8');
  const phony = mk.split('\n').find((l) => l.startsWith('.PHONY:'));
  assert.ok(phony, 'Makefile must contain a .PHONY line');
  assert.match(phony, /\btest-l2\b/, `test-l2 must be declared .PHONY; got:\n${phony}`);
  // Declaring test-l2 must not silently drop any pre-existing phony target.
  for (const t of PHONY_TARGETS_KEPT) {
    assert.match(phony, new RegExp(`\\b${t.replace(/[-]/g, '\\-')}\\b`), `.PHONY must still list "${t}"`);
  }
});

// -------------------------------------------------------------------------- Check 3 (9.1 / AC5 backward-compat)
test('check 3 (AC5): Makefile durably wires test-l2 + keeps L0/L1 targets; check-deterministic gated', async (t) => {
  const mk = fs.readFileSync(MAKEFILE, 'utf8');

  // (a) DURABLE file-content check (F4): a `test-l2:` target exists AND invokes the L2 run.sh.
  //     Replaces the old `git diff HEAD -- Makefile` shape assert, which only held PRE-commit —
  //     once the L2 work is committed the diff is empty and the shape assert fails permanently.
  assert.match(mk, /^test-l2:/m, 'Makefile must define a `test-l2:` target');
  const testL2Recipe = mk.slice(mk.search(/^test-l2:/m)).split(/\n(?=\S)/)[0];
  assert.match(
    testL2Recipe,
    /bash platforms\/copilot-cli\/compat-tests\/l2\/run\.sh/,
    'the test-l2 target must invoke the L2 run.sh',
  );

  // (b) `.PHONY` lists test-l2 alongside the durable targets (test-copilot/test-hooks/build/validate
  //     + the rest) — wiring test-l2 in must not silently drop a pre-existing phony target.
  const phony = mk.split('\n').find((l) => l.startsWith('.PHONY:'));
  assert.ok(phony, 'Makefile must contain a .PHONY line');
  for (const target of ['test-l2', ...PHONY_TARGETS_KEPT]) {
    assert.match(phony, new RegExp(`\\b${target.replace(/[-]/g, '\\-')}\\b`), `.PHONY must list "${target}"`);
  }

  // (c) belt-and-suspenders: the L0/L1 recipes remain VERBATIM (wiring test-l2 did not rewrite them).
  assert.ok(
    mk.includes('test-copilot:\n\t$(MAKE) build\n\tbash platforms/copilot-cli/compat-tests/run.sh'),
    'test-copilot target must be unchanged',
  );
  assert.ok(
    mk.includes('test-hooks:\n\t$(MAKE) build\n\tbash platforms/copilot-cli/compat-tests/l1-hook-effects.sh'),
    'test-hooks target must be unchanged',
  );

  // (d) backward-compat proof (byte-identical rebuild) — make-invoking, so GATED out of the pure-unit
  //     path (it shells `$(MAKE) build` ~2x). Opt in with L2_BUILD_CHECKS=1; skipped by default (F4).
  await t.test('make check-deterministic byte-identical rebuild (L2_BUILD_CHECKS=1)', (st) => {
    if (process.env.L2_BUILD_CHECKS !== '1') {
      st.skip('set L2_BUILD_CHECKS=1 to run `make check-deterministic` (it shells `make build`)');
      return;
    }
    const det = make(['check-deterministic']);
    assert.equal(det.status, 0, `make check-deterministic must exit 0; got ${det.status}\n${det.stdout}\n${det.stderr}`);
    assert.match(det.stdout, /PASS: rebuild is byte-identical/, 'determinism guard must report byte-identical rebuild');
  });
});

// -------------------------------------------------------------------------- Check 4 (9.1 / AC6)
test('check 4 (AC6): .gitignore ignores l2-trace-equivalence reports; reference/sandbox stay tracked', () => {
  // Ignored: a sample generated L2 report.
  const rep = git(['check-ignore', `${REPORTS_DIR}/l2-trace-equivalence-20260724T000000Z.md`]);
  assert.equal(rep.status, 0, `l2-trace-equivalence-*.md must be git-ignored (check-ignore exit 0); got ${rep.status}`);
  assert.match(rep.stdout, /l2-trace-equivalence-.*\.md/, 'the ignored path should be echoed by check-ignore');

  // NOT ignored (must stay tracked): the committed reference golden.
  const ref = git(['check-ignore', 'platforms/copilot-cli/compat-tests/l2/reference/development.skeleton.json']);
  assert.equal(ref.status, 1, 'l2/reference/development.skeleton.json must NOT be ignored (must stay tracked)');

  // NOT ignored (must stay tracked): a sandbox fixture.
  const sbx = git(['check-ignore', 'platforms/copilot-cli/compat-tests/l2/sandbox/sample-cli/cli.sh']);
  assert.equal(sbx.status, 1, 'l2/sandbox/sample-cli/cli.sh must NOT be ignored (must stay tracked)');

  // .gitkeep preserved (still on disk AND still tracked) so reports/ keeps a home for artifacts.
  assert.ok(fs.existsSync(path.join(REPO_ROOT, REPORTS_DIR, '.gitkeep')), 'reports/.gitkeep must still exist');
  const tracked = git(['ls-files', `${REPORTS_DIR}/.gitkeep`]);
  assert.match(tracked.stdout, /\.gitkeep/, 'reports/.gitkeep must remain tracked');

  // The pre-existing ignore globs are retained (this group only APPENDS).
  const gi = fs.readFileSync(GITIGNORE, 'utf8');
  assert.match(gi, /^compat-report-\*\.md$/m, 'compat-report-*.md glob must be retained');
  assert.match(gi, /^l1-hook-effects-\*\.md$/m, 'l1-hook-effects-*.md glob must be retained');
  assert.match(gi, /^l2-trace-equivalence-\*\.md$/m, 'l2-trace-equivalence-*.md glob must be appended');
});
