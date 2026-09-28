# ADR 0010 — `sync.sh` is tested against four hermetic git repositories, a line-keyed three-bucket census, and a vendored pre-fix control

- **Status:** Accepted — 2026-09-28
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#161](https://github.com/robmar-net/maister/issues/161) (the unit-test ticket this ADR records), [#160](https://github.com/robmar-net/maister/issues/160) (the fix the vendored control gates)
- **Issues filed from this work:** [#164](https://github.com/robmar-net/maister/issues/164) (`sync.sh:199` SIGPIPE — a reading of the code, **not** reproduced at the call site), [#165](https://github.com/robmar-net/maister/issues/165) (`sync.sh:37` header over-claim), [#166](https://github.com/robmar-net/maister/issues/166) (`sync.sh:229` / `pr.sh:117` unreachable `fail` — bucket B's sole member), [#167](https://github.com/robmar-net/maister/issues/167) (`sync.sh:110` unquoted `${a}` in an ERE), [#168](https://github.com/robmar-net/maister/issues/168) (`ab-compare.test.mjs` shared-`REPORTS_DIR` race)
- **Related:** [ADR 0009](0009-fork-vs-upstream-comparison-divergences.md) (its LIMITATION is the depth-1 CI fact Decision 3 is built on, and `variants.test.mjs`'s `^{commit}` probe is the anti-pattern Decision 3 departs from), [ADR 0002](0002-copilot-agent-model-mapping.md) (the alias tripwire whose guard at `sync.sh:110` carries #167), [ADR 0007](0007-l2-hygiene-default-and-bundle-provenance.md) (the "derive it from the artifact, never from the live checkout" precedent), `AGENTS.md:43-64` (parity — never a silent green), `AGENTS.md:66-71` (this ADR's mandate), `AGENTS.md:229-246` and `:291-296` (the shipping scripts; `pr.sh` cannot land a sync), the spec at `.maister/tasks/development/2026-09-27-161-sync-sh-unit-tests/implementation/spec.md` §§ 4, 5, 9

## Context

`scripts/sync.sh` had no test coverage. It is the only sanctioned way to land an upstream merge, its
`land` subcommand is a ladder of ten guards, and a wrong guard is either a merge that silently loses the
second parent or a refusal nobody can get past.

**Why a git fixture is needed at all — this is the part that is not recoverable from the code.** Every
`land` guard checks the **shape of a repository**, not the content of a file: that you are in a *linked
worktree* and not the main checkout (`sync.sh:172-173`), that the branch is not `master`, that the tree
is clean, that a remote *resolvable by slug* points at upstream (`:180`, `:189`), that the upstream tip
is an **ancestor** of `HEAD` (`:197`), that the branch carries a **merge commit of its own** (`:200`),
that no conflict residue survives (`:204`), that three manifests agree and the version moved the
inverted way (`:213-216`), that CALIBRATION was **appended** to and not rewritten. You cannot put the
real repository into any of those states in order to assert on them without damaging it — and several of
the states are mutually exclusive, so you cannot even reach them one after another in one tree.

**Why *four* repositories and not one.** The guards do not describe a repository; they describe
*relationships between four things* — an upstream remote, a fork remote, a main checkout that resolves
both by slug, and a linked worktree hanging off that main checkout whose branch has merged upstream into
fork master. Three of those relationships are invisible in a single repository: "upstream tip is an
ancestor of HEAD" needs two histories, "resolvable by slug" needs two remotes with the right URL
strings, and "linked worktree, not the main checkout" needs a real `git worktree` link, which is the one
thing a hand-built directory cannot fake.

None of that reasoning survives in the test code, which is why this ADR exists. The next author who
needs a git fixture in this repository will copy the recipe below; the four decisions it records are the
ones that are non-obvious enough to be got wrong on the second attempt.

## Decision 1 — local bare repositories at slug-embedding paths, because the slug matcher is textual and unanchored

`remote_for()` at `sync.sh:71` is, verbatim:

```sh
    case "$url" in *"github.com/${want}"*|*"github.com:${want}"*) printf '%s' "$r"; return 0 ;; esac
```

That is a **substring glob over the URL string**. There is no scheme check, no host lookup, no network,
no validation of any kind. `git remote get-url` returns the configured value **unrewritten**, so a
*local bare repository* at a path containing `github.com/<slug>` satisfies the lookup completely
offline. The fixture therefore puts its bare repositories at `<root>/github.com/SkillPanel/maister.git`
and `<root>/github.com/<FIXTURE_SLUG>.git`, and `sync.sh` resolves both.

**The trap is the opposite of the intuitive one, and this is the single most reversible mistake in the
recipe.** Because the match is textual and unanchored, a fixture path can satisfy it **by accident**. It
follows that a `file://` URL over the same path is **not** a negative control — it *resolves*, exit 0,
worktree created; three independent agents confirmed it. A negative control that changes the scheme
proves nothing and passes for the wrong reason. **The negative control must remove the
`github.com/<slug>` substring**, which is the only thing the matcher actually reads.

Two further properties of the same matcher are pinned deliberately:

- **The slug wins over the remote name.** The fixture names the upstream remote `zzz-upstream` and the
  fork `aaa-fork` — deliberately misleading, and deliberately sorted against any alphabetical
  first-match shortcut — so a passing test can never be read as "remote *names* work". This is
  `AGENTS.md:347-356` ("never trust the remote name — key every decision on the repository slug") made
  executable rather than asserted.
- **`FIXTURE_SLUG` is `fixture-owner/fixture-repo`, never `robmar-net/maister`.** It is also passed as
  `PR_REPO_SLUG`, so no spawn can name the real repository to `gh` even if `gh` were reachable.

### The rest of the recipe, and why each line is correctness rather than hygiene theatre

**`git init -b master` is mandatory — on every repository, bare ones included.** A fixture that inherits
the developer's `init.defaultBranch` asserts a refusal on one machine and its absence on another: the
branch-name guard at `sync.sh:175` and every `aaa-fork/master` reference depend on the name. That is a
**correctness bug, not a flake** — the test would be green and wrong, not intermittently red. The latent
version of this already exists in the suite: `citation-drift.test.mjs:62` is `git('init', '-q')` with no
`-b`, and it is only harmless there because nothing in that test reads a branch name.

**`HOME`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`, identity, date and locale are isolated for
correctness, not tidiness.** `sync.sh` runs `fetch`, `merge` and `push`. A developer's global config can
supply `init.defaultBranch`, `commit.gpgsign` (a merge that cannot be signed fails), `core.hooksPath` (a
pre-commit hook fires inside the fixture), `merge.conflictStyle` (`diff3` changes the marker shape the
`:204` guard greps for) and `push.default`. An unpinned author date makes SHAs non-reproducible; an
unpinned locale changes the git output the script parses. Each of these changes the *result*, not the
noise level.

**The one leak that actually bit was the test runner itself, and no amount of git-config isolation would
have caught it.** `node --test` exports `NODE_TEST_CONTEXT=child-v8` into every test *file's* process.
The fixture env is built from `{ ...process.env }`, so that variable rode into the `land` spawn and from
there into the **inner** `node --test` that `sync.sh:228` runs as its L2-suite gate. Measured twice, on
the same one-line deliberately-red file:

```
node --test red.test.mjs                            -> exit 1
NODE_TEST_CONTEXT=child-v8 node --test red.test.mjs -> exit 0
```

Set, the variable makes the inner runner behave as a **reporting child** of a parent runner: it reports
its failure upward instead of exiting non-zero. The consequence was observed, not theorised — module 4's
deliberately **red** stub *passed* the L6 gate, the spawn logged `L6 gates green, tree still clean`, and
the run refused far downstream at site 246 without ever reaching site 229. A green-looking arm for a site
it never visited: precisely the silent green `AGENTS.md:43-64` exists to prevent.

This is the sharpest available instance of the claim this section makes. The isolation list above is
about *git* — `HOME`, the config files, the identity, the date, the locale — and a reviewer scanning for
"is the environment isolated?" would have ticked every box while this variable decided the outcome of a
guard. The contaminant was not the operator's `~/.gitconfig`; it was **the harness's own runtime**, one
level up. Two consequences are recorded because both are non-obvious:

- **The scrub belongs in the env-building function, not in the module that noticed.** It was first
  patched locally in the ladder module, which was the only module whose spawns reach `sync.sh:228`. That
  is the smaller fix and the wrong one: the hazard is **generic** — `pr.sh:117` runs the identical
  `node --test` construct — so any future test driving `pr.sh ship` through this harness would hit it
  again, in a module whose author had no reason to know. `fixtureEnv` deletes `NODE_TEST_CONTEXT`
  unconditionally, which makes NFR1's claim ("the operator's environment cannot decide a test") true **by
  construction** for all four modules and every module added later.
- **The same hazard recurred one level further up, which is why the scrub is a LIST and not one delete.**
  The suite's own gate is `make test-l2-unit` (`Makefile:148`), so GNU make exports **`MAKELEVEL=1`** into
  `node --test`, and it rode into the fixture's own `make` — the one `sync.sh:225-227` invokes as its L6
  gate. That make then believed it was a *sub*-make and labelled its diagnostics `make[1]: *** [validate]
  Error 1`, so 4.T1(b)'s site-226 anchor (which tolerates GNU Make 4.x's `Makefile:<n>: ` field but not a
  recursion level) stopped matching. Isolated to the single variable: `MAKEFLAGS=s` is harmless,
  `MAKELEVEL=1` alone reproduces it. **`MAKELEVEL`, `MAKEFLAGS` and `MFLAGS` are scrubbed alongside
  `NODE_TEST_CONTEXT`.** Two things make this worth recording rather than just fixing. First, `sync.sh`
  behaved **correctly** — it refused at site 226 with the right message; the leak corrupted the guard's
  diagnostic *prefix*, not the guard, so the failure accused the subject of something it did not do.
  Second, and worse: the defect was **invisible to a bare `node --test` over the same glob** (green 3/3)
  and appeared only under the **official gate** (red 3/3). Verifying with the convenient command instead of
  the real one is its own silent green, and the fixture's `make` is the SUBJECT'S gate — invoked the way a
  real operator's `sync.sh land` invokes it — so it must never inherit a recursion level, a jobserver
  handle or a flag set from whatever drove the suite.
- **What is asserted is the behaviour, never the variable.** The load-bearing check is module 4's
  `assert.doesNotMatch(stderr, /^L6 gates green, tree still clean$/m)`: `sync.sh:231` prints that line
  only when `:228-:230` all succeeded, so its **absence** is the positive proof that site 229 was the
  stopping point — which is what keeps that arm's zero-`REFUSED` count honest. An assertion on the
  variable's absence from the env would merely restate the harness's own code and would go green again
  the moment some other mechanism re-neutralised the inner runner.

**The root is resolved through `fs.realpathSync` before any use.** On macOS `/tmp` is a symlink to
`/private/tmp`, and `main_checkout()` (`sync.sh:75`, via `git worktree list --porcelain`) returns the
resolved path while `git rev-parse --show-toplevel` (`sync.sh:172`) may return the unresolved one. A
disagreement flips site 173 — the "you are in the MAIN checkout" refusal — in *either* direction: a
false refusal, or a guard that silently stops firing. Resolving once at `mkdtemp` time is what makes the
guard mean what it says.

**Reusing a fixture via `cp -R` is forbidden.** The copy keeps the *source* root's absolute paths in the
linked worktree's gitdir pointer and in every remote URL, so the copy's `push` lands in the **source
fixture's** bare repository. The failure is silent and cross-test: the copy appears to work while
mutating another test's repositories. Every fixture is built from scratch in its own `mkdtemp` root.

## Decision 2 — the census is keyed on the LINE NUMBER, has exactly three buckets, and ratchets in both directions

Coverage of a refusal ladder is worthless unless something reds the suite when a new refusal appears
untested. That something is a census test that enumerates every `fail "` site in `scripts/sync.sh` and
asserts the enumeration equals the union of three declared buckets. At HEAD `b3feeda` the enumeration is
**36 sites**: 86 87 88 112 121 173 175 176 180 181 189 195 197 200 204 213 216 220 225 226 227 229 230
237 240 246 248 253 255 258 266 269 273 274 276 288.

**Why the key is the line number and not the `fail` string.** Three strings are duplicated across six
sites — `no remote points at upstream ${UPSTREAM_SLUG} (fetch-only)` at 86 and 189, `no remote points at
${SLUG}` at 87 and 180, `push refused` at 253 and 255 — so **36 sites collapse to 33 distinct strings**.
A string-keyed census would report full coverage, **33 of 33**, with three sites entirely untested. That
is exactly the silent-green shape the census exists to prevent (`AGENTS.md:43-64`), so keying on the
message text is **forbidden**, not merely discouraged.

**Why there are three buckets and not two.** The obvious design is covered-versus-excluded. It has a
fatal property: the one site whose `fail` is genuinely unreachable *because of a defect* has nowhere to
go but the exclusion list, where it becomes indistinguishable from a structural impossibility — a real
defect laundered into an amnesty. So:

- **Bucket A — refusal-covered, 29 sites.** Each executes and produces exit 1 with a `REFUSED` line.
- **Bucket B — defect-pinned, 1 site: 229.** `sync.sh:228-229` re-runs the L2 suite through
  `| tail -30 >&2` and then calls `fail`. Under `set -euo pipefail` (`sync.sh:57`) the brace group is the
  **last** member of the `||` list, so errexit applies inside it and the shell exits at the pipeline —
  whose status is node's, via `pipefail`. Observed: exit 1, the node dump on stderr, **zero `REFUSED`
  lines**. `errexit` and `pipefail` are **jointly** load-bearing: with `pipefail` off the pipeline
  reports `tail`'s 0 and `fail` *does* run. Filed as [#166](https://github.com/robmar-net/maister/issues/166);
  `pr.sh:117` carries the identical construct.
- **Bucket C — excluded, 6 sites: 266, 269, 273, 274, 276, 288.** Each sits behind a **successful
  `gh pr create`** at `sync.sh:258` — `num` is assigned at 259 only if 258 succeeded — which is a true
  impossibility offline, not a cost. Site **258 itself is reachable** and is covered: with `gh` absent
  from the derived PATH the command substitution fails and its `fail` fires.

**Bucket B is held to bucket C's standard, deliberately.** Membership requires a **demonstrated**
unreachability — the neutralisation experiment above and its recorded result — and a filed issue number
**does not satisfy it on its own**. Without that rule bucket B is a soft landing place for any site
someone found inconvenient to test, which is the two-bucket failure mode reintroduced under a new name.

**The ratchet runs both ways, and one direction is counter-intuitive.** A `fail` site **added** to
`sync.sh` later belongs to no bucket, so the set-equality assertion fails and the suite is red until
someone tests it, pins it, or justifies excluding it. A site **removed** also fails set equality, so a
stale map cannot rot silently. And **fixing #166 reds the suite**: site 229 moves into the refusal map,
and the test that pins today's crash fails. That is the correct signal, not a maintenance burden — the
pin is a statement about a defect, and it must stop being green the moment the defect is gone. The
enumeration was proved non-vacuous by mutation: an added site yields enumeration 37 and the count
assertion fails; a removed site leaves 18 stale bucket keys and the reverse-direction assertion fails.

## Decision 3 — the pre-fix script is vendored as a fixture, never read out of git history, and the skip gate probes the blob

The #160 fix needs a control: the pre-fix script must **fail** the oracles that current code passes, or
the test characterises rather than gates. The obvious way to get those bytes is `git show 9765a95^:scripts/sync.sh`.

**That is a permanent red in CI.** `l2-check.yml` checks out at the default **depth 1**, so the object
is simply absent — the same fact ADR 0009 records as its LIMITATION. So the pre-fix script is
**vendored** as `test/fixtures/sync-sh/pre-160-sync.sh.txt`, mode `0644`, and the control runs those
bytes through the same spawn helper as the live script. Verified at the time of writing: **289 lines,
17792 bytes**, sha256 `87b6661ec1f5aff94f63329d4b8d5714145f2067558447d77f090b80afff5bb3`, git blob
`c3c7499a1a75fd4059151c215cf72997acce57de`. Three digest assertions run **unconditionally**, and a
provenance sidecar (`fixtures/sync-sh/README.md`) records the commit and the rule that the file is
**data, never code** — it must never be edited to make a failing control pass.

The vendored file commits verbatim because it contains **zero** lines matching the conflict-marker guard
at `sync.sh:204` (measured: 0). Had it contained one, it would have needed base64 storage with the test
decoding it — which is why that possibility is recorded here and **not** implemented speculatively.

**The digest guard probes the blob the assertion reads, and never `^{commit}`.** One assertion — the
byte-equality against `git show 9765a95^:scripts/sync.sh` — may skip, and its gate is
`git cat-file -e 9765a95^:scripts/sync.sh`, the **blob**. The precedent in this suite does it the other
way: `variants.test.mjs:410` probes `f75ef4f^{commit}`. A commit probe is wrong here, and the depth
sweep is the evidence: the byte-equality passed **128/128 at depths 1 and 2**, **0/128 at depth 3**, and
0/0 from depth 4 — and at depth 3 the *commit* is present while `git show` of the blob fails. A commit
probe would therefore have let the assertion run and fail rather than skip honestly. The skip reason is
also worded as the true condition — "the pre-#160 blob is absent from this clone" — which is **wider**
than "on a depth-1 clone", and stated by line number in the module header on the
`sweep-sh.test.mjs:38-44` model.

**"Only one *assertion* may skip" is enforceable only because that assertion is a guarded SUBTEST, and
this is the mechanism to preserve.** NFR8 permits exactly one skip in this PR, and the word *assertion* is
load-bearing: the three digest checks — 289 lines, 17792 bytes, the sha256 — must run on **every** clone
at **every** depth, because they are what makes the vendored bytes trustworthy as data. Only the
byte-equality against git history is allowed to stand down, and only when the blob is genuinely absent.
Node's test runner gives exactly one construct that expresses that split: the test declares the digest
assertions at its own level and wraps the comparison in `await t.test('2.T3b: …', { skip }, …)` — a
subtest carrying its own `skip`, where `skip` is the falsified blob probe.

The alternative shape — `test('2.T3', { skip }, …)` on the whole test — is the one a future reader is
most likely to reach for as a simplification, and it would **silently widen the exemption from one
assertion to four**. On a depth-1 clone the three unconditional digests would stop running too: the
vendored file could then drift, or be edited to make a failing control pass, and CI would report a
tidy single skip with nothing red. That is the same class of silent green as Decision 2's string-keyed
census — an accounting change that looks like a simplification and quietly removes a guard. The
`{ skip }`-guarded subtest is therefore **structural, not stylistic**, and the skip-count assertion in
`make test-l2-unit`'s acceptance delta (at most **+1**) is what would catch its loss only if the whole
test skipped as one — which is precisely why the mechanism is recorded here rather than left to the
reader's judgement.

Note the shape of that window: it **moves as the repository advances**, so it never closes on its own.
Vendoring is not a workaround for a temporary CI setting; it is the only depth-independent answer.

## Decision 4 — one shared helper module, which breaks this suite's precedent, and when to split it further

Every other test module in `l2/test/` is self-contained. `sync-sh-harness.mjs` is the suite's **first
shared helper module**, and the precedent break follows mechanically from a measurement, not a taste:
the coverage splits into **four** test modules (`sync-sh`, `sync-sh-160`, `sync-sh-land`,
`sync-sh-ladder`) because the ladder must run strictly serially in guard order while the shape tiers do
not. Four modules need one definition of the four-repository fixture and one definition of the
refusal/usage/crash taxonomy. Four copies of `assertRefused` would drift.

The claim is deliberately modest, and the weaker version is the honest one: **a drifted copy would be a
weaker assertion, not a silent green.** The taxonomy is subtle in ways that reward one definition — the
`REFUSED` prefix is matched with a multiline anchor rather than `startsWith`, because site 226's observed
output has a `make:` line in front of it; a crash is "any non-zero status with **no** `REFUSED` line",
which is what separates a guard from site 229's silent exit 1 and from an exit 128; and every assertion
normalises `stdout`/`stderr` with `?? ''` so `doesNotMatch` is never handed `undefined`. The module is
named a *harness* rather than a fixture factory precisely because it exports assertions as well as
repositories.

**When to split `helpers/sh-assert.mjs` out: when a non-git subject first needs the taxonomy.** `pr.sh`,
`wiki.sh` and `sweep.sh` share the exit-code contract (1 + `REFUSED`, 2 for usage) but need nothing from
the four-repository fixture. The first of those to be tested is the trigger, and the split is then
obvious and cheap. Doing it **now**, with exactly one consumer, would be speculative structure — a
second module to justify a boundary no caller has asked for.

## Honest limits

1. **30 of 36 sites are executed — 29 as refusals, 1 pinned as a defect — and 6 are named as structurally
   behind a successful `gh pr create`.** That is the honest number and the one the PR body states; it is
   not rounded up, and `--no-merge` does not improve it (it is evaluated at `sync.sh:261`, after the
   pushes at 253/255 and after `gh pr create` at 258). The hermetic ceiling is structural.
2. **[#164](https://github.com/robmar-net/maister/issues/164) (`sync.sh:199` SIGPIPE) is a reading of the
   code, not an observed failure.** `git rev-list --merges HEAD "^$base_sha" | grep -q .` can leave
   `rev-list` writing into a closed pipe. The mechanism was demonstrated and the threshold measured at
   roughly 1600 lines / 64 KiB — but the **call site is not reproduced** at this repository's 43 merges.
   This hedge is preserved everywhere the issue appears, including here: it is a hazard, never a defect.
   Issues #166 and #167 are different in kind — both reproduced by execution.
3. **A green census is not proof that a guard is correct**, only that it refuses. The tests assert exit
   status, the `REFUSED` prefix and a message fragment; they do not assert that the *predicate* behind a
   refusal is the right predicate. Site 258's test likewise pins that the script refuses when its
   tooling is absent — it does not exercise a GitHub-reported API failure.
4. **The four-repository fixture proves the guards against a *synthetic* topology.** It builds the shapes
   `sync.sh` checks for; it does not prove that a real upstream merge produces exactly those shapes. The
   live proof of that is a sync actually landing.

## Consequences

- `sync.sh` has coverage that reds on an unclassified new refusal site, and the #160 fix has a proven
  regression gate that is independent of git history depth.
- The next git fixture in this repository has a recipe: local bare repos at slug-embedding paths,
  explicit `-b master` everywhere, a realpath'd `mkdtemp` root, the full config/identity/locale
  isolation set, misleading remote names, a fixture slug that is never the real one, and no `cp -R`.
- One known defect ([#166](https://github.com/robmar-net/maister/issues/166)) is **visible in a bucket of
  its own** instead of absorbed into an exclusion list — and fixing it will red the suite on purpose.
- The suite acquires a shared helper module, with a stated trigger for the next split rather than an
  open question.
- This PR ships through `scripts/pr.sh` and does **not** bump `+fork.N`: `pr.sh:125`'s `installer_paths`
  regex is `^`-anchored to four prefixes — `plugins/`, `platforms/copilot-cli/build.sh`,
  `platforms/copilot-cli/hooks-overrides/`, `.claude-plugin/marketplace.json` — and **neither**
  `platforms/copilot-cli/compat-tests/…` **nor** `docs/adr/…` matches any of them. `sync.sh` is the
  subject under test and is never invoked to ship its own tests.

## A note on this document and the conflict-marker guard

`sync.sh:204` greps the whole tree for a line **beginning** with seven less-than signs or seven
greater-than signs followed by a space, and this ADR discusses that guard. Every reference to those
characters here is therefore spelled out **in words**, and no such run appears at the start of a line in
this file. A future editor adding an example must keep it that way, or landing the next sync refuses on
this document.

## This ADR is append-only

ADRs in this repository are **append-only**. If any decision here is revisited — the matcher at
`sync.sh:71` is anchored, the census gains a fourth bucket, #166 is fixed and 229 moves to the refusal
map, CI gains full history and the vendored fixture becomes redundant, or `helpers/sh-assert.mjs` is
split out — that change is recorded in a **new, superseding ADR** that references this one. **Never edit
this file to reflect a later decision.** The record of what was believed, and why, on 2026-09-28 is what
makes the reasoning auditable at all.
