# ADR 0009 — The fork-vs-upstream comparison diverges from #138's literal text in four places, and one of those divergences is visible only here

- **Status:** Accepted — 2026-09-06
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#138](https://github.com/robmar-net/maister/issues/138) (the epic this ADR records), WP1 (upstream arm), WP2 (sweep), WP3 (cost normalization), WP5 (bundle archive), WP6 (this document)
- **Follow-ups:** [#144](https://github.com/robmar-net/maister/issues/144) (witness-based `route`, `basis: 'witness'`), [#145](https://github.com/robmar-net/maister/issues/145) (`fetch-depth: 0` — the one-line fix for the LIMITATION below)
- **Related:** [ADR 0007](0007-l2-hygiene-default-and-bundle-provenance.md) (bundle-first cost, self-describing provenance — the mechanism DIV-2 and DIV-3 sit on top of), [ADR 0008](0008-copilot-overrides-the-model-pin-per-subagent.md) (the per-subagent model override — the reason DIV-4's numbers move and the reason route explains nothing), [ADR 0003](0003-copilot-parallel-fan-out-measurement.md) (the "measured ≠ true" precedent), `docs/copilot-parity-runbook.md` §§ "The `upstream` control arm", "How to read a cost comparison", `l2/variants/legacy-arms.json`, `docs/parity/l2-evidence-dispositions.md`

## Context

Issue #138 specified a repeatable fork-vs-upstream comparison: an upstream control arm, a budgeted sweep,
normalized cost, durable evidence, and a runbook. Implementation followed the issue closely, but in four
places the issue's **literal text** turned out to be wrong, unreachable, or actively harmful to a reader,
and the implementation deliberately diverged.

This ADR records those four divergences. It exists because #138's text will outlive the work — someone
will read the issue, compare it to the tree, and need to know which differences are *decisions* and which
are *bugs*. All four below are decisions.

It also exists for a second, less obvious reason, stated plainly in DIV-2 below: **for one of these
divergences, this ADR is the only place the fact is visible at all.**

## DIV-1 — the arm id is `upstream`, not `upstream-control`

#138 names the control arm `upstream-control`. The manifest ships as `l2/variants/arms/upstream.json`
with `"arm": "upstream"`.

**Why.** `upstream-control` is *already taken*. It is the `legacyArm` token of three surviving
pre-provenance bundles (`20260831T022944Z`, `20260831T022952Z`, `20260831T024753Z`) in
`l2/variants/legacy-arms.json`, and it is pinned by a test at `run.test.mjs:986`. Those bundles are
`comparable: false` legacy rows; the new arm produces `comparable: yes` live rows. Had the new arm reused
the token, `ab-compare` would print **the same word from two namespaces in one table** — one meaning "a
verified, staged, provenance-bearing control" and the other "an operator-asserted 2026-08-31 hand-stage
that is not comparable to anything". A reader cannot distinguish those by eye, and the whole point of the
`comparable` column is that they must not be conflated.

The cost of the divergence is one word in an issue. The cost of obeying the issue is an unreadable table.

## DIV-2 — `legacy-arms.json` gains **nothing**

#138 asks for a `commit:` field on the legacy map rows, recording that the three upstream-control bundles
were staged from `f75ef4f`. **No field was added. The file is unchanged.**

**Why.** `commit: f75ef4f` is not a recorded fact about those bundles. It is an **inference** — the
operator's recollection of which tree was hand-staged in a `/private/tmp/…/upstream-variant-*` directory
on 2026-08-31, reconstructed after the fact from `maisterVersion` and `skill.invoked.data.path`. The
bundles do not contain it. Nothing in them can confirm it.

On `20260831T022944Z` the inference is worse than unrecorded — it is **chained**. That row's
`pluginDirRecovered` is `null` (it has no path-bearing event at all: no `skill.invoked`), so its own note
already concedes it is "an operator assertion — same upstream-variant session as 022952Z". Its
upstream-ness is inferred from a *sibling bundle*, and a `commit:` field on it would be an inference
resting on an inference, rendered in the same typeface as `pluginSource.commit` on a live bundle, which is
a **recorded** fact verified against a staged tree.

ADR 0007's entire premise is that provenance comes from the bundle. Writing a plausible commit into a
metadata file is precisely the move that premise forbids. The three rows stay `comparable: false`, and the
recovered plugin dir stays the only path evidence they have.

There is also a mechanical constraint that makes the "just add it to the three upstream rows" instinct
fail immediately: `run.test.mjs:985` asserts the **exact row key set, per row, looped over all six**
bundles. A `commit:` field on three of six rows fails that test outright. The schema is uniform on
purpose.

### The DIV-2 visibility caveat — this ADR is doing the visibility work

The design intent was that the `f75ef4f` reasoning would live in each row's free-text **`note`**. Two
things are true about that, and both matter.

**First, the `note` is rendered nowhere.**

`ab-compare`'s row keys are exactly:

```
ts, scenario, arm, mutation, source, comparable, commit, aiu, models, dir   (+ origin, after WP1)
```

`note` is not among them. No tool prints it; no report surfaces it. It is a durable breadcrumb for
whoever opens the JSON, not a visible one.

**Second — and this was verified while writing this ADR — the reasoning is not in the `note` either.**
`grep -c 'f75ef4f' l2/variants/legacy-arms.json` returns **`0`**. The three `upstream-control` notes read
"…same upstream-variant session as 022952Z", "…(upstream 2.2.3 tree, no fork hook, leaked instructions)"
and "upstream 2.2.3 tree; leaked instructions". The commit is named in none of them.

So the fallback that DIV-2 was designed to rely on **does not exist in the shipped tree**. There is no
unrendered-but-present breadcrumb; there is no breadcrumb. Outside this document, the connection between
those three bundles and `f75ef4f` is recorded **nowhere in the repository at all**.

**This matters, and it is the reason this section exists.** AGENTS.md's parity rule requires every
divergence to be *documented, visible and tracked* — never a silent green. Had this ADR merely recorded
"we chose not to add a `commit:` field", DIV-2 would have satisfied **documented** while quietly failing
**visible**: a reader of the tables would see three legacy rows with no indication that their
upstream-ness is an operator assertion at all, and — given the empty `note` — no way to reach that fact
from the repository by any path.

So this is stated explicitly: **the ADR is the visibility mechanism for DIV-2.** If a future change adds a
renderer for `note`, or promotes those rows, or files the gap as an issue, that mechanism can move — but
it must move somewhere, not simply be dropped.

## DIV-3 — only `pluginSource.origin` enters bundle meta; `treeFacts` stay on stderr

#138 describes recording the staged tree's facts in the bundle. The implementation records exactly **one**
field in meta — `pluginSource.origin` (`'fork'` | `'upstream'`) — and leaves the richer `treeFacts` the
staging step computes on **`variant.sh`'s stderr**, where they appear in the drive log and nowhere else.

**Why.** `origin` is a **declaration** that the arm manifest makes and the staging step verifies against
the tree (`expects.hooksDir: false` for `upstream`). It is stable, one-of-two, and it is what any
comparison actually needs: which side of the fork this drive came from. It is also what `ab-compare`'s new
`origin` column renders.

`treeFacts` are a **staging diagnostic** — shaped by whatever `variant.sh` happened to compute, unstable
across changes to that script, and of no use to a downstream comparison. Promoting them into bundle meta
would freeze a debug format into the persisted schema every replay tool must then honor, in exchange for
data no consumer reads. They belong in the log.

## DIV-4 — `34.78` is refuted; the measured pair is `28.588154` vs `36.994980`

#138's text cites **`34.78`** as the upstream figure in the fork-vs-upstream cost comparison. **That
number is unreproducible.** It appears nowhere outside #138's own text — not in a bundle, not in a
manifest, not in `cost-bands.json`, not in any report.

The measured pair, derived from the bundles themselves, **normalized on the intersection of the served-model
sets** (`gpt-5.6-luna` + `gpt-5.4-mini`) — not on the model pin:

| side | bundle | normalized AIU | derivation |
|---|---|---|---|
| upstream | `20260831T024753Z` | **`28.588154`** | `6.189270` (`gpt-5.4-mini`) + `22.398884` (`gpt-5.6-luna`). Its **raw** total is `72.579689` |
| fork | `20260903T000910Z` | **`36.994980`** | Σ `totalNanoAiu` / 1e9 — its **entire** total, since it served only luna + mini (cross-checks to the DB window read and `session.usage_checkpoint`, Δ 0.000000) |

Two things this table must not be allowed to hide. **`28.588154` is not the upstream drive's cost** — that
drive cost `72.579689`. It is what remains after restricting to the models both sides share, which is the
only basis on which the two can be compared at all. And the discarded remainder is the actual finding:
`20260831T024753Z` burned **`43.991535` AIU — 61 % of its total — on `claude-sonnet-4.6`**, a model its
counterpart never served once.

Note also that #138's stated *mechanism* cannot work even in principle. It keys normalization on the model
**pin**, but `modelMix.pin` is `null` for both of these bundles and for **five of the seven** survivors.
Under the null discipline a pin-keyed figure would itself be `null`. This is why `--normalize=shared` keys
on the served-model **intersection** instead (D2, rewritten).

**Why this is recorded rather than quietly corrected.** `34.78` is close enough to `36.99` to look like a
rounding difference or a slightly different window, which is exactly what makes it dangerous: a reader
reconciling the issue against the tree could conclude the tree is wrong. It is not a variant of the
measured number. It has no derivation.

**And the pair itself is not a headline.** Both bundles are pre-provenance, `comparable: false` legacy
rows — the struck pair. Any figure quoted from them **must** carry the `comparable: no (legacy)` caveat,
and `28.59 vs 37.00` must **never** be quoted bare. They ran with leaked custom instructions, under a
pre-#120 no-op hook, across different served-model sets — the precise conditions ADR 0008 shows make an
arm-to-arm comparison invalid rather than merely weak. They are recorded here as *the correction to a
specific wrong number*, not as a result.

## LIMITATION — WP1's staging path is not exercised in CI

The upstream arm is WP1's headline capability, and **CI does not test that it works.**

`.github/workflows/l2-check.yml`'s checkout step carries no `with:` block at all — so no `fetch-depth`,
so a depth-1 clone that **cannot resolve `f75ef4f`** (153 commits back).

Two tests are involved, and the distinction is the whole limitation:

- **Test 9** (`variants.test.mjs:420`, "stages the pinned upstream tree byte-identically") is the one that
  actually exercises staging. It is skip-gated on `git cat-file -e f75ef4f^{commit}`. On a developer
  machine with full history it **runs and passes**. On a depth-1 runner the probe fails and the test
  **skips**.
- **Test 6** (`variants.test.mjs:305`) carries no `{skip}` and always runs — but it parses the manifests
  against the R5 **schema**. That is all it verifies.

So on CI, what remains after test 9 skips is a schema check. CI says **nothing** about whether the
upstream tree still stages, whether `expects.hooksDir` still holds against the real tree, or whether
`origin` is still recorded. A skip is not a pass, and it is not reported as one.

The staging path is therefore proven **only on a developer machine with full history**. A green CI must
not be read as evidence that the upstream arm works. The fix is one line — `fetch-depth: 0` on that
checkout step — filed as [#145](https://github.com/robmar-net/maister/issues/145); the repository's full
history is 356 commits, so the cost is negligible. Until it lands, this limitation stands and is repeated
in the runbook beside the arm.

## Decision

Accept all four divergences as recorded above. #138's literal text is superseded by this ADR on these four
points; the issue remains authoritative everywhere else.

## Consequences

- The comparison tables stay readable, and `comparable` keeps its meaning (DIV-1).
- Inferences are never rendered in the same typeface as recorded facts (DIV-2), at the cost that the
  reasoning is visible **only here** — a cost this ADR discharges by saying so.
- The persisted bundle schema stays small and stable (DIV-3).
- A wrong number in a widely-read issue has a citable refutation (DIV-4).
- The upstream arm carries a standing, stated CI gap until `fetch-depth: 0` lands (LIMITATION).

## This ADR is append-only

ADRs in this repository are **append-only**. If any decision here is revisited — the arm is renamed, a
`commit:` field is added, `treeFacts` are promoted, a reproducible cost pair is measured, or CI gains full
history — that change is recorded in a **new, superseding ADR** that references this one. **Never edit
this file to reflect a later decision.** The record of what was believed, and why, on 2026-09-06 is the
thing that makes the divergence auditable at all.
