// Fixture harness for the `scripts/sync.sh` unit tests (robmar-net/maister#161, spec § 4).
//
// This is the suite's FIRST shared helper module. It is a HARNESS rather than a fixture factory because
// it exports the refusal taxonomy (§ 4.2) as well as the repositories: AC2-AC4 and AC6 are subtle enough
// that four copies across four test modules would drift apart. When a non-git subject (`pr.sh`,
// `wiki.sh`, `sweep.sh`) first needs the taxonomy, split `helpers/sh-assert.mjs` out — doing that now,
// with no second consumer, would be speculative structure (ADR 0010).
//
// WHAT IT BUILDS (§ 4.1) — four repositories under ONE `mkdtemp` root, resolved through
// `fs.realpathSync` before any use, because on macOS `/tmp` resolves to `/private/tmp` and a
// `main_checkout()` (sync.sh:75) vs `git rev-parse --show-toplevel` (sync.sh:173) disagreement flips
// site 173 in either direction:
//
//   <root>/github.com/SkillPanel/maister.git      bare upstream   (slug hardcoded at sync.sh:60)
//   <root>/github.com/<FIXTURE_SLUG>.git          bare fork       (also PR_REPO_SLUG — NFR9a)
//   <root>/main                                   clone of the fork bare
//   <root>/main/.worktrees/sync-<upver>            linked worktree on the sync branch
//   <root>/{seed,work-up,work-fork}               short-lived authoring clones, removed with the root
//
// Local paths, not `file://` URLs, because sync.sh:71 is an UNANCHORED SUBSTRING GLOB over the remote's
// URL string with no scheme check and no host resolution — a bare repo at a path containing
// `github.com/<slug>` satisfies the lookup entirely offline, and so does a `file://` URL over the same
// path. Local paths are the least machinery, NOT the only thing that works: because the match is purely
// textual, a fixture path can satisfy it BY ACCIDENT, which is why FR9's negative control removes the
// `github.com/` substring rather than changing the scheme.
//
// REMOTE NAMES ARE DELIBERATELY MISLEADING — the upstream remote is `zzz-upstream` and the fork is
// `aaa-fork` — so a passing test can never be read as "remote NAMES work" (AGENTS.md:347-356: never
// trust the remote name, key every decision on the repository slug).
//
// EVERY `git init` PASSES AN EXPLICIT `-b master`, bare repos included. This is correctness, not style:
// sync.sh:175 refuses when the branch is `master`, so a fixture inheriting the operator's
// `init.defaultBranch` would assert a refusal on one machine and its absence on another (NFR2).
//
// EVERY COMMIT AND EVERY MERGE RESOLUTION WRITES ALL THREE MANIFESTS. sync.sh:212-214 loops over
// `.claude-plugin/marketplace.json`, `plugins/maister/.claude-plugin/plugin.json` and
// `plugins/maister-copilot/.claude-plugin/plugin.json` BEFORE the version branch at 215, so a fixture
// carrying only one of them refuses at site 213 and reaches nothing beyond — and the whole L6-L9 ladder
// sits behind that too. This was revision 1's defect: it invalidated 12 of 29 claimed sites.
//
// NFR9 — THE TWO-LOCK CONTRACT ON THE `gh` BOUNDARY. sync.sh:59 is
// `SLUG="${PR_REPO_SLUG:-robmar-net/maister}"` and sync.sh:258 is `gh pr create --repo "$SLUG"`, and the
// ladder tests execute a real `git push` and then reach 258. Lock (a): every spawn sets
// `PR_REPO_SLUG=FIXTURE_SLUG` AND the fork bare's path embeds that same slug, because `remote_for`
// resolves the push target from that string. Lock (b): `NO_GH_PATH`, below. Neither is sufficient alone.
//
// NFR7 — self-cleaning, `node:` builtins only. `makeFixture` hands back `cleanup()`; call it from a
// per-test `finally` so it runs on assertion failure as well as on success. Never a global `after()`.
// `NO_GH_PATH` is a plain module-level string with NO lifecycle — no shim, no symlink, no temp directory
// — so it needs no exception to that rule.
//
// NFR4 — `makeFixture` asserts ONCE that every path it returns is under its own realpath'd root. That
// single assertion is what stops a fixture's `$main` resolving to the real checkout, which matters
// because sync.sh lines 274, 288 and 289 run `pull --ff-only`, `worktree remove` and `branch -D`
// against `$main`.
//
// NFR5 — no line in this file begins with seven `<` or seven `>` followed by a space. The conflict
// markers topology `markers` needs are built by CONCATENATION at runtime (see `conflictMarker`) and
// never sit at column 0 in source. sync.sh:204's guard is anchored at column 0 across all TRACKED
// files, so one such line here would make real `sync.sh land` refuse forever, blaming "the tree".
//
// NOT REUSED, deliberately (§ 8.3): `bundle-archive.test.mjs:154-190` runs git against the REAL
// repository and the real main checkout, safe only via `-n`. One dropped flag from destroying untracked
// files in both worktrees — not imported here, where the subject calls `fetch`, `push`,
// `worktree add/remove`, `branch -D`, `gh pr create` and `gh pr merge`. Also not reused:
// `run-sh.test.mjs:47-51`'s whitelisted PATH (host-dependent — see `NO_GH_PATH`), bare `git init` with
// no `-b` (`citation-drift.test.mjs:62` — harmless there, a correctness bug here), and `cp`/`cpSync`
// fixture reuse (NG7: a copied fixture's gitdir pointer and remote URLs still name the SOURCE root, so
// it pushes into the source fixture's bare repo — verified. There is no `cp` anywhere in this file).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------------------------ constants
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..', '..'); // helpers -> test -> l2/
// l2 -> compat-tests -> copilot-cli -> platforms -> <repo>  (bundle-archive.test.mjs:43-47 depth idiom;
// that file is the ONLY sanctioned precedent for reaching outside l2/, and this is the same four hops).
export const REPO_ROOT = path.resolve(L2_DIR, '..', '..', '..', '..');
export const SYNC_SH = path.join(REPO_ROOT, 'scripts', 'sync.sh');
export const PRE160_FIXTURE = path.join(L2_DIR, 'test', 'fixtures', 'sync-sh', 'pre-160-sync.sh.txt');

// NEVER `robmar-net/maister` (AGENTS.md:13-24). Without this lock a fixture was demonstrated to reach
// `gh pr create --repo robmar-net/maister` against the real repository.
export const FIXTURE_SLUG = 'fixture-owner/fixture-repo';
const UPSTREAM_SLUG = 'SkillPanel/maister'; // hardcoded at sync.sh:60; cannot be overridden

const MANIFESTS = [
  '.claude-plugin/marketplace.json',
  'plugins/maister/.claude-plugin/plugin.json',
  'plugins/maister-copilot/.claude-plugin/plugin.json',
];
const AGENT_MD = 'plugins/maister/agents/example.md';
const BUILD_SH = 'platforms/copilot-cli/build.sh';
const L2_REL = 'platforms/copilot-cli/compat-tests/l2';
const STUB_TEST = `${L2_REL}/test/stub.test.mjs`;
const DRIFT_TOOL = `${L2_REL}/tools/citation-drift.mjs`;
const CAL_LOG = `${L2_REL}/reference/CALIBRATION-LOG.md`;
const TRACKED = 'TRACKED.md';   // site 230's ` M TRACKED.md`
const CONFLICTED = 'CONFLICTED.md'; // site 204's marker carrier

const PINNED_DATE = '2026-01-02T03:04:05+0000';

// ------------------------------------------------------------------------------- NFR9b: NO_GH_PATH
// Built by FILTERING, never by whitelisting directories the test does not control. `run-sh.test.mjs:51`
// whitelists `[dirname(process.execPath), '/usr/bin', '/bin']` with a comment justifying it for
// `copilot`, which "ships only in /usr/local/bin here". That justification does NOT transfer to `gh`:
// `gh` is a Homebrew sibling of `node` (measured: `command -v` resolves both under /opt/homebrew/bin on
// this machine) and an apt package in /usr/bin on Linux, alongside `git`.
//
// Node's own install directory is PREPENDED because the filter would otherwise remove node together
// with `gh`. Measured here that directory is /opt/homebrew/Cellar/node/25.2.1/bin and holds exactly
// `node`, `npm`, `npx` — no `gh` — so it survives. THE FILTER APPLIES TO IT TOO: on a host where `gh`
// does sit beside node, node is dropped with it and `assertNoGh()` then fails loudly with a named
// reason (NFR8) rather than silently admitting `gh`.
//
// There is no shim, no symlink and no temp directory here, therefore nothing to create or tear down.
function holdsExecutable(dir, name) {
  try {
    fs.accessSync(path.join(dir, name), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const NODE_BIN_DIR = path.dirname(process.execPath);
export const NO_GH_PATH = [NODE_BIN_DIR, ...(process.env.PATH ?? '').split(path.delimiter)]
  .filter((d) => d.length > 0)
  .filter((d) => !holdsExecutable(d, 'gh'))
  .join(path.delimiter);

// PROBE FOR THE BINARY, never infer from a directory whitelist. Called at MODULE SCOPE by every module
// that spawns sync.sh, before any `test(...)` declaration and therefore before its first spawn:
// `node --test` gives each file its own process, so one proof in one module says nothing about the
// other three (§ 9.1). The optional argument exists so the harness's own control can prove this probe
// CAN fail — a probe that cannot fail proves nothing.
export function assertNoGh(pathStr = NO_GH_PATH) {
  const dirs = pathStr.split(path.delimiter).filter((d) => d.length > 0);
  for (const d of dirs) {
    assert.ok(
      !holdsExecutable(d, 'gh'),
      `NFR9b: no directory of the derived PATH may hold an executable \`gh\`, but ${path.join(d, 'gh')} `
      + 'is executable — a `land` spawn reaching sync.sh:258 could then run a real `gh pr create`',
    );
  }
  for (const tool of ['git', 'make', 'bash', 'node']) {
    assert.ok(
      dirs.some((d) => holdsExecutable(d, tool)),
      `NFR9b/NFR8: the derived PATH no longer resolves \`${tool}\`. On this host \`${tool}\` shares a `
      + 'directory with `gh`, so the gh filter took it too. This fails loudly ON PURPOSE (§ 9.1): the '
      + 'alternative — re-admitting that directory — would put `gh` back on the PATH of a spawn that '
      + `reaches sync.sh:258. Derived PATH was: ${pathStr}`,
    );
  }
}

// ------------------------------------------------------------------------------ § 4.4 isolation set
// Applied to BOTH the fixture-building git calls AND the sync.sh spawn. The script itself runs `fetch`,
// `merge`, `push` and `worktree add`, so without this the operator's global config would decide
// outcomes that hinge on merge topology and branch names.
//
// `extra` with a `null` (or `undefined`) value DELETES the key — the `sweep-sh.test.mjs:70-83`
// signature.
export function fixtureEnv(root, extra = {}) {
  const env = { ...process.env };

  // A leaked GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE from the parent would silently retarget every
  // fixture git call at another repository. Nothing in the suite sets these, but NFR1's claim is
  // "the operator's environment cannot decide a test", and that claim has to be true by construction.
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
    'GIT_CEILING_DIRECTORIES']) delete env[k];

  // THE CONTAMINANT WAS THE TEST RUNNER ITSELF, and it produced a real silent green — which is why the
  // scrub lives HERE, in the one function every spawn's env is built by, and not in the one module that
  // happened to notice. `node --test` exports `NODE_TEST_CONTEXT=child-v8` into each test FILE's
  // process; `fixtureEnv` starts from `{ ...process.env }`, so it reached the `land` spawn and from
  // there the INNER `node --test` that sync.sh:228 runs as its L2-suite gate. MEASURED TWICE, on the
  // same one-line deliberately-red file:
  //     node --test red.test.mjs                            -> exit 1
  //     NODE_TEST_CONTEXT=child-v8 node --test red.test.mjs -> exit 0
  // Set, the variable makes the inner runner behave as a REPORTING CHILD of a parent runner: it reports
  // its failure upward instead of exiting non-zero. The consequence was measured, not theorised —
  // 4.T2(a)'s deliberately RED stub PASSED the L6 gate, the spawn logged `L6 gates green, tree still
  // clean`, and the run refused far downstream at site 246 without ever reaching site 229. A green-
  // looking arm for a site it never visited: exactly the silent green AGENTS.md:47-64 exists to prevent.
  //
  // Deleting it is also correct in kind, not just convenient: a fixture's L6 run is a REAL standalone
  // `node --test`, not a child of this suite's runner, and it must exit the way the subject's own gate
  // assumes. THE HAZARD IS GENERIC, not ladder-specific — `pr.sh:117` runs `node --test` under the same
  // construct, so any future test driving `pr.sh ship` through this harness would hit it identically.
  // Scrubbing it in `fixtureEnv` makes NFR1 ("the operator's environment cannot decide a test") hold BY
  // CONSTRUCTION for all four modules and every module added later, rather than by one local override a
  // future author can forget. See ADR 0010, Decision 1.
  delete env.NODE_TEST_CONTEXT;

  // THE SAME HAZARD, ONE LEVEL FURTHER UP THE TOOLING — and the reason this scrub is a LIST rather than a
  // single delete. The suite's own gate is `make test-l2-unit` (Makefile:148), so when the gate runs, GNU
  // make exports `MAKELEVEL=1` into `node --test`, `{ ...process.env }` carries it here, and the fixture's
  // own `make` — the one sync.sh:225-227 invokes as its L6 gate — then believes it is a SUB-make. It
  // therefore labels its diagnostics `make[1]: *** [validate] Error 1` instead of `make: *** [...]`, and
  // 4.T1(b)'s site-226 anchor (which tolerates GNU Make 4.x's `Makefile:<n>: ` field, but not a recursion
  // level) stopped matching. MEASURED, isolated to the single variable:
  //     node --test sync-sh-ladder.test.mjs              -> 5/5 pass
  //     MAKEFLAGS=s  node --test sync-sh-ladder.test.mjs -> 5/5 pass   (harmless)
  //     MAKELEVEL=1  node --test sync-sh-ladder.test.mjs -> 4.T1 FAILS (this one)
  // and reproduced 3/3 under the real `make test-l2-unit` while the identical glob under a bare
  // `node --test` was green 3/3 — so the DEFECT WAS INVISIBLE to the raw-glob run and only the official
  // gate showed it.
  //
  // Note what did NOT happen: sync.sh behaved CORRECTLY and refused at site 226 with the right message.
  // The leak corrupted the guard's own diagnostic PREFIX, not the guard. Scrubbing is correct in kind
  // rather than merely convenient: the fixture's `make` is the SUBJECT'S gate, invoked the way a real
  // operator's `sync.sh land` invokes it from a shell — it is not logically a child of whatever drove the
  // test suite, and it must not inherit a recursion level, a jobserver handle or a flag set from one.
  // Widening the anchor to tolerate `make[N]:` would also silence the symptom, but it would loosen a pin
  // in order to accommodate contamination; removing the contamination keeps the anchor at full strength.
  for (const k of ['MAKELEVEL', 'MAKEFLAGS', 'MFLAGS']) delete env[k];

  env.HOME = root;                                          // ~/.gitconfig discovery
  env.GIT_CONFIG_GLOBAL = path.join(root, 'gitconfig');     // init.defaultBranch, commit.gpgsign,
  env.GIT_CONFIG_NOSYSTEM = '1';                            //   core.hooksPath, merge.conflictStyle,
  env.GIT_TERMINAL_PROMPT = '0';                            //   any insteadOf rule, /etc/gitconfig
  env.GIT_AUTHOR_NAME = 'Fixture Builder';
  env.GIT_AUTHOR_EMAIL = 'fixture@invalid.example';
  env.GIT_COMMITTER_NAME = 'Fixture Builder';
  env.GIT_COMMITTER_EMAIL = 'fixture@invalid.example';
  env.GIT_AUTHOR_DATE = PINNED_DATE;                        // non-reproducible SHAs
  env.GIT_COMMITTER_DATE = PINNED_DATE;
  env.TMPDIR = root;                                        // run-sh.test.mjs:196-199 — node --test
  env.PATH = NO_GH_PATH;                                    //   runs files CONCURRENTLY, so a shared
  env.PR_REPO_SLUG = FIXTURE_SLUG;                          //   os.tmpdir() would race
  env.LANG = 'C';                                           // AC5 matches git and make phrasing
  env.LC_ALL = 'C';

  for (const [k, v] of Object.entries(extra)) {
    if (v == null) delete env[k];
    else env[k] = String(v);
  }
  return env;
}

// -------------------------------------------------------------------------------------- the spawn
// AC6 in one function: `assert.equal(res.error, undefined, …)` BEFORE any stream assertion, and `?? ''`
// normalisation, because `assert.doesNotMatch` handed `undefined` throws a confusing type error and a
// spawn failure otherwise surfaces as `status: null` plus a misleading downstream assertion
// (`bundle-archive.test.mjs:49-59`). `maxBuffer` is generous because site 229's arm captures a whole
// `node --test` failure dump. The optional `script` is what lets FR3 push the vendored pre-#160 bytes
// through this same helper.
export function runSync(args, { cwd, env, script } = {}) {
  const res = spawnSync('bash', [script ?? SYNC_SH, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    res.error, undefined,
    `the sync.sh spawn itself must succeed before any stream can be asserted on; it failed with: `
    + `${res.error && res.error.message}`,
  );
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// ------------------------------------------------------------------------------ assertion taxonomy
// MULTILINE `match` + `contains`, never `startsWith` (AC2). Many sites emit other output BEFORE the
// refusal: 226 is preceded by `make: *** [validate] Error 1`, 230 by ` M <file>`, 253/255 by git's
// push-rejection block (with its LEADING SPACE), 258 by `line 258: gh: command not found`, and 112
// with no build.sh by a `grep:` error. A `startsWith` written from § 6.1's table would fail at every
// one of them on a CORRECT script.
const REFUSED_LINE = /^sync\.sh: REFUSED — /m;

export function assertRefused(res, fragment, label) {
  assert.equal(
    res.status, 1,
    `${label}: a refusal point exits 1 (sync.sh:63); got ${res.status}\n--- stdout:\n${res.stdout}`
    + `\n--- stderr:\n${res.stderr}`,
  );
  assert.match(
    res.stderr, REFUSED_LINE,
    `${label}: the refusal announces itself with a \`sync.sh: REFUSED — \` line on STDERR\n`
    + `--- stderr:\n${res.stderr}`,
  );
  assert.ok(
    res.stderr.includes(fragment),
    `${label}: the refusal must carry the discriminating fragment ${JSON.stringify(fragment)} — `
    + `without it this test would pass on ANY of the 29 refusal sites\n--- stderr:\n${res.stderr}`,
  );
  assert.equal(
    res.stdout, '',
    `${label}: a refused invocation writes NOTHING to stdout — sync.sh's stdout carries only the `
    + `worktree path (153) or the PR URL (261/279/286/291)\n--- stdout:\n${res.stdout}`,
  );
}

export function assertUsage(res, label) {
  assert.equal(
    res.status, 2,
    `${label}: a usage error exits 2 (sync.sh:64), distinctly from a refusal's 1; got ${res.status}\n`
    + `--- stdout:\n${res.stdout}\n--- stderr:\n${res.stderr}`,
  );
  assert.doesNotMatch(
    res.stderr, REFUSED_LINE,
    `${label}: usage() is not a refusal point and must emit no \`REFUSED\` line — that disjointness is `
    + `what makes "exit 1 + REFUSED" a discriminating signal\n--- stderr:\n${res.stderr}`,
  );
  assert.equal(res.stdout, '', `${label}: usage() writes only to stderr\n--- stdout:\n${res.stdout}`);
}

// AC3: ANY non-zero exit with ZERO `REFUSED` lines. Not "exit 1" — an absent fetch target exits 128
// (sync.sh:190/191), while site 229 exits 1 silently. Asserting bare non-zero is not acceptable either:
// without the zero-REFUSED half, a crash reads as a guard.
export function assertCrash(res, label) {
  assert.notEqual(
    res.status, 0,
    `${label}: a crash exits non-zero\n--- stdout:\n${res.stdout}\n--- stderr:\n${res.stderr}`,
  );
  const hits = (res.stderr.match(/^sync\.sh: REFUSED — /mg) ?? []).length;
  assert.equal(
    hits, 0,
    `${label}: a crash is distinguished from a refusal by the ABSENCE of a \`REFUSED\` line; found `
    + `${hits}. If a REFUSED line is present the run reached a guard and belongs in assertRefused.\n`
    + `--- stderr:\n${res.stderr}`,
  );
}

// --------------------------------------------------------------------------------- NFR4 under-root
// Exported so the harness's own control can prove this guard THROWS on a path outside the root. A guard
// whose failure path is never exercised is an assumption, not a guard.
export function assertUnderRoot(root, paths) {
  for (const [name, p] of Object.entries(paths)) {
    assert.ok(
      typeof p === 'string' && (p === root || p.startsWith(root + path.sep)),
      `NFR4: makeFixture must never hand back a path outside its own mkdtemp root — \`${name}\` is `
      + `${JSON.stringify(p)} but the root is ${JSON.stringify(root)}. sync.sh lines 274, 288 and 289 `
      + `run \`pull --ff-only\`, \`worktree remove\` and \`branch -D\` against \`$main\`, so a $main `
      + `pointing at the real checkout would damage the real repository.`,
    );
  }
}

// ------------------------------------------------------------------------------ scaffold contents
// A conflict marker, built by concatenation so no SOURCE line here starts with the run of characters
// sync.sh:204 greps for at column 0 (NFR5).
const conflictMarker = (ch, rest) => `${ch.repeat(7)} ${rest}`;

const manifestJson = (rel, version) => `${JSON.stringify({
  name: rel === MANIFESTS[0] ? 'fixture-marketplace' : 'fixture-plugin',
  version,
  description: 'fixture manifest — see l2/test/helpers/sync-sh-harness.mjs',
}, null, 2)}\n`;

// Only the four step-3b `case` LABELS matter: sync.sh:110 greps this file for `^[[:space:]]*<alias>)`.
// Without this file `grep` exits 2, EVERY alias reports unknown, site 112 trips for the wrong reason,
// site 121 becomes unreachable, and 3.T5 / 3.T7(c) become indistinguishable (§ 6.4).
const buildShStub = [
  '#!/usr/bin/env bash',
  '# fixture stand-in for platforms/copilot-cli/build.sh — step-3b model-alias map only.',
  'set -euo pipefail',
  'case "${1:-}" in',
  '  inherit) ;;',
  '  haiku) ;;',
  '  sonnet) ;;',
  '  opus) ;;',
  'esac',
  '',
].join('\n');

// sync.sh:105 reads `sed -n '1,12p'` then `s/^model:[[:space:]]*\\([A-Za-z0-9._-]*\\).*/\\1/p`, so the
// `model:` line must sit at column 0 inside the first 12 lines.
const agentMd = (alias) => [
  '---',
  'name: example',
  `model: ${alias}`,
  '---',
  '',
  '# example agent (fixture)',
  '',
].join('\n');

// A trivial HAND-WRITTEN green stub, never a copy of a real test file (NFR6): a `land` spawn inside a
// fixture reaches L6 and runs `node --test` over the FIXTURE's l2/test/ glob, which must match only
// this file. A copy makes the recursion unbounded.
const stubTest = (red) => [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  `test('stub ${red ? 'red' : 'green'}', () => { assert.equal(1, ${red ? 2 : 1}); });`,
  '',
].join('\n');

const driftStub = (dirty) => [
  '#!/usr/bin/env node',
  '// fixture stand-in for l2/tools/citation-drift.mjs — exit code only (sync.sh:236).',
  ...(dirty ? ["console.error('DRIFT fixture/demo.derivation.md:1 unresolved');"] : []),
  `process.exit(${dirty ? 1 : 0});`,
  '',
].join('\n');

const calLog = [
  '# CALIBRATION LOG (fixture)',
  '',
  '## entry 1 — baseline',
  'baseline reference state recorded by the fixture builder',
  '',
].join('\n');

function makefile(makeRed) {
  const recipe = {
    build: makeRed === 'build' ? '@echo "fixture: build is red" >&2; exit 1'
      : makeRed === 'dirty' ? `@printf 'dirtied by make build\\n' >> ${TRACKED}`
        : '@true',
    validate: makeRed === 'validate' ? '@echo "fixture: validate is red" >&2; exit 1' : '@true',
    'check-deterministic': makeRed === 'check-deterministic'
      ? '@echo "fixture: check-deterministic is red" >&2; exit 1' : '@true',
  };
  return [
    '# fixture Makefile — only the three L6 gate targets exist (sync.sh:225-227).',
    '.PHONY: build validate check-deterministic',
    ...Object.entries(recipe).flatMap(([t, r]) => [`${t}:`, `\t${r}`]),
    '',
  ].join('\n');
}

// ------------------------------------------------------------------------------------- git plumbing
function git(args, cwd, env, { tolerate = false } = {}) {
  const res = spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(
    res.error, undefined,
    `fixture build: spawning \`git ${args.join(' ')}\` failed: ${res.error && res.error.message}`,
  );
  if (!tolerate) {
    assert.equal(
      res.status, 0,
      `fixture build: \`git ${args.join(' ')}\` in ${cwd} exited ${res.status}. A fixture that cannot `
      + `build FAILS LOUDLY with a named reason; it never skips quietly (NFR8).\n${res.stdout}`
      + `${res.stderr}`,
    );
  }
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

const rev = (cwd, env, ref) => git(['rev-parse', ref], cwd, env).stdout.trim();

function write(dir, rel, body) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

// `git add -A` INSIDE a throwaway mkdtemp fixture repo is what the sanctioned template does
// (`citation-drift.test.mjs:66`) and is not the operator's tree, so GOV3 is not engaged. The operator's
// worktree is never staged by this file.
function commitAll(dir, env, msg) {
  git(['add', '-A'], dir, env);
  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], dir, env).stdout.trim();
  assert.equal(
    unmerged, '',
    `fixture build: unresolved paths remain after the merge resolution in ${dir}: ${unmerged}. A `
    + `fixture committed with conflict residue would trip sync.sh:204 instead of its intended site.`,
  );
  git(['commit', '-q', '-m', msg], dir, env);
  return rev(dir, env, 'HEAD');
}

// ---------------------------------------------------------------------------------- § 4.3 topologies
// `graph` values:
//   full  upstream B->X; fork B->C->M'; S = merge(C,X) on the sync branch; T = merge(S,M') is HEAD
//   A     full truncated after S, then M' pushed to fork master and NEVER merged      -> 195
//   B     full truncated after S, then upstream advances to X2                        -> 197
//   C     full truncated after S, then S pushed to fork master (HEAD == fork master)  -> 200
//   step3 truncated BEFORE the worktree exists: remotes wired and fetched, no sync branch
//
// `sver` is the version S commits (the sync merge kept ours); the SYNC-BRANCH TIP always commits
// `headver`, which for graphs A/B/C is S itself.
const TOPOLOGIES = {
  D: { graph: 'full', upver: '2.2.4', bver: '2.2.3+fork.3', cver: '2.2.3+fork.4', mver: '2.2.3+fork.5', sver: '2.2.3+fork.4', headver: '2.2.3+fork.5', scaffold: 'none' },
  'D(ladder)': { graph: 'full', upver: '2.2.4', bver: '2.2.3+fork.3', cver: '2.2.3+fork.4', mver: '2.2.3+fork.5', sver: '2.2.3+fork.4', headver: '2.2.4+fork.1', scaffold: 'ladder' },
  'D(213)': { graph: 'full', upver: '2.2.4', bver: '2.2.3+fork.3', cver: '2.2.3+fork.4', mver: '2.2.3+fork.5', sver: '2.2.3+fork.4', headver: '2.2.4+fork.1', marketVer: '2.2.3+fork.5', scaffold: 'none' },
  A: { graph: 'A', upver: '2.2.4', bver: '2.2.3+fork.3', cver: '2.2.3+fork.4', mver: '2.2.3+fork.5', sver: '2.2.3+fork.4', headver: '2.2.3+fork.4', scaffold: 'none' },
  B: { graph: 'B', upver: '2.2.4', bver: '2.2.3+fork.3', cver: '2.2.3+fork.4', mver: '2.2.3+fork.5', sver: '2.2.3+fork.4', headver: '2.2.3+fork.4', scaffold: 'none' },
  C: { graph: 'C', upver: '2.2.4', bver: '2.2.3+fork.3', cver: '2.2.3+fork.4', mver: '2.2.3+fork.5', sver: '2.2.3+fork.4', headver: '2.2.3+fork.4', scaffold: 'none' },
  // upstream advanced WITHOUT bumping, so `upver == basever%%+*` takes the `else` at 218 and headver
  // lacks `+fork.` -> site 220.
  E: { graph: 'full', upver: '2.2.3', bver: '2.2.3+fork.3', cver: '2.2.3+fork.4', mver: '2.2.3+fork.5', sver: '2.2.3+fork.4', headver: '2.2.3', scaffold: 'none' },
  'D-at-step-3': { graph: 'step3', upver: '2.2.4', bver: '2.2.3+fork.3', cver: '2.2.3+fork.4', mver: '2.2.3+fork.5', sver: '2.2.3+fork.4', headver: '2.2.3+fork.4', scaffold: 'start', alias: 'haiku' },
};
// `G` is NOT "D plus a Makefile" — it is D with an L5-PASSING manifest set (all three at 2.2.4+fork.1)
// plus the 'ladder' scaffold. That is the single ingredient revision 1 omitted, and it is why all 11
// ladder sites were unreachable there.
TOPOLOGIES.G = TOPOLOGIES['D(ladder)'];

export const TOPOLOGY_NAMES = Object.keys(TOPOLOGIES);

// ------------------------------------------------------------------------------------- makeFixture
// `opts` is taken EXPLICITLY per call and no ambient module state is ever read. The reason is a bash
// discipline note that cost real time to find: a variable assignment prefixed to a FUNCTION call
// persists after the function returns, so a builder driven by `OPT=x build_fixture` leaks `OPT` into
// the next call. In JavaScript that is a non-issue only if the object is the sole input.
export function makeFixture(opts = {}) {
  const base = TOPOLOGIES[opts.topology];
  assert.ok(
    base,
    `makeFixture: unknown topology ${JSON.stringify(opts.topology)} — § 4.3 defines exactly `
    + `${TOPOLOGY_NAMES.join(', ')}`,
  );
  const o = { ...base };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) o[k] = v;
  o.scaffold = o.scaffold ?? 'none';
  assert.ok(
    ['none', 'start', 'ladder'].includes(o.scaffold),
    `makeFixture: scaffold must be one of none|start|ladder, got ${JSON.stringify(o.scaffold)}`,
  );

  // realpath BEFORE any use: on macOS /tmp resolves to /private/tmp, and a main_checkout() vs
  // --show-toplevel disagreement flips site 173 in either direction.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'l2-syncsh-')));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });

  try {
    fs.writeFileSync(path.join(root, 'gitconfig'), '# fixture global git config — intentionally empty\n');
    const env = fixtureEnv(root);

    // Both bare paths EMBED `github.com/<slug>`, which is the whole mechanism: sync.sh:71 is an
    // unanchored substring glob over the remote's URL string. The upstream slug is hardcoded at
    // sync.sh:60 and cannot be overridden, so that path is fixed; the fork's carries FIXTURE_SLUG,
    // which is also PR_REPO_SLUG, because `remote_for` resolves the push target from the same string.
    const upBare = path.join(root, 'github.com', `${UPSTREAM_SLUG}.git`);
    const forkBare = path.join(root, 'github.com', `${FIXTURE_SLUG}.git`);
    const main = path.join(root, 'main');
    const branch = `sync/upstream-${o.upver}`;
    const worktree = path.join(main, '.worktrees', `sync-${o.upver}`);

    // NFR4, asserted ONCE, before any spawn acts on any of them.
    assertUnderRoot(root, { root, upBare, forkBare, main, worktree });

    // ---------------------------------------------------------------- the scaffold and the manifests
    const scaffoldFor = (dir) => {
      if (o.scaffold === 'start' || o.scaffold === 'ladder') {
        write(dir, BUILD_SH, buildShStub);
        write(dir, AGENT_MD, agentMd('inherit'));
      }
      if (o.scaffold === 'ladder') {
        write(dir, 'Makefile', makefile(o.makeRed ?? 'none'));
        write(dir, STUB_TEST, stubTest(o.makeRed === 'suite'));
        if (o.drift !== 'missing') write(dir, DRIFT_TOOL, driftStub(o.drift === 'dirty'));
        write(dir, CAL_LOG, calLog);
        write(dir, TRACKED, '# a tracked file `make build` can dirty (site 230)\n');
      }
    };
    const manifestsAt = (dir, version, marketVer) => {
      for (const rel of MANIFESTS) {
        write(dir, rel, manifestJson(rel, rel === MANIFESTS[0] ? (marketVer ?? version) : version));
      }
    };

    // ------------------------------------------------------------------------- B, in both bare repos
    // Explicit `-b master` on EVERY init, bare repos included (NFR2).
    git(['init', '-q', '-b', 'master', '--bare', upBare], root, env);
    git(['init', '-q', '-b', 'master', '--bare', forkBare], root, env);

    const seed = path.join(root, 'seed');
    fs.mkdirSync(seed, { recursive: true });
    git(['init', '-q', '-b', 'master', seed], root, env);
    scaffoldFor(seed);
    manifestsAt(seed, o.bver);
    const shaB = commitAll(seed, env, 'B: shared base');
    git(['push', '-q', upBare, 'master'], seed, env);
    git(['push', '-q', forkBare, 'master'], seed, env);

    // ------------------------------------------------------------------------------ X, upstream tip
    const workUp = path.join(root, 'work-up');
    git(['clone', '-q', upBare, workUp], root, env);
    manifestsAt(workUp, o.upver);
    if (o.scaffold === 'start' || o.scaffold === 'ladder') {
      // The incoming `model:` alias arrives ON THE UPSTREAM SIDE, so sync.sh:104's
      // `git diff --name-only $mb $upstream_sha -- 'plugins/maister/agents/*.md'` lists this file.
      write(workUp, AGENT_MD, agentMd(o.alias ?? 'haiku'));
    }
    const shaX = commitAll(workUp, env, 'X: upstream advances');
    git(['push', '-q', 'origin', 'master'], workUp, env);

    // -------------------------------------------------------------------------- C, on fork master
    const workFork = path.join(root, 'work-fork');
    git(['clone', '-q', forkBare, workFork], root, env);
    manifestsAt(workFork, o.cver);
    const shaC = commitAll(workFork, env, 'C: fork advances');
    git(['push', '-q', 'origin', 'master'], workFork, env);

    // ------------------------------------------------------------- the main clone, remotes by slug
    git(['clone', '-q', forkBare, main], root, env);
    // Deliberately misleading names (AGENTS.md:347-356): a pass must never read as "remote names work".
    git(['remote', 'rename', 'origin', 'aaa-fork'], main, env);
    git(['remote', 'add', 'zzz-upstream', upBare], main, env);
    git(['fetch', '-q', 'aaa-fork', 'master'], main, env);
    git(['fetch', '-q', 'zzz-upstream', 'master'], main, env);

    const shas = { B: shaB, X: shaX, C: shaC };

    if (o.graph === 'step3') {
      // The worktree path is returned but DOES NOT EXIST — that is the point of this topology
      // (`cmd_start` creates it; site 121's arm pre-creates it).
      return finish({ root, upBare, forkBare, main, worktree, branch, shas, env, cleanup });
    }

    // ------------------------------------------------------- the sync branch: worktree at C, then S
    git(['worktree', 'add', '-q', worktree, '-b', branch, 'aaa-fork/master'], main, env);
    git(['merge', '--no-commit', '--no-ff', '-q', shaX], worktree, env, { tolerate: true });
    const tipIsS = o.graph !== 'full';
    manifestsAt(worktree, tipIsS ? o.headver : o.sver, tipIsS ? o.marketVer : undefined);
    if (tipIsS) applyTipExtras(worktree, o);
    shas.S = commitAll(worktree, env, 'S: merge upstream into the sync branch');

    // ---------------------------------------------------------------------- M', the next fork master
    if (o.graph === 'full' || o.graph === 'A') {
      manifestsAt(workFork, o.mver);
      shas.M = commitAll(workFork, env, "M': fork master moves on");
      git(['push', '-q', 'origin', 'master'], workFork, env);
      git(['fetch', '-q', 'aaa-fork', 'master'], main, env);
    }

    if (o.graph === 'B') {
      // Upstream advances again AFTER this sync merged -> site 197.
      manifestsAt(workUp, o.upver);
      write(workUp, 'UPSTREAM-X2.md', 'upstream moved again after the sync merged\n');
      shas.X2 = commitAll(workUp, env, 'X2: upstream advances again');
      git(['push', '-q', 'origin', 'master'], workUp, env);
    }

    if (o.graph === 'C') {
      // S itself becomes fork master, so HEAD == fork master and the merge is already on master.
      git(['push', '-q', forkBare, 'HEAD:master'], worktree, env);
    }

    // ------------------------------------------------------------------- T = merge(S, M'), the HEAD
    if (o.graph === 'full') {
      git(['merge', '--no-commit', '--no-ff', '-q', shas.M], worktree, env, { tolerate: true });
      manifestsAt(worktree, o.headver, o.marketVer);
      applyTipExtras(worktree, o);
      shas.T = commitAll(worktree, env, "T: merge fork master back in (HEAD^2 is OUR master)");
    }

    return finish({ root, upBare, forkBare, main, worktree, branch, shas, env, cleanup });
  } catch (e) {
    cleanup();
    throw e;
  }
}

// The CALIBRATION-LOG movement (L8) and the site-204 marker carrier both belong to the sync-branch TIP
// commit, because sync.sh:245 diffs `$base_sha`..HEAD and 204 greps the tracked tree.
function applyTipExtras(wt, o) {
  if (o.scaffold === 'ladder') {
    if (o.cal === 'appended') {
      fs.appendFileSync(path.join(wt, CAL_LOG), '## entry 2 — this sync\nupstream base moved; the copilot tree was regenerated\n');
    } else if (o.cal === 'edited') {
      const p = path.join(wt, CAL_LOG);
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      const i = lines.indexOf('baseline reference state recorded by the fixture builder');
      assert.notEqual(i, -1, 'fixture build: the CALIBRATION-LOG baseline line to edit is missing');
      lines[i] = 'baseline reference state EDITED IN PLACE (the log is append-only)';
      fs.writeFileSync(p, lines.join('\n'));
    }
    // `cal: 'none'` (the default) leaves the log byte-identical to base -> numstat empty -> site 246.
  }
  if (o.markers) {
    // Built by concatenation; no source line in this file starts with the run of characters
    // sync.sh:204 greps for (NFR5).
    fs.writeFileSync(path.join(wt, CONFLICTED), [
      '# a file carrying UNRESOLVED conflict residue (site 204)',
      conflictMarker('<', 'HEAD'),
      'ours',
      '=======',
      'theirs',
      conflictMarker('>', 'upstream'),
      '',
    ].join('\n'));
  }
}

function finish(f) {
  // Re-assert after the build: a `git worktree add` that silently landed elsewhere, or a realpath that
  // moved under us, must be loud rather than handed to a spawn.
  assertUnderRoot(f.root, {
    root: f.root, upBare: f.upBare, forkBare: f.forkBare, main: f.main, worktree: f.worktree,
  });
  return f;
}
