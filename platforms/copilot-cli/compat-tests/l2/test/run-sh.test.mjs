// run-sh.test.mjs — Task Group 8: 4 credit-free scripted checks for the bash operator wrapper run.sh.
//
// These are SHELL-level assertions wrapped in node:test so `node --test l2/test/*.test.mjs` (Group 10.1's
// pre-seat green gate) runs them alongside the pure-module + pipeline tests. Every check is
// CREDIT-FREE and NEVER drives a live Copilot session:
//   1. `run.sh -h/--help` reprints the header via sed and exits 0.
//   2. LOW-4: `run.sh --check-reference` reaches the staleness verdict EVEN WITH NO SEAT
//      (copilot hidden from PATH) — it is NOT masked by a preflight SKIP. exit 0 "current".
//   3. No `copilot` binary / no seat on the LIVE path -> loud SKIP, exit 0 (not 1).
//   4. Config byte-identical restore — de-shadow (filter_config) then restore_config over a fake
//      config (COPILOT_CONFIG override) -> `diff` before/after is identical (AC9 partial).
//
// SAFETY: checks 2 & 3 spawn run.sh only under a PATH from which `copilot` is ABSENT, and assert
// that absence up-front, so an accidental live run (credit spend) is impossible. Check 4 sources
// run.sh's helper functions (the source-guard suppresses main) and operates on a throwaway temp
// config — the operator's real ~/.copilot/config.json is never touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..'); // l2/
const RUN_SH = path.join(L2_DIR, 'run.sh');

// A PATH that keeps node (for the --check-reference exec) + coreutils but HIDES `copilot`.
// `copilot` ships only in /usr/local/bin here; node lives beside the running interpreter. We
// deliberately exclude /usr/local/bin. Derived (not hardcoded) so the check tracks the toolchain.
const NODE_BIN_DIR = path.dirname(process.execPath);
const NO_COPILOT_PATH = [NODE_BIN_DIR, '/usr/bin', '/bin'].join(':');

function runSh(args, extraEnv = {}) {
  return spawnSync('bash', [RUN_SH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

function copilotVisibleUnder(p) {
  const r = spawnSync('bash', ['-c', 'command -v copilot || true'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: p },
  });
  return r.stdout.trim().length > 0;
}

// -------------------------------------------------------------------------- Check 1 (8.1)
test('check 1: run.sh -h/--help reprints the header via sed and exits 0', () => {
  for (const flag of ['-h', '--help']) {
    const res = runSh([flag]);
    assert.equal(res.status, 0, `${flag} must exit 0 (got ${res.status}) — stderr:\n${res.stderr}`);
    // Header content is reprinted (sed range over the leading comment block)...
    assert.match(res.stdout, /Workflow-model conformance testing harness/i, `${flag} should print the header title`);
    assert.match(res.stdout, /Usage:/, `${flag} should print the Usage section`);
    assert.match(res.stdout, /--check-reference/, `${flag} should document --check-reference`);
    // ...with the leading "# " comment markers stripped (proves the sed reprint, not a raw cat).
    assert.doesNotMatch(res.stdout, /^# /m, `${flag} output must not retain "# " comment prefixes`);
  }
});

// -------------------------------------------------------------------------- Check 2 (8.1 / LOW-4)
test('check 2 (LOW-4): --check-reference reaches the staleness verdict with NO seat, exit 0 "current"', () => {
  // Prove copilot is genuinely hidden — the whole point is that the verdict survives no-seat.
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  const res = runSh(['--check-reference'], { PATH: NO_COPILOT_PATH });

  assert.equal(res.status, 0, `--check-reference must exit 0 (current); got ${res.status}\n${res.stdout}\n${res.stderr}`);
  // The credit-free reference verdict is rendered (from run.mjs, reached via `exec node`)...
  assert.match(res.stdout, /--check-reference:\s*CURRENT/i, 'staleness verdict must be printed');
  // ...and it is NEVER masked by a seat-preflight SKIP (LOW-4: short-circuit BEFORE preflight).
  assert.doesNotMatch(res.stdout, /SKIP/i, 'the check-reference path must not be rendered as a SKIP');
});

// -------------------------------------------------------------------------- Check 3 (8.1 / AC4)
test('check 3 (AC4): no copilot/seat on the LIVE path -> loud SKIP, exit 0 (not 1)', () => {
  // Absolutely no live run: assert copilot is invisible before spawning the live (no-arg) path.
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  const res = runSh([], { PATH: NO_COPILOT_PATH });

  assert.equal(res.status, 0, `no-seat SKIP must exit 0, not 1/2; got ${res.status}\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /\bSKIP\b/, 'a loud SKIP line must be printed');
  assert.match(res.stdout, /copilot.*not on PATH/i, 'the SKIP reason should name the missing copilot binary');
  // A SKIP is not a verdict: it must not masquerade as a conformance result.
  assert.doesNotMatch(res.stdout, /REGRESSED|AS-EXPECTED|CURRENT/, 'a no-seat SKIP is not a verdict');
});

// -------------------------------------------------------------------------- Check 5 (live-path scenario allowlist ↔ run.mjs registry)
// Regression guard: run.sh's live-path `case` (scenario -> sandbox) MUST stay in lockstep with the
// run.mjs SCENARIOS registry. A scenario known to run.mjs (e.g. destructive-guard, #48 Stage 6) but
// missing a case arm here fails "L2 INCOMPLETE: unknown scenario" (exit 2) on the live path — while
// --check-reference (exec'd before the case) still works, masking the gap from the unit suite.
// Credit-free: spawned under a copilot-absent PATH, so it reaches the no-seat SKIP, never a live run.
test('check 5: every non-check-reference scenario is recognized on the LIVE path (no "unknown scenario")', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  // Scenarios registered in run.mjs that a maintainer would drive live. Keep in sync with the registry.
  for (const scenario of ['development', 'research', 'quick-bugfix', 'destructive-guard', 'work', 'init']) {
    const res = runSh([`--scenario=${scenario}`], { PATH: NO_COPILOT_PATH });
    // The live-path case must recognize the scenario and fall through to the no-seat SKIP (exit 0),
    // NOT bail at the `*)` unknown-scenario arm (exit 2).
    assert.doesNotMatch(res.stderr + res.stdout, /unknown scenario/i,
      `run.sh does not recognize --scenario=${scenario} on the live path (case arm missing):\n${res.stderr}`);
    assert.equal(res.status, 0, `--scenario=${scenario} must reach the no-seat SKIP (exit 0), got ${res.status}\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /\bSKIP\b/, `--scenario=${scenario} should print the no-seat SKIP line`);
  }
});

// -------------------------------------------------------------------------- Check 4 (8.1 / AC9 partial)
test('check 4 (AC9 partial): de-shadow then restore_config is byte-identical', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-cfg-'));
  try {
    const cfg = path.join(tmp, 'config.json');
    const backup = path.join(tmp, 'config.json.orig');

    // A realistic Copilot config.json (JSONC: a full-line // comment) with maister-copilot installed
    // alongside another plugin, in the operator's own hand-formatting (4-space indent, trailing NL).
    const original = [
      '// GitHub Copilot CLI configuration (JSONC — full-line // comments allowed).',
      '{',
      '    "theme": "dark",',
      '    "installedPlugins": [',
      '        { "name": "maister-copilot", "path": "/opt/plugins/maister-copilot" },',
      '        { "name": "some-other-plugin", "path": "/opt/plugins/other" }',
      '    ]',
      '}',
      '',
    ].join('\n');
    fs.writeFileSync(cfg, original);

    // Drive the REAL sourced helpers: source run.sh (source-guard suppresses main), then reproduce
    // main's de-shadow (backup -> filter_config -> mv -> NEUTRALIZED=1) and restore_config, asserting
    // (a) de-shadow actually removed maister-copilot and (b) restore is byte-for-byte the backup.
    const helper = path.join(tmp, 'deshadow-restore.sh');
    fs.writeFileSync(helper, [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'source "$RUN_SH"                         # source-guard returns; helpers + REAL_CONFIG(=COPILOT_CONFIG) in scope',
      'CONFIG_BACKUP="$BACKUP"',
      'cp -a "$REAL_CONFIG" "$CONFIG_BACKUP"    # == main step 1: back up the operator config',
      'filter_config "$REAL_CONFIG" "$REAL_CONFIG.l2.tmp"   # == main step 2: JSONC-safe de-shadow',
      'mv "$REAL_CONFIG.l2.tmp" "$REAL_CONFIG"',
      'NEUTRALIZED=1',
      'if diff -q "$CONFIG_BACKUP" "$REAL_CONFIG" >/dev/null 2>&1; then echo "FAIL: de-shadow was a no-op"; exit 11; fi',
      'if grep -q "maister-copilot" "$REAL_CONFIG"; then echo "FAIL: maister-copilot not de-shadowed"; exit 12; fi',
      'if ! grep -q "some-other-plugin" "$REAL_CONFIG"; then echo "FAIL: de-shadow dropped an unrelated plugin"; exit 13; fi',
      'restore_config                           # == trap/cleanup restore',
      'if ! diff "$CONFIG_BACKUP" "$REAL_CONFIG"; then echo "FAIL: restore not byte-identical"; exit 14; fi',
      'echo "OK: de-shadow removed maister-copilot; restore byte-identical"',
      '',
    ].join('\n'));

    const res = spawnSync('bash', [helper], {
      encoding: 'utf8',
      env: { ...process.env, RUN_SH, COPILOT_CONFIG: cfg, BACKUP: backup },
    });

    assert.equal(res.status, 0, `de-shadow/restore helper failed (status ${res.status})\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`);
    assert.match(res.stdout, /restore byte-identical/, 'restore must be reported byte-identical');

    // Independent confirmation from the node side: the restored file equals the original bytes.
    const restored = fs.readFileSync(cfg, 'utf8');
    assert.equal(restored, original, 'restored config must be byte-identical to the original');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
