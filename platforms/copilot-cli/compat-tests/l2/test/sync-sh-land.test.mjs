// sync-sh-land.test.mjs — #161 module 3: the L3/L5 topology refusals of `scripts/sync.sh land` and the
// `cmd_start` tripwire tier — the only sanctioned way to land an UPSTREAM MERGE (AGENTS.md, spec § 3.3).
//
// CREDIT-FREE AND HERMETIC. Nothing here drives a live Copilot session, opens a network connection or
// touches the real repository; every repository is built fresh by `makeFixture` under its own `mkdtemp`
// root (§ 4.1), never copied (NG7: a `cp -R` keeps the SOURCE root's paths in the gitdir pointer and in
// every remote URL, so it pushes into the source's bare repo). Two locks make a real `gh pr create`
// impossible (NFR9): every spawn's `PR_REPO_SLUG` is a harmless fixture slug AND the fork-bare path
// embeds it, since `remote_for` (sync.sh:67-74) keys on the URL string; and the derived PATH FILTERS OUT
// every directory holding an executable `gh`. `assertNoGh()` runs at MODULE SCOPE below, before the
// first spawn — per module, because `node --test` gives each FILE its own process (NFR9b, § 9.1).
//
// THE CONTROL THAT MAKES EVERY CLAIM BELOW MEAN SOMETHING (steps 11.2/12.1, § 12.2). Each test asserts
// the run REACHED its intended guard — the preceding `L1`-`L4` (land) or `S1`/`S3` (start) success lines
// are on stderr and no crash marker is — BEFORE it asserts the refusal. A missing-manifest error, a
// `grep:` error or a git `fatal:` means the run stopped EARLIER and the refusal is another site's;
// reading one as evidence of reaching a guard is the misreading that failed revision 1's audit. The ONE
// exemption is 3.T7(c), where the `grep:` line IS the mechanism under test — see its comment. All three
// manifests agree in every topology here: sync.sh:212-214 loops over them before 215, else 213 refuses.
//
// SCOPE LIMITS, BY LINE NUMBER. Six sites: 195, 197, 200, 220 under `land`, and 112, 121 under `start`
// — which takes NO arguments, so it shares no args path with `land`. The L6-L9 ladder (225-258) is
// `sync-sh-ladder.test.mjs`; script shape, `usage` and the census are `sync-sh.test.mjs`.
//
//   3.T1 (FR1) — site 195: L3 refuses when fork master moved and was NOT merged (topology A).
//   3.T2 (FR1) — site 197: L3 refuses when upstream advanced to `X2` after the sync merged (topology B).
//        Its `is NOT an ancestor of HEAD` differs from 195's by CAPITALISATION alone — hence AC5.
//   3.T3 (FR1) — site 200: L3 refuses a branch carrying no merge commit of its own (topology C).
//   3.T4 (FR1) — site 220: L5 refuses when the base is unchanged and `headver` lacks the `+fork.`
//        shape (topology E: upstream advanced WITHOUT bumping, so `upver == basever%%+*`).
//   3.T5 (FR1) — site 112, two spawns on ONE `D-at-step-3` fixture carrying alias `zeta`: (a)
//        `assertRefused` on `the build.sh step-3b map does not know: zeta`; (b) commit a `zeta)` label
//        and the SAME fixture logs `zeta (all mapped)` and exits 0. Without (b) this IS 3.T7(c).
//   3.T6 (FR1) — site 121: an EMPTY `.worktrees/sync-2.2.4` (the test is `-e`) refuses `worktree
//        already exists`; alias `haiku` is mapped, so the run gets past 112 to reach 121.
//   3.T7 (FR8/D8) — three `sync.sh:110` fragilities on one fixture, issue 4 (#167), alias
//        `claude.haiku`: (a) a `case` label OUTSIDE the step-3b block is accepted, the grep scans the
//        whole file; (b) `claudeXhaiku)` alone still logs `all mapped`, the unquoted `${a}` making `.`
//        an ERE wildcard; (c) no `build.sh` ⇒ grep exits 2 ⇒ 112 trips for a MAPPED alias.
//   3.T8 (FR8/D9) — `sync.sh:113`'s `&&` list is falsy with no aliases and does NOT abort under
//        `set -e`: no `S3 incoming model:` line, yet the run reaches S4 (exit 0, stdout = the worktree).
//
// Zero dependencies — `node:` builtins only — and self-cleaning: every fixture root is removed in its
// own test's `finally`, so it goes on an assertion failure too, never a global `after()`. NFR5: no line
// here begins with seven `<` or `>` plus a space, so a real `land` cannot refuse at 204 over this tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertNoGh, assertRefused, FIXTURE_SLUG, makeFixture, runSync,
} from './helpers/sync-sh-harness.mjs';

// NFR9b — the per-module precondition, at MODULE SCOPE and before any `test(...)` declaration.
assertNoGh();

// The `land` success logs, as sync.sh emits them (177, 182, 201, 205). Each is matched on its STABLE
// part only: `L1`'s carries the worktree path and branch, `L3`'s two short SHAs (AC5).
const L1_LOG = 'L1 worktree ';
const L1_LOG_TAIL = ', tree clean';
const L2_LOG = `L2 push target: aaa-fork → ${FIXTURE_SLUG}`;
const L3_LOG = 'L3 contains aaa-fork/master ';
const L3_LOG_TAIL = '; merge commit present';
const L4_LOG = 'L4 no conflict residue';

// Text that only a run which stopped BEFORE its intended guard produces: git's `fatal:`, the `grep:`
// of a missing `build.sh`, and the "No such file or directory" of an absent manifest or tool. No
// topology below can legitimately emit any of them, so their presence means the refusal asserted
// afterwards belongs to some earlier site (§ 12.2, revision 1's audit failure). THE SINGLE EXCEPTION is
// 3.T7(c), which removes `build.sh` on purpose and therefore MUST NOT use this list — see its comment.
const CRASH_MARKERS = ['fatal:', 'grep:', 'No such file or directory'];

// ------------------------------------------------------------------------------------ the control
// Called BEFORE `assertRefused` in every test but 3.T7(c), never after: the order is the whole point.
// `logs` is the list of guards that must have SUCCEEDED for the site under test to be the one tripped.
function assertReachedGuard(res, { site, logs }) {
  for (const marker of CRASH_MARKERS) {
    assert.ok(
      !res.stderr.includes(marker),
      `site ${site}: the run must reach the guard, not crash before it — stderr carries `
      + `${JSON.stringify(marker)}, which means it stopped at an earlier line (a missing manifest, a `
      + `missing build.sh or a git fatal). A refusal asserted after this would be attributed to the `
      + `wrong site (§ 12.2)\n--- stderr:\n${res.stderr}`,
    );
  }
  for (const line of logs) {
    assert.ok(
      res.stderr.includes(line),
      `site ${site}: the preceding guard's success line ${JSON.stringify(line)} must be on stderr — `
      + `without it the run never reached site ${site} and the refusal below is another site's\n`
      + `--- stderr:\n${res.stderr}`,
    );
  }
}

// `land` needs a title and an existing `--body-file` (sync.sh:168) before L1 runs at all, so every
// fixture gets one inside its own root (NFR4 — nothing is written outside the mkdtemp root).
function landArgs(root) {
  const body = path.join(root, 'pr-body.md');
  fs.writeFileSync(body, '# fixture PR body\n\nland-pipeline fixture — see sync-sh-land.test.mjs\n');
  return ['land', 'sync: fixture upstream merge', '--body-file', body];
}

// -------------------------------------------------------------------------------------------- 3.T1
test('3.T1 land refuses at sync.sh:195 when fork master moved and was not merged (topology A)', () => {
  // Topology A: D truncated after `S`, then `M'` pushed to fork master and NEVER merged. HEAD is `S`,
  // so `aaa-fork/master` (= M') is not contained in it. `headver` is 2.2.3+fork.4 and all three
  // manifests agree, but L5 is never reached — L3 refuses first.
  const f = makeFixture({ topology: 'A' });
  try {
    const res = runSync(landArgs(f.root), { cwd: f.worktree, env: f.env });

    // The control FIRST: L1 and L2 succeeded, so the run is inside L3.
    assertReachedGuard(res, { site: 195, logs: [L1_LOG, L1_LOG_TAIL, L2_LOG] });
    assert.ok(
      !res.stderr.includes(L3_LOG),
      'site 195: L3 must NOT have logged success — a run that printed the L3 line passed all three of '
      + `its checks and refused somewhere later\n--- stderr:\n${res.stderr}`,
    );

    // AC5 — the short discriminating fragment, lower-case `not`, never the whole advice sentence.
    assertRefused(res, 'is not an ancestor of HEAD', 'site 195 (topology A, fork master moved)');
    assert.ok(
      res.stderr.includes('aaa-fork/master is not an ancestor of HEAD'),
      'site 195: the refusal names the FORK remote resolved by slug (AGENTS.md:347-356), not a '
      + `hardcoded remote name\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// -------------------------------------------------------------------------------------------- 3.T2
test('3.T2 land refuses at sync.sh:197 when upstream advanced to X2 after the sync merged (topology B)', () => {
  // Topology B: D truncated after `S`, then upstream advances to `X2`. Fork master is still `C`, which
  // IS an ancestor of `S`, so site 195 passes and 197 is the first refusal — that ordering is what
  // makes the two fragments discriminating rather than interchangeable.
  const f = makeFixture({ topology: 'B' });
  try {
    const res = runSync(landArgs(f.root), { cwd: f.worktree, env: f.env });

    assertReachedGuard(res, { site: 197, logs: [L1_LOG, L1_LOG_TAIL, L2_LOG] });
    assert.ok(
      !res.stderr.includes('is not an ancestor of HEAD'),
      'site 197: the fork-master check at 195 must have PASSED — its lower-case fragment on stderr '
      + `would mean this run refused at 195 instead\n--- stderr:\n${res.stderr}`,
    );

    // AC5 — note the capitalisation: 197 says `is NOT`, 195 says `is not`. Coupling to the whole
    // sentence would hide that the two sites are distinguished by this one word.
    assertRefused(res, 'is NOT an ancestor of HEAD', 'site 197 (topology B, upstream advanced)');
    assert.ok(
      res.stderr.includes('upstream SkillPanel/maister@'),
      'site 197: the refusal names the UPSTREAM slug hardcoded at sync.sh:60 and the short SHA it '
      + `resolved from the upstream remote\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// -------------------------------------------------------------------------------------------- 3.T3
test('3.T3 land refuses at sync.sh:200 when the branch carries no merge commit of its own (topology C)', () => {
  // Topology C: D truncated after `S`, then `S` pushed to fork master — so `HEAD == fork master` and
  // the merge is already on master. Both ancestry checks pass (195, 197) and
  // `git rev-list --merges HEAD ^base_sha` is therefore EMPTY, which is the real invariant 200 states:
  // a squashed or rebased sync leaves nothing recording that we merged at all.
  const f = makeFixture({ topology: 'C' });
  try {
    const res = runSync(landArgs(f.root), { cwd: f.worktree, env: f.env });

    assertReachedGuard(res, { site: 200, logs: [L1_LOG, L1_LOG_TAIL, L2_LOG] });
    assert.ok(
      !res.stderr.includes('ancestor of HEAD'),
      'site 200: both ancestry checks (195, 197) must have PASSED — either fragment on stderr would '
      + `mean this run refused before reaching the merge-commit check\n--- stderr:\n${res.stderr}`,
    );

    assertRefused(res, 'carries no merge commit of its own', 'site 200 (topology C, HEAD == fork master)');
  } finally {
    f.cleanup();
  }
});

// -------------------------------------------------------------------------------------------- 3.T4
test('3.T4 land refuses at sync.sh:220 when the base is unchanged and headver lacks the +fork. shape (topology E)', () => {
  // Topology E: the same graph as D, but `X = 2.2.3` — upstream advanced WITHOUT bumping — and
  // `headver = 2.2.3`. So `upver` equals `basever%%+*` (2.2.3+fork.5 → 2.2.3), the `if` at 215 takes
  // its `else` at 218, and the `case` finds no `2.2.3+fork.` prefix. This is the ONE arm of L5 that
  // needs an unmoved base; the moved-base arm is site 216 and belongs to topology D.
  const f = makeFixture({ topology: 'E' });
  try {
    const res = runSync(landArgs(f.root), { cwd: f.worktree, env: f.env });

    // The deepest control in this module: L1, L2, L3 and L4 all logged success, so the run is inside
    // L5 with all three manifests already agreeing (the 213 loop ran and passed).
    assertReachedGuard(res, {
      site: 220,
      logs: [L1_LOG, L1_LOG_TAIL, L2_LOG, L3_LOG, L3_LOG_TAIL, L4_LOG],
    });
    assert.ok(
      !res.stderr.includes('all three manifests must agree'),
      'site 220: the 213 loop must have PASSED — a manifest disagreement would refuse at 213, before '
      + `the version branch at 215 is ever evaluated\n--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      !res.stderr.includes('the upstream base moved'),
      'site 220: the base must be UNCHANGED so that 215 takes its `else`; site 216\'s fragment on '
      + `stderr would mean the fixture moved the base and refused at 216 instead\n`
      + `--- stderr:\n${res.stderr}`,
    );

    assertRefused(res, 'does not carry the', 'site 220 (topology E, base unchanged, no +fork. shape)');
    assert.ok(
      res.stderr.includes('version 2.2.3 does not carry the 2.2.3+fork.N shape'),
      'site 220: the refusal quotes the offending `headver` and the shape it must take, both derived '
      + `from the fixture's pinned versions (§ 4.3)\n--- stderr:\n${res.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// ======================================================================== the `cmd_start` tier
// `start` takes NO ARGUMENTS — `cmd_start` opens with `[ $# -eq 0 ] || usage` (sync.sh:80) — so it
// cannot reuse `landArgs` above: that helper appends a title and a `--body-file`, which would make
// `start` exit 2 at line 80 before reaching a single guard. There is nothing to build, hence a
// constant rather than a function.
const START_ARGS = ['start'];

// `start`'s own success logs. S1 (sync.sh:99) is the guard that must have PASSED for 112 to be the
// site that tripped. S3 (113) is the "every incoming alias is in the map" line, and the
// PRESENCE-vs-ABSENCE of that one line is the whole discrimination in 3.T5, 3.T7 and 3.T8. The remote
// name in S1 is `zzz-upstream` deliberately (harness: "REMOTE NAMES ARE DELIBERATELY MISLEADING") —
// keying on it here would be reading a remote NAME, so only its stable surroundings are matched.
const S1_LOG = 'S1 upstream zzz-upstream → ';
const S1_LOG_TAIL = '(version 2.2.4); our master ';
const S3_ALIAS_PREFIX = 'S3 incoming model: aliases — ';
const s3AliasLog = (list) => `${S3_ALIAS_PREFIX}${list} (all mapped)`;
const MAP_MISS = 'the build.sh step-3b map does not know';

// The four labels the real step-3b map carries, and the one the harness's committed stub must carry
// (§ 4.3). Asserted against the fixture in 3.T5 rather than trusted, because the whole tier collapses
// if that stub is absent.
const REAL_LABELS = ['inherit', 'haiku', 'sonnet', 'opus'];
const BUILD_SH_REL = 'platforms/copilot-cli/build.sh';
const STEP3B_OPEN = 'case "${1:-}" in';
const STEP3B_CLOSE = 'esac';

// ------------------------------------------------------------------- varying the step-3b map
// `labels` land INSIDE the step-3b `case`; `planted` land in a second `case`, inside a function step
// 3b never calls, AFTER `esac`. That split is 3.T7(a)'s entire point: sync.sh:110 greps the whole
// FILE, so a label the step-3b `case` can never reach still reads as "known".
function buildSh({ labels, planted = [] }) {
  const lines = [
    '#!/usr/bin/env bash',
    '# fixture stand-in for platforms/copilot-cli/build.sh — step-3b model-alias map only.',
    'set -euo pipefail',
    STEP3B_OPEN,
    ...labels.map((l) => `  ${l}) ;;`),
    STEP3B_CLOSE,
  ];
  if (planted.length > 0) {
    lines.push(
      '',
      '# A SECOND case statement, in a function step 3b never calls (3.T7(a)).',
      'unrelated_helper() {',
      `  ${STEP3B_OPEN}`,
      ...planted.map((l) => `    ${l}) ;;`),
      `  ${STEP3B_CLOSE}`,
      '}',
    );
  }
  lines.push('');
  return lines.join('\n');
}

function gitIn(dir, args, env) {
  const res = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
  assert.equal(
    res.error, undefined,
    `arm setup: spawning \`git ${args.join(' ')}\` failed: ${res.error && res.error.message}`,
  );
  assert.equal(
    res.status, 0,
    `arm setup: \`git ${args.join(' ')}\` in ${dir} exited ${res.status}. An arm that cannot be built `
    + `FAILS LOUDLY with a named reason; it never skips quietly (NFR8)\n${res.stdout}${res.stderr}`,
  );
  return res.stdout ?? '';
}

// Rewrite (`body`) or delete (`body === null`) `build.sh` in the MAIN checkout and COMMIT it. sync.sh:110
// greps the working tree at this relative path and `start` never checks cleanliness, so committing is
// discipline rather than a requirement: it keeps the tree clean between arms, so a later arm can never
// be read as having been decided by an earlier arm's stray edit. Staging is by EXACT PATH, never
// `git add -A` (AGENTS.md § One ticket). The commit lands on the main clone's LOCAL master, which
// changes nothing the script reads: `base_sha` is `$fork/master` (sync.sh:93, a remote-tracking ref).
function commitBuildSh(f, body, msg) {
  const p = path.join(f.main, BUILD_SH_REL);
  if (body === null) fs.rmSync(p);
  else fs.writeFileSync(p, body);
  gitIn(f.main, ['add', '--', BUILD_SH_REL], f.env);
  gitIn(f.main, ['commit', '-q', '-m', msg], f.env);
  return p;
}

// PARSED STRUCTURE, never "the string X is in the file" (§ 7). That family of assertion is what this PR
// has already paid for twice: `--force` is a substring of `--force-with-lease`, and `/\[\[/` is false
// against a subject containing `[[:space:]]`. So the step-3b `case … esac` is LOCATED, and membership is
// then a question about line indices.
function step3bBlock(text) {
  const lines = text.split('\n');
  const open = lines.findIndex((l) => l.trim() === STEP3B_OPEN);
  assert.notEqual(
    open, -1,
    `the step-3b map must open with ${JSON.stringify(STEP3B_OPEN)} for this arm to mean anything\n`
    + `--- build.sh:\n${text}`,
  );
  const close = lines.findIndex((l, i) => i > open && l.trim() === STEP3B_CLOSE);
  assert.notEqual(
    close, -1,
    `the step-3b map must close with ${JSON.stringify(STEP3B_CLOSE)}\n--- build.sh:\n${text}`,
  );
  return { lines, open, close };
}

// Every label at the head of a `case` arm inside the step-3b block, in source order.
function step3bLabels(text) {
  const { lines, open, close } = step3bBlock(text);
  return lines.slice(open + 1, close)
    .map((l) => (l.trim().match(/^([A-Za-z0-9._-]+)\)/) ?? [])[1])
    .filter((l) => l !== undefined);
}

// THE SUBJECT'S OWN TOOL, not a JS `RegExp`. 3.T7(b)'s claim is about what `grep -E` does with an
// unquoted `${a}`; a JS regex is a different engine with different escaping, so proving the point there
// would prove it about the wrong program. `grep -c` exits 1 when the count is 0, which is asserted too.
function grepCount(args, file, env) {
  const res = spawnSync('grep', [...args, file], { encoding: 'utf8', env });
  assert.equal(
    res.error, undefined,
    `the grep control itself must run before its output can be read: ${res.error && res.error.message}`,
  );
  return { status: res.status, count: Number.parseInt((res.stdout ?? '').trim(), 10) };
}

// -------------------------------------------------------------------------------------------- 3.T5
test('3.T5 start refuses an unknown alias at sync.sh:112, and accepts a mapped one (D-at-step-3)', () => {
  // TWO ARMS ON ONE FIXTURE, and arm (b) is not decoration. A missing `build.sh` makes `grep` exit 2,
  // which reports EVERY alias as unknown — so arm (a) alone goes green on a fixture whose map was never
  // consulted at all, which is exactly 3.T7(c) and says nothing about the map (§ 4.3, § 6.4). Arm (b)
  // shows the SAME fixture, differing only by a `zeta)` label, getting PAST 112.
  const f = makeFixture({ topology: 'D-at-step-3', alias: 'zeta' });
  try {
    // 12.1(i) — the control ON THE FIXTURE ITSELF, before any spawn: `D-at-step-3` must COMMIT a
    // `build.sh` whose step-3b block carries the four real labels. Trusting that is how this whole
    // tier silently becomes "grep exited 2 four times".
    const stub = path.join(f.main, BUILD_SH_REL);
    assert.ok(
      fs.existsSync(stub),
      `12.1(i): \`D-at-step-3\` must commit ${BUILD_SH_REL}. Without it grep exits 2, EVERY alias `
      + `reports unknown, site 112 trips for the wrong reason and site 121 is unreachable (§ 6.4)`,
    );
    assert.deepEqual(
      step3bLabels(fs.readFileSync(stub, 'utf8')), REAL_LABELS,
      `12.1(i): the stub's step-3b block must carry the four REAL labels ${REAL_LABELS.join(', ')} — a `
      + `map with different contents would make "zeta is unknown" a statement about the fixture`,
    );
    assert.equal(
      gitIn(f.main, ['status', '--porcelain', '--', BUILD_SH_REL], f.env).trim(), '',
      `12.1(i): the stub must be COMMITTED, not merely written into the working tree — sync.sh:122 `
      + `checks out \`$fork/master\` into a fresh worktree, which an uncommitted file never reaches`,
    );

    // ---- arm (a): `zeta` is in none of the four labels -> 112
    const a = runSync(START_ARGS, { cwd: f.main, env: f.env });

    assertReachedGuard(a, { site: 112, logs: [S1_LOG, S1_LOG_TAIL] });
    assert.ok(
      !a.stderr.includes(S3_ALIAS_PREFIX),
      'site 112 arm (a): sync.sh:113 must NOT have logged the alias line — it sits one line AFTER the '
      + `guard, so its presence would mean the map accepted zeta\n--- stderr:\n${a.stderr}`,
    );

    assertRefused(a, `${MAP_MISS}: zeta`, 'site 112 arm (a) (D-at-step-3, alias zeta unmapped)');
    assert.ok(
      !fs.existsSync(f.worktree),
      'site 112 arm (a): 112 is in the S3 PREFLIGHT, which runs BEFORE `git worktree add` at '
      + `sync.sh:122 — a directory at ${f.worktree} would mean the run passed both 112 and 121`,
    );

    // ---- arm (b), THE CONTROL: add `zeta)` to the map and re-run the very same fixture
    commitBuildSh(
      f, buildSh({ labels: [...REAL_LABELS, 'zeta'] }),
      'extend the step-3b map with a zeta) label (3.T5 arm (b))',
    );
    const b = runSync(START_ARGS, { cwd: f.main, env: f.env });

    assert.ok(
      b.stderr.includes(s3AliasLog('zeta')),
      'site 112 arm (b): sync.sh:113 logs the accepted alias verbatim. THIS LINE, and not merely the '
      + `absence of a refusal, is what distinguishes 3.T5 from 3.T7(c)\n--- stderr:\n${b.stderr}`,
    );
    assert.ok(
      !b.stderr.includes(MAP_MISS),
      'site 112 arm (b): the 112 fragment must be gone — the only change from arm (a) is the added '
      + `label, so its disappearance is attributable to the map and nothing else\n`
      + `--- stderr:\n${b.stderr}`,
    );
    assert.equal(
      b.status, 0,
      'site 112 arm (b): with `zeta)` mapped the whole preflight passes and `start` runs to completion\n'
      + `--- stdout:\n${b.stdout}\n--- stderr:\n${b.stderr}`,
    );
    assert.equal(
      b.stdout.trim(), f.worktree,
      'site 112 arm (b): `start` writes ONLY the worktree path to stdout (sync.sh:153), which is also '
      + `the path the fixture predicted from the upstream version\n--- stdout:\n${b.stdout}`,
    );
  } finally {
    f.cleanup();
  }
});

// -------------------------------------------------------------------------------------------- 3.T6
test('3.T6 start refuses at sync.sh:121 when the worktree directory already exists (D-at-step-3)', () => {
  // The test at 121 is `[ ! -e "$wt" ]`, so an EMPTY directory is enough — no git metadata, no branch,
  // no registration in `git worktree list`. The alias is the MAPPED `haiku` (D-at-step-3's default) on
  // purpose: 112 runs before 121, so an unmapped alias would refuse first and this test would quietly
  // be a second copy of 3.T5 arm (a) under a misleading name.
  const f = makeFixture({ topology: 'D-at-step-3' });
  try {
    fs.mkdirSync(f.worktree, { recursive: true });
    assert.deepEqual(
      fs.readdirSync(f.worktree), [],
      `site 121: the arm must pre-create an EMPTY directory at ${f.worktree} — the point of the claim `
      + `is that sync.sh:121 tests \`-e\`, not "is a valid worktree"`,
    );

    const res = runSync(START_ARGS, { cwd: f.main, env: f.env });

    // The control FIRST: S1 passed AND the alias tripwire at 112 logged its success line, so the run
    // is at 121 and nowhere earlier.
    assertReachedGuard(res, { site: 121, logs: [S1_LOG, S1_LOG_TAIL, s3AliasLog('haiku')] });
    assert.ok(
      !res.stderr.includes(MAP_MISS),
      'site 121: the alias tripwire at 112 must have PASSED — its fragment on stderr would mean this '
      + `run refused one guard earlier\n--- stderr:\n${res.stderr}`,
    );

    assertRefused(res, 'worktree already exists', 'site 121 (D-at-step-3, empty .worktrees dir)');
    assert.ok(
      res.stderr.includes(`worktree already exists: ${f.worktree}`),
      'site 121: the refusal names the path it derived from `main_checkout()` (sync.sh:75) and the '
      + `upstream version, not a generic message\n--- stderr:\n${res.stderr}`,
    );
    assert.deepEqual(
      fs.readdirSync(f.worktree), [],
      'site 121 refuses BEFORE `git worktree add` at sync.sh:122, so the directory it complained about '
      + 'must still be empty — anything in it would mean the guard ran too late',
    );
  } finally {
    f.cleanup();
  }
});

// -------------------------------------------------------------------------------------------- 3.T7
test('3.T7 the three sync.sh:110 alias-map fragilities — issue 4 (#167) (D-at-step-3)', () => {
  // ISSUE 4 (#167). sync.sh:110 is `grep -qE "^[[:space:]]*${a}\)" platforms/copilot-cli/build.sh`, and
  // three properties of that one line decide whether the ADR 0002 tripwire means what AGENTS.md says:
  //   (a) the grep scans the WHOLE FILE, so a `case` label outside the step-3b function is "known";
  //   (b) `${a}` is interpolated UNQUOTED into an ERE, so a `.` in an alias is a wildcard;
  //   (c) a missing `build.sh` makes grep exit 2, which the `||` reads as "unknown" — so the guard
  //       fires for every alias, including ones the map really does carry.
  // All three arms run on ONE fixture whose incoming alias is `claude.haiku`, which (a) proves mapped
  // and (c) then trips anyway.
  const ALIAS = 'claude.haiku';
  const f = makeFixture({ topology: 'D-at-step-3', alias: ALIAS });
  try {
    // Arms (a) and (b) both PASS 112, and 121 is the very next guard — so one pre-created empty
    // worktree directory stops each of them one line later. That is deliberate and it is the stronger
    // assertion: refusing at 121 PROVES the run got past 112, where exit 0 would only imply it. It also
    // keeps all four spawns on one fixture (no `worktree remove` between arms) and keeps the module
    // inside its wall-clock budget.
    fs.mkdirSync(f.worktree, { recursive: true });

    // ---- the baseline that makes arm (a) non-vacuous, asserted STATICALLY against the pristine stub
    // with sync.sh:110's own ERE: `claude.haiku` matches nothing in the four real labels. So the ONLY
    // difference between that state and arm (a) below is one planted line, and arm (a)'s pass is
    // attributable to it alone. (Stated with grep rather than a fourth spawn on purpose: a spawn would
    // re-prove 3.T5 arm (a) and cost the module a second of its wall-clock budget.)
    const pristine = grepCount(['-cE', `^[[:space:]]*${ALIAS}\\)`], path.join(f.main, BUILD_SH_REL), f.env);
    assert.equal(
      pristine.count, 0,
      `baseline: sync.sh:110's ERE must find ${ALIAS} NOWHERE in the four-label stub — otherwise arm `
      + `(a) below would pass without its planted line and prove nothing`,
    );

    // ---- arm (a): the same label, planted OUTSIDE the step-3b block
    const planted = commitBuildSh(
      f, buildSh({ labels: REAL_LABELS, planted: [ALIAS] }),
      `plant a ${ALIAS}) label outside the step-3b case block (3.T7 arm (a))`,
    );
    const { lines, close } = step3bBlock(fs.readFileSync(planted, 'utf8'));
    const at = lines.reduce((acc, l, i) => (/^\s*claude\.haiku\)/.test(l) ? [...acc, i] : acc), []);
    assert.equal(
      at.length, 1,
      `arm (a): exactly one line may carry the planted label, or "outside the block" is ambiguous — `
      + `found ${at.length}\n--- build.sh:\n${lines.join('\n')}`,
    );
    assert.ok(
      at[0] > close,
      `arm (a): the planted label must sit AFTER the step-3b \`esac\` (line ${close}), which is what `
      + `makes the claim "the grep is file-wide" rather than "the map contains it"; it is at line `
      + `${at[0]}\n--- build.sh:\n${lines.join('\n')}`,
    );
    assert.deepEqual(
      step3bLabels(fs.readFileSync(planted, 'utf8')), REAL_LABELS,
      'arm (a): the step-3b block itself must still carry ONLY the four real labels — if the planted '
      + 'label leaked into it, the arm would be asserting the opposite of its claim',
    );

    const a = runSync(START_ARGS, { cwd: f.main, env: f.env });
    assertReachedGuard(a, { site: 121, logs: [S1_LOG, S1_LOG_TAIL, s3AliasLog(ALIAS)] });
    assert.ok(
      !a.stderr.includes(MAP_MISS),
      'arm (a): a label the step-3b `case` can never reach is nonetheless accepted, because sync.sh:110 '
      + `greps the whole file (issue 4 / #167)\n--- stderr:\n${a.stderr}`,
    );
    assertRefused(a, 'worktree already exists', 'site 110 arm (a) (label outside the step-3b block)');

    // ---- arm (b): only `claudeXhaiku)`, and the unquoted `${a}` matches it anyway
    const only = commitBuildSh(
      f, buildSh({ labels: ['claudeXhaiku'] }),
      'replace the step-3b map with claudeXhaiku) alone (3.T7 arm (b))',
    );
    const fixedStr = grepCount(['-cF', `${ALIAS})`], only, f.env);
    assert.equal(
      fixedStr.count, 0,
      `arm (b): a FIXED-STRING grep for ${JSON.stringify(`${ALIAS})`)} must find 0 hits — that is the `
      + `whole claim, and an ordinary \`includes\` would have reported it present`,
    );
    assert.equal(
      fixedStr.status, 1,
      `arm (b): \`grep -c\` exits 1 on a zero count, which is the second half of "0 literal hits"; `
      + `got ${fixedStr.status}`,
    );
    const ere = grepCount(['-cE', `^[[:space:]]*${ALIAS}\\)`], only, f.env);
    assert.equal(
      ere.count, 1,
      `arm (b): sync.sh:110's ERE, interpolated exactly as the script does it, matches ONE line — the `
      + `\`.\` is a wildcard over the \`X\` of claudeXhaiku. Same file, same tool, opposite answer`,
    );

    const b = runSync(START_ARGS, { cwd: f.main, env: f.env });
    assertReachedGuard(b, { site: 121, logs: [S1_LOG, S1_LOG_TAIL, s3AliasLog(ALIAS)] });
    assert.ok(
      !b.stderr.includes(MAP_MISS),
      'arm (b): the tripwire reports `all mapped` against a map that carries no such alias at all — an '
      + `unmapped alias would sail through a real sync (issue 4 / #167)\n--- stderr:\n${b.stderr}`,
    );
    assertRefused(b, 'worktree already exists', 'site 110 arm (b) (claudeXhaiku) matched by the ERE)');

    // ---- arm (c): `build.sh` removed. THE CRASH-MARKER EXEMPTION — the only one in this module.
    // `assertReachedGuard` treats `grep:` and `No such file or directory` as proof a run stopped before
    // its guard, and that reading is right everywhere else. HERE THAT EXACT LINE IS THE MECHANISM UNDER
    // TEST: grep's failure to open the file is what makes the `||` mark a mapped alias unknown. Calling
    // `assertReachedGuard` would therefore fail on CORRECT behaviour, so the control is spelled out by
    // hand instead — S1 present (the run reached S3), no git `fatal:` (it did not die in plumbing), the
    // grep error present by exact text, and the S3 alias line absent.
    commitBuildSh(f, null, 'remove build.sh entirely (3.T7 arm (c))');
    const c = runSync(START_ARGS, { cwd: f.main, env: f.env });

    assert.ok(
      c.stderr.includes(S1_LOG) && c.stderr.includes(S1_LOG_TAIL),
      `arm (c): S1 must still have succeeded, or the refusal below belongs to an earlier site\n`
      + `--- stderr:\n${c.stderr}`,
    );
    assert.ok(
      !c.stderr.includes('fatal:'),
      'arm (c): no git `fatal:` — the run must reach 112 through grep\'s exit 2, not through a git '
      + `plumbing failure that merely looks like it\n--- stderr:\n${c.stderr}`,
    );
    assert.ok(
      c.stderr.includes(`grep: ${BUILD_SH_REL}: No such file or directory`),
      `arm (c): grep's own error names the unopenable file, which is the evidence that its exit 2 (not `
      + `a real map miss) is what the \`||\` at sync.sh:110 turned into "unknown"\n`
      + `--- stderr:\n${c.stderr}`,
    );
    assert.ok(
      !c.stderr.includes(S3_ALIAS_PREFIX),
      `arm (c): sync.sh:113 must not have run\n--- stderr:\n${c.stderr}`,
    );

    assertRefused(c, `${MAP_MISS}: ${ALIAS}`, 'site 110 arm (c) (build.sh removed, a MAPPED alias)');
    assert.ok(
      at.length === 1 && !c.stderr.includes(s3AliasLog(ALIAS)),
      `arm (c): the refused alias is the very one arm (a) proved the map accepts — the guard is `
      + `reporting the absence of the FILE as a property of the ALIAS\n--- stderr:\n${c.stderr}`,
    );
  } finally {
    f.cleanup();
  }
});

// -------------------------------------------------------------------------------------------- 3.T8
test('3.T8 sync.sh:113 does not abort under set -e when no aliases are incoming (FR8/D9)', () => {
  // PINNED AS CORRECT-AS-WRITTEN, so it is never re-litigated as a bug. sync.sh:113 is
  // `[ -n "$aliases" ] && log "S3 incoming model: …"`. With `$aliases` empty the `[` fails, and `set -e`
  // exempts any command in an `&&` list except the one following the final `&&` (bash manual). The
  // list's own status is then 1 and bash still does not exit — `bash -ec 'false && echo x; echo ok'`
  // prints `ok`. The observable consequence is the only thing asserted: no S3 alias line, and the run
  // carries on to S4.
  //
  // `scaffold: 'none'` is what makes the incoming range alias-free: it commits the three manifests and
  // NO `plugins/maister/agents/*.md` at all, so sync.sh:104's pathspec lists nothing, `$aliases` is
  // empty, and the `for a in $aliases` loop at 109 never runs a single `grep` — which is also why the
  // absent `build.sh` is harmless here and cannot be confused with 3.T7(c).
  const f = makeFixture({ topology: 'D-at-step-3', scaffold: 'none' });
  try {
    const res = runSync(START_ARGS, { cwd: f.main, env: f.env });

    assert.ok(
      res.stderr.includes(S1_LOG) && res.stderr.includes(S1_LOG_TAIL),
      `FR8/D9: S1 must have succeeded, or this run never reached line 113 at all\n`
      + `--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      !res.stderr.includes(S3_ALIAS_PREFIX),
      'FR8/D9: with no incoming aliases the `&&` list at sync.sh:113 is falsy, so its `log` must NOT '
      + `have run — an S3 alias line here would mean the fixture smuggled one in\n`
      + `--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      !res.stderr.includes('grep:'),
      'FR8/D9: the loop at sync.sh:109 must never have iterated — a `grep:` error would mean an alias '
      + `was found and this test is measuring 3.T7(c) instead\n--- stderr:\n${res.stderr}`,
    );

    // The half that makes this a claim about `set -e` rather than about logging: the run CONTINUES.
    assert.doesNotMatch(
      res.stderr, /^sync\.sh: REFUSED — /m,
      `FR8/D9: a falsy \`&&\` list is not a refusal point\n--- stderr:\n${res.stderr}`,
    );
    assert.equal(
      res.status, 0,
      'FR8/D9: the falsy `&&` list must not abort the script. A non-zero exit with no REFUSED line '
      + 'here would be exactly the silent `set -e` death this test exists to rule out\n'
      + `--- stdout:\n${res.stdout}\n--- stderr:\n${res.stderr}`,
    );
    assert.ok(
      res.stderr.includes('S2 worktree ready: ') && res.stderr.includes('S4 merge'),
      'FR8/D9: the run reaches S2 and then S4 — both lie AFTER 113, so either one missing would mean '
      + `the script stopped at the falsy list\n--- stderr:\n${res.stderr}`,
    );
    assert.equal(
      res.stdout.trim(), f.worktree,
      'FR8/D9: S4 completing is observable on stdout, which carries only the worktree path '
      + `(sync.sh:153)\n--- stdout:\n${res.stdout}`,
    );
  } finally {
    f.cleanup();
  }
});
