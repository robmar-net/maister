// run-sh.test.mjs — Task Group 8: 4 credit-free scripted checks for the bash operator wrapper run.sh,
// plus the #122 G2 `--variant=<arm> --commit=<sha>` arg-surface checks (V1-V5 below).
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
//   5. Live-path scenario allowlist stays in lockstep with the run.mjs SCENARIOS registry.
//
// #122 G2 — `--variant` / `--commit` parse-time validation (spec R6; the parse-time exit-2 idiom is
// mutations.test.mjs cases E-H: spawn under NO_COPILOT_PATH with COPILOT_CONFIG pointing at a temp
// file, so nothing is staged and nothing is touched — audit I2). All four rejects fire BEFORE the
// --check-reference short-circuit, the sandbox allowlist, the seat preflight, the trap and de-shadow:
//   V1. `--variant=bogus` (no l2/variants/arms/bogus.json) -> exit 2, no SKIP banner, no verdict,
//       and a path-shaped / dot-leading name (`../plain`, `a/b`, `.plain`) -> the parse-time CHARSET reject;
//       COPILOT_CONFIG byte-identical; also exits 2 when combined with --check-reference (ordering).
//   V2. `--variant=plain` without `--commit=` AND without COMPAT_VARIANT_COMMIT -> exit 2; with the
//       env pin alone the validation passes and the no-seat SKIP is reached with NO l2-variant-*
//       residue (staging is post-preflight, as for mutants).
//   V3. `--variant=plain --commit=x --mutation=M1` -> exit 2 (mutually exclusive).
//   V4. `--commit=x` without `--variant` -> exit 2.
//   V5. `-h` documents --variant, --commit, COMPAT_VARIANT_COMMIT, COMPAT_L2_HTML_OUTPUT,
//       COMPAT_L2_SKIP_INSTR.
//
// SAFETY: checks 2, 3, 5 and V1-V4 spawn run.sh only under a PATH from which `copilot` is ABSENT,
// and assert that absence up-front, so an accidental live run (credit spend) is impossible. Check 4
// sources run.sh's helper functions (the source-guard suppresses main) and operates on a throwaway
// temp config — the operator's real ~/.copilot/config.json is never touched.

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

// ============================================================================ #122 G2: --variant / --commit
// Spawn idiom (mutations.test.mjs E-H): copilot hidden from PATH, COPILOT_CONFIG -> a throwaway temp
// file, COMPAT_VARIANT_COMMIT scrubbed from the inherited env (an operator's shell pin must not leak
// into the "no pin" case). Every spawn below either rejects at parse time (exit 2, nothing created)
// or reaches the no-seat SKIP (exit 0, staging is post-preflight) — never a live session.
//
// Residue is checked in a PRIVATE TMPDIR handed to the spawn (run.sh's `mktemp -d` and variant.sh /
// mutate.sh all honor TMPDIR): node runs test files concurrently, so diffing the shared os.tmpdir()
// would race against mutations.test.mjs / variants.test.mjs staging their own l2-mutant-* / l2-variant-*
// dirs at the same moment.
const stagedEntries = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('l2-variant-') || n.startsWith('l2-mutant-'));

function runShVariant(args, cfgPath, extraEnv = {}) {
  const env = { ...process.env, PATH: NO_COPILOT_PATH, COPILOT_CONFIG: cfgPath, TMPDIR: path.dirname(cfgPath) };
  delete env.COMPAT_VARIANT_COMMIT;
  for (const [k, v] of Object.entries(extraEnv)) if (v == null) delete env[k]; else env[k] = v;
  return spawnSync('bash', [RUN_SH, ...args], { encoding: 'utf8', env });
}

// fn(cfgPath, originalBytes, tmpDir) — tmpDir doubles as the spawn's private TMPDIR (see above).
function withTempConfig(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-vcfg-'));
  try {
    const cfg = path.join(tmp, 'config.json');
    const bytes = '// throwaway operator config (run-sh.test.mjs V-cases)\n{\n  "installedPlugins": [\n' +
      '    { "name": "maister-copilot", "path": "/opt/plugins/maister-copilot" }\n  ]\n}\n';
    fs.writeFileSync(cfg, bytes);
    return fn(cfg, bytes, tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// A parse-time reject renders NEITHER a verdict NOR the SKIP banner and never reaches the live hand-off.
function assertParseTimeReject(res, label) {
  assert.equal(res.status, 2, `${label} must exit 2 (got ${res.status})\n${res.stdout}\n${res.stderr}`);
  assert.doesNotMatch(res.stdout, /\bSKIP\b/, `${label} must not render the no-seat SKIP banner (reject is pre-preflight)`);
  assert.doesNotMatch(res.stdout, /REGRESSED|AS-EXPECTED|CURRENT/, `${label} must not render a verdict`);
  assert.doesNotMatch(res.stdout, /driving one live/i, `${label} must never reach the live hand-off`);
  assert.doesNotMatch(res.stderr, /Unknown argument/, `${label} must be a dedicated validation reject, not the unknown-argument arm`);
}

// -------------------------------------------------------------------------- V1 (R6: unknown arm)
test('V1 (#122 G2): --variant=bogus -> credit-free exit 2, no SKIP banner, COPILOT_CONFIG byte-identical; also before --check-reference', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  assert.ok(!fs.existsSync(path.join(L2_DIR, 'variants', 'arms', 'bogus.json')), 'test setup: no arms/bogus.json may exist');
  withTempConfig((cfg, bytes, tmp) => {
    let res = runShVariant(['--variant=bogus', '--commit=deadbeef'], cfg);
    assertParseTimeReject(res, '--variant=bogus');
    assert.match(res.stderr, /bogus/, 'stderr must name the unknown arm');
    assert.match(res.stderr, /arms\/bogus\.json|unknown (arm|variant)/i, 'stderr must explain that no manifest exists for the arm');
    assert.equal(fs.readFileSync(cfg, 'utf8'), bytes, 'COPILOT_CONFIG must be byte-identical (reject fires before de-shadow)');
    assert.deepEqual(stagedEntries(tmp), [], 'a rejected arm must stage NOTHING');

    // Ordering: the reject wins over the credit-free --check-reference short-circuit (spec R6 :161-164 < :170).
    res = runShVariant(['--variant=bogus', '--commit=deadbeef', '--check-reference'], cfg);
    assertParseTimeReject(res, '--variant=bogus --check-reference');
    assert.doesNotMatch(res.stdout, /--check-reference:/i, 'an unknown arm must be rejected BEFORE the --check-reference verdict');

    // Fix pass (verification W1): a PATH-SHAPED arm name is rejected by the parse-time CHARSET rule
    // (variant.sh:81-83 mirrored in run.sh) — a dedicated message, NOT the manifest-existence reject, so
    // `../plain` can never resolve outside variants/arms/ and reach the de-shadow. Also a leading dot, and
    // (fix pass 2) a leading dash — `-x` is an option spelling, never an arm.
    for (const bad of ['../plain', 'a/b', '.plain', '-x']) {
      res = runShVariant([`--variant=${bad}`, '--commit=deadbeef'], cfg);
      assertParseTimeReject(res, `--variant=${bad}`);
      assert.match(res.stderr, /invalid arm name/, `--variant=${bad}: the charset reject must fire (dedicated message)`);
      assert.doesNotMatch(res.stderr, /unknown arm/, `--variant=${bad}: the charset rule fires BEFORE the manifest-existence check`);
      assert.equal(fs.readFileSync(cfg, 'utf8'), bytes, `--variant=${bad}: COPILOT_CONFIG must be byte-identical (no de-shadow)`);
      assert.deepEqual(stagedEntries(tmp), [], `--variant=${bad}: nothing staged`);
    }

    // Fix pass 2: on a CASE-INSENSITIVE filesystem (macOS default) `--variant=PLAIN` resolves arms/plain.json,
    // so the manifest-existence check passes; run.sh's manifest read then pins `arm` to the typed name and
    // rejects the mismatch with its own exit-2 message — still credit-free, config untouched, nothing staged.
    // Detected at test time (arms/PLAIN.json resolving while only plain.json exists); on a case-sensitive
    // filesystem the sub-case is skipped (it is the plain `unknown arm` reject there, covered above).
    const armsDir = path.join(L2_DIR, 'variants', 'arms');
    const caseInsensitive = fs.existsSync(path.join(armsDir, 'PLAIN.json')) && !fs.readdirSync(armsDir).includes('PLAIN.json');
    if (caseInsensitive) {
      res = runShVariant(['--variant=PLAIN', '--commit=deadbeef'], cfg);
      assertParseTimeReject(res, '--variant=PLAIN (case-insensitive FS)');
      assert.match(res.stderr, /arm\/manifest name mismatch/, '--variant=PLAIN: the manifest arm/name mismatch reject must fire (dedicated message)');
      assert.match(res.stderr, /PLAIN/, '--variant=PLAIN: stderr names the typed spelling');
      assert.doesNotMatch(res.stderr, /invalid arm name|unknown arm|cannot resolve html_output/, '--variant=PLAIN: not the charset / existence / html_output message');
      assert.equal(fs.readFileSync(cfg, 'utf8'), bytes, '--variant=PLAIN: COPILOT_CONFIG must be byte-identical (reject fires before de-shadow)');
      assert.deepEqual(stagedEntries(tmp), [], '--variant=PLAIN: nothing staged');
    }
  });
});

// -------------------------------------------------------------------------- V2 (R6: --variant without a pin)
test('V2 (#122 G2): --variant=plain without --commit or COMPAT_VARIANT_COMMIT -> exit 2; env pin alone passes validation and SKIPs credit-free', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  assert.ok(fs.existsSync(path.join(L2_DIR, 'variants', 'arms', 'plain.json')), 'test setup: arms/plain.json must exist');
  withTempConfig((cfg, bytes, tmp) => {
    let res = runShVariant(['--variant=plain'], cfg);
    assertParseTimeReject(res, '--variant=plain (no pin)');
    assert.match(res.stderr, /--commit|COMPAT_VARIANT_COMMIT/, 'stderr must tell the operator how to pin the commit');
    assert.equal(fs.readFileSync(cfg, 'utf8'), bytes, 'COPILOT_CONFIG must be byte-identical after the reject');

    // The env pin is an accepted alternative to --commit=: validation passes and, with no seat, the
    // run reaches the loud SKIP (exit 0) with NOTHING staged — staging is post-preflight.
    res = runShVariant(['--variant=plain'], cfg, { COMPAT_VARIANT_COMMIT: 'deadbeef' });
    assert.equal(res.status, 0, `--variant=plain with COMPAT_VARIANT_COMMIT must reach the no-seat SKIP (exit 0), got ${res.status}\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /\bSKIP\b/, 'the no-seat SKIP banner must be printed when the pin comes from the env');
    assert.deepEqual(stagedEntries(tmp), [], 'a no-seat SKIP must stage NO variant (staging is post-preflight)');
    assert.equal(fs.readFileSync(cfg, 'utf8'), bytes, 'COPILOT_CONFIG must be byte-identical after a no-seat SKIP');
  });
});

// -------------------------------------------------------------------------- V3 (R6: mutual exclusion)
test('V3 (#122 G2): --variant=plain --commit=x --mutation=M1 -> exit 2 (mutually exclusive)', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  withTempConfig((cfg, bytes, tmp) => {
    const res = runShVariant(['--variant=plain', '--commit=deadbeef', '--mutation=M1'], cfg);
    assertParseTimeReject(res, '--variant + --mutation');
    assert.match(res.stderr, /--variant/, 'stderr must name --variant');
    assert.match(res.stderr, /--mutation/, 'stderr must name --mutation');
    assert.equal(fs.readFileSync(cfg, 'utf8'), bytes, 'COPILOT_CONFIG must be byte-identical after the reject');
    assert.deepEqual(stagedEntries(tmp), [], 'the exclusion reject must stage NOTHING (neither an arm nor a mutant)');
  });
});

// -------------------------------------------------------------------------- V4 (R6: --commit without --variant)
test('V4 (#122 G2): --commit=x without --variant -> exit 2', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
  withTempConfig((cfg, bytes) => {
    const res = runShVariant(['--commit=deadbeef'], cfg);
    assertParseTimeReject(res, '--commit without --variant');
    assert.match(res.stderr, /--variant/, 'stderr must point at the missing --variant');
    assert.equal(fs.readFileSync(cfg, 'utf8'), bytes, 'COPILOT_CONFIG must be byte-identical after the reject');
  });
});

// -------------------------------------------------------------------------- V5 (R1.5 / R6: help)
test('V5 (#122 G2): -h documents --variant, --commit, COMPAT_VARIANT_COMMIT, COMPAT_L2_HTML_OUTPUT, COMPAT_L2_SKIP_INSTR', () => {
  const res = runSh(['-h'], { PATH: NO_COPILOT_PATH });
  assert.equal(res.status, 0, `-h must exit 0 (got ${res.status})\n${res.stderr}`);
  for (const needle of ['--variant=<arm>', '--commit=<sha>', 'COMPAT_VARIANT_COMMIT', 'COMPAT_L2_HTML_OUTPUT', 'COMPAT_L2_SKIP_INSTR']) {
    assert.ok(res.stdout.includes(needle), `-h must document ${needle}`);
  }
  assert.match(res.stdout, /--variant[^\n]*--mutation[^\n]*mutually exclusive|mutually exclusive/i, '-h must state that --variant and --mutation are mutually exclusive');
});
