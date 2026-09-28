// sync-sh-ladder.test.mjs — #161 module 4 (spec § 3.4): the L6→L9 ladder of `scripts/sync.sh land`,
// the only sanctioned way to land an UPSTREAM MERGE on the fork (AGENTS.md § Shipping).
//
// THIS IS THE MODULE THAT PUSHES. It holds all TWELVE `fail` sites at or past sync.sh:252 — 225, 226,
// 227, 229, 230, 237, 240, 246, 248, 253, 255, 258 — it performs the suite's ONE real `git push`, and
// it reaches site 258, the line immediately after that push, where the subject runs
// `gh pr create --repo "$SLUG"`. Everything below follows from that one fact.
//
// NFR9 — THE TWO-LOCK CONTRACT, LOAD-BEARING HERE ABOVE ALL OTHER MODULES.
//   (a) Every spawn's `PR_REPO_SLUG` is the harmless fixture slug AND the fixture's fork-bare path
//       embeds that same slug, because `remote_for` (sync.sh:67-74) resolves the push target from the
//       remote's URL STRING. `sync.sh:59` is `SLUG="${PR_REPO_SLUG:-robmar-net/maister}"`, so with
//       `PR_REPO_SLUG` unset an argv-recording stub was OBSERVED capturing
//       `gh pr create --repo robmar-net/maister` — the REAL repository (AGENTS.md:13-24 forbids that
//       absolutely). 4.T5(c) additionally asserts the L2 line names the fixture slug, so the lock is
//       not merely configured, it is witnessed on every push arm.
//   (b) The derived PATH is built by FILTERING OUT every directory that holds an executable `gh`,
//       never by whitelisting directories this test does not control, and `assertNoGh()` PROBES for
//       the binary rather than inferring its absence. On this host `gh` is a Homebrew sibling of
//       `node` (`/opt/homebrew/bin`), which is exactly why a whitelist would have re-admitted it.
//   Neither lock is sufficient alone. `assertNoGh()` runs at MODULE SCOPE below, after the imports and
//   BEFORE the first `test(...)` declaration and therefore before this file's first spawn: `node --test`
//   gives each FILE its own process, so module 1's proof says nothing here — and here a surviving push
//   is followed one line later by `gh pr create`.
//
// SCOPE LIMITS, BY LINE NUMBER — the `sweep-sh.test.mjs:38-44` model. Stated out loud, never hidden:
//   * SIX `fail` sites sit behind a SUCCESSFUL `gh pr create` (`num` is assigned at sync.sh:259 from
//     its output) and are unreachable hermetically: 266, 269, 273, 274, 276, 288. They are declared as
//     DATA with a reason each by module 1's census (1.T7), not silently omitted. `--no-merge` does not
//     lower that ceiling — it is evaluated at :261, AFTER the pushes (253/255) and AFTER 258.
//   * sync.sh:258 itself IS hermetically reachable and 4.T5(c) covers it. What that test proves is
//     narrow and it says so: the script REFUSES rather than proceeding when its tooling is absent. It
//     does NOT exercise a GitHub-reported API failure, and a `gh`-present variant is deliberately not
//     built — running a real `gh pr create` is the one thing NFR9 exists to make impossible.
//   * sync.sh:229's `fail` is UNREACHABLE (issue #166). 4.T2(a) pins the OBSERVED behaviour as a
//     defect — including the zero-`REFUSED` count — rather than laundering the site into an exclusion
//     list, so the gap stays visible (AGENTS.md:47-64).
//
// TOPOLOGY `G` IS NOT "D PLUS A MAKEFILE" (spec § 4.3). It is topology D's graph with an L5-PASSING
// manifest set — `headver = 2.2.4+fork.1`, the base-version successor, in ALL THREE manifests — plus
// the `ladder` scaffold (a committed `Makefile`, a green hand-written `l2/test/stub.test.mjs`, an
// `l2/tools/citation-drift.mjs`, an `l2/reference/CALIBRATION-LOG.md`). That L5-passing manifest set is
// the single ingredient revision 1 of this spec omitted, and it is why all 11 ladder sites were
// unreachable there: every spawn refused at L5 (:216) and nothing past :221 ever ran. So every test
// here asserts the fixture reaches L5 GREEN — `L5 version 2.2.3+fork.5 → 2.2.4+fork.1 (base moved, N
// reset)` on stderr — BEFORE it asserts any refusal. A ladder test that does not prove it got past L5
// is proving nothing about the ladder.
//
// NFR6 — THE RECURSION BOUND, AND ITS ONE CONSTRAINT. A `land` spawn inside a fixture reaches L6 and
// runs `node --test platforms/copilot-cli/compat-tests/l2/test/*.test.mjs` over the FIXTURE's glob.
// The bound at depth 1 holds only because that glob matches exactly one file and that file is a
// HAND-WRITTEN TRIVIAL STUB (`stubTest` below, three lines), never a copy of any real test file. A
// copy would put this module inside the fixture and make the recursion unbounded. Requirement, not
// preference (spec § 9.4).
//
// ARMS IN GUARD ORDER, ON ONE FIXTURE — and FIXTURES ARE NEVER COPIED (NG7). Each test builds one `G`
// fixture and walks its sites in ascending guard order, committing the single changed tracked file
// between arms. The tree stays clean and L3/L5 keep passing because the extra commits disturb neither
// the merge commit nor the version (verified: after four commits changing only `Makefile`, a spawn
// still logged both the L3 and the L5 success lines). Sharing by `cp -R` is forbidden and was
// measured to be wrong, not merely inelegant: a copied root's `main/.worktrees/<n>/.git` still reads
// `gitdir: <ORIGINAL root>/…`, so does `main/.git/worktrees/<n>/gitdir`, and so does every remote URL
// — the copy fetches from and PUSHES INTO the SOURCE fixture's bare repo. There is no `cp` here.
//
// NFR5 — no line in this file begins with seven `<` or seven `>` followed by a space. This module needs
// no conflict markers at all (topology `markers` is module 2's business), so there is nothing to build
// by concatenation here; the constraint is restated because sync.sh:204 greps for that shape at column
// 0 across all TRACKED files, and one such line would make a real `sync.sh land` refuse forever while
// blaming "the tree".
//
// NFR3 — the module's own budget is 22 s wall clock for 5 tests. If it ever lands over, the fix is a
// MODULE SPLIT, not a budget edit; over 25 s is a finding, not a pass.
//
//   4.T1 (FR1)          — L6's three `make` gates each refuse, in order: 225, 226, 227.
//   4.T2 (FR8/D10+FR1)  — L6's L2-suite gate CANNOT refuse (229, the defect pin) and the
//                         dirtying-build gate can (230).
//   4.T3 (FR1)          — L7 refuses on citation drift (237) and on a missing tool (240).
//   4.T4 (FR1)          — L8 refuses on a missing (246) and a non-appended (248) CALIBRATION entry.
//   4.T5 (FR1/FR4/NFR9) — L9's two push refusals and the hermetic ceiling: 255, 253, 258, in that
//                         order, on a fixture no prior spawn has pushed from.
//
// Zero dependencies — `node:` builtins only — and self-cleaning: every fixture is removed in its own
// test's `finally`, so it goes on an assertion failure as well as on success. No global `after()`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertNoGh, assertRefused, assertUnderRoot, FIXTURE_SLUG, makeFixture, runSync,
} from './helpers/sync-sh-harness.mjs';

// NFR9b — the per-module precondition, at MODULE SCOPE and before any `test(...)` declaration, hence
// before this file's first spawn. See the header: this is the module where it matters most.
assertNoGh();

// --------------------------------------------------------------------------------- shared constants
// The three tracked paths the arms rewrite, plus the one `make build` dirties. Relative to the
// worktree, because that is the cwd of every spawn and of every `git add`.
const MAKEFILE = 'Makefile';
const STUB_TEST = 'platforms/copilot-cli/compat-tests/l2/test/stub.test.mjs';
const DRIFT_TOOL = 'platforms/copilot-cli/compat-tests/l2/tools/citation-drift.mjs';
const CAL_LOG = 'platforms/copilot-cli/compat-tests/l2/reference/CALIBRATION-LOG.md';
const TRACKED = 'TRACKED.md';

const TITLE = 'sync: fixture upstream merge';

// The L5 success line every test must see BEFORE it asserts a refusal (sync.sh:217). Anchored
// multiline, never `startsWith` — L1..L4 log four lines ahead of it (AC2).
const L5_GREEN = /^L5 version 2\.2\.3\+fork\.5 → 2\.2\.4\+fork\.1 \(base moved, N reset\)$/m;

// ------------------------------------------------------------------------------------ git plumbing
// A fixture-local `git`, failing LOUDLY with a named reason rather than skipping (NFR8). Kept separate
// from the harness's private one because the arms need `git rm`, `update-ref` and an explicit-refspec
// `fetch` that fixture CONSTRUCTION never performs.
function git(args, cwd, env) {
  const res = spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(
    res.error, undefined,
    `arm setup: spawning \`git ${args.join(' ')}\` failed: ${res.error && res.error.message}`,
  );
  assert.equal(
    res.status, 0,
    `arm setup: \`git ${args.join(' ')}\` in ${cwd} exited ${res.status}. An arm that cannot be set up `
    + `FAILS LOUDLY with a named reason; it never skips quietly (NFR8).\n${res.stdout}${res.stderr}`,
  );
  return (res.stdout ?? '').trim();
}

// EXPLICIT STAGING, by exact path (AGENTS.md § One ticket = one worktree): `git add -A` is how one
// session's stray ends up in another's commit, and in an arm it would also hide a file an earlier
// spawn's `make build` dirtied. These commits are inside a throwaway `mkdtemp` fixture, never the
// operator's tree.
function commitPaths(f, rels, msg) {
  git(['add', '--', ...rels], f.worktree, f.env);
  git(['commit', '-q', '-m', msg], f.worktree, f.env);
}

// ----------------------------------------------------------------------------- fixture file bodies
// The three L6 gate targets only (sync.sh:225-227). `red` names the ONE target that fails; `dirty`
// makes `build` rewrite a TRACKED file, which is site 230's whole mechanism.
function makefile(red) {
  const recipe = {
    build: red === 'build' ? '@echo "fixture: build is red" >&2; exit 1'
      : red === 'dirty' ? `@printf 'dirtied by make build\\n' >> ${TRACKED}`
        : '@true',
    validate: red === 'validate' ? '@echo "fixture: validate is red" >&2; exit 1' : '@true',
    'check-deterministic': red === 'check-deterministic'
      ? '@echo "fixture: check-deterministic is red" >&2; exit 1' : '@true',
  };
  return [
    '# fixture Makefile — only the three L6 gate targets exist (sync.sh:225-227).',
    '.PHONY: build validate check-deterministic',
    ...Object.entries(recipe).flatMap(([t, r]) => [`${t}:`, `\t${r}`]),
    '',
  ].join('\n');
}

// HAND-WRITTEN AND TRIVIAL — three lines, no imports beyond `node:` builtins, and above all NOT a copy
// of any real test file. This is the NFR6 constraint in code: the fixture's L6 glob must match exactly
// this, or the recursion is unbounded (spec § 9.4).
const stubTest = (red) => [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  `test('stub ${red ? 'red' : 'green'}', () => { assert.equal(1, ${red ? 2 : 1}); });`,
  '',
].join('\n');

// ------------------------------------------------------------------------------------- the `land` run
// One `land` spawn against the fixture worktree, plus the two assertions every arm needs before it
// looks at a refusal: the spawn reached L5 GREEN (so the ladder was actually entered — see the header)
// and stdout is empty (AC4: sync.sh's stdout carries only the worktree path at :153 or a PR URL).
function land(f, label) {
  const res = runSync(['land', TITLE, '--body-file', f.bodyFile], { cwd: f.worktree, env: f.env });
  assert.match(
    res.stderr, L5_GREEN,
    `${label}: the fixture must reach L5 GREEN before any ladder site is reachable — topology G's `
    + `L5-passing manifest set (2.2.4+fork.1 in all three) is what makes sync.sh:225-258 reachable at `
    + `all. Without this line the run refused at :216 and the site under test never executed.\n`
    + `--- stderr:\n${res.stderr}`,
  );
  assert.equal(
    res.stdout, '',
    `${label}: nothing on stdout — sync.sh writes only the worktree path (:153) or a PR URL `
    + `(:261/:279/:286/:291) there (AC4)\n--- stdout:\n${res.stdout}`,
  );
  return res;
}

// A `G` fixture plus the PR body `land` requires at sync.sh:168. The body lives at the fixture ROOT,
// never inside the worktree, because a file in the worktree would dirty the tree and refuse at :176
// before any ladder site ran.
function ladderFixture(opts) {
  const f = makeFixture({ topology: 'G', ...opts });
  try {
    // NFR1's `NODE_TEST_CONTEXT` scrub USED TO LIVE HERE and is now STRUCTURAL, inside the harness's
    // `fixtureEnv` — see the measured record there and ADR 0010, Decision 1. The hazard is generic
    // (`pr.sh:117` runs the same `node --test` construct), so it belongs in the one function every
    // spawn's env is built by, not in the one module that happened to notice it. This module keeps no
    // local override and asserts nothing about the env's SHAPE: the load-bearing check is the one in
    // 4.T2(a) that asserts sync.sh:231's `L6 gates green, tree still clean` line is ABSENT, which is a
    // claim about the BEHAVIOUR this scrub exists to produce and therefore holds however the env is
    // built. An assertion on the variable's absence would only restate the harness's own code.
    f.bodyFile = path.join(f.root, 'pr-body.md');
    fs.writeFileSync(f.bodyFile, '# fixture PR body\n\nupstream merge, fixture only.\n');
    assertUnderRoot(f.root, { bodyFile: f.bodyFile });
    return f;
  } catch (e) {
    f.cleanup();
    throw e;
  }
}

// `indexOf` ordering, asserted rather than assumed: "preceded by" is a claim about the STREAM, and the
// whole point of AC2 is that these sites emit other output BEFORE the refusal line.
function assertPrecedesRefusal(stderr, needle, label) {
  const at = stderr.search(needle);
  const refusal = stderr.search(/^sync\.sh: REFUSED — /m);
  assert.notEqual(
    at, -1,
    `${label}: the guard's own diagnostic ${needle} must appear on stderr — its absence means the `
    + `refusal fired for a different reason than the one this arm built\n--- stderr:\n${stderr}`,
  );
  assert.ok(
    refusal !== -1 && at < refusal,
    `${label}: that diagnostic must PRECEDE the \`REFUSED\` line (found at ${at}, refusal at `
    + `${refusal}). This is AC2's anchor: a \`startsWith\` on the REFUSED prefix written from spec `
    + `§ 6.1's table fails right here on a CORRECT script.\n--- stderr:\n${stderr}`,
  );
}

// ------------------------------------------------------------------------- 4.T1 — L6's three `make` gates
test('4.T1 sync.sh land: L6 refuses at each of the three make gates (sites 225, 226, 227)', () => {
  const f = ladderFixture({ makeRed: 'build' });
  try {
    // --- arm (a), site 225: `make -s build` red.
    let res = land(f, '4.T1(a) site 225');
    assertRefused(res, 'make build failed', '4.T1(a) site 225 — make build');

    // --- arm (b), site 226: `build` green, `validate` red. Only the Makefile changes, so L3's merge
    // commit and L5's version are untouched and both still pass.
    fs.writeFileSync(path.join(f.worktree, MAKEFILE), makefile('validate'));
    commitPaths(f, [MAKEFILE], 'arm b: make validate is red');
    res = land(f, '4.T1(b) site 226');
    assertRefused(res, 'make validate failed', '4.T1(b) site 226 — make validate');
    // sync.sh:226 is the ONE gate whose `make` is not silenced (`>&2`, not `>/dev/null 2>&1`), so
    // make's own failure line reaches stderr AHEAD of the refusal. Observed on GNU Make 3.81 as
    // `make: *** [validate] Error 1`; GNU Make 4.x prefixes the target with `Makefile:<n>: `, which is
    // why the anchor tolerates that field and nothing else.
    assertPrecedesRefusal(
      res.stderr, /^make: \*\*\* \[(?:Makefile:\d+: )?validate\] Error 1$/m,
      '4.T1(b) site 226 — make validate',
    );

    // --- arm (c), site 227: `build` and `validate` green, `check-deterministic` red.
    fs.writeFileSync(path.join(f.worktree, MAKEFILE), makefile('check-deterministic'));
    commitPaths(f, [MAKEFILE], 'arm c: make check-deterministic is red');
    res = land(f, '4.T1(c) site 227');
    assertRefused(
      res, 'make check-deterministic failed', '4.T1(c) site 227 — make check-deterministic',
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------- 4.T2 — the defect pin (229) plus the dirtying build (230)
test('4.T2 sync.sh land: L6\'s L2-suite gate cannot refuse (229, issue #166) but the dirtying-build gate can (230)', () => {
  const f = ladderFixture({ makeRed: 'suite' });
  try {
    // --- arm (a), site 229 — THE DEFECT PIN (FR8/D10, spec § 5.3 bucket B, issue 3 = #166).
    //
    // sync.sh:228-229 is
    //   node --test <glob> >/dev/null 2>&1 \
    //     || { node --test <glob> 2>&1 | tail -30 >&2; fail "L2 unit suite failed"; }
    // Under `set -euo pipefail` (sync.sh:57) the diagnostic re-run PIPELINE takes node's non-zero
    // status via `pipefail`, and because the brace group is the LAST member of the `||` list errexit
    // applies to the commands inside it — the shell exits 1 at the pipeline and `fail` NEVER RUNS.
    // errexit and pipefail are JOINTLY load-bearing; neither alone produces this.
    //
    // THE § 5.3 NEUTRALISATION EXPERIMENT AND ITS RESULT — this record is bucket B's MEMBERSHIP
    // REQUIREMENT, not a nicety: a site enters the defect bucket only on a DEMONSTRATED
    // unreachability, never on a filed issue alone (FR4, § 5.4 assertion 6), and module 1's census
    // (1.T7) reads this record. Experiment: neutralise the pipeline's status, i.e. replace the brace
    // group's pipeline with `{ node --test <glob> || true; } | tail -30 >&2`. RESULT: the same shape
    // then PRINTS `sync.sh: REFUSED — L2 unit suite failed`; without the neutralisation it does not.
    // That isolates the cause to the pipeline's status rather than to `fail`, the glob or the guard.
    // `pr.sh:117` carries the identical construct under the same `set -euo pipefail`.
    //
    // So this arm pins the OBSERVED behaviour — exit 1, the node dump on stderr, ZERO `REFUSED` lines
    // — and it is deliberately NOT `assertRefused`. Writing it as a refusal would make the suite green
    // on a script that silently drops its own diagnostic, which is the exact silent green AGENTS.md
    // exists to prevent. When #166 is fixed this assertion FAILS, which is how the pin ratchets.
    const res = land(f, '4.T2(a) site 229');
    assert.equal(
      res.status, 1,
      `4.T2(a) site 229: the run still stops with exit 1 — errexit aborts the brace group at the `
      + `pipeline. Only the REFUSED line is lost (#166).\n--- stderr:\n${res.stderr}`,
    );
    assert.match(
      res.stderr, /^\s*✖ stub red/m,
      `4.T2(a) site 229: the diagnostic re-run's node failure dump must reach stderr through `
      + `\`tail -30\` — that half of sync.sh:229 DOES work, and it names the fixture's own `
      + `hand-written red stub (NFR6), never a real test file\n--- stderr:\n${res.stderr}`,
    );
    // The one assertion that keeps the zero-`REFUSED` count honest: a ZERO count also describes a run
    // that sailed straight past :228 because the suite gate passed. sync.sh:231 logs `L6 gates green,
    // tree still clean` only when :228-:230 all succeeded, so its ABSENCE is the positive proof that
    // site 229 was the stopping point. Without this, scrubbing NODE_TEST_CONTEXT out of the spawn env
    // (see `ladderFixture`) would be an undetectable regression.
    assert.doesNotMatch(
      res.stderr, /^L6 gates green, tree still clean$/m,
      `4.T2(a) site 229: the run must STOP inside L6's suite gate — sync.sh:231's success line means `
      + `\`node --test\` exited 0 and the red stub never failed, so the zero-\`REFUSED\` count below `
      + `would be measuring a run that never reached site 229\n--- stderr:\n${res.stderr}`,
    );
    const hits = (res.stderr.match(/^sync\.sh: REFUSED — /mg) ?? []).length;
    assert.equal(
      hits, 0,
      `4.T2(a) site 229: sync.sh:229's \`fail\` is UNREACHABLE (issue #166) — exactly ZERO `
      + `\`REFUSED\` lines are expected and ${hits} were found. If this assertion fails because a `
      + `REFUSED line APPEARED, #166 has been fixed: move site 229 out of the census's defect map `
      + `into its refusal map and make this arm an \`assertRefused\`. Do NOT relax the count.\n`
      + `--- stderr:\n${res.stderr}`,
    );

    // --- arm (b), site 230: a GREEN stub (so L6's suite gate passes) plus a `build` target that
    // rewrites a tracked file, which is what sync.sh:230's `git status --porcelain` catches.
    fs.writeFileSync(path.join(f.worktree, STUB_TEST), stubTest(false));
    fs.writeFileSync(path.join(f.worktree, MAKEFILE), makefile('dirty'));
    commitPaths(f, [STUB_TEST, MAKEFILE], 'arm b: green stub, make build dirties a tracked file');
    const res2 = land(f, '4.T2(b) site 230');
    assertRefused(
      res2, 'the build changed tracked files', '4.T2(b) site 230 — the build dirtied the tree',
    );
    // sync.sh:230 pipes `git status --short` to stderr before refusing; git's short format puts a
    // SPACE in the index column for an unstaged modification, so the line is ` M TRACKED.md`.
    assertPrecedesRefusal(
      res2.stderr, /^ M TRACKED\.md$/m, '4.T2(b) site 230 — the build dirtied the tree',
    );
  } finally {
    f.cleanup();
  }
});

// ---------------------------------------------------------------------------- 4.T3 — L7, citation provenance
test('4.T3 sync.sh land: L7 refuses on unresolved citation drift (237) and on a missing tool (240)', () => {
  const f = ladderFixture({ drift: 'dirty' });
  try {
    // --- arm (a), site 237: the stub `citation-drift.mjs` exits 1. L6 is fully green here (green
    // stub, three `@true` targets, clean tree), which is the only way L7 is reached at all.
    let res = land(f, '4.T3(a) site 237');
    assertRefused(res, 'citation drift is unresolved', '4.T3(a) site 237 — drift unresolved');

    // --- arm (b), site 240: the tool is GONE. sync.sh:235 is `if [ -f "$drift" ]`, so removing the
    // file takes the `else` at :239 — a different branch, not a louder version of arm (a).
    git(['rm', '-q', '--', DRIFT_TOOL], f.worktree, f.env);
    git(['commit', '-q', '-m', 'arm b: remove citation-drift.mjs'], f.worktree, f.env);
    res = land(f, '4.T3(b) site 240');
    assertRefused(
      res, 'is missing — a sync cannot be verified', '4.T3(b) site 240 — drift tool absent',
    );
  } finally {
    f.cleanup();
  }
});

// -------------------------------------------------------------------------- 4.T4 — L8, the CALIBRATION entry
test('4.T4 sync.sh land: L8 refuses with no CALIBRATION entry (246) and on a non-appended one (248)', () => {
  // `cal` defaults to 'none', which leaves CALIBRATION-LOG.md byte-identical between fork master and
  // HEAD — so sync.sh:245's `git diff --numstat` is EMPTY, which is site 246's condition.
  const f = ladderFixture({});
  try {
    // --- arm (a), site 246: no CALIBRATION-LOG movement in this sync at all.
    let res = land(f, '4.T4(a) site 246');
    assertRefused(res, 'no CALIBRATION-LOG entry', '4.T4(a) site 246 — no calibration record');

    // --- arm (b), site 248: a REWRITE, not an append. The guard is `del != 0` (sync.sh:248), so the
    // numstat must carry insertions > 0 AND deletions > 0; editing one line in place gives `1  1`.
    // Appending would give `N  0` and pass, which is exactly the distinction the log's append-only
    // rule encodes (AGENTS.md: correct a stale citation in a NEW entry, never by editing the old one).
    const calPath = path.join(f.worktree, CAL_LOG);
    const lines = fs.readFileSync(calPath, 'utf8').split('\n');
    const i = lines.indexOf('baseline reference state recorded by the fixture builder');
    assert.notEqual(
      i, -1,
      '4.T4(b) site 248: the CALIBRATION-LOG baseline line to rewrite is missing from the fixture — '
      + 'the arm cannot be set up, so it fails loudly rather than asserting on the wrong shape (NFR8)',
    );
    lines[i] = 'baseline reference state EDITED IN PLACE (the log is append-only)';
    fs.writeFileSync(calPath, lines.join('\n'));
    commitPaths(f, [CAL_LOG], 'arm b: rewrite the CALIBRATION baseline in place');
    const numstat = git(
      ['diff', '--numstat', 'aaa-fork/master', 'HEAD', '--', CAL_LOG], f.worktree, f.env,
    );
    assert.match(
      numstat, /^1\t1\t/,
      `4.T4(b) site 248: the arm must produce insertions > 0 AND deletions > 0, because an APPEND `
      + `(\`N\t0\`) passes the guard. numstat was ${JSON.stringify(numstat)}`,
    );
    res = land(f, '4.T4(b) site 248');
    assertRefused(res, 'has 1 deletion(s)', '4.T4(b) site 248 — the log was rewritten, not appended');
    assert.ok(
      res.stderr.includes('APPEND-ONLY'),
      `4.T4(b) site 248: the refusal names the invariant it defends (APPEND-ONLY), which is what makes `
      + `it discriminating against site 246's "no entry at all"\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------ 4.T5 — L9, the two push refusals and 258
test('4.T5 sync.sh land: L9 refuses both pushes then stops at the absent gh (sites 255, 253, 258 — in that order)', () => {
  // WHY THE ORDER IS LOAD-BEARING, AND WHY THIS FIXTURE MUST BE FRESH.
  //
  // The arms run 255 → 253 → 258 and a later arm must NEVER precede an earlier one. Once a push
  // SUCCEEDS the remote ref matches HEAD, git finds nothing to send, and it skips `receive-pack`
  // entirely — so the `pre-receive` hook never runs and the lease is never checked. OBSERVED: with
  // the branch already pushed, the `pre-receive` arm produced `gh pr create failed` (258) instead of
  // `push refused`. Both refusal arms then pass through to 258 and the test is green while proving
  // nothing about 253 or 255.
  //
  // Therefore this fixture is built for this test alone and NO PRIOR SPAWN HAS PUSHED FROM IT: it is
  // not shared with 4.T1-4.T4 (each builds its own), it is not a `cp -R` of one (NG7 — a copy pushes
  // into the SOURCE fixture's bare repo, measured), and the only pushes it ever sees are arm (b)'s
  // deliberate setup push and arm (c)'s single real push by the subject itself.
  //
  // `cal: 'appended'` is required, not decorative: L9 is reachable only through a GREEN L8, and L8
  // demands insertions > 0 with deletions == 0 (sync.sh:246-248).
  const f = ladderFixture({ cal: 'appended' });
  try {
    const head = git(['rev-parse', 'HEAD'], f.worktree, f.env);
    const parent = git(['rev-parse', 'HEAD^1'], f.worktree, f.env);
    const remoteRef = `refs/heads/${f.branch}`;
    const trackingRefspec = `+${remoteRef}:refs/remotes/aaa-fork/${f.branch}`;
    const hook = path.join(f.forkBare, 'hooks', 'pre-receive');
    // NFR4 restated for the two paths this test acts on that no other test touches.
    assertUnderRoot(f.root, { forkBare: f.forkBare, hook });
    assert.equal(
      git(['ls-remote', '--heads', f.forkBare, f.branch], f.worktree, f.env), '',
      '4.T5: precondition — the sync branch must be ABSENT from the fixture bare, so sync.sh:252 '
      + 'takes the `else` and arm (a) exercises the `-u` push at :255. A branch already there would '
      + 'silently route arm (a) to :253 instead.',
    );

    // --- arm (a), site 255: branch absent on the remote ⇒ sync.sh:252's `ls-remote --exit-code`
    // fails ⇒ the `git push -q -u` at :255. A `pre-receive` hook in the fork bare exits 1, so
    // `receive-pack` declines the update.
    fs.writeFileSync(hook, '#!/bin/sh\n# fixture: decline every update (site 255)\nexit 1\n', { mode: 0o755 });
    let res = land(f, '4.T5(a) site 255');
    assertRefused(res, 'push refused', '4.T5(a) site 255 — the -u push was declined');
    // git's push status table, reproduced byte-accurately: the line has a LEADING SPACE, which is
    // precisely the trap AC2 exists for. The summary column is padded to the width of the widest
    // reason, so the anchor pins the leading space, the flag, the bracketed reason and the refname
    // pair, and tolerates only that padding. Observed on git 2.54.0:
    //   ` ! [remote rejected] sync/upstream-2.2.4 -> sync/upstream-2.2.4 (pre-receive hook declined)`
    //   ` ! [rejected]        sync/upstream-2.2.4 -> sync/upstream-2.2.4 (stale info)`
    assertPrecedesRefusal(
      res.stderr,
      new RegExp(`^ ! \\[remote rejected\\] +${f.branch} -> ${f.branch} \\(pre-receive hook declined\\)$`, 'm'),
      '4.T5(a) site 255 — the -u push was declined',
    );
    assert.match(
      res.stderr, new RegExp(`^L2 push target: aaa-fork → ${FIXTURE_SLUG}$`, 'm'),
      `4.T5(a) site 255: NFR9a witnessed on the arm that pushes — the target resolved BY SLUG to the `
      + `fixture repository, never to the real one (AGENTS.md:13-24)\n--- stderr:\n${res.stderr}`,
    );

    // --- arm (b), site 253: remove the hook, push the branch so a remote-tracking ref exists, then
    // move the REMOTE branch back to HEAD^1 behind our back. `--force-with-lease` with no argument
    // leases on `refs/remotes/aaa-fork/<branch>`, which still reads HEAD, so the remote's actual
    // value disagrees and git rejects with `(stale info)` — a LEASE failure, not a non-fast-forward
    // (HEAD^1 → HEAD would fast-forward happily).
    fs.rmSync(hook);
    git(['push', '-q', 'aaa-fork', f.branch], f.worktree, f.env); // setup, not the subject's push
    assert.equal(
      git(['rev-parse', remoteRef], f.forkBare, f.env), head,
      '4.T5(b) site 253: the setup push must have landed in the FIXTURE bare before the lease can be '
      + 'staled — otherwise arm (b) would re-run arm (a)\'s `-u` branch at :255',
    );
    git(['update-ref', remoteRef, parent], f.forkBare, f.env);
    res = land(f, '4.T5(b) site 253');
    assertRefused(res, 'push refused', '4.T5(b) site 253 — the lease was stale');
    assertPrecedesRefusal(
      res.stderr,
      new RegExp(`^ ! \\[rejected\\] +${f.branch} -> ${f.branch} \\(stale info\\)$`, 'm'),
      '4.T5(b) site 253 — the lease was stale',
    );

    // --- arm (c), site 258: refresh the lease with an EXPLICIT refspec (an opportunistic
    // remote-tracking update is not something to rely on), so the push at :253 now succeeds. This is
    // the suite's ONE real `git push` by the subject, and it lands in the fixture's own bare repo.
    // One line later sync.sh:258 runs `gh pr create --repo "$SLUG"` — and `gh` is absent from the
    // derived PATH (NFR9b), so the command substitution fails and `fail "gh pr create failed"` fires.
    //
    // WHAT THIS PROVES, AND WHAT IT DOES NOT. It pins that the script REFUSES rather than proceeding
    // when its tooling is absent. It does NOT exercise a GitHub-reported API failure: no PR is
    // created, no network is touched, and no `gh` runs. A `gh`-present variant is deliberately not
    // built — that is the one thing NFR9 exists to make impossible.
    git(['fetch', '-q', 'aaa-fork', trackingRefspec], f.worktree, f.env);
    res = land(f, '4.T5(c) site 258');
    assertRefused(res, 'gh pr create failed', '4.T5(c) site 258 — gh is absent from the derived PATH');
    assertPrecedesRefusal(
      res.stderr, /^.*sync\.sh: line 258: gh: command not found$/m,
      '4.T5(c) site 258 — gh is absent from the derived PATH',
    );

    // THE PUSH LANDED, AND ONLY IN THE FIXTURE BARE. Asserted rather than assumed: this is the single
    // place in the suite where the subject writes to a repository, and the whole NFR9/NFR4 argument
    // rests on where that write went.
    assert.equal(
      git(['rev-parse', remoteRef], f.forkBare, f.env), head,
      `4.T5(c) site 258: the subject's one real push must have advanced ${remoteRef} in the FIXTURE `
      + `bare (${f.forkBare}) to the worktree HEAD ${head} — that is what makes 258 reachable at all`,
    );
    assert.ok(
      f.forkBare.startsWith(f.root + path.sep),
      `4.T5(c) site 258: the pushed-into bare must sit under this test's own mkdtemp root — it is `
      + `${f.forkBare}, the root is ${f.root}`,
    );
  } finally {
    f.cleanup();
  }
});
