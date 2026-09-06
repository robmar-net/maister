# AGENTS.md — agent working agreement (robmar-net/maister)

Instructions for AI agents (Claude Code, GitHub Copilot CLI, etc.) working in this repository.
See also `CLAUDE.md` (Claude-specific project docs).

> **How this file reaches an agent — do not break it.** Claude Code auto-loads only the repo-root
> `CLAUDE.md`; it does **not** read `AGENTS.md` on its own. `CLAUDE.md` therefore opens with an
> `@AGENTS.md` import. If that line is dropped (an upstream merge overwriting `CLAUDE.md` is the
> likely way), every rule here goes silently unenforced for Claude Code sessions — the failure mode
> is invisible, because nothing errors. **After any upstream merge that touches `CLAUDE.md`,
> re-check that the import survived** (`grep -n '@AGENTS.md' CLAUDE.md`).

## Direction — BINDING, not negotiable

**We are a DOWNSTREAM fork. The direction of contribution is one-way: upstream → us. It is
NEVER us → upstream.**

- **Never push anything to `SkillPanel/maister` (upstream). Full stop.** No pushes, no new pull
  requests, no updates to existing upstream PRs, no merges into upstream — under any circumstances.
  This is not a case-by-case "ask first" rule; the answer is already **no**. Do not propose it, do not
  set it up "in case", do not infer an exception from any instruction. If a task appears to require an
  upstream contribution, that is a misread — STOP and re-scope to the fork.
- **All work happens on our fork, `robmar-net/maister`.** It is the working repository and the only
  valid write target for branches, pushes, PRs, and merges.

## Our job (this is the goal)

We maintain the **GitHub Copilot CLI adaptation** of maister as a downstream of `SkillPanel/maister`:

1. **React to upstream.** When `SkillPanel/maister` changes, fetch and **merge** those changes into
   our fork.
2. **Regenerate & adapt.** The Claude source (`plugins/maister/**`) stays **zero-touch**; our
   adaptation lives in `platforms/copilot-cli/build.sh` (transforms) and the generated
   `plugins/maister-copilot/**`. After a merge, rebuild (`make build`) and **intervene only where the
   Copilot version-adaptation needs it** — fix transforms, resolve generated-file drift by
   regenerating (never hand-merge generated files), keep `make validate` + `make check-deterministic`
   green.
3. **Keep the fork current and correct** so it can be installed/updated as the Copilot variant.

That reaction-and-adaptation loop — merge upstream, regenerate, fix our Copilot layer — **is the
entire purpose of this fork.** Improving upstream is not our concern.

### Parity, and honest knowledge of the gaps — never swept under the rug

The point of this project is **behavioral parity** — the generated `maister-copilot` variant behaving
the way maister is documented to behave for Claude — **and honest knowledge of exactly where that
parity cannot be reached and why.** The conformance tests (L0/L1/L2) are a *means to that end, not the
end in themselves.* A passing test suite is worthless if it passes by hiding a real divergence.

So for every divergence a test surfaces, do one of two things — never a third:

1. **Fix it** — adapt the Copilot layer (`build.sh` transforms, `hooks-overrides/`, generator rules)
   so the variant matches Claude's documented behavior.
2. **Document it as a limitation, with a justification** — say *what* diverges, *why* it can't be made
   to match (which mechanism is missing / can't be simulated on Copilot), keep it **visible** (a
   `🟢 ADAPTED` / `LIMITATION` cell in the Compatibility-Matrix + the report, never absorbed silently),
   and **track it** (a fork issue with the analysis). If it's hard, ticket it and tackle it separately
   — we do not have to solve everything at once.

**Never sweep a problem under the rug or hide it quietly.** Relaxing a conformance signal (moving a
required predicate to `optional`/`allowlist`, widening a sanity floor, softening an assertion) to make
a run go green is legitimate **only** when the divergence is simultaneously (a) justified from the
**workflow model** — not fitted to an observed run — and (b) documented + visible + tracked per point 2.
A silent green that buries a real gap is the one outcome this project exists to prevent.

### Decision records (ADRs) — write them, and never delete them

Significant decisions get an **ADR** under [`docs/adr/`](docs/adr/) (`NNNN-short-slug.md`, zero-padded,
sequential). "Significant" = anything a future contributor would otherwise have to reverse-engineer or
re-litigate: an architectural choice, a conformance/harness-semantics decision, a parity trade-off, a
"why we did NOT do the obvious thing" call. When in doubt, write one.

**ADRs are append-only history, not living docs.** When we change our mind, we do **not** edit away or
delete the old ADR — the superseded reasoning is exactly the record we want to keep. Instead:

- Add a **new** ADR that states the new decision and opens with `Supersedes ADR NNNN`.
- Update the **old** ADR's `Status` to `Superseded by ADR MMMM` (a one-line status change + link only —
  leave its body intact as the historical record).

The point is the same as the parity principle above: never quietly erase a decision or the context that
produced it. The trail of *why we thought X, then learned Y, then chose Z* is the asset.

## Versioning — downstream `+fork.N` suffix (BINDING)

We are a permanent fork whose *content* diverges from upstream while the version *number* is upstream's
(it is set by upstream's own "Bump version" commits, which we inherit by merging). Two artifacts labeled
`2.2.3` — upstream's and ours, ~130 commits richer — would otherwise be indistinguishable. So **every
shipped version string in this fork carries a SemVer 2.0.0 build-metadata suffix:**

    <upstream-base>+fork.<N>          e.g.  2.2.3+fork.1

- **`<upstream-base>`** — copied **verbatim** from the upstream commit we last merged (the value
  upstream's "Bump version" commit set). We never invent or bump this ourselves; it changes **only** by
  merging upstream.
- **`+fork.<N>`** — build metadata. It is ignored by SemVer *precedence*, so `2.2.3+fork.1` sorts equal
  to upstream `2.2.3` — which is exactly right: same upstream base, extra downstream content, not
  "newer" or "older". `N` is a monotonic integer counting downstream builds atop this base.

**Three files carry the version — keep them identical:** `.claude-plugin/marketplace.json` and
`plugins/maister/.claude-plugin/plugin.json` are **source** (edit by hand); `plugins/maister-copilot/.claude-plugin/plugin.json`
is **generated** — do **not** hand-edit it. It inherits the version from the source `plugin.json` via
`cp` in `build.sh`, so bump the source and run `make build`.

**When to bump `N`:**
- **+1** on each PR to `master` that changes what an installer receives — `plugins/**`,
  `platforms/copilot-cli/**` (build.sh / hooks-overrides), or the manifests. Docs-only, wiki-only,
  `compat-tests/`-only, or AGENTS.md-only PRs do **not** bump `N`.
- **reset to 1** whenever an upstream merge moves `<upstream-base>` (new base ⇒ `…+fork.1`).

**After merging upstream — the re-application step, do NOT skip:**
1. The merge overwrites our suffixed version with upstream's bare one, so `make validate` (**WS5.16**)
   fails loudly with "no `+fork.`". That failure is the reminder — it is working as designed.
2. Set all three manifests to `<new-upstream-base>+fork.1` (base moved ⇒ reset `N`). If the merge did
   **not** move the base, keep the base and only bump `N` when you actually ship a downstream change.
3. `make build` (propagates the version to the generated plugin) → `make validate` → commit.

`make validate` (**WS5.16**) enforces the `X.Y.Z+fork.N` shape on all three manifests, so a dropped
suffix can never ship silently. Distinguishing fork builds by version does **not** change our identity:
the marketplace stays `maister-plugins` and we still never push upstream (see Direction).

## Upstream-merge tripwires

Some incoming upstream changes need a Copilot-side adaptation to land *before* the merge, or they
introduce a silent parity gap. Treat each tripwire below as a **STOP** during a sync: if the incoming
merge carries the trigger, pause, finish the linked adaptation, then merge.

### `CLAUDE.md` overwritten — the `@AGENTS.md` import (ALWAYS check)

This file only reaches an agent because `CLAUDE.md` imports it (see the note at the top).
`CLAUDE.md` is **upstream-owned**, so any merge that touches it can drop the import — and nothing
will error, because absent instructions raise nothing. `make validate` (**WS5.23**) fails loudly if
the import is gone; run it after every sync and restore the `@AGENTS.md` block at the top of
`CLAUDE.md` if it fails. This tripwire is unlike the others: it does not gate one feature, it gates
whether *any* rule in this document still applies.

### `model:` per-agent tiering — issue #86 (RESOLVED — block lifted, residual guard stays)

Upstream carries a live `feat/model-tiering` branch that sets **per-agent `model:` frontmatter**
(`inherit` / `haiku` / `sonnet`). The probe (#86 T1, Copilot 1.0.82) established that Copilot **honors**
agent-level `model:`, but a Claude alias that is not a Copilot catalog id **errors at delegation** and
falls back to the default model. `build.sh` (step 3b) now **maps** the aliases to catalog ids
(`haiku→claude-haiku-4.5`, `sonnet→claude-sonnet-5`, `opus→claude-opus-5`; `inherit` left; unknown →
**build fails**), guarded by `make validate` (WS5.17). See
[ADR 0002](docs/adr/0002-copilot-agent-model-mapping.md).

- **`feat/model-tiering` is now safe to merge** — its `inherit`/`haiku`/`sonnet` values are all covered.
- **Residual guard (keep):** a `model:` value the map does not know **fails the build** on purpose. If
  an upstream merge introduces a *new* alias, the build stops — add it to the step-3b map (a Copilot
  catalog id) before completing the merge. That build-fail is the tripwire now, not a manual STOP.

## One ticket = one branch = one worktree (BINDING)

**Never work on a ticket in the shared main checkout.** Every ticket gets its own branch **and its
own `git worktree` directory**:

```bash
scripts/pr.sh start <ticket> <branch>      # = git worktree add .worktrees/<ticket> -b <branch> fork/master
cd .worktrees/<ticket>                     # do ALL the work here
scripts/pr.sh ship "<title>" --body-file … # lands the PR and removes the worktree (§ Shipping below)
```

`.worktrees/` is already git-ignored (`.gitignore:12`). The main checkout at the repo root stays on
`master` and is used only for reading, syncing and merging — never for authoring a change.

**Why this is binding, not a style preference.** Two agent sessions sharing one working tree
corrupted each other's work on 2026-09-03/04, in two ways — one loud, one silent:

- **Loud:** stray duplicates appeared and disappeared mid-session — `SKILL (1).md` inside the
  *generated* tree broke `make validate` outright, `scenarios/work (1).mjs` still breaks
  `run.test.mjs`'s on-disk scenario enumeration, and a `replay-provenance.test.mjs` materialised
  and vanished between two consecutive checks.
- **Silent, and worse:** PR #126's edits were swept into PR **#128** by the other session's
  `git add -A` before #126's own branch committed them. The change shipped correctly but under the
  wrong PR, so **commit attribution in that window is not trustworthy**. #126 had to be closed as
  superseded by content it had authored. A silent cross-branch leak like this is exactly the class
  of failure the rest of this document exists to prevent — it can just as easily carry a *wrong*
  change into someone else's green PR.

Rules that follow from it:

- **Stage explicitly.** Prefer `git add <paths>` over `git add -A` / `git commit -a`. In a shared
  tree `-A` is how one session's work ends up in another's commit; even in a clean worktree it
  hides strays.
- **`make build` writes into `plugins/maister-copilot/**`,** which is per-worktree — so parallel
  builds do not collide *provided* each session is in its own worktree. In a shared tree they do.
- **Check before you start:** `git worktree list`. If a worktree for this ticket already exists,
  use it — do not create a second one, and do not fall back to the main checkout.
- **`make validate` failing on a file you did not write** is a symptom of tree sharing, not a bug in
  the generator. Confirm with `git status --porcelain` and `git worktree list` before "fixing" it.

### Evidence must outlive the worktree (BINDING)

A worktree is disposable; the evidence produced inside one is not. **About 16 L2 replay bundles were
destroyed** by `git worktree remove` followed by `git clean -xdf` — `compat-tests/reports/` is
per-worktree **and** git-ignored (`reports/.gitignore` line 8 is `*/`), so nothing in git ever held
them and nothing complained when they went. Their `.md` reports survived and happened to be enough
that time; the raw traces they were derived from did not, and cannot be regenerated without spending
credits on a fresh drive.

So, for any run artifact you would be unhappy to lose:

- **A drive's bundle never lives only in a ticket worktree.** Archive it out of the repository the
  moment it is worth keeping:

  ```bash
  bash platforms/copilot-cli/compat-tests/l2/tools/bundle-archive.sh <ts>   # or an absolute bundle path
  ```

  The destination is a **sibling directory outside the repository** (`--print-dest` shows which;
  `COMPAT_L2_ARCHIVE` overrides it) precisely so it is unreachable by both `git worktree remove` and
  `git clean -xdf`. Do **not** "solve" this by copying the bundle to another directory *inside* the
  repo, `compat-tests/reports/` included — that is the same loss one command later.
- **Verify the copy landed before you remove the worktree — copying is not the rule, *verified* copying
  is.** `git worktree remove` is irreversible and a silent partial copy looks exactly like a good one:

  ```bash
  bash platforms/copilot-cli/compat-tests/l2/tools/bundle-archive.sh <ts> --verify   # exit 0 = intact
  ```

  `--verify` re-checks the recorded sha256 digests and names the offending path on any mismatch. **A
  non-zero exit means the evidence is not safe yet — do not remove the worktree.**
- **Analysis derived from a bundle is not a substitute for the bundle.** Keep both: the reduced report
  answers the question you had, the raw trace answers the one you have not thought of yet.

## Shipping — PRs and wiki updates go through the scripts (BINDING)

Two scripts are the **only** sanctioned way to land a change on `master` or on the wiki. Every rule in
this document that can be checked by a machine is checked by them, at the moment it matters, and none
of the checks has a skip flag. Hand-run `gh pr merge`, hand-run `git push` to the wiki, and "I'll fix
the counters later" are all violations, not shortcuts.

Why (review of 2026-09-07, [#148](https://github.com/robmar-net/maister/issues/148)): **56 PRs landed
in one week, all self-merged, three sessions in parallel.** In that week the wiki rollup drifted three
times in one session; six bundles were driven on Copilot CLI 1.0.83 and *no page mentioned 1.0.83* —
the "verified per release" promise had no tripwire; Home's ADR index stopped two ADRs short; and the
two incidents recorded above (the cross-branch leak into PR #128, ~16 bundles destroyed with a
worktree) both happened at steps a script now refuses to skip.

### PRs — `scripts/pr.sh`

```bash
scripts/pr.sh start <ticket> <branch>                  # .worktrees/<ticket> on <branch>, off fresh fork master
cd .worktrees/<ticket>                                 # ... work, git add <paths>, git commit ...
scripts/pr.sh ship "<title>" --body-file <body.md>     # the whole pipeline below, or a named refusal
```

`ship` runs a fixed pipeline; each step is a refusal point (see the script header for the list):
linked worktree + non-master branch + clean tree → push target resolved **by slug** to
`robmar-net/maister` → rebase on fresh master → **zero-touch** on `plugins/maister/**` (only the
version line of its `plugin.json` may change) → `make build` · `validate` · `check-deterministic` ·
the L2 unit suite, and the tree is *still* clean afterwards → the **`+fork.N` rule** (installer-visible
change ⇒ bumped; otherwise untouched) → push, `gh pr create`, wait for **every** check → squash-merge
with branch deletion → fast-forward the main checkout → remove the worktree **only** after the merge is
confirmed on `master` and every bundle in it is archived **and verified**. `--no-merge` / `--draft`
stop after opening; `--keep-worktree` keeps the tree. Nothing else is configurable.

Rules the script cannot check, and which still bind:

- **One PR per ticket, one ticket per session.** Before starting anything: `git worktree list` and
  `gh pr list --repo robmar-net/maister` — if the ticket is in flight elsewhere, do not start it again.
- **Never merge on red, never "re-run until green".** A flaky check is a bug to ticket, not a die to roll.
- **The PR body names the wiki pages it invalidates** ("Wiki: Matrix row for 1.0.83, Home status
  box"), and that wiki publish happens in the **same session, right after the merge** — not "later".
- **Stage explicitly** (`git add <paths>`); the script refuses a dirty tree but cannot tell a stray
  from a change.

### Wiki — `scripts/wiki.sh`

```bash
W=$(scripts/wiki.sh checkout)          # a FRESH clone (never a shared one) — prints its path
# ... edit $W/<Page>.md with anchored, assert-guarded replaces (the pages are hand-edited by the operator) ...
scripts/wiki.sh publish "<msg>" "$W"   # guards → pull --rebase → commit → push → verify remote HEAD
```

`publish` (and `check`, read-only) run four guards and refuse on any failure: **G1** the Parity-Map
header census matches its tables (`parity-header.mjs --check`); **G2** every Copilot CLI version with
a local bundle or archive has a **Compatibility-Matrix row** (`matrix-versions.mjs --check` — the
1.0.83 tripwire); **G3** every `docs/adr/NNNN-*.md` is linked from Home; **G4** the clone is not
behind `origin/master` (warning — publish rebases, and re-runs G1–G3 on the rebased result, so a
parallel session's edit cannot re-drift a counter under you). CI runs the same `check` on a fresh
clone daily and on web edits (`wiki-census-check.yml`).

Rules the script cannot check:

- **Pull, edit, publish — within minutes, never across a session.** A clone older than the edit it
  carries is stale by definition; `checkout` again rather than reuse one.
- **Anchored replaces only, never whole-page rewrites.** The operator edits these pages by hand
  between sessions; an unanchored rewrite deletes their work silently. Assert the anchor exists first.
- **A live run is not recorded until the Matrix has its row.** A run that spent credits and left no
  Matrix row is evidence that does not exist — G2 will refuse the next publish anyway, so do it now.
- **The Home status box and the Parity-Map "In plain terms" restate the Matrix; they never lead it.**
  Change the Matrix row first, then the restatements, in the same publish.

## Remotes — identify by repo SLUG, not by remote name

Remote *names* differ between clones (`origin`/`upstream`/`fork` are used inconsistently across
checkouts), so **never trust the remote name — key every decision on the repository slug**:

- `SkillPanel/maister` → **upstream. Read-only. Never a push/PR target.** (Fetch & merge only.)
- `robmar-net/maister` → **our fork. The only write target.**

Before any push/PR/merge, resolve the target's slug (e.g. `git remote -v`) and confirm it is
`robmar-net/maister`. If it resolves to `SkillPanel/maister`, do not proceed.

## Compatibility & conformance testing

We verify the generated `maister-copilot` variant against a live Copilot CLI at three layers
(L0 wiring / L1 hook effects / L2 workflow-model conformance). **How to run each, credit-free vs live,
where results are recorded, cost source, and the hard-won gotchas** (Copilot's ≥3 state-serialization
variants, sanity-floor INCOMPLETE ≠ regression, etc.) live in the runbook — read it before running or
debugging any compat/conformance check:

→ **[`docs/copilot-parity-runbook.md`](docs/copilot-parity-runbook.md)**

Live results are recorded on the **fork wiki** (`robmar-net/maister` wiki →
`Compatibility-Matrix`, `L2-Trace-Equivalence`, …), NOT in-repo (reports under
`compat-tests/reports/` are git-ignored artifacts). Costs come from
`~/.copilot/session-store.db` → `assistant_usage_events` (AIU = `total_nano_aiu`/1e9).

## Note on existing upstream work

- Upstream PR #10 (generator remediation) exists from earlier. Per the rule above, do **not** add to
  it or open new upstream PRs — it is legacy; leave it untouched.
