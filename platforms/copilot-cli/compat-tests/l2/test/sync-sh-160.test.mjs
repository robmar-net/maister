// sync-sh-160.test.mjs — #161 module 2: the PR #160 acceptance case, its pre-#160 control, that control's provenance, and the two topology-D mutations (spec § 3.2).
//
// CREDIT-FREE AND HERMETIC. Nothing here drives a live Copilot session, opens a network connection, or
// touches the real repository. Two locks make an accidental real `gh pr create` impossible (NFR9):
// (a) every spawn's `PR_REPO_SLUG` is a harmless fixture slug AND the fixture's fork-bare path embeds
// that same slug, because `remote_for` (sync.sh:67-74) resolves the push target from the URL string;
// (b) the derived PATH is built by FILTERING OUT every directory holding an executable `gh`, never by
// whitelisting. `assertNoGh()` runs at MODULE SCOPE below, before any `test(...)` and hence before the
// first spawn — per module, because `node --test` gives each FILE its own process (NFR9b).
//
// WHY 2.T2 EXISTS. This ticket was planned `has_reproducible_defect: false`, which removed the TDD red
// gate. 2.T2 IS THE SUBSTITUTE FOR IT, and is declared FIRST for that reason. It asserts both that the
// fix's oracles FAIL against the vendored pre-#160 bytes and — the load-bearing half — that both
// old-code strings are PRESENT, so a crash or a bad temp path cannot read as a passing control.
//
// SCOPE LIMITS, BY LINE NUMBER — the `sweep-sh.test.mjs:38-44` model. Stated out loud, never hidden:
//   * SIX `fail` sites are unreachable hermetically, behind a SUCCESSFUL `gh pr create` at :258 (`num`
//     is assigned at :259): 266, 269, 273, 274, 276, 288 — declared as DATA by 1.T7's census.
//   * sync.sh:229's `fail` is UNREACHABLE (issue #166) — pinned as a DEFECT by 4.T2(a) in the ladder
//     module, not laundered into the exclusion list.
//   * This module reaches 204, 213, 216 and the L3 SUCCESS log at :201, and NOTHING at or past :225 —
//     every spawn refuses at or before :216, so no `make` target and no nested `node --test` runs here.
//   * EXACTLY ONE assertion in this PR may skip, and it is in 2.T3 (NFR8, § 9.5): its gate is the blob
//     the assertion READS, `git cat-file -e 9765a95^:scripts/sync.sh`. Peeling `9765a95` to its own
//     commit object is FORBIDDEN — 2.T3 records the depth-3 window that probe leaves open.
//
// SOURCING IS NOT AN OPTION, and the limit is stated rather than half-implemented: sync.sh:295-300 is a
// bare top-level `case` with no `main`-guard, so `. scripts/sync.sh` runs `usage` and exits 2 out of the
// caller. Every check is therefore a `bash <script>` spawn or a read of the source TEXT — the vendored
// bytes through the SAME `runSync` helper via its `script` argument, so spawn, env and streams match.
//
//   2.T2 (FR3) — THE CONTROL, first: the vendored pre-#160 bytes fail BOTH oracles, and both old-code
//        strings are asserted PRESENT so the control discriminates on both halves.
//   2.T1 (FR2) — THE ACCEPTANCE CASE: both oracles from ONE `land` spawn on topology D, with `HEAD^2`
//        confirmed to be fork master and the logged upstream SHA confirmed different from it.
//   2.T3 (FR3) — the fixture IS the real `9765a95^` bytes: 289 lines / 17792 bytes / sha256, asserted
//        UNCONDITIONALLY, plus the one permitted named skip.  2.T4 (FR1) — :204 refuses COMMITTED
//        conflict residue.  2.T5 (FR1) — :213 refuses when the three manifests disagree.
//
// NFR5 — no line in this file begins with seven `<` or seven `>` followed by a space. This is the module
// that deliberately writes conflict markers into a fixture, so `marker()` (at 2.T4) builds them by
// CONCATENATION at runtime: sync.sh:204's guard is anchored at column 0 across all TRACKED files.
//
// Zero dependencies (`node:` builtins) and self-cleaning: every fixture root goes in its own `finally`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertNoGh, assertRefused, makeFixture, PRE160_FIXTURE, REPO_ROOT, runSync,
} from './helpers/sync-sh-harness.mjs';

// NFR9b — the per-module precondition, at MODULE SCOPE and before any `test(...)` declaration.
assertNoGh();

// The three digests § 1.1 pins for deliverable 2. Named constants because 2.T3 asserts them and the
// provenance sidecar repeats them: a drift between the two is then a one-line diff, not an argument.
const PRE160_LINES = 289;
const PRE160_BYTES = 17792;
const PRE160_SHA256 = '87b6661ec1f5aff94f63329d4b8d5714145f2067558447d77f090b80afff5bb3';
const PRE160_BLOB = '9765a95^:scripts/sync.sh';

// Topology D's pinned versions (§ 4.3): B = 2.2.3+fork.3, X = 2.2.4, C = 2.2.3+fork.4,
// M' = 2.2.3+fork.5, S = 2.2.3+fork.4, and HEAD (= T) carries `headver`.
const D_HEADVER = '2.2.3+fork.5';
const D_213_HEADVER = '2.2.4+fork.1';

// Run `git` inside a fixture with that fixture's isolated env and return trimmed stdout. Separate from
// the harness's internal helper on purpose: these are READS the oracles depend on, so a non-zero exit
// must fail loudly here rather than be tolerated.
function gitOut(args, cwd, env) {
  const res = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  assert.equal(res.error, undefined, `git ${args.join(' ')} could not be spawned: ${res.error && res.error.message}`);
  assert.equal(
    res.status, 0,
    `the oracle's own read \`git ${args.join(' ')}\` in ${cwd} exited ${res.status}; an oracle that `
    + `cannot read the fixture must fail loudly, never skip (NFR8)\n${res.stdout}${res.stderr}`,
  );
  return (res.stdout ?? '').trim();
}

// `land` needs a title AND an existing --body-file, or sync.sh:168 exits 2 via usage before any guard.
function bodyFileIn(root) {
  const p = path.join(root, 'sync-body.md');
  fs.writeFileSync(p, '# fixture PR body\n\nland-pipeline fixture body; never published.\n');
  return p;
}

const landArgs = (body) => ['land', 'sync upstream 2.2.4', '--body-file', body];

// ------------------------------------------------------------------------------------------- 2.T2
// THE CONTROL — and this module exists for it. It is the substitute for the TDD red gate that
// `has_reproducible_defect: false` removed (see the header), so it is declared before the green half.
//
// The pre-#160 defect, verbatim from the vendored bytes: `:178` takes
// `upstream_sha="$(git rev-parse HEAD^2)"` — PARENT POSITION, not the remote by slug. On topology D
// `HEAD^2` is OUR OWN master M', so the old script reads our fork version as "upstream" and its `:190`
// logs an L3 line carrying NO SHAs at all. Both halves are asserted:
//   absent  — `L3 contains … and upstream …; merge commit present` (the fixed log) and `→ 2.2.4`
//   present — `L3 <fork>/master is an ancestor of HEAD` and `the upstream base moved 2.2.3 → 2.2.3+fork.5`
// Asserting only the ABSENCE half would let an unrelated crash — a bad temp path, a missing manifest, a
// `bash` that never got past L1 — read as a passing control. The presence half is what makes it
// discriminate.
//
// The bytes are DATA, never code (deliverable 3's sidecar states the same rule): if this control ever
// goes green, the defect has been re-introduced or the fixture has been edited. Never edit the fixture
// to "fix" a failing control.
test('2.T2 (#161 FR3): the pre-#160 control — the vendored bytes fail BOTH #160 oracles on topology D, '
  + 'and both old-code strings are asserted PRESENT so an unrelated crash cannot pass as a control', () => {
  const f = makeFixture({ topology: 'D' });
  try {
    // Copied to a temp file inside the fixture's OWN mkdtemp root: the vendored path is tracked and
    // mode 0644, and a temp copy under the root has no lifecycle of its own — it goes with `cleanup()`
    // (NFR7). A second mkdtemp here would be a second thing to own for no gain, and `node --test` runs
    // files concurrently, so it must never be a shared `os.tmpdir()` path (`run-sh.test.mjs:196-199`).
    const oldScript = path.join(f.root, 'pre-160-sync.sh');
    fs.copyFileSync(PRE160_FIXTURE, oldScript);

    const res = runSync(landArgs(bodyFileIn(f.root)), {
      cwd: f.worktree, env: f.env, script: oldScript,
    });

    // --- the two CURRENT strings must be ABSENT ------------------------------------------------
    assert.doesNotMatch(
      res.stderr, /L3 contains \S+\/master \S+ and upstream \S+; merge commit present/,
      'FR3: the pre-#160 bytes cannot emit the FIXED L3 log — their :190 logs `L3 <fork>/master is an '
      + 'ancestor of HEAD` with no SHAs at all. A match here means the temp copy is NOT the pre-#160 '
      + `script (check PRE160_FIXTURE and 2.T3's digests)\n--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      !res.stderr.includes('the upstream base moved 2.2.3 → 2.2.4'),
      'FR3: the pre-#160 bytes cannot report the real upstream version, because their :178 reads '
      + '`HEAD^2` — our own master on topology D — instead of resolving upstream from the remote by '
      + `slug\n--- stderr:\n${res.stderr}`,
    );

    // --- the two OLD-CODE strings must be PRESENT ----------------------------------------------
    // This is the half that stops the control passing on an unrelated crash.
    assert.ok(
      res.stderr.includes(`L3 ${'aaa-fork'}/master is an ancestor of HEAD`),
      'FR3: the pre-#160 L3 log must be observed VERBATIM — without it this control could be passing '
      + 'because the run died at L1/L2 and never reached L3 at all, which proves nothing about #160\n'
      + `--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      res.stderr.includes(`the upstream base moved 2.2.3 → ${D_HEADVER}`),
      `FR3: the pre-#160 L5 must refuse with the WRONG upstream version (${D_HEADVER} = M', our own `
      + 'master, arriving via `HEAD^2`). That string IS the #160 defect; observing it is what makes '
      + `this a control rather than a coincidence\n--- stderr:\n${res.stderr}`,
    );

    // The old script still refuses in the taxonomy's shape, which is why 2.T1's green is a CHANGE of
    // message rather than a change of exit code — the defect never announced itself as a crash.
    assertRefused(res, `the upstream base moved 2.2.3 → ${D_HEADVER}`, 'FR3 control (vendored :205)');
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 2.T1
// THE #160 ACCEPTANCE CASE — both oracles from ONE `land` spawn, because a fix that needed two runs to
// demonstrate would not be one fix. Topology D puts `HEAD^1 = S` (the sync merge) and
// `HEAD^2 = M' = aaa-fork/master` — OUR OWN master as the second parent. That is the entire point of
// the topology: it is the shape the old `HEAD^2` reading gets wrong, and it is produced by following
// sync.sh:195's own advice (`git merge $fork/master`), so it is the NORMAL shape, not a contrived one.
//
// Oracle (a), sync.sh:201 — the L3 success log names BOTH short SHAs, and the logged upstream SHA is
// NOT `HEAD^2`. Oracle (b), sync.sh:216 — the refusal reports `2.2.3 → 2.2.4`, which witnesses that
// `upstream_sha` came from `remote_for "$UPSTREAM_SLUG"` (:189-191) and not from parent position: X's
// version is 2.2.4 and M''s is 2.2.3+fork.5, so the two readings are textually distinguishable.
test('2.T1 (#161 FR2): the #160 acceptance case — one `land` spawn on topology D satisfies BOTH oracles: '
  + 'sync.sh:201 logs fork master and the upstream tip as two DIFFERENT short SHAs, and sync.sh:216 '
  + 'reports the real upstream version, proving `upstream_sha` is resolved by slug and not by `HEAD^2`', () => {
  const f = makeFixture({ topology: 'D' });
  try {
    // The topology's own premise, asserted before the oracles: if `HEAD^2` were NOT fork master the
    // run would pass for the wrong reason and #160 would be untested.
    const head2 = gitOut(['rev-parse', 'HEAD^2'], f.worktree, f.env);
    const forkMaster = gitOut(['rev-parse', 'aaa-fork/master'], f.worktree, f.env);
    assert.equal(
      head2, forkMaster,
      'FR2: topology D must put OUR OWN master as HEAD^2 — that is the shape PR #160 fixed. '
      + `HEAD^2 is ${head2} and aaa-fork/master is ${forkMaster}`,
    );
    const shortHead2 = gitOut(['rev-parse', '--short', 'HEAD^2'], f.worktree, f.env);
    const shortUpstreamTip = gitOut(['rev-parse', '--short', 'zzz-upstream/master'], f.worktree, f.env);

    const res = runSync(landArgs(bodyFileIn(f.root)), { cwd: f.worktree, env: f.env });

    // --- oracle (a): sync.sh:201, both short SHAs present -------------------------------------
    const l3 = res.stderr.match(/L3 contains (\S+)\/master (\S+) and upstream (\S+); merge commit present/);
    assert.ok(
      l3,
      'FR2 oracle (a): sync.sh:201 must log `L3 contains <fork>/master <short base> and upstream '
      + '<short upstream>; merge commit present` — the pre-#160 log carried NO SHAs, so the SHAs are '
      + `the observable half of the fix\n--- stderr:\n${res.stderr}`,
    );
    const [, loggedRemote, loggedBase, loggedUpstream] = l3;
    assert.equal(
      loggedRemote, 'aaa-fork',
      'FR2 oracle (a): the logged remote is resolved BY SLUG, so it must be the deliberately '
      + `misleading fixture name \`aaa-fork\`, not a name-ordering accident; got ${loggedRemote}`,
    );
    assert.equal(
      loggedBase, shortHead2,
      `FR2 oracle (a): sync.sh:201 logs fork master, which on topology D IS HEAD^2 (${shortHead2}); `
      + `it logged ${loggedBase}`,
    );
    assert.equal(
      loggedUpstream, shortUpstreamTip,
      'FR2 oracle (a): the logged upstream SHA must be the tip of the UPSTREAM remote '
      + `(${shortUpstreamTip}); it logged ${loggedUpstream}`,
    );
    assert.notEqual(
      loggedUpstream, shortHead2,
      'FR2 oracle (a) — THE DISCRIMINATING ASSERTION: the logged upstream SHA must differ from '
      + `\`git rev-parse --short HEAD^2\` (${shortHead2}). If they were equal, sync.sh would still be `
      + 'reading upstream from parent position and #160 would be unfixed, whatever the log says',
    );

    // --- oracle (b): sync.sh:216, the real upstream version ------------------------------------
    // AC2: a multiline `contains` on the discriminating fragment, never `startsWith` — and AC5: the
    // fragment, not the whole advice sentence. `2.2.3 → 2.2.4` is `${basever%%+*} → $upver`, i.e. fork
    // master's base and the UPSTREAM tip's version. The pre-#160 bytes print `2.2.3 → 2.2.3+fork.5`
    // here (2.T2), which is the same sentence with our own master's version in upstream's place.
    assertRefused(
      res, 'the upstream base moved 2.2.3 → 2.2.4',
      'FR2 oracle (b) (sync.sh:216)',
    );
    assert.ok(
      !res.stderr.includes(`→ ${D_HEADVER},`),
      'FR2 oracle (b): the refusal must NOT name our own master version as the upstream one — that is '
      + `the pre-#160 reading, pinned by 2.T2\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 2.T3
// The control is only a control if the bytes it runs are the real pre-fix script. `l2-check.yml:38`
// sets no `fetch-depth`, so CI checks out at depth 1 and `9765a95^` is absent there — which is why the
// script is VENDORED (S4) and why the three digests below are UNCONDITIONAL. They are the pin; the
// history comparison is a bonus that confirms the vendoring on a clone deep enough to hold the blob.
test('2.T3 (#161 FR3): the vendored pre-#160 fixture is pinned by line count, byte length and sha256 '
  + 'UNCONDITIONALLY; only its byte-for-byte comparison against git history may skip, by a named reason', async (t) => {
  const bytes = fs.readFileSync(PRE160_FIXTURE);
  const text = bytes.toString('utf8');

  assert.equal(
    text.split('\n').length - 1, PRE160_LINES,
    `FR3: deliverable 2 must be the ${PRE160_LINES}-line pre-#160 script; a different length means the `
    + 'vendored bytes are not the ones § 1.1 pins, and 2.T2 is then controlling against something else',
  );
  assert.equal(
    bytes.length, PRE160_BYTES,
    `FR3: deliverable 2 must be exactly ${PRE160_BYTES} bytes (§ 1.1). Byte length catches a line-ending `
    + 'or trailing-newline rewrite that the line count alone would not',
  );
  assert.equal(
    crypto.createHash('sha256').update(bytes).digest('hex'), PRE160_SHA256,
    `FR3: deliverable 2's sha256 must be ${PRE160_SHA256} (§ 1.1). This is the assertion that makes the `
    + 'fixture DATA rather than editable code: it must never be "fixed" to match a changed file',
  );

  // THE PROBE TESTS THE OBJECT THE ASSERTION READS — the blob at a path in `9765a95`'s PARENT tree.
  // Peeling `9765a95` to its own commit object instead is forbidden (see the header): measured over
  // clone depths 1-7 of this repository, at depth 3 that probe exits 0 while `git show` exits 128, so
  // the probe passes, the assertion runs, and this test ERRORS instead of skipping. `git cat-file -e`
  // on the blob tracks the assertion exactly at every depth.
  const probe = spawnSync('git', ['-C', REPO_ROOT, 'cat-file', '-e', PRE160_BLOB], { encoding: 'utf8' });
  const skip = probe.status === 0
    ? false
    : `the pre-#160 blob \`${PRE160_BLOB}\` is absent from this clone; the vendored digests above still `
      + 'pin the bytes';

  // THE ONE PERMITTED SKIP IN THIS PR (NFR8, § 9.5), in the `variants.test.mjs:407-413` shape. It is
  // scoped to this single assertion: the three digests above have already run, and the FR3 control
  // (2.T2) never skips at all, because it runs the vendored bytes rather than git history.
  await t.test('2.T3b: the vendored bytes equal `git show 9765a95^:scripts/sync.sh` byte-for-byte', { skip }, () => {
    const show = spawnSync('git', ['-C', REPO_ROOT, 'show', PRE160_BLOB], { maxBuffer: 8 * 1024 * 1024 });
    assert.equal(
      show.status, 0,
      `FR3: the probe said \`${PRE160_BLOB}\` is present, so \`git show\` must succeed; it exited `
      + `${show.status}. A divergence here means the probe and the assertion read different objects — `
      + `exactly the failure mode that peeling ${PRE160_BLOB.split(':')[0]} to a commit reintroduces\n`
      + `${show.stderr}`,
    );
    assert.ok(
      show.stdout.equals(bytes),
      'FR3: the vendored fixture must be the real `9765a95^` bytes, verbatim. A mismatch means the '
      + 'vendoring drifted from history, so 2.T2 is controlling against a script that never shipped',
    );
  });
});

// ------------------------------------------------------------------------------------------- 2.T4
// sync.sh:204 is `! git grep -qE '^(…|…) ' -- . || fail "conflict markers are still in the tree"` —
// anchored at column 0 across all TRACKED files. Two consequences, and this test depends on both:
//   * the residue must be COMMITTED, not merely present: L1 (:176) refuses a dirty tree first, so an
//     uncommitted marker would trip the wrong site;
//   * NFR5 — the markers are built by CONCATENATION at runtime and kept mid-line, so no source line in
//     this file begins with the run of characters the guard greps for. A marker at column 0 in a
//     TRACKED test file makes real `sync.sh land` refuse forever, blaming "the tree". That is the
//     difference between testing the guard and bricking it.
// Extra commits on top of `T` do not disturb L3 or L5 (verified, § 6.4), and 204 sits BEFORE the
// version branch at 215, so topology D's own `headver` never gets a chance to fire 216 here.
const marker = (ch, rest) => `${ch.repeat(7)} ${rest}`;

test('2.T4 (#161 FR1): sync.sh:204 refuses a tree carrying COMMITTED conflict residue — the markers are '
  + 'built by concatenation at runtime so no line of this file can brick the guard it tests', () => {
  const f = makeFixture({ topology: 'D' });
  try {
    const rel = 'CONFLICTED.md';
    fs.writeFileSync(path.join(f.worktree, rel), [
      '# a file carrying UNRESOLVED conflict residue (site 204)',
      marker('<', 'HEAD'),
      'ours',
      '=======',
      'theirs',
      marker('>', 'upstream'),
      '',
    ].join('\n'));
    // Explicit path, never `-A`: this is a throwaway fixture repo, but naming the file is what makes a
    // stray impossible to sweep in silently (GOV3's reasoning, applied for its own sake).
    gitOut(['add', rel], f.worktree, f.env);
    gitOut(['commit', '-q', '-m', 'commit conflict residue (site 204)'], f.worktree, f.env);
    assert.equal(
      gitOut(['status', '--porcelain'], f.worktree, f.env), '',
      'the residue must be COMMITTED: sync.sh:176 refuses a dirty tree before L4 is ever reached, so a '
      + 'leftover working-tree change would make this test assert the wrong site',
    );

    const res = runSync(landArgs(bodyFileIn(f.root)), { cwd: f.worktree, env: f.env });
    assertRefused(res, 'conflict markers are still in the tree', 'FR1 site 204 (L4 residue)');
    assert.ok(
      res.stderr.includes('L3 contains '),
      'site 204 sits AFTER L3, so the L3 success log must precede the refusal — without it this test '
      + `could be passing on an earlier guard\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------------------------------------------------------- 2.T5
// sync.sh:212-214 loops over the three manifests BEFORE the version branch at 215, so a disagreement
// refuses at 213 and nothing past it is reached. Topology D(213) sets `plugin.json` (the file :211
// reads `headver` from) to 2.2.4+fork.1 and leaves `.claude-plugin/marketplace.json` at 2.2.3+fork.5.
//
// AC2 NOTE, recorded here so it is not mis-cited: site 213 emits a SINGLE CLEAN refusal line — the
// loop's first entry is `marketplace.json`, so nothing precedes the refusal on stderr. 213 is therefore
// NOT the site to cite as AC2's example of "other output before the REFUSED line"; site 226
// (`make: *** [validate] Error 1`) is. The multiline `contains` is still used, because the rule is
// about the assertion shape and not about which sites happen to need it.
test('2.T5 (#161 FR1): sync.sh:213 refuses when the three manifests disagree — marketplace.json left at '
  + '2.2.3+fork.5 while plugin.json reads 2.2.4+fork.1', () => {
  const f = makeFixture({ topology: 'D(213)' });
  try {
    const res = runSync(landArgs(bodyFileIn(f.root)), { cwd: f.worktree, env: f.env });
    assertRefused(
      res,
      `.claude-plugin/marketplace.json version is ${D_HEADVER}, not ${D_213_HEADVER}`,
      'FR1 site 213 (L5 manifest agreement)',
    );
    // The loop refuses at its FIRST disagreeing entry, so the version branch at 215-220 is never
    // entered: proving 216's message absent is what shows 213 is the site under test.
    assert.ok(
      !res.stderr.includes('the upstream base moved'),
      'site 213 refuses BEFORE the version branch at 215, so 216\'s message must be absent — its '
      + `presence would mean the manifest loop was passed and this test is pinning 216, not 213\n`
      + `--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});
