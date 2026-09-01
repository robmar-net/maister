# AGENTS.md — agent working agreement (robmar-net/maister)

Instructions for AI agents (Claude Code, GitHub Copilot CLI, etc.) working in this repository.
See also `CLAUDE.md` (Claude-specific project docs).

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
