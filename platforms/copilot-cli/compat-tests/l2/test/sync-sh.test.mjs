// sync-sh.test.mjs — #161 module 1 (F0/F1/F2): the credit-free unit suite for `scripts/sync.sh`, the
// only sanctioned way to land an UPSTREAM MERGE on the fork (AGENTS.md § Shipping, spec § 3.1).
//
// CREDIT-FREE AND HERMETIC: no Copilot session, no network, no touch of the real repository. TWO LOCKS make
// a real `gh pr create` impossible (NFR9): (a) every spawn's `PR_REPO_SLUG` is a fixture slug AND the
// fork-bare path embeds it, since `remote_for` (:67-74) resolves the push target from the URL string; (b) the
// derived PATH FILTERS OUT every dir holding an executable `gh`. `assertNoGh()` runs at MODULE SCOPE, per file.
//
// SCOPE LIMITS, BY LINE NUMBER — the `sweep-sh.test.mjs:38-44` model. Stated out loud, never hidden:
//   * SIX `fail` sites are unreachable hermetically, behind a SUCCESSFUL `gh pr create` at :258 (`num` is
//     assigned at :259 from its output): 266, 269, 273, 274, 276, 288 — declared as DATA with a reason each
//     by 1.T7's census, never omitted. `--no-merge` does NOT lower that ceiling: it is evaluated at :261,
//     AFTER the pushes (253/255) and AFTER 258 (1.T10 pins it). Site 258 IS reachable — 4.T5(c) drives it.
//   * sync.sh:229's `fail` is UNREACHABLE (issue #166): errexit and pipefail are JOINTLY load-bearing, so
//     the diagnostic re-run pipeline aborts the brace group first. Pinned as a DEFECT by 4.T2(a), never
//     laundered into the exclusion list, so it stays visible (AGENTS.md:47-64).
//   * Site 175's `master` arm IS constructible (`worktree add --force <path> master`, git 2.54.0; 1.T18).
//
// SOURCING THE SCRIPT IS NOT AN OPTION, and the limit is stated rather than half-implemented: sync.sh:295-300
// is a bare top-level `case` with no `main`-guard, so `. scripts/sync.sh` runs `usage` and exits 2 out of the
// caller. Every check below reads the source TEXT or spawns `bash <script>`; no function is ever called.
//
// THE TWENTY TESTS, IN DECLARATION ORDER (1.T6 and 1.T13 are hoisted controls). A claim with no test is a lie.
//   1.T1  (FR6)     script shape: mode 755, the bash shebang, no `[[` compound command, no ANSI escapes.
//   1.T2  (FR6)     `-h`/`--help`/`help` reprint the header ON STDERR, with nothing on stdout (AC1).
//   1.T6  (FR1/AC3) CONTROL, hoisted: a CRASH is distinguishable from a refusal.
//   1.T3  (FR5)     all four `usage` exits (:80, :165, :168, :299): exit 2, no `REFUSED`, empty stdout.
//   1.T4  (FR5/FR4) the `usage` ratchet: the call sites enumerate to exactly {80, 165, 168, 299}.
//   1.T5  (FR7)     the flag set is closed: three `land` options plus the title; `start` takes nothing.
//   1.T7  (FR4)     the three-bucket line-keyed `fail`-site census, declared as data.
//   1.T8  (NFR9b)   no executable `gh` on the derived PATH, toolchain intact, probe shown falsifiable.
//   1.T9  (NFR9a)   the slug handed to `gh pr create` is the fixture slug, never `robmar-net/maister`.
//   1.T10 (FR8/D7)  `--no-merge` skips 6 refusal points and `--keep-worktree` 1 — :37 claims none (#165).
//   1.T13 (FR9c)    CONTROL, hoisted: moving the UPSTREAM bare out of a `github.com/` path fires 86.
//   1.T11 (FR9a)    a bare LOCAL PATH containing `github.com/<slug>` resolves; `start` completes offline.
//   1.T12 (FR9b)    a `file://` URL containing the slug ALSO resolves — the scheme is NOT a control.
//   1.T14 (FR1)     86 — `start` refuses with no remote pointing at upstream.
//   1.T15 (FR1)     87 — `start` refuses with upstream present but no fork (remote named `zzz-upstream`).
//   1.T18 (FR1)     175 `master` arm — precondition asserted first; built with `worktree add --force`.
//   1.T19 (FR1)     175 detached arm — `abbrev-ref HEAD` is the literal `HEAD`, asserted first.
//   1.T16 (FR1)     88 — `start` refuses when the fork remote FETCHES the fork but PUSHES upstream.
//   1.T17 (FR1)     173 — `land` refuses from the MAIN checkout (the realpath'd root makes it stable).
//   1.T20 (FR1)     176, 180, 181, 189 — four ordered `land` arms on one topology-D fixture.
//
// `node:` builtins only, self-cleaning: every temp root is removed in its OWN test's `finally` (NFR7).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertCrash, assertNoGh, assertRefused, assertUsage, fixtureEnv, FIXTURE_SLUG, makeFixture,
  NO_GH_PATH, runSync, SYNC_SH,
} from './helpers/sync-sh-harness.mjs';

// NFR9b — the per-module precondition, at MODULE SCOPE and before any `test(...)` declaration.
assertNoGh();

const SRC = fs.readFileSync(SYNC_SH, 'utf8');
const SRC_LINES = SRC.split('\n');

// A throwaway root for the spawns that need a cwd and an isolated environment. Every caller removes it
// in its own `finally` (NFR7) — never a global `after()`.
const mkroot = (tag) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `l2-syncsh-${tag}-`)));

// A non-comment line of the subject: a leading `#` after optional whitespace is a comment (§ 5.1).
const isComment = (line) => /^\s*#/.test(line);

// § 5.1 — THE ENUMERATION, keyed on the 1-BASED LINE NUMBER. Read the source, drop comment lines, and
// collect every remaining line containing the literal `fail "`. The definition at sync.sh:63 is
// `fail() { log "…"; exit 1; }` and contains no `fail "`, so no exclusion rule is needed for it.
function enumerateFailSites() {
  const sites = [];
  SRC_LINES.forEach((line, i) => {
    if (!isComment(line) && line.includes('fail "')) sites.push(i + 1);
  });
  return sites;
}

// § 5.5 — the `usage` CALL sites. `\busage\b` with a negative lookahead on `(` excludes the definition
// at sync.sh:64 (`usage() { … }`); the comment filter excludes the header prose.
function enumerateUsageSites(pattern = /\busage\b(?!\()/, dropComments = true) {
  const sites = [];
  SRC_LINES.forEach((line, i) => {
    if (dropComments && isComment(line)) return;
    if (pattern.test(line)) sites.push(i + 1);
  });
  return sites;
}

// § 5.1's enumeration restricted to a predicate over the LINE TEXT, keyed on the 1-based line number.
// Every structural claim below is expressed through this rather than through `SRC.includes(<token>)`,
// because a bare substring search over this subject is demonstrably unsound — see 1.T10's `--force`
// control, where `--force` IS present (as part of `--force-with-lease` at :253) on a correct script.
function linesMatching(re) {
  const hits = [];
  SRC_LINES.forEach((line, i) => { if (!isComment(line) && re.test(line)) hits.push(i + 1); });
  return hits;
}

// The real repository, spelled out ONCE so the NFR9a assertions can name what must never be reached.
const REAL_SLUG = 'robmar-net/maister';

// Does `dir` hold an EXECUTABLE named `name`? The NFR9b probe shape (harness `holdsExecutable`): probe
// for the binary, never infer from a directory whitelist. Re-declared here rather than imported
// because 1.T8 must be able to judge the harness's PATH with its own copy of the predicate.
function holdsExe(dir, name) {
  try {
    fs.accessSync(path.join(dir, name), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------- fixture git plumbing
// A git call against a FIXTURE repository — used only to mutate remote wiring or to assert a
// PRECONDITION before a spawn, and every `cwd` handed to it is under a `makeFixture` root (NFR4).
// `gitTry` tolerates a non-zero exit and is what lets 1.T18 assert that a plain `worktree add master`
// genuinely FAILS before `--force` is used; `git` insists on success and fails loudly with the command
// and both streams, because a test that cannot build its precondition must never skip (AGENTS.md:47-64).
function gitTry(args, cwd, env) {
  const res = spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(
    res.error, undefined,
    `\`git ${args.join(' ')}\` could not be spawned in ${cwd}: ${res.error && res.error.message}`,
  );
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function git(args, cwd, env) {
  const res = gitTry(args, cwd, env);
  assert.equal(
    res.status, 0,
    `fixture wiring: \`git ${args.join(' ')}\` in ${cwd} exited ${res.status}. A test that cannot build `
    + `its precondition FAILS LOUDLY with a named reason; it never skips quietly (NFR8)\n`
    + `--- stdout:\n${res.stdout}\n--- stderr:\n${res.stderr}`,
  );
  return res.stdout.trim();
}

// sync.sh:75 is `main_checkout() { git worktree list --porcelain | sed -n '1s/^worktree //p'; }` — the
// FIRST porcelain record is the main checkout. Reproduced here so 1.T17/1.T18/1.T19 assert their
// precondition against the same definition the subject uses, not against a path the test assumed.
const mainCheckout = (cwd, env) => git(['worktree', 'list', '--porcelain'], cwd, env)
  .split('\n')[0].replace(/^worktree /, '');

// ------------------------------------------------------------------------------------------- 1.T1
test('1.T1 (#161 FR6): sync.sh carries the mandated script shape — mode 755, `#!/usr/bin/env bash`, '
  + 'no `[[` compound command, no ANSI escapes', () => {
  assert.equal(
    fs.statSync(SYNC_SH).mode & 0o777, 0o755,
    'sync.sh must be mode 755: AGENTS.md § Shipping makes `scripts/sync.sh land` the only sanctioned '
    + 'way to land an upstream merge, and an operator invokes it directly',
  );
  assert.ok(
    SRC.startsWith('#!/usr/bin/env bash\n'),
    'sync.sh must open with the `#!/usr/bin/env bash` shebang so it resolves bash from PATH rather '
    + `than assuming /bin/bash; it opens with ${JSON.stringify(SRC.slice(0, 40))}`,
  );

  // THE REGEX IS `/\[\[(?!:)/`, NOT `/\[\[/`. The rule is "no bash COMPOUND COMMAND `[[ … ]]`", so the
  // script runs under stock macOS bash 3.2 — it is not a ban on the character pair. sync.sh contains
  // the pair TWICE, both as the POSIX character class `[[:space:]]`, at :105 (the `model:` extractor's
  // sed expression) and :110 (the step-3b alias grep). `bundle-archive.test.mjs:207`'s bare `!/\[\[/`
  // is sound only because its own subjects contain zero `[[`; cloned here it is FALSE against a
  // correct script (2 hits). This was the audit's finding C2.
  assert.equal(
    (SRC.match(/\[\[(?!:)/g) ?? []).length, 0,
    'sync.sh must use no bash `[[ … ]]` compound command — it has to run under stock macOS bash 3.2, '
    + 'where `[[` is unavailable. The two `[[:space:]]` character classes at :105 and :110 are NOT '
    + 'compound commands and are excluded by the `(?!:)` lookahead',
  );
  // Anti-vacuity control for the assertion above: the subject really does contain `[[` sequences, and
  // every one of them is a `[[:` character class. Without this, the `(?!:)` form would be
  // indistinguishable from "the file happens to contain no `[[` at all".
  assert.equal(
    (SRC.match(/\[\[/g) ?? []).length, (SRC.match(/\[\[:/g) ?? []).length,
    'every `[[` in sync.sh must be the start of a POSIX character class `[[:…:]]`; if a bare `[[` ever '
    + 'appears the counts diverge and the assertion above is the one that should be believed',
  );

  assert.equal(
    // eslint-disable-next-line no-control-regex
    (SRC.match(/\x1b\[/g) ?? []).length, 0,
    'sync.sh must emit no ANSI/colour escapes: its whole output is consumed from logs and from '
    + 'test assertions, where escape sequences corrupt the match',
  );
});

// ------------------------------------------------------------------------------------------- 1.T2
// AC1 — THE CONTROL THIS TEST EXISTS FOR. sync.sh:298 redirects the header reprint with `>&2`, unlike
// `run.sh` and `bundle-archive.sh`. `run-sh.test.mjs:69-80` asserts the same shape against
// `res.stdout`; cloned verbatim here, every `doesNotMatch` would pass VACUOUSLY against an always-empty
// string — green, proving nothing. Measured: 0 bytes on stdout, 3829 on stderr. So every `-h` claim
// below targets `res.stderr`, `res.stdout` is separately asserted `=== ''`, and the two negatives are
// additionally shown to be discriminating (the tokens exist in the source, just not in the reprint).
test('1.T2 (#161 FR6): `-h`, `--help` and `help` each exit 0 and reprint the header ON STDERR with the '
  + '`# ` prefixes stripped, writing NOTHING to stdout', () => {
  // The two negatives are only meaningful if the tokens exist in the subject at all. They do: the
  // function definition and the closing `case` terminator both live BELOW `set -euo pipefail`, i.e.
  // outside the `sed -n '2,/^set -euo pipefail/p'` range at :298. Their absence from the reprint is
  // therefore a fact about that range, not about the tokens.
  assert.ok(
    SRC.includes('cmd_land()'),
    'anti-vacuity control: `cmd_land()` must exist in sync.sh, otherwise `doesNotMatch(stderr, '
    + '/cmd_land\\(\\)/)` below proves nothing about the sed range at :298',
  );
  assert.ok(
    SRC.includes('esac'),
    'anti-vacuity control: `esac` must exist in sync.sh (the top-level dispatcher at :295-300 ends '
    + 'with one), otherwise `doesNotMatch(stderr, /esac/)` below proves nothing',
  );

  const root = mkroot('t2');
  try {
    for (const flag of ['-h', '--help', 'help']) {
      const res = runSync([flag], { cwd: root, env: fixtureEnv(root) });

      assert.equal(
        res.status, 0,
        `${flag}: asking sync.sh for help is not an error — it exits 0 (sync.sh:298 carries no exit, `
        + `unlike usage() at :64 which exits 2); got ${res.status}\n--- stderr:\n${res.stderr}`,
      );
      // AC1/FR6 — the whole point of this test.
      assert.equal(
        res.stdout, '',
        `${flag}: sync.sh:298 redirects the reprint to STDERR (\`>&2\`), so stdout must be EMPTY; `
        + 'sync.sh reserves stdout for the worktree path (:153) and the PR URL (:261/:279/:286/:291)'
        + `\n--- stdout:\n${res.stdout}`,
      );
      assert.ok(
        res.stderr.length > 0,
        `${flag}: the header must actually ARRIVE on stderr — against an empty stream every negative `
        + 'assertion below would pass vacuously, which is exactly the AC1 trap this test exists for',
      );

      assert.ok(
        res.stderr.includes('the ONLY sanctioned way to land an UPSTREAM MERGE'),
        `${flag}: the reprint must carry the header's title line, which states what the script is for`
        + `\n--- stderr:\n${res.stderr}`,
      );

      // `S1`…`S4` are the `start` pipeline steps, `L1`…`L10` the `land` ones. Matched at LINE START
      // after any indent rather than at column 0 — the header lines are indented two spaces — and with
      // a trailing `\s`, because a bare `includes('L1')` is satisfied by the `L10` line and would then
      // report a step present that is not.
      for (const tag of ['S1', 'S2', 'S3', 'S4',
        'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10']) {
        assert.match(
          res.stderr, new RegExp(`^\\s*${tag}\\s`, 'm'),
          `${flag}: the reprint must document pipeline step ${tag} — the header IS the operator-facing `
          + `contract for what each refusal point checks\n--- stderr:\n${res.stderr}`,
        );
      }
      assert.ok(
        res.stderr.includes('Env: PR_REPO_SLUG'),
        `${flag}: the reprint must document the one environment knob, \`Env: PR_REPO_SLUG\` `
        + `(sync.sh:54, read at :59)\n--- stderr:\n${res.stderr}`,
      );

      assert.doesNotMatch(
        res.stderr, /^# /m,
        `${flag}: sync.sh:298 pipes the range through \`sed 's/^# \\{0,1\\}//'\`, so no line may keep `
        + 'its `# ` comment prefix — a retained prefix means the reprint is a raw `cat`, not the sed'
        + `\n--- stderr:\n${res.stderr}`,
      );
      // THE LOAD-BEARING NEGATIVES: both tokens sit BELOW `set -euo pipefail` (:57), so their absence
      // proves the sed range `2,/^set -euo pipefail/p` still terminates there — i.e. the header comment
      // block still sits IMMEDIATELY above :57 with no code spliced between them, and the range has
      // not run away into the body of the script.
      assert.doesNotMatch(
        res.stderr, /cmd_land\(\)/,
        `${flag}: the reprint must not reach \`cmd_land()\` (sync.sh:157) — if it does, the sed range `
        + 'at :298 ran past `set -euo pipefail` and the header no longer sits directly above it'
        + `\n--- stderr:\n${res.stderr}`,
      );
      assert.doesNotMatch(
        res.stderr, /esac/,
        `${flag}: the reprint must not reach any \`esac\` — the nearest one closes the dispatcher at `
        + `:295-300, so its presence means the sed range swallowed the whole script`
        + `\n--- stderr:\n${res.stderr}`,
      );
    }

    // `-h` is a pure read: it must create nothing, not even in the cwd it was handed.
    assert.deepEqual(
      fs.readdirSync(root), [],
      'asking sync.sh for help must create nothing — the header reprint at :298 is the only statement '
      + `on that arm of the dispatcher; found ${JSON.stringify(fs.readdirSync(root))} under ${root}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------- 1.T6
// DECLARED BEFORE 1.T3-1.T5 ON PURPOSE (task group 6 step 6.1). This is the CONTROL that makes the
// whole exit taxonomy discriminating: it exhibits a non-zero exit with NO `REFUSED` line, so the other
// tests' "exit 1 + `REFUSED`" is evidence that a GUARD fired rather than a coincidence of the script
// having died somewhere. Without it a crash reads as a refusal (AC3).
test('1.T6 (#161 FR1/AC3): `land t --body-file` with no value CRASHES mid-parse — exit 1 with ZERO '
  + '`REFUSED` lines — which is what makes "exit 1 + REFUSED" a guard signal and not a coincidence', () => {
  const root = mkroot('t6');
  try {
    const res = runSync(['land', 't', '--body-file'], { cwd: root, env: fixtureEnv(root) });

    // sync.sh:162 is `--body-file) body_file="${2:-}"; shift 2 ;;`. With exactly one argument left,
    // `shift 2` returns non-zero; it is a simple command in the `case` body, so errexit (`set -euo
    // pipefail`, sync.sh:57) exits the shell right there — before ANY refusal point is reached.
    assert.equal(
      res.status, 1,
      'a `--body-file` with no value exits 1 at sync.sh:162\'s `shift 2` under errexit, not 2: the '
      + `argument parser never completes, so usage() at :165/:168 is never reached; got ${res.status}`
      + `\n--- stdout:\n${res.stdout}\n--- stderr:\n${res.stderr}`,
    );
    const refused = (res.stderr.match(/^sync\.sh: REFUSED — /mg) ?? []).length;
    assert.equal(
      refused, 0,
      'this exit-1 carries NO `REFUSED` line — it is a CRASH, not a refusal. That distinction is the '
      + 'only thing separating a fired guard from a dead shell, and asserting exit 1 alone would '
      + `conflate them; found ${refused} REFUSED line(s)\n--- stderr:\n${res.stderr}`,
    );
    // The taxonomy helper, on the same result, so the crash arm and the 29 refusal arms are judged by
    // one shared definition (harness § 4.2) rather than by two hand-rolled ones.
    assertCrash(res, 'sync.sh:162 — `shift 2` with one argument left');
    assert.doesNotMatch(
      res.stderr, /^Usage: scripts\/sync\.sh/m,
      'a crash is also distinct from a usage error: usage() at sync.sh:64 prints the `Usage:` line and '
      + `exits 2, and neither happened here\n--- stderr:\n${res.stderr}`,
    );
    assert.equal(
      res.stdout, '',
      'a crashed invocation writes nothing to stdout — sync.sh reserves stdout for the worktree path '
      + `(:153) and the PR URL (:261/:279/:286/:291)\n--- stdout:\n${res.stdout}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------- 1.T3
test('1.T3 (#161 FR5): all four `usage` exits — sync.sh:80, :165, :168, :299 — exit 2 with NO `REFUSED` '
  + 'line anywhere on stderr and empty stdout, across eight argument arms', () => {
  const root = mkroot('t3');
  try {
    const body = path.join(root, 'body.md');
    fs.writeFileSync(body, 'a body file that genuinely exists\n');
    const missing = path.join(root, 'no-such-body.md');
    assert.ok(
      !fs.existsSync(missing),
      `test setup: ${missing} must NOT exist, otherwise the :168 arm keyed on \`[ -f "$body_file" ]\` `
      + 'would pass for the wrong reason',
    );

    // Each arm names the `usage` call site it reaches. A body file that EXISTS is passed to the :165
    // arms on purpose: it removes :168 as an alternative explanation, so the only thing that can have
    // produced the exit is the unknown flag in the `case` at :161-167.
    //
    // SCOPE, STATED RATHER THAN IMPLIED: the per-arm `site` is an attribution REASONED from the source,
    // not an observation. All four call sites invoke the same `usage()` at :64, which prints one fixed
    // line, so stderr cannot say which of them fired. What IS asserted per arm is the behaviour FR5
    // cares about — exit 2, no `REFUSED`, empty stdout, and the `Usage:` line — plus, once, that the
    // arms' declared sites cover the source enumeration exactly. Narrowing each arm to one site is done
    // by construction (a body file present/absent, a flag known/unknown), which is why each arm's
    // `why` states the single condition that can have produced its exit.
    const arms = [
      { site: 80, args: ['start', 'extra'], why: '`start` takes no arguments at all: `[ $# -eq 0 ] || usage`' },
      { site: 165, args: ['land', 't', '--body-file', body, '--bogus'], why: 'an unknown flag falls to the `*)` arm of land\'s parser' },
      { site: 165, args: ['land', 't', '--body-file', body, '--force'], why: '`--force` does not exist — there is no override flag on a sync' },
      { site: 168, args: ['land'], why: 'no positional title' },
      { site: 168, args: ['land', 't'], why: 'a title but no `--body-file`' },
      { site: 168, args: ['land', 't', '--body-file', missing], why: 'a `--body-file` naming a file that does not exist' },
      { site: 299, args: ['frobnicate'], why: 'an unknown verb falls to the `*)` arm of the top-level dispatcher' },
      { site: 299, args: [], why: 'no verb at all — `case "${1:-}"` takes the `*)` arm' },
    ];

    // The arms must between them reach EVERY enumerated call site, or this test silently covers three
    // of four. The expected set is derived from the source by the same pass 1.T4 asserts, so the two
    // tests cannot drift apart.
    assert.deepEqual(
      [...new Set(arms.map((a) => a.site))].sort((x, y) => x - y), enumerateUsageSites(),
      'the eight arms must between them reach every `usage` call site the source enumeration finds — '
      + 'otherwise FR5\'s "all four `usage` exits" is a claim about a subset',
    );

    for (const { site, args, why } of arms) {
      const res = runSync(args, { cwd: root, env: fixtureEnv(root) });
      const label = `site ${site} — \`${args.join(' ') || '<no args>'}\` (${why})`;
      // exit 2, no REFUSED line, empty stdout — the taxonomy's usage third (AC3).
      assertUsage(res, label);
      // ...and it really came from usage() at :64, not from some other exit-2 path.
      assert.match(
        res.stderr, /^Usage: scripts\/sync\.sh start \| scripts\/sync\.sh land /m,
        `${label}: the exit must come from usage() at sync.sh:64, which prints the one-line synopsis; `
        + `an exit 2 without it would be some other path\n--- stderr:\n${res.stderr}`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------- 1.T4
test('1.T4 (#161 FR5/FR4): the `usage` ratchet — the call sites enumerate to exactly '
  + '{80, 165, 168, 299} over non-comment lines', () => {
  const sites = enumerateUsageSites();
  assert.deepEqual(
    sites, [80, 165, 168, 299],
    'sync.sh must have exactly four `usage` CALL sites — 80 (`start` takes no arguments), 165 (an '
    + 'unknown `land` flag), 168 (a missing title or body file) and 299 (an unknown verb). A fifth '
    + 'call site added later belongs in 1.T3\'s arm table before this ratchet may be widened, and a '
    + `deleted one means an exit path was removed; enumerated ${JSON.stringify(sites)}`,
  );

  // WHY THE REGEX IS `/\busage\b(?!\()/` AND NOT `/usage[^(]/` — measured, not asserted by taste.
  // Lines 80 and 168 END with the token (`… || usage`), so they have NO following character and the
  // naive form cannot match them: it reports {165, 299} and the ratchet would then silently permit a
  // call site to be added at either of the two it cannot see.
  assert.deepEqual(
    enumerateUsageSites(/usage[^(]/), [165, 299],
    'the naive `/usage[^(]/` form must be shown to be WRONG against this subject — it finds only 165 '
    + 'and 299 because 80 and 168 end with the token. This is why FR5 mandates the word boundary plus '
    + 'the negative lookahead',
  );

  // The comment filter is load-bearing too: the header's own prose mentions `usage` (measured: the
  // `2 = usage.` line of the exit-code paragraph), and without the filter it joins the enumeration.
  const unfiltered = enumerateUsageSites(/\busage\b(?!\()/, false);
  assert.ok(
    unfiltered.length > sites.length,
    'the comment filter must be load-bearing: the header prose mentions `usage`, so dropping the '
    + `filter has to widen the enumeration. Filtered ${JSON.stringify(sites)}, unfiltered `
    + `${JSON.stringify(unfiltered)} — if these are equal the filter is untested`,
  );
  assert.ok(
    !sites.includes(64),
    'the definition at sync.sh:64 (`usage() { … }`) must NOT enter the enumeration — the negative '
    + 'lookahead on `(` is what excludes it, and counting it would make the ratchet off by one',
  );
});

// ------------------------------------------------------------------------------------------- 1.T5
test('1.T5 (#161 FR7): `land` accepts exactly `--body-file`, `--no-merge`, `--keep-worktree` plus the '
  + 'positional title; `start` accepts nothing at all; `PR_REPO_SLUG` is the only env knob', () => {
  const root = mkroot('t5');
  try {
    const body = path.join(root, 'body.md');
    fs.writeFileSync(body, 'a body file that genuinely exists\n');

    // ---- (a) THE ACCEPTED SET parses past the `case` at :161-167 and past the :168 guard.
    // The temp root is not a git repository, so the first thing AFTER the parse — L1's
    // `git rev-parse --show-toplevel` at :172 — dies with git's own message. That message is the
    // evidence: reaching it proves the parser accepted every flag, and it is a CRASH (exit 128, no
    // `REFUSED`) rather than a usage error, so it cannot be confused with the rejected arms below.
    const accepted = [
      { args: ['land', 'a title', '--body-file', body], why: 'the positional title plus --body-file' },
      { args: ['land', 'a title', '--body-file', body, '--no-merge'], why: '--no-merge' },
      { args: ['land', 'a title', '--body-file', body, '--keep-worktree'], why: '--keep-worktree' },
      { args: ['land', 'a title', '--body-file', body, '--no-merge', '--keep-worktree'], why: 'all three together' },
    ];
    for (const { args, why } of accepted) {
      const res = runSync(args, { cwd: root, env: fixtureEnv(root) });
      const label = `accepted arm (${why})`;
      assert.doesNotMatch(
        res.stderr, /^Usage: scripts\/sync\.sh/m,
        `${label}: ${why} must be ACCEPTED by land's parser — a \`Usage:\` line means it fell to the `
        + `\`*)\` arm at sync.sh:165\n--- stderr:\n${res.stderr}`,
      );
      assert.notEqual(
        res.status, 2,
        `${label}: an accepted flag set must not produce usage()'s exit 2 (sync.sh:64)`
        + `\n--- stderr:\n${res.stderr}`,
      );
      assert.match(
        res.stderr, /not a git repository/,
        `${label}: the run must get past the parser to L1's \`git rev-parse --show-toplevel\` at `
        + 'sync.sh:172, which fails here because the temp cwd is not a repository. That failure IS the '
        + `proof the flags parsed\n--- stderr:\n${res.stderr}`,
      );
      assertCrash(res, `${label} — reached sync.sh:172 outside any repository`);
    }

    // ---- (b) THE ACCEPTED SET IS CLOSED, read off the parser itself: the option `case` labels in
    // cmd_land's `while` loop (sync.sh:160-167) are exactly three, at :162, :163 and :164, and the
    // fourth arm is `*) usage`. Enumerating them is what turns "accepts exactly three flags" into a
    // ratchet — an added label is a new option and breaks this before any behaviour test notices.
    const optionLabels = [];
    SRC_LINES.forEach((line, i) => {
      if (isComment(line)) return;
      const m = line.match(/^\s*(--[A-Za-z0-9-]+)\)/);
      if (m) optionLabels.push([i + 1, m[1]]);
    });
    assert.deepEqual(
      optionLabels,
      [[162, '--body-file'], [163, '--no-merge'], [164, '--keep-worktree']],
      'sync.sh must define exactly three long-option `case` labels — `--body-file` (:162), `--no-merge` '
      + '(:163) and `--keep-worktree` (:164) — and the parser\'s fourth arm is `*) usage` at :165. A '
      + 'fourth label is a new flag, and AGENTS.md § Shipping is explicit that none of these checks may '
      + `have an off switch; enumerated ${JSON.stringify(optionLabels)}`,
    );

    // ---- (c) THE REJECTED TABLE. Every one of these is a flag a reader might reasonably expect a
    // shipping script to have; none exists, because a guard with an off switch is how an ordinary
    // ticket bypasses a check (AGENTS.md § Shipping).
    //
    // NOTE the trap, measured: a naive `!SRC.includes('--force')` is FALSE against a correct script —
    // sync.sh:253 runs `git push -q --force-with-lease`, of which `--force` is a substring. The claim
    // is about the parser's accepted labels, so that is what is asserted.
    for (const flag of ['--force', '--no-verify', '--draft', '--skip-l6']) {
      const res = runSync(['land', 'a title', '--body-file', body, flag],
        { cwd: root, env: fixtureEnv(root) });
      assertUsage(res, `site 165 — rejected flag \`${flag}\``);
      assert.match(
        res.stderr, /^Usage: scripts\/sync\.sh start \| scripts\/sync\.sh land /m,
        `site 165 — \`${flag}\` must be refused by usage() at sync.sh:64: sync.sh has NO override, `
        + `verification-skip or draft flag, and adding one would disable a refusal point`
        + `\n--- stderr:\n${res.stderr}`,
      );
      assert.ok(
        !optionLabels.some(([, label]) => label === flag),
        `\`${flag}\` must not be one of land's option \`case\` labels — the flag set is closed, so the `
        + 'parser at :160-167 and the usage line at :64 agree that it does not exist',
      );
    }

    // ---- (d) `start` ACCEPTS NOTHING AT ALL (`[ $# -eq 0 ] || usage`, sync.sh:80).
    assertUsage(runSync(['start', 'extra'], { cwd: root, env: fixtureEnv(root) }),
      'site 80 — `start` with one argument');
    const startBare = runSync(['start'], { cwd: root, env: fixtureEnv(root) });
    assert.match(
      startBare.stderr, /not a git repository/,
      'control for site 80: `start` with NO arguments must get PAST :80 and die in `main_checkout()` '
      + '(:75/:81) because the cwd is not a repository. Without this arm, "`start extra` exits 2" '
      + `would also be satisfied by a \`start\` that always exits 2\n--- stderr:\n${startBare.stderr}`,
    );
    assertCrash(startBare, 'site 80 control — `start` with no arguments, outside any repository');

    // ---- (e) `PR_REPO_SLUG` IS THE ONLY ENV KNOB. Enumerated from the source rather than asserted by
    // reading: collect every UPPERCASE variable reference on a non-comment line. `SLUG` and
    // `UPSTREAM_SLUG` are assigned by the script itself (:59, :60) and `BASH_SOURCE` is a bash
    // builtin, so `PR_REPO_SLUG` at :59 is the only value the operator's environment supplies.
    const refs = new Map();
    SRC_LINES.forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(/\$\{?([A-Z][A-Z0-9_]*)\b/g)) {
        if (!refs.has(m[1])) refs.set(m[1], []);
        refs.get(m[1]).push(i + 1);
      }
    });
    assert.deepEqual(
      [...refs.keys()].sort(), ['BASH_SOURCE', 'PR_REPO_SLUG', 'SLUG', 'UPSTREAM_SLUG'],
      'sync.sh may reference only these uppercase variables. A new one is a new environment seam and '
      + 'has to be justified before this list is widened — every skip/override knob this suite refuses '
      + `to find would arrive as exactly such a reference; found ${JSON.stringify([...refs.keys()])}`,
    );
    assert.deepEqual(
      refs.get('PR_REPO_SLUG'), [59],
      'the ONLY read of `PR_REPO_SLUG` is sync.sh:59 — `SLUG="${PR_REPO_SLUG:-robmar-net/maister}"`. '
      + 'Both NFR9 locks are keyed on that single read, so a second one would be a second seam',
    );
    assert.match(
      SRC_LINES[58], /^SLUG="\$\{PR_REPO_SLUG:-robmar-net\/maister\}"$/,
      'sync.sh:59 must read `PR_REPO_SLUG` with the real repository as its DEFAULT — that default is '
      + `precisely why every spawn in this suite must override it (NFR9a); line 59 is `
      + `${JSON.stringify(SRC_LINES[58])}`,
    );
    assert.match(
      SRC_LINES[59], /^UPSTREAM_SLUG="SkillPanel\/maister"$/,
      'sync.sh:60 hardcodes the upstream slug with NO environment override — the fetch target cannot '
      + `be redirected, which is what makes upstream read-only by construction; line 60 is `
      + `${JSON.stringify(SRC_LINES[59])}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------- 1.T7
// THE CENSUS (§ 5), declared as DATA and keyed on the LINE NUMBER. Keying on the `fail` message string
// is FORBIDDEN (§ 5.2) and the test below demonstrates why: 36 sites collapse to 33 distinct strings,
// so a string-keyed census would report 33 of 33 covered with three sites entirely untested — the exact
// silent green AGENTS.md:47-64 exists to prevent.
//
// BUCKET A — refusal-covered, 29 sites. Each value names the test id(s) that DRIVE that site. The ids
// are spec § 3.1/§ 3.5's planned ids; most live in the other three modules, so their EXISTENCE is
// verified by the acceptance pass over the whole PR, not from inside this file (`node --test` gives
// each module its own process and this one cannot see the others' declarations).
const REFUSAL_MAP = new Map([
  [86, '1.T11, 1.T13, 1.T14'], [87, '1.T15'], [88, '1.T16'],
  [112, '3.T5, 3.T7'], [121, '3.T6'],
  [173, '1.T17'], [175, '1.T18, 1.T19'], [176, '1.T20'],
  [180, '1.T20'], [181, '1.T20'], [189, '1.T20'],
  [195, '3.T1'], [197, '3.T2'], [200, '3.T3'],
  [204, '2.T4'], [213, '2.T5'], [216, '2.T1'], [220, '3.T4'],
  [225, '4.T1'], [226, '4.T1'], [227, '4.T1'], [230, '4.T2(b)'],
  [237, '4.T3(a)'], [240, '4.T3(b)'], [246, '4.T4(a)'], [248, '4.T4(b)'],
  [253, '4.T5(b)'], [255, '4.T5(a)'], [258, '4.T5(c)'],
]);

// BUCKET B — defect-pinned, 1 site. Membership requires a DEMONSTRATED unreachability, not merely a
// filed issue (§ 5.3, § 5.4 assertion 6): held to exactly bucket C's standard so it cannot become a
// soft landing place for a site someone found inconvenient to test.
const DEFECT_MAP = new Map([
  [229, {
    test: '4.T2(a)',
    issue: '#166',
    demonstration:
      'sync.sh:228-229 is `node --test <glob> >/dev/null 2>&1 || { node --test <glob> 2>&1 | tail -30 '
      + '>&2; fail "L2 unit suite failed"; }`. The brace group is the LAST member of the `||` list, so '
      + 'errexit is not suspended inside it; pipefail makes the diagnostic re-run pipeline carry '
      + 'node\'s non-zero status, and the shell exits there before `fail` runs. Observed: exit 1, the '
      + 'node failure dump on stderr, ZERO `REFUSED` lines. Isolated by two controls: neutralising the '
      + 'pipeline (`{ node --test … || true; } | tail -30 >&2`) makes `fail` fire, and removing '
      + 'pipefail while keeping the pipe also makes it fire — errexit and pipefail are JOINTLY '
      + 'load-bearing. `pr.sh:117` carries the identical construct. When #166 is fixed this site moves '
      + 'into REFUSAL_MAP and 4.T2(a) goes red, which is the correct signal, not a regression.',
  }],
]);

// BUCKET C — excluded, 6 sites. Every reason LEADS WITH THE STRUCTURAL GATE: `num` is assigned at
// sync.sh:259 from the output of a SUCCESSFUL `gh pr create` at :258, and nothing past that point can
// run without it. `--no-merge` does not help — it is evaluated at :261, after the pushes and after 258.
// Site 258 itself is NOT here: it is hermetically reachable and 4.T5(c) drives it.
const EXCLUSIONS = new Map([
  [266, 'behind a successful `gh pr create` at :258 — `num` is assigned at :259 from its output, so the '
    + 'check-poll loop needs `gh`, auth and a real PR. (It also polls 30 x 10 s, but that is a cost, '
    + 'not the reason.)'],
  [269, 'behind a successful `gh pr create` at :258 — needs `gh pr checks --watch --fail-fast` against '
    + 'a real PR that :258 created'],
  [273, 'behind a successful `gh pr create` at :258 — needs `gh pr merge` against a real unmergeable PR'],
  [274, 'behind a successful `gh pr create` at :258 and then a successful `gh pr merge` at :273'],
  [276, 'behind a successful `gh pr create` at :258 and then a successful `gh pr merge` at :273 — the '
    + 'post-merge ancestor assertion cannot run before the merge exists'],
  [288, 'behind a successful `gh pr create` at :258 and the whole L10 block, plus `keep=0` and every '
    + '`reports/<ts>` bundle passing `bundle-archive.sh --verify`'],
]);

test('1.T7 (#161 FR4): the three-bucket line-keyed `fail`-site census — 36 sites, 29 refusal-covered, '
  + '1 defect-pinned, 6 excluded, disjoint, and their union is the enumeration', () => {
  const enumerated = enumerateFailSites();

  // --- assertion 1
  assert.equal(
    enumerated.length, 36,
    'sync.sh must hold exactly 36 `fail "` sites on non-comment lines. This is the denominator of '
    + 'every coverage claim in #161; if it moves, the buckets below are stale and one of them has to '
    + `absorb the change deliberately. Enumerated ${JSON.stringify(enumerated)}`,
  );

  const refusal = new Set(REFUSAL_MAP.keys());
  const defect = new Set(DEFECT_MAP.keys());
  const excluded = new Set(EXCLUSIONS.keys());

  // --- assertion 4 (sizes)
  assert.equal(
    refusal.size, 29,
    `the refusal bucket must hold exactly FR1's 29 sites; it holds ${refusal.size}`,
  );
  assert.deepEqual(
    [...refusal].sort((a, b) => a - b),
    [86, 87, 88, 112, 121, 173, 175, 176, 180, 181, 189, 195, 197, 200, 204, 213, 216, 220,
      225, 226, 227, 230, 237, 240, 246, 248, 253, 255, 258],
    'the refusal bucket must be exactly FR1\'s enumerated list — a site silently swapped for another '
    + 'would keep the count at 29 while changing what is covered',
  );
  assert.equal(
    defect.size, 1,
    `the defect bucket must hold exactly one site (229); it holds ${defect.size}. A second entry needs `
    + 'its own demonstrated unreachability and its own issue, per § 5.3',
  );
  assert.deepEqual([...defect], [229], 'the sole defect-pinned site is sync.sh:229 (issue #166)');
  assert.equal(
    excluded.size, 6,
    `the exclusion list must hold exactly six sites; it holds ${excluded.size}. It is a RATCHET, not `
    + 'an amnesty: growing it requires a true impossibility, and if a `gh` seam is ever added rows '
    + 'leave it and the count moves the right way on its own',
  );
  assert.deepEqual(
    [...excluded].sort((a, b) => a - b), [266, 269, 273, 274, 276, 288],
    'the excluded sites are exactly 266, 269, 273, 274, 276 and 288 — six, and notably NOT 258, which '
    + 'is hermetically reachable and is driven by 4.T5(c)',
  );

  // --- assertion 2 (pairwise disjoint)
  for (const [aName, a, bName, b] of [
    ['refusal', refusal, 'defect', defect],
    ['refusal', refusal, 'excluded', excluded],
    ['defect', defect, 'excluded', excluded],
  ]) {
    const both = [...a].filter((n) => b.has(n));
    assert.deepEqual(
      both, [],
      `the ${aName} and ${bName} buckets must be disjoint — a site claimed as both covered and `
      + `excused is the shape that lets a gap hide in plain sight; overlap: ${JSON.stringify(both)}`,
    );
  }

  // --- assertion 3 (set equality, BOTH directions)
  const union = [...new Set([...refusal, ...defect, ...excluded])].sort((a, b) => a - b);
  const missing = enumerated.filter((n) => !refusal.has(n) && !defect.has(n) && !excluded.has(n));
  assert.deepEqual(
    missing, [],
    'every enumerated `fail` site must belong to exactly one bucket. A site added to sync.sh later '
    + 'belongs to none, so this goes red until someone TESTS it, PINS it as a defect, or JUSTIFIES '
    + `excluding it; unclassified: ${JSON.stringify(missing)}`,
  );
  const stale = union.filter((n) => !enumerated.includes(n));
  assert.deepEqual(
    stale, [],
    'every bucketed line number must still be a `fail` site in sync.sh. The reverse direction matters '
    + 'as much as the forward one: a REMOVED or MOVED site would otherwise leave a stale map claiming '
    + `coverage of a line that no longer guards anything; stale: ${JSON.stringify(stale)}`,
  );
  assert.deepEqual(
    union, enumerated,
    'refusal + defect + excluded must equal the enumeration exactly, as sets and as sorted lists',
  );

  // --- assertion 5 (exclusion reasons)
  for (const [site, reason] of EXCLUSIONS) {
    assert.ok(
      typeof reason === 'string' && reason.trim().length > 0,
      `site ${site}: an exclusion needs a reason, not an empty slot`,
    );
    assert.ok(
      reason.includes('gh pr create'),
      `site ${site}: the exclusion reason must name the structural gate — a SUCCESSFUL \`gh pr create\` `
      + 'at sync.sh:258, whose output assigns `num` at :259. A reason that does not name an '
      + `impossibility is a cost, and FR4 forbids excluding on cost; reason was: ${reason}`,
    );
  }

  // --- assertion 6 (bucket B's membership requirement)
  for (const [site, entry] of DEFECT_MAP) {
    assert.match(
      entry.issue ?? '', /^#\d+$/,
      `site ${site}: the defect entry must cite a filed issue number (#166 for sync.sh:229)`,
    );
    const demo = entry.demonstration ?? '';
    assert.ok(
      demo.trim().length > 0,
      `site ${site}: a filed issue number ALONE does not admit a site to the defect bucket — § 5.3's `
      + 'neutralisation experiment and its result must be recorded here, or bucket B becomes a soft '
      + 'landing place for anything inconvenient to test',
    );
    for (const token of ['errexit', 'pipefail', '|| true', 'ZERO `REFUSED`']) {
      assert.ok(
        demo.includes(token),
        `site ${site}: the demonstration must record ${JSON.stringify(token)} — the unreachability was `
        + 'isolated by showing errexit and pipefail are JOINTLY load-bearing and that neutralising the '
        + 'pipeline makes `fail` fire. A record missing either half would not establish the cause',
      );
    }
  }

  // --- assertion 7 (every refusal-map AND defect-map value names a non-empty test id)
  for (const [site, tests] of REFUSAL_MAP) {
    assert.ok(
      typeof tests === 'string' && tests.trim().length > 0,
      `site ${site}: the refusal map must bind the site to a test id, never to an empty string`,
    );
    assert.match(
      tests, /\b\d\.T\d+/,
      `site ${site}: the refusal map value must NAME a test id in the house \`<module>.T<n>\` form — `
      + 'prose, a TODO or a bare "covered" would let FR1\'s "bound to a test id present in this PR" '
      + `pass on nothing; value was ${JSON.stringify(tests)}`,
    );
  }
  for (const [site, entry] of DEFECT_MAP) {
    assert.match(
      entry.test ?? '', /\b\d\.T\d+/,
      `site ${site}: the defect map value must name a test id too (4.T2(a) pins sync.sh:229) — the `
      + 'defect bucket is held to the refusal bucket\'s standard here as well',
    );
  }

  // --- § 5.2, demonstrated rather than asserted by taste: WHY THE KEY IS THE LINE NUMBER.
  const byMessage = new Map();
  for (const site of enumerated) {
    const line = SRC_LINES[site - 1];
    const msg = line.slice(line.indexOf('fail "') + 'fail "'.length);
    if (!byMessage.has(msg)) byMessage.set(msg, []);
    byMessage.get(msg).push(site);
  }
  assert.equal(
    byMessage.size, 33,
    `the 36 sites carry only ${byMessage.size} distinct \`fail\` message strings (measured: 33). This `
    + 'is why § 5.2 FORBIDS keying the census on the message: a string-keyed census would report 33 of '
    + '33 covered while three sites went entirely untested',
  );
  const duplicated = [...byMessage.values()].filter((v) => v.length > 1)
    .map((v) => v.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(
    duplicated, [[86, 189], [87, 180], [253, 255]],
    'the three duplicated `fail` strings must be exactly these site pairs — `no remote points at '
    + 'upstream …` (86/189), `no remote points at ${SLUG}` (87/180) and `push refused` (253/255). Each '
    + 'pair is two DIFFERENT guards in two different commands, which is precisely what a string key '
    + 'would collapse',
  );
});

// ------------------------------------------------------------------------------------------- 1.T8
// THE CONTROL COMES FIRST (task group 7 step 7.1). A probe that cannot fail proves nothing, so before
// any positive claim this test hands the probing logic a PATH that DOES hold an executable `gh` and
// confirms it reports it — `assertNoGh(pathStr)` takes the PATH as an optional argument for exactly
// this purpose. Both halves of the probe are shown falsifiable: the `gh`-absence half and the
// toolchain-resolves half, because a probe whose second half silently never fires would let the
// filter take `git` away with `gh` and report success.
//
// NO DIRECTORY WHITELIST APPEARS ANYWHERE — not here, not in the harness — and that is a requirement,
// not a preference. `run-sh.test.mjs:47-51` whitelists `[dirname(process.execPath), '/usr/bin',
// '/bin']` with a comment justifying it for `copilot`, which "ships only in /usr/local/bin here".
// That justification does NOT transfer to `gh`: measured, `command -v` resolves `gh` and `node` BOTH
// under /opt/homebrew/bin on this machine, and on Linux `gh` is an apt package in /usr/bin beside
// `git`. A whitelist would therefore either admit `gh` or delete the toolchain depending on the host.
// NFR9b FILTERS instead, and the last two assertions below prove it is a filter and not a whitelist:
// every inherited directory with no `gh` survives, and no directory is INVENTED (no shim, no symlink,
// no temp directory — hence nothing to create or tear down, which is what reconciles NFR9 with NFR7).
test('1.T8 (#161 NFR9): the derived PATH provably holds no executable `gh` while `git`, `make`, `bash` '
  + 'and `node` all still resolve — and the probe is first shown to be CAPABLE of failing', () => {
  const root = mkroot('t8');
  try {
    // ---- (a) THE PROBE CAN FAIL, half 1: a directory holding an executable `gh` must be reported.
    const withGh = path.join(root, 'bin-with-gh');
    fs.mkdirSync(withGh, { recursive: true });
    const plantedGh = path.join(withGh, 'gh');
    fs.writeFileSync(plantedGh, '#!/usr/bin/env bash\necho "planted gh — never reachable" >&2\nexit 1\n');
    fs.chmodSync(plantedGh, 0o755);
    assert.ok(
      holdsExe(withGh, 'gh'),
      'control setup: the planted `gh` must actually be executable, otherwise the assertion below '
      + 'would pass because the probe found nothing rather than because it rejected something',
    );
    assert.throws(
      () => assertNoGh(withGh),
      /no directory of the derived PATH may hold an executable `gh`/,
      'CONTROL: handed a PATH that DOES hold an executable `gh`, `assertNoGh` must THROW. Without '
      + 'this the positive assertions below are indistinguishable from a probe that can never fail — '
      + 'which is the whole failure mode NFR9b exists to rule out',
    );

    // ---- (b) THE PROBE CAN FAIL, half 2: a PATH with no `gh` but no toolchain either must also be
    // rejected. This is the half that matters on a host where `gh` sits beside `node` or `git`: the
    // filter takes the tool with it, and NFR8 requires that to be LOUD rather than a silent pass.
    const emptyDir = path.join(root, 'bin-empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    assert.throws(
      () => assertNoGh(emptyDir),
      /the derived PATH no longer resolves `git`/,
      'CONTROL: a PATH holding no `gh` is not sufficient — `assertNoGh` must also THROW when the '
      + 'toolchain has gone, so that a host where the gh filter removes `git`/`node` fails loudly '
      + '(NFR8) instead of quietly reporting a clean PATH it can no longer run anything with',
    );

    // ---- (c) THE PROBE KEYS ON EXECUTABILITY, not on the name. A non-executable file called `gh`
    // cannot be run, so it must NOT trip the probe — otherwise `holdsExecutable` is really
    // `existsSync` and the lock would be over-strict for the wrong reason.
    const inertDir = path.join(root, 'bin-inert-gh');
    fs.mkdirSync(inertDir, { recursive: true });
    fs.writeFileSync(path.join(inertDir, 'gh'), 'not executable, not a program\n');
    fs.chmodSync(path.join(inertDir, 'gh'), 0o644);
    assert.doesNotThrow(
      () => assertNoGh([inertDir, NO_GH_PATH].join(path.delimiter)),
      'a NON-executable file named `gh` must not trip the probe: NFR9b probes for the BINARY '
      + '(`accessSync(..., X_OK)`), and a file that cannot be executed cannot run a `gh pr create`',
    );

    // ---- (d) THE POSITIVE ASSERTIONS, over the PATH every spawn in this suite actually receives.
    const dirs = NO_GH_PATH.split(path.delimiter).filter((d) => d.length > 0);
    assert.ok(
      dirs.length > 0,
      'anti-vacuity: the derived PATH must contain at least one directory, otherwise "for every `d` '
      + `in the derived PATH …" below is vacuously true; NO_GH_PATH was ${JSON.stringify(NO_GH_PATH)}`,
    );
    for (const d of dirs) {
      assert.throws(
        () => fs.accessSync(path.join(d, 'gh'), fs.constants.X_OK),
        `NFR9b: ${path.join(d, 'gh')} must NOT be an executable — it is on the PATH of every spawn in `
        + 'this suite, and a `land` spawn that reaches sync.sh:258 would then run a real `gh pr '
        + 'create`. The lock is that the binary is unreachable, not that the test avoids that line',
      );
    }
    for (const tool of ['git', 'make', 'bash', 'node']) {
      assert.ok(
        dirs.some((d) => holdsExe(d, tool)),
        `NFR9b/NFR8: the derived PATH must still resolve \`${tool}\` — sync.sh calls all four, so a `
        + 'PATH the gh filter has emptied of one of them would make every fixture test fail for a '
        + `reason that has nothing to do with the subject. Derived PATH: ${NO_GH_PATH}`,
      );
    }

    // ---- (e) IT IS A FILTER, NOT A WHITELIST — the structural claim, asserted rather than asserted
    // by comment. Every inherited directory that holds no `gh` must have SURVIVED: a whitelist would
    // drop gh-free directories too, and this is what would catch one being introduced later.
    const inherited = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d.length > 0);
    const droppedThoughGhFree = inherited.filter((d) => !dirs.includes(d) && !holdsExe(d, 'gh'));
    assert.deepEqual(
      droppedThoughGhFree, [],
      'NFR9b: the derived PATH must be the inherited PATH MINUS the directories holding a `gh`, so a '
      + 'gh-free inherited directory may never be dropped. A non-empty list here means the '
      + 'construction has become a whitelist — host-dependent, and forbidden by NFR9 and § 8.1: '
      + `${JSON.stringify(droppedThoughGhFree)}`,
    );

    // ---- (f) NOTHING IS INVENTED. Every kept directory is either inherited or node's own install
    // directory, which NFR9 prepends because the filter would otherwise remove node together with
    // `gh`. Measured on this machine: that directory is /opt/homebrew/Cellar/node/25.2.1/bin and
    // holds exactly `node`, `npm`, `npx` — no `gh` — so it survives its own filter. THERE IS NO SHIM:
    // no symlink and no temp directory, therefore nothing with a lifecycle for NFR7 to tear down.
    const nodeBin = path.dirname(process.execPath);
    assert.deepEqual(
      dirs.filter((d) => d !== nodeBin && !inherited.includes(d)), [],
      'NFR9b: the derived PATH may contain no directory that is neither inherited nor node\'s own '
      + 'install directory. A third source would be a shim — and a shim needs an owner and a '
      + 'teardown, which § 9.1 removed on purpose',
    );
    assert.ok(
      holdsExe(nodeBin, 'gh') || dirs[0] === nodeBin,
      'NFR9b: node\'s own install directory must be PREPENDED to the candidate list — unless it holds '
      + 'a `gh` itself, in which case the filter correctly takes it and assertion (d) above is the '
      + `one that speaks. First derived entry was ${JSON.stringify(dirs[0])}, node's is `
      + `${JSON.stringify(nodeBin)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------- 1.T9
// NFR9 LOCK (a), the half a PATH filter cannot provide. DEMONSTRATED, NOT THEORISED (§ 9.1): with
// `PR_REPO_SLUG` unset and revision 1's fixture shape (fork bare at
// `<root>/github.com/robmar-net/maister.git`), an argv-recording stub named `gh` captured exactly what
// the script tried to run — no network was contacted:
//
//   pr / create / --repo / robmar-net/maister / --head / sync/upstream-2.2.4 / --base / master
//      / --title / t / --body-file / <root>/body.md
//
// So setting the variable is NOT the whole requirement: `remote_for` (sync.sh:67-74) resolves the push
// target from the URL STRING, so the fixture's fork-bare PATH must embed the same fixture slug. Lock
// (b) alone is a property of the host, not of the test — an Intel-Mac Homebrew puts `node` and `gh`
// both in /usr/local/bin, and ubuntu-latest ships `gh` in /usr/bin beside `git`.
test('1.T9 (#161 NFR9a): the slug sync.sh would hand `gh pr create` is the FIXTURE slug and never '
  + '`robmar-net/maister` — the spawn env sets it AND the fork-bare path embeds the same string', () => {
  // ---- (a) the two source lines the lock is keyed on, read rather than assumed.
  assert.match(
    SRC_LINES[58], /^SLUG="\$\{PR_REPO_SLUG:-robmar-net\/maister\}"$/,
    'sync.sh:59 must read `PR_REPO_SLUG` with the REAL repository as its default — that default is '
    + `exactly why every spawn here overrides it; line 59 is ${JSON.stringify(SRC_LINES[58])}`,
  );
  assert.ok(
    SRC_LINES[257].includes('gh pr create --repo "$SLUG"'),
    'sync.sh:258 must be the `gh pr create --repo "$SLUG"` call — it is the single boundary at which '
    + `a wrong slug would reach a real repository; line 258 is ${JSON.stringify(SRC_LINES[257])}`,
  );

  // ---- (b) the env EVERY spawn in this suite is built with, checked through `fixtureEnv` itself.
  const probeRoot = mkroot('t9');
  try {
    const env = fixtureEnv(probeRoot);
    assert.equal(
      env.PR_REPO_SLUG, FIXTURE_SLUG,
      '`fixtureEnv` must set `PR_REPO_SLUG` on every spawn — sync.sh:59 falls back to the real '
      + `repository when it is unset, which is the captured-argv case above; got `
      + `${JSON.stringify(env.PR_REPO_SLUG)}`,
    );
    assert.notEqual(
      env.PR_REPO_SLUG, REAL_SLUG,
      `the fixture slug must not BE the real one: ${REAL_SLUG} is upstream-facing and a live `
      + '`gh pr create` against it is the one outcome NFR9 exists to make impossible (AGENTS.md:13-24)',
    );

    // ---- (c) the second half of lock (a): the fork bare's PATH embeds that same slug, because
    // `remote_for` resolves the push target from the URL string. Demonstrated on a real fixture.
    const f = makeFixture({ topology: 'D-at-step-3' });
    try {
      assert.ok(
        f.forkBare.includes(`github.com/${FIXTURE_SLUG}`),
        'NFR9a: the fork bare\'s path must embed `github.com/<FIXTURE_SLUG>` — sync.sh:71 matches the '
        + 'URL STRING, so this path is what makes `remote_for "$SLUG"` resolve the fixture\'s fork and '
        + `not something else; forkBare was ${f.forkBare}`,
      );
      assert.ok(
        !f.forkBare.includes(REAL_SLUG),
        `NFR9a: the fork bare's path must NOT contain ${REAL_SLUG}. This was revision 1's shape, and `
        + 'it is what the captured argv above shows reaching the real repository',
      );
      // The wiring, not just the path: the remote the script will resolve really is that bare repo.
      assert.equal(
        git(['remote', 'get-url', 'aaa-fork'], f.main, f.env), f.forkBare,
        'NFR9a: the fork remote in the fixture must point AT that bare path — the slug lock is only '
        + 'worth anything if the remote sync.sh resolves is the one carrying the fixture slug',
      );
      assert.ok(
        !git(['remote', '-v'], f.main, f.env).includes(REAL_SLUG),
        `NFR9a: no remote in the fixture may name ${REAL_SLUG}; \`remote_for\` iterates ALL remotes, `
        + 'so a single stray one would be enough for sync.sh:258 to name the real repository',
      );
    } finally {
      f.cleanup();
    }
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------- 1.T10
// FR8/D7 — THE HEADER OVER-CLAIMS, pinned as a documentation defect (issue #165, task group 7 step 7.3).
//
// EVERY ASSERTION BELOW IS AGAINST PARSED, LINE-KEYED STRUCTURE, NEVER AGAINST SUBSTRING PRESENCE, and
// that is a measured requirement rather than a stylistic one. The obvious form of this test — "flag X
// does not appear in the source" — is FALSE against a correct script: `--force` IS present, because
// sync.sh:253 runs `git push -q --force-with-lease`, of which it is a substring. Arm (d) below asserts
// that inverted control explicitly, so the reason this test is written structurally is itself pinned
// and cannot be "simplified" back into the trap by a later reader.
test('1.T10 (#161 FR8/D7): `--no-merge` skips SIX refusal points (266, 269, 273, 274, 276, 288) and '
  + '`--keep-worktree` skips 288, contradicting sync.sh:37\'s "none can be skipped by flag" (#165)', () => {
  // ---- (a) THE FLAG → VARIABLE → EARLY-RETURN CHAIN, read off the parser and the two guards.
  assert.match(
    SRC_LINES[162], /^\s*--no-merge\) merge=0; shift ;;$/,
    'sync.sh:163 must be land\'s `--no-merge` arm setting `merge=0` — the whole pin is that this flag '
    + `reaches an early \`return 0\`; line 163 is ${JSON.stringify(SRC_LINES[162])}`,
  );
  assert.match(
    SRC_LINES[163], /^\s*--keep-worktree\) keep=1; shift ;;$/,
    'sync.sh:164 must be land\'s `--keep-worktree` arm setting `keep=1`; line 164 is '
    + `${JSON.stringify(SRC_LINES[163])}`,
  );
  const noMergeGuards = linesMatching(/\[ "\$merge" -eq 0 \]/);
  const keepGuards = linesMatching(/\[ "\$keep" -eq 1 \]/);
  assert.deepEqual(
    noMergeGuards, [261],
    'the `--no-merge` early return must be tested at exactly sync.sh:261. Its LINE NUMBER is the whole '
    + `argument — everything numerically after it is what the flag skips; found `
    + `${JSON.stringify(noMergeGuards)}`,
  );
  assert.deepEqual(
    keepGuards, [279],
    `the \`--keep-worktree\` early return must be tested at exactly sync.sh:279; found `
    + `${JSON.stringify(keepGuards)}`,
  );
  for (const [site, flag] of [[261, '--no-merge'], [279, '--keep-worktree']]) {
    assert.ok(
      SRC_LINES[site - 1].includes('return 0'),
      `sync.sh:${site} must \`return 0\` — that is what makes \`${flag}\` a SKIP rather than a `
      + `refusal: the run ends successfully with the later guards never evaluated; line ${site} is `
      + `${JSON.stringify(SRC_LINES[site - 1])}`,
    );
  }

  // ---- (b) 261 SITS AFTER THE PUSHES AND AFTER `gh pr create`. This is the ordering fact that makes
  // the exclusion list in 1.T7 correct and `--no-merge` irrelevant to it: the flag cannot lower the
  // `gh`-dependent ceiling, because it is not consulted until after 258 has already run.
  assert.ok(
    SRC_LINES[252].includes('git push') && SRC_LINES[254].includes('git push'),
    'sync.sh:253 and :255 must be the two `git push` commands (the --force-with-lease arm and the '
    + `-u arm); they are ${JSON.stringify(SRC_LINES[252])} and ${JSON.stringify(SRC_LINES[254])}`,
  );
  assert.ok(
    SRC_LINES[257].includes('gh pr create'),
    `sync.sh:258 must be the \`gh pr create\`; line 258 is ${JSON.stringify(SRC_LINES[257])}`,
  );
  assert.deepEqual(
    [253, 255, 258].filter((n) => n >= noMergeGuards[0]), [],
    'the pushes (253, 255) and `gh pr create` (258) must all precede the `--no-merge` return at 261. '
    + 'If any of them came after it, `--no-merge` would lower the structural `gh` ceiling and 1.T7\'s '
    + 'six-site exclusion list would be wrong for a different reason than the one it states',
  );

  // ---- (c) WHAT EACH FLAG ACTUALLY SKIPS, derived from the census rather than listed by hand.
  const failSites = enumerateFailSites();
  const skippedByNoMerge = failSites.filter((n) => n > noMergeGuards[0]);
  const skippedByKeep = failSites.filter((n) => n > keepGuards[0]);
  assert.deepEqual(
    skippedByNoMerge, [266, 269, 273, 274, 276, 288],
    'D7: `--no-merge` must remove exactly these SIX refusal points — the check-poll timeout (266), the '
    + 'red-check refusal (269), the merge failure (273), the main-checkout fast-forward (274), the '
    + 'post-merge ancestor assertion (276) and the archive-verified worktree removal (288). Derived '
    + `from § 5.1's enumeration, not listed by hand; got ${JSON.stringify(skippedByNoMerge)}`,
  );
  assert.equal(
    skippedByNoMerge.length, 6,
    `FR8/D7 states SIX removed refusal points; the enumeration yields ${skippedByNoMerge.length}`,
  );
  assert.deepEqual(
    skippedByKeep, [288],
    'D7: `--keep-worktree` must remove exactly one refusal point, 288 — the `worktree remove` failure '
    + `— and it lies after the return at 279; got ${JSON.stringify(skippedByKeep)}`,
  );

  // ---- (d) THE HEADER CLAIMS THE OPPOSITE. This is the defect, at sync.sh:37, filed as #165: a
  // documentation defect rather than a bug, because both flags are documented and intended — it is the
  // header's absolute phrasing that is untrue, and an operator reading line 37 would believe the
  // L9/L10 guards cannot be bypassed when two flags bypass seven of them between them.
  assert.ok(
    SRC_LINES[36].includes('every step is a refusal point and none can be skipped by flag'),
    'sync.sh:37 must still carry the claim this test contradicts. If the wording is ever corrected, '
    + 'THIS assertion is the one that goes red first, and #165 can then be closed and the test '
    + `retired deliberately rather than silently; line 37 is ${JSON.stringify(SRC_LINES[36])}`,
  );

  // ---- (e) THE INVERTED CONTROL for the trap named in this test's header comment. A reader who
  // "simplifies" any assertion above into `!SRC.includes('--force')` gets a test that fails against a
  // CORRECT script. Asserting the substring's presence is what keeps that fact on the record.
  assert.ok(
    SRC.includes('--force'),
    'the inverted control for FR7/FR8: `--force` MUST be found in sync.sh, as part of '
    + '`--force-with-lease` at :253. Any "flag X is absent from the source" assertion is therefore '
    + 'unsound against this subject, which is why every claim above is keyed on PARSED STRUCTURE — '
    + 'the option `case` labels (1.T5) and the guard line numbers (here)',
  );
  assert.ok(
    !SRC.includes('--no-merge-') && linesMatching(/^\s*--no-merge\)/).length === 1,
    'the `--no-merge` label must be exactly one `case` arm and not a prefix of a longer flag — the '
    + 'symmetric form of the `--force` trap, checked so the two flags this test reasons about cannot '
    + 'themselves be substrings of something else',
  );
});

// ------------------------------------------------------------------------------------------- 1.T13
// DECLARED BEFORE 1.T11/1.T12 ON PURPOSE (task group 8 step 8.1), for the same reason 1.T6 precedes
// 1.T3: it is the CONTROL, and FR9's obvious control is FALSE. The intuitive negative control —
// "change the URL's scheme and the lookup fails" — does not work, because sync.sh:71 is
//   case "$url" in *"github.com/${want}"*|*"github.com:${want}"*)
// an UNANCHORED SUBSTRING GLOB over the URL string with no scheme check and no host resolution. 1.T12
// shows a `file://` URL resolving fine. The only thing that actually breaks the match is removing the
// `github.com/` substring, which is what this test does.
//
// IT MOVES THE *UPSTREAM* BARE, NOT THE FORK, and that distinction is load-bearing (§ 2 FR9, verified):
// arms (a)/(b) are keyed on `github.com/<FIXTURE_SLUG>` — the FORK — so the same move applied to the
// fork bare fires 87 from `start` and 180 from `land`, and NEVER 86. Site 86 is the upstream lookup.
test('1.T13 (#161 FR9 arm c): moving the UPSTREAM bare out of a `github.com/` path makes site 86 fire '
  + '— the real negative control, because the glob is textual and the scheme is irrelevant', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    // Move the bare somewhere whose path still names the upstream SLUG but no longer contains
    // `github.com/`. Keeping `SkillPanel/maister` in the new path is deliberate: it isolates the
    // `github.com/` substring as the thing the match depends on, rather than the slug.
    const moved = path.join(f.root, 'not-a-forge-path', 'SkillPanel', 'maister.git');
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(f.upBare, moved);
    git(['remote', 'set-url', 'zzz-upstream', moved], f.main, f.env);

    // --- the preconditions, asserted BEFORE the spawn so a pass cannot come from the wrong shape.
    assert.ok(
      moved.includes('SkillPanel/maister') && !moved.includes('github.com/'),
      'control setup: the moved path must still contain the upstream slug `SkillPanel/maister` but no '
      + `longer contain \`github.com/\` — otherwise this test does not isolate the substring the glob `
      + `at sync.sh:71 keys on; the path is ${moved}`,
    );
    assert.equal(
      git(['remote', 'get-url', 'zzz-upstream'], f.main, f.env), moved,
      'control setup: the upstream remote must actually point at the moved path — a `set-url` that '
      + 'silently did nothing would leave the original URL and this test would assert the opposite',
    );
    assert.ok(
      git(['remote', 'get-url', 'aaa-fork'], f.main, f.env).includes(`github.com/${FIXTURE_SLUG}`),
      'control setup: the FORK remote must be UNTOUCHED and still carry `github.com/<FIXTURE_SLUG}`. '
      + 'That is what makes the refusal below specifically the UPSTREAM lookup (86) and not the fork '
      + 'lookup (87) — the two `fail` strings differ, and 1.T7 records that 86 and 189 share one',
    );

    const res = runSync(['start'], { cwd: f.main, env: f.env });

    // § 6.1, site 86, reproduced verbatim.
    assertRefused(
      res, 'no remote points at upstream SkillPanel/maister (fetch-only)',
      'site 86 (arm c — upstream bare moved out of a `github.com/` path)',
    );
    assert.ok(
      !res.stderr.includes(`no remote points at ${FIXTURE_SLUG}`),
      'site 86, not 87: the FORK lookup must still have succeeded. If this refusal were 87 the moved '
      + 'bare would have been the wrong one — which is exactly the mistake FR9 arm (c) names, since '
      + `moving the fork bare fires 87 from \`start\` and 180 from \`land\`\n--- stderr:\n${res.stderr}`,
    );
    assert.doesNotMatch(
      res.stderr, /^S1 upstream /m,
      'the refusal must come BEFORE S1\'s log line (sync.sh:99): 86 is the `remote_for` failure at :86, '
      + `so a run that reached S1 resolved the upstream after all\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T11
// FR9 ARM (a) — the POSITIVE half, and the one that stops the whole fixture design passing for the
// wrong reason. A bare repository at a LOCAL PATH containing `github.com/<slug>` resolves a remote:
// there is no scheme, no host and no network, and the match still succeeds, because sync.sh:71 compares
// strings. This is why § 4.1 uses local paths rather than URLs — least machinery, not the only thing
// that works.
test('1.T11 (#161 FR9 arm a): a BARE LOCAL PATH containing `github.com/<slug>` resolves a remote, so '
  + 'the fixture\'s own wiring gets PAST site 86 and `start` runs to completion offline', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    // The mechanism, asserted: a filesystem path, carrying no scheme at all, that nonetheless contains
    // the substring the glob looks for.
    assert.ok(
      f.forkBare.includes(`github.com/${FIXTURE_SLUG}`) && !f.forkBare.includes('://'),
      'the fork bare must be a plain local PATH (no `://`) that still contains '
      + `\`github.com/${FIXTURE_SLUG}\` — that combination IS arm (a); forkBare is ${f.forkBare}`,
    );
    assert.ok(
      f.upBare.includes('github.com/SkillPanel/maister') && !f.upBare.includes('://'),
      `the upstream bare must likewise be a plain local path containing \`github.com/SkillPanel/`
      + `maister\`; upBare is ${f.upBare}`,
    );

    const res = runSync(['start'], { cwd: f.main, env: f.env });

    assert.equal(
      res.status, 0,
      'arm (a): `start` must run to completion — both slug lookups resolve, the tripwire preflight '
      + `passes (the stub build.sh maps the incoming \`haiku\` alias) and S4 leaves the merge `
      + `uncommitted\n--- stdout:\n${res.stdout}\n--- stderr:\n${res.stderr}`,
    );
    assert.doesNotMatch(
      res.stderr, /^sync\.sh: REFUSED — /m,
      'arm (a) must produce NO refusal at all — in particular not 86, 87 or 88, the three slug-keyed '
      + `guards in \`start\`\n--- stderr:\n${res.stderr}`,
    );
    // THE DISCRIMINATING EVIDENCE that 86 was PASSED rather than merely not reached: S1 logs the
    // upstream remote it resolved BY SLUG, and its name is the deliberately misleading `zzz-upstream`.
    assert.match(
      res.stderr, /^S1 upstream zzz-upstream → [0-9a-f]{7,} \(version 2\.2\.4\); our master [0-9a-f]{7,}$/m,
      'arm (a): S1 (sync.sh:99) must log the remote `remote_for` resolved for the UPSTREAM slug. The '
      + 'remote is named `zzz-upstream` on purpose (AGENTS.md:347-356), so this line passing can never '
      + `be read as "remote names work" — it resolved by SLUG over a local path\n--- stderr:\n${res.stderr}`,
    );
    assert.match(
      res.stderr, /^S2 worktree ready: .* \(branch sync\/upstream-2\.2\.4 off aaa-fork\/master\)$/m,
      'arm (a): S2 (sync.sh:123) must log the worktree created off the FORK remote — that half proves '
      + `\`remote_for "$SLUG"\` resolved too, i.e. site 87 was passed as well\n--- stderr:\n${res.stderr}`,
    );
    // sync.sh:153 is the only stdout write on this path, and the directory must really be there.
    assert.equal(
      res.stdout, `${f.worktree}\n`,
      'arm (a): `start` writes the worktree path and nothing else to stdout (sync.sh:153); it must be '
      + `the path the harness predicted\n--- stdout:\n${res.stdout}`,
    );
    assert.ok(
      fs.existsSync(path.join(f.worktree, '.git')),
      `arm (a): the linked worktree must actually exist at ${f.worktree} — the strongest available `
      + 'proof the run got past every guard in `start` rather than exiting 0 early',
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T12
// FR9 ARM (b) — CHANGING THE SCHEME IS **NOT** A NEGATIVE CONTROL. Revision 1 of the spec asserted the
// opposite and was wrong: because sync.sh:71 matches the URL string without anchoring and without any
// scheme check, `file:///…/github.com/<slug>.git` still contains `github.com/<slug>` and resolves
// exactly like the bare path. Observed: exit 0, worktree created.
//
// THE TRAP IS THE REVERSE OF THE INTUITIVE ONE. The risk is not that a legitimate URL fails to match;
// it is that a fixture path satisfies the match BY ACCIDENT, because the comparison is purely textual.
// 1.T13 is the control that actually discriminates.
test('1.T12 (#161 FR9 arm b): a `file://` URL whose path still contains `github.com/<slug>` ALSO '
  + 'resolves — sync.sh:71 ignores the scheme, so changing it is NOT a negative control', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    const fileUrl = `file://${f.forkBare}`;
    git(['remote', 'set-url', 'aaa-fork', fileUrl], f.main, f.env);

    // Preconditions: the URL now really does carry a scheme, AND still contains the matched substring.
    // Both halves matter — the first makes this a different shape from arm (a), the second is why it
    // nonetheless resolves.
    assert.equal(
      git(['remote', 'get-url', 'aaa-fork'], f.main, f.env), fileUrl,
      'setup: the fork remote must actually be the `file://` form now — otherwise this test silently '
      + 're-runs arm (a)',
    );
    assert.ok(
      fileUrl.startsWith('file://') && fileUrl.includes(`github.com/${FIXTURE_SLUG}`),
      'setup: the rewritten URL must carry a scheme AND still contain '
      + `\`github.com/${FIXTURE_SLUG}\` — that combination is precisely what arm (b) pins: the scheme `
      + `is irrelevant to an unanchored substring glob; URL is ${fileUrl}`,
    );

    const res = runSync(['start'], { cwd: f.main, env: f.env });

    assert.equal(
      res.status, 0,
      'arm (b): the run must get PAST the S1 slug lookup and complete — the observed behaviour is exit '
      + `0 with the worktree created. A refusal here would mean the scheme DID matter, which is the `
      + `claim revision 1 made and § 6.4 disproved\n--- stdout:\n${res.stdout}\n--- stderr:\n${res.stderr}`,
    );
    assert.doesNotMatch(
      res.stderr, /^sync\.sh: REFUSED — /m,
      `arm (b): no refusal of any kind — in particular not 87, the fork-slug lookup this rewrite `
      + `targets\n--- stderr:\n${res.stderr}`,
    );
    assert.match(
      res.stderr, /^S2 worktree ready: .* \(branch sync\/upstream-2\.2\.4 off aaa-fork\/master\)$/m,
      'arm (b): S2 must log the worktree created off the `file://`-wired fork remote — the positive '
      + `evidence that \`remote_for "$SLUG"\` matched a URL with a scheme\n--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      fs.existsSync(path.join(f.worktree, '.git')),
      `arm (b): the linked worktree must exist at ${f.worktree}; the match succeeded over a URL`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T14
// FR1, site 86 — the PLAIN refusal, distinct from 1.T13's mechanism probe. 1.T13 keeps the remote and
// moves its path out of `github.com/`, isolating the substring the glob depends on; this removes the
// remote outright. Both reach 86, which is why 1.T7's REFUSAL_MAP binds 86 to 1.T11, 1.T13 AND 1.T14.
test('1.T14 (#161 FR1): `start` refuses at site 86 when NO remote points at upstream — the fork remote '
  + 'is present and untouched, so the refusal names the upstream lookup specifically', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    git(['remote', 'remove', 'zzz-upstream'], f.main, f.env);
    assert.deepEqual(
      git(['remote'], f.main, f.env).split('\n').filter((r) => r.length > 0), ['aaa-fork'],
      'precondition: exactly one remote must remain, the fork. `remote_for` iterates every remote, so '
      + 'a leftover second one could resolve the upstream slug and this refusal would never fire',
    );

    const res = runSync(['start'], { cwd: f.main, env: f.env });

    // § 6.1, site 86, verbatim.
    assertRefused(
      res, 'no remote points at upstream SkillPanel/maister (fetch-only)',
      'site 86 (no upstream remote at all) — `start`',
    );
    assert.ok(
      !res.stderr.includes(`no remote points at ${FIXTURE_SLUG}`),
      'site 86, not 87: the fork remote is still wired, so the fork lookup at :87 must not be what '
      + `refused\n--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      res.stderr.includes('(fetch-only)'),
      'site 86\'s message must carry `(fetch-only)` — it is the half that distinguishes it from site '
      + '87\'s string, and it states the invariant: upstream is never a push target (AGENTS.md § '
      + `Direction)\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T15
// FR1, site 87. THE REMOTE THAT REMAINS IS DELIBERATELY NAMED `zzz-upstream` (harness § 4.1,
// AGENTS.md:347-356): if this test passed with a remote named `upstream` or `origin`, the pass could be
// read as "the remote NAMES work". It cannot be read that way here — the only remote present sorts last
// alphabetically and is named for the wrong role, so the lookup that fails can only have been keyed on
// the SLUG.
test('1.T15 (#161 FR1): `start` refuses at site 87 with the upstream present but NO fork remote — the '
  + 'surviving remote is named `zzz-upstream`, so a pass cannot be read as "remote names work"', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    git(['remote', 'remove', 'aaa-fork'], f.main, f.env);
    assert.deepEqual(
      git(['remote'], f.main, f.env).split('\n').filter((r) => r.length > 0), ['zzz-upstream'],
      'precondition: exactly one remote must remain and it must be `zzz-upstream` — the misleading '
      + 'name is the point. The upstream lookup at :86 therefore SUCCEEDS on it, and the run reaches '
      + ':87, which is the site under test',
    );

    const res = runSync(['start'], { cwd: f.main, env: f.env });

    // § 6.1, site 87, verbatim. Note the string is IDENTICAL to site 180's (1.T7 records the pair):
    // 180 is the same guard inside `land`. The verb is what separates them, and this is `start`.
    assertRefused(
      res, `no remote points at ${FIXTURE_SLUG}`,
      'site 87 (upstream present, fork remote removed) — `start`',
    );
    assert.ok(
      !res.stderr.includes('no remote points at upstream SkillPanel/maister'),
      'site 87, not 86: the upstream lookup must have SUCCEEDED — on a remote named `zzz-upstream`. '
      + 'Without this negative the test would pass just as well if both lookups had failed, and the '
      + `slug-over-name claim would be unproven\n--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      !res.stderr.includes('(fetch-only)'),
      'site 87\'s message must NOT carry `(fetch-only)` — that suffix belongs to 86. This is the '
      + `positive discriminator between two refusals whose prefixes are identical\n`
      + `--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T18
// SITE 175, `master` ARM — DECLARED FIRST OF GROUP 9 (step 9.1) because it is a CONTROL: it asserts the
// PRECONDITION before the refusal, so a pass cannot come from the wrong shape. Both halves are needed.
// `abbrev-ref HEAD === 'master'` says the branch really is the one :175 refuses; `show-toplevel !==
// main_checkout` says we are in a LINKED worktree and therefore already past :173. Without the second,
// a run that had actually refused at 173 would be indistinguishable from one refusing at 175.
//
// THIS ARM IS CONSTRUCTIBLE, and no comment here may claim otherwise (§ 6.4, git 2.54.0). A plain
// `git worktree add <path> master` FAILS — `fatal: 'master' is already used by worktree at <main>` —
// because the main checkout holds that branch; `--force` succeeds. The failing form is asserted below
// rather than described, so `--force` is shown to be NECESSARY and not merely used.
test('1.T18 (#161 FR1): `land` refuses at site 175 in a linked worktree on `master` — built with '
  + '`worktree add --force`, with `HEAD === master` and a toplevel ≠ the main checkout asserted first', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    const body = path.join(f.root, 'body.md');
    fs.writeFileSync(body, 'a body file that genuinely exists\n');
    const wt = path.join(f.main, '.worktrees', 'on-master');

    // --- the `--force` necessity control: the plain form must fail, for the documented reason.
    const plain = gitTry(['worktree', 'add', wt, 'master'], f.main, f.env);
    assert.notEqual(
      plain.status, 0,
      'control: a PLAIN `git worktree add <path> master` must FAIL while the main checkout is on '
      + `master. If it ever succeeds, \`--force\` below is no longer the reason this arm exists and the `
      + `comment explaining it has gone stale\n--- stderr:\n${plain.stderr}`,
    );
    assert.match(
      plain.stderr, /fatal: 'master' is already used by worktree at /,
      'control: the plain form must fail with git\'s `already used by worktree at` message — any other '
      + `failure means the fixture is broken rather than the branch being checked out twice\n`
      + `--- stderr:\n${plain.stderr}`,
    );
    git(['worktree', 'add', '--force', wt, 'master'], f.main, f.env);

    // --- THE PRECONDITION, both halves, before the spawn.
    assert.equal(
      git(['rev-parse', '--abbrev-ref', 'HEAD'], wt, f.env), 'master',
      'precondition: the linked worktree must really be ON `master` — that is the value sync.sh:174 '
      + 'reads into `$branch` and :175 refuses. Asserting it first is what makes the refusal below '
      + 'evidence about site 175 rather than about whatever branch the fixture happened to create',
    );
    const top = git(['rev-parse', '--show-toplevel'], wt, f.env);
    assert.equal(top, wt, `precondition: \`--show-toplevel\` in the new worktree must be ${wt}`);
    assert.notEqual(
      top, mainCheckout(wt, f.env),
      'precondition: the toplevel must DIFFER from `main_checkout()` (sync.sh:75), or the run would '
      + 'refuse at :173 (`you are in the MAIN checkout`) and never reach :175. The fixture root is '
      + 'realpath\'d precisely so this comparison is stable on macOS, where /tmp → /private/tmp',
    );

    const res = runSync(['land', 'a title', '--body-file', body], { cwd: wt, env: f.env });

    // § 6.1, site 175 (`master` arm), verbatim.
    assertRefused(
      res, "on 'master' — a sync needs its own branch",
      'site 175 (`master` arm) — linked worktree force-checked-out on master',
    );
    assert.ok(
      !res.stderr.includes('you are in the MAIN checkout'),
      'site 175, not 173: the run must have passed L1\'s first guard. This is the negative half of the '
      + `precondition, restated against the actual output\n--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      !res.stderr.includes("on 'HEAD' —"),
      'site 175\'s `master` arm must name `master`, not `HEAD` — the two arms interpolate `$branch` '
      + `into one message and 1.T19 drives the other\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T19
// SITE 175, DETACHED ARM. `git rev-parse --abbrev-ref HEAD` prints the literal string `HEAD` on a
// detached head, which is why sync.sh:175 tests for it alongside `master`:
//   [ "$branch" != "master" ] && [ "$branch" != "HEAD" ] || fail "on '$branch' — …"
// The precondition is asserted first for the same reason as 1.T18: `abbrev-ref HEAD === 'HEAD'` is what
// makes the refusal evidence about the detached arm specifically.
test('1.T19 (#161 FR1): `land` refuses at site 175 in a DETACHED linked worktree — `abbrev-ref HEAD` is '
  + 'the literal `HEAD`, asserted before the refusal', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    const body = path.join(f.root, 'body.md');
    fs.writeFileSync(body, 'a body file that genuinely exists\n');
    const wt = path.join(f.main, '.worktrees', 'detached');
    git(['worktree', 'add', '--detach', wt, 'HEAD'], f.main, f.env);

    assert.equal(
      git(['rev-parse', '--abbrev-ref', 'HEAD'], wt, f.env), 'HEAD',
      'precondition: on a detached head `--abbrev-ref HEAD` must print the literal string `HEAD` — '
      + 'that is the value sync.sh:175 compares against, and the reason the guard needs two clauses '
      + 'rather than one',
    );
    assert.notEqual(
      git(['rev-parse', '--show-toplevel'], wt, f.env), mainCheckout(wt, f.env),
      'precondition: a LINKED worktree, so :173 is already passed and the refusal below is :175',
    );

    const res = runSync(['land', 'a title', '--body-file', body], { cwd: wt, env: f.env });

    // § 6.1, site 175 (detached arm), verbatim.
    assertRefused(
      res, "on 'HEAD' — a sync needs its own branch",
      'site 175 (detached arm) — linked worktree on a detached head',
    );
    assert.ok(
      !res.stderr.includes("on 'master' —"),
      'the detached arm must name `HEAD`, not `master`. Asserting each arm excludes the other is what '
      + `keeps the two site-175 tests from being one test run twice\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T16
// SITE 88 — `start`'s poisoned-push-URL guard. `remote_for` keys on the FETCH url (sync.sh:70), so the
// fork still resolves; :88 then checks the PUSH url separately, which is the only way a remote can look
// correct and still push upstream. Note 88's string is a PREFIX of site 181's (`… points at upstream`
// vs `… points at upstream SkillPanel/maister`), so the negative assertion below is what separates
// them; the verbs differ too — 88 is in `start`, 181 in `land` (1.T20 drives it).
test('1.T16 (#161 FR1): `start` refuses at site 88 when the fork remote FETCHES from the fork but '
  + 'PUSHES to upstream — the fetch url still resolves the slug, so only the push check can fire', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    git(['remote', 'set-url', '--push', 'aaa-fork', f.upBare], f.main, f.env);

    assert.ok(
      git(['remote', 'get-url', 'aaa-fork'], f.main, f.env).includes(`github.com/${FIXTURE_SLUG}`),
      'precondition: the FETCH url must still carry the fork slug, so `remote_for "$SLUG"` at :87 '
      + 'resolves and the run reaches :88. If the fetch url were poisoned too, this would be 87',
    );
    assert.ok(
      git(['remote', 'get-url', '--push', 'aaa-fork'], f.main, f.env).includes('SkillPanel/maister'),
      'precondition: the PUSH url must name upstream `SkillPanel/maister` — that is the substring '
      + 'sync.sh:88 cases on, and the whole hazard AGENTS.md § Remotes exists for',
    );

    const res = runSync(['start'], { cwd: f.main, env: f.env });

    // § 6.1, site 88, verbatim.
    assertRefused(
      res, "push url of 'aaa-fork' points at upstream",
      'site 88 (fork remote fetching from the fork, pushing to upstream) — `start`',
    );
    assert.ok(
      !res.stderr.includes('points at upstream SkillPanel/maister'),
      'site 88, not 181: site 88\'s message ends at `points at upstream`, while :181 — the same check '
      + 'inside `land` — appends the upstream slug. Without this negative the two sites\' assertions '
      + `would be interchangeable, since 88's string is a prefix of 181's\n--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      res.stderr.includes("'aaa-fork'"),
      'the refusal must name the offending REMOTE — the deliberately misleading `aaa-fork` — because '
      + `an operator's first question is which remote is wrong\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T17
// SITE 173 — `land` from the MAIN checkout. THE REALPATH'D FIXTURE ROOT IS WHAT MAKES THIS
// DETERMINISTIC: :172 compares `git rev-parse --show-toplevel` with `main_checkout()` (:75), and on
// macOS `/tmp` resolves to `/private/tmp`, so an un-realpath'd root makes the two disagree and flips
// this site in EITHER direction — a false refusal here, or a false pass in 1.T18/1.T19 where the two
// must differ. `makeFixture` resolves its root before any use for exactly this reason (§ 4.1).
test('1.T17 (#161 FR1): `land` refuses at site 173 when run from the MAIN checkout — `--show-toplevel` '
  + 'and `main_checkout()` are asserted EQUAL first, which is what the realpath\'d root guarantees', () => {
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    const body = path.join(f.root, 'body.md');
    fs.writeFileSync(body, 'a body file that genuinely exists\n');

    const top = git(['rev-parse', '--show-toplevel'], f.main, f.env);
    assert.equal(
      top, f.main,
      `precondition: \`--show-toplevel\` in the main clone must be exactly ${f.main}, with no /tmp vs `
      + '/private/tmp divergence. A mismatch here is the macOS hazard, not a bug in the subject',
    );
    assert.equal(
      top, mainCheckout(f.main, f.env),
      'precondition: `--show-toplevel` and `main_checkout()` (sync.sh:75) must AGREE — their equality '
      + 'is the condition sync.sh:173 refuses on, so asserting it first is what makes the refusal '
      + 'below evidence about site 173 and not about a path-resolution accident',
    );

    const res = runSync(['land', 'a title', '--body-file', body], { cwd: f.main, env: f.env });

    // § 6.1, site 173, verbatim (with the fixture root substituted for <root>).
    assertRefused(
      res, `you are in the MAIN checkout (${f.main}); land from the sync worktree (scripts/sync.sh start)`,
      'site 173 (`land` run from the main checkout)',
    );
    assert.ok(
      !res.stderr.includes('a sync needs its own branch'),
      'site 173, not 175: :173 must fire FIRST even though the main checkout is also on `master`. The '
      + 'two guards are adjacent and both would trip here, so the ORDER is part of the claim'
      + `\n--- stderr:\n${res.stderr}`,
    );
    assert.doesNotMatch(
      res.stderr, /^L1 worktree /m,
      'the refusal must precede L1\'s success log (sync.sh:177) — a run that logged L1 passed the '
      + `whole of L1, site 173 included\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 1.T20
// FOUR SITES, ONE TOPOLOGY-D FIXTURE, FOUR ORDERED SPAWNS WITH THE REMOTE STATE RESTORED BETWEEN THEM.
// This is NFR3's sanctioned form of fixture sharing — ordered arms inside one test — and never a copied
// root (NG7: a `cp -R` copy's gitdir pointer and remote URLs still name the SOURCE root, so `land`
// pushes into the original fixture's bare repo; verified in § 6.4).
//
// THE ARMS ARE ORDERED BECAUSE EACH ONE'S EVIDENCE IS THE PREVIOUS STAGE'S LOG LINE. Arms 2-4 assert
// `L1 worktree … tree clean` (sync.sh:177), proving L1 was passed and the refusal is not 176 again;
// arm 4 additionally asserts `L2 push target:` (sync.sh:182), proving L2 was passed and the refusal is
// not 180/181. That is what makes four refusals with two duplicated message strings discriminable:
// 180's string is identical to 87's and 189's to 86's (1.T7 records both pairs).
test('1.T20 (#161 FR1): four ordered `land` arms on one topology-D fixture — L1 dirty tree (176), L2 '
  + 'fork missing (180), L2 poisoned push url (181), L3 upstream missing (189)', () => {
  const f = makeFixture({ topology: 'D' });
  try {
    const body = path.join(f.root, 'body.md');
    fs.writeFileSync(body, 'a body file that genuinely exists\n');
    const wt = f.worktree;
    const land = () => runSync(['land', 'a title', '--body-file', body], { cwd: wt, env: f.env });

    // The fixture must START clean and on the sync branch, or arm 1 proves nothing and arms 2-4 would
    // all refuse at 176 instead of their own sites.
    assert.equal(
      git(['status', '--porcelain'], wt, f.env), '',
      'precondition: the topology-D sync worktree must be CLEAN before arm 1 dirties it — otherwise '
      + 'arm 1 would pass on a dirtiness the test did not create, and arms 2-4 would never reach L2/L3',
    );
    assert.equal(
      git(['rev-parse', '--abbrev-ref', 'HEAD'], wt, f.env), 'sync/upstream-2.2.4',
      'precondition: on the sync branch, so sites 173 and 175 are both passed and every refusal below '
      + 'is the site it claims to be',
    );

    // ---- ARM 1 — site 176, L1's clean-tree guard.
    const dirty = path.join(wt, 'UNCOMMITTED.md');
    fs.writeFileSync(dirty, 'an uncommitted change sitting in the sync worktree\n');
    assert.notEqual(
      git(['status', '--porcelain'], wt, f.env), '',
      'arm 1 setup: `git status --porcelain` must be non-empty — that is the exact expression '
      + 'sync.sh:176 evaluates, so asserting it here removes any doubt about what the guard saw',
    );
    const r176 = land();
    assertRefused(
      r176, 'working tree not clean — commit (git add <paths>) or drop the changes first',
      'site 176 (arm 1 — L1 dirty tree)',
    );
    assert.doesNotMatch(
      r176.stderr, /^L1 worktree /m,
      'site 176 (arm 1): the refusal must PRECEDE L1\'s success log at sync.sh:177 — arms 2-4 assert '
      + `that same line's PRESENCE, so its absence here is what makes the pair meaningful`
      + `\n--- stderr:\n${r176.stderr}`,
    );
    fs.rmSync(dirty);
    assert.equal(
      git(['status', '--porcelain'], wt, f.env), '',
      'arm 1 teardown: the tree must be clean again before arm 2, or arm 2 refuses at 176 as well',
    );

    // ---- ARM 2 — site 180, L2's fork lookup. Same `fail` STRING as site 87 (1.T7 records the pair);
    // the discriminator is the verb (`land`, not `start`) plus the L1 log line below.
    git(['remote', 'remove', 'aaa-fork'], wt, f.env);
    const r180 = land();
    assertRefused(
      r180, `no remote points at ${FIXTURE_SLUG}`,
      'site 180 (arm 2 — L2 fork remote removed)',
    );
    assert.match(
      r180.stderr, /^L1 worktree .* on sync\/upstream-2\.2\.4, tree clean$/m,
      'site 180 (arm 2): L1 must be logged as PASSED (sync.sh:177). This is what proves the refusal is '
      + `180 in \`land\`'s L2 and not 87 in \`start\`, whose message is byte-identical`
      + `\n--- stderr:\n${r180.stderr}`,
    );
    git(['remote', 'add', 'aaa-fork', f.forkBare], wt, f.env);
    git(['fetch', '-q', 'aaa-fork', 'master'], wt, f.env);
    assert.equal(
      git(['remote', 'get-url', 'aaa-fork'], wt, f.env), f.forkBare,
      'arm 2 teardown: the fork remote must be restored to the fixture bare before arm 3, or arm 3 '
      + 'refuses at 180 again instead of reaching :181',
    );

    // ---- ARM 3 — site 181, L2's push-url check. Distinct from site 88 (1.T16) by the appended slug.
    git(['remote', 'set-url', '--push', 'aaa-fork', f.upBare], wt, f.env);
    const r181 = land();
    assertRefused(
      r181, "push url of 'aaa-fork' points at upstream SkillPanel/maister",
      'site 181 (arm 3 — L2 push url poisoned to upstream)',
    );
    assert.match(
      r181.stderr, /^L1 worktree .* tree clean$/m,
      'site 181 (arm 3): L1 passed, so this is L2\'s push check and not 176'
      + `\n--- stderr:\n${r181.stderr}`,
    );
    assert.doesNotMatch(
      r181.stderr, /^L2 push target: /m,
      'site 181 (arm 3): the refusal must precede L2\'s success log at sync.sh:182 — arm 4 asserts '
      + `that line's PRESENCE, which is how 189 is separated from 180/181`
      + `\n--- stderr:\n${r181.stderr}`,
    );
    git(['remote', 'set-url', '--push', 'aaa-fork', f.forkBare], wt, f.env);

    // ---- ARM 4 — site 189, L3's upstream lookup. Same `fail` STRING as site 86 (1.T7 records the
    // pair); the discriminator is the `L2 push target:` line, which only `land` emits and only after
    // L2 has fully passed.
    git(['remote', 'remove', 'zzz-upstream'], wt, f.env);
    const r189 = land();
    assertRefused(
      r189, 'no remote points at upstream SkillPanel/maister (fetch-only)',
      'site 189 (arm 4 — L3 upstream remote removed)',
    );
    assert.match(
      r189.stderr, new RegExp(`^L2 push target: aaa-fork → ${FIXTURE_SLUG}$`, 'm'),
      'site 189 (arm 4): L2 must be logged as PASSED (sync.sh:182) — the whole of L2, sites 180 and '
      + '181 included. That line is the only thing distinguishing 189 from site 86, whose message is '
      + `byte-identical, and it also re-witnesses NFR9a: the resolved push target is the FIXTURE slug`
      + `\n--- stderr:\n${r189.stderr}`,
    );
    assert.ok(
      !r189.stderr.includes('is not an ancestor of HEAD'),
      'site 189 (arm 4): the refusal must be the upstream LOOKUP at :189, not the ancestry assertions '
      + `at :195/:197 further down L3\n--- stderr:\n${r189.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});
