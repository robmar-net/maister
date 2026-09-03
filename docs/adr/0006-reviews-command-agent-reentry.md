# ADR 0006 — The `reviews-*` fan-out is direct; the real defect is agent **re-entry** (19–24% of subagent tokens)

- **Status:** Accepted — 2026-09-03
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#76](https://github.com/robmar-net/maister/issues/76) (WP-C1), [#106](https://github.com/robmar-net/maister/issues/106) (group A), [#110](https://github.com/robmar-net/maister/issues/110) (cost)
- **Related:** [#16](https://github.com/robmar-net/maister/issues/16)/[#17](https://github.com/robmar-net/maister/issues/17) (commands surface as skills), [ADR 0003](0003-copilot-parallel-fan-out-measurement.md) (the "measured ≠ true" precedent), `platforms/copilot-cli/build.sh` step 8e, `make validate` WS5.18

## Context

WP-C1's hypothesis, carried on the Parity-Map for weeks as the reason the verification fan-out is 🟡:

> the model prefers `skill("reviews-*")` over the instructed `task` calls, so the five review agents
> run **via a skill hop instead of direct delegation** — "serialization + an extra hop".

Following ADR 0003's lesson, the hypothesis was checked against raw events before being fixed or
excused. It is wrong in its causal direction, and it hides a larger, measurable defect.

## What the bundles actually show

Reading `tool.execution_start` / `subagent.started` (with `turnId` and `parentId`) in the two live
1.0.82 development bundles `20260903T000910Z` and `20260831T024753Z`:

1. **The orchestrator delegates directly, as instructed.** `spec-auditor` starts from a top-level
   `task` call (orchestrator turn 25), and the verification wave starts
   `implementation-completeness-checker` + `code-reviewer` + `production-readiness-checker` +
   `code-quality-pragmatist` back-to-back in a single turn — the documented "up to 5 parallel task
   calls" (consistent with ADR 0003's 6× peak). There is no "skill instead of task".
2. **The agent then invokes its own same-named skill.** Inside the subagent (its turn 0) comes
   `skill(reviews-spec-audit)` — a plugin **command** that Copilot surfaces as a model-invocable
   skill (#16/#17).
3. **That skill body orders a delegation back to the same agent.** Every `reviews-*` body opens with
   an imperative — *"Call the task tool with `agent_type="maister-copilot:spec-auditor"` NOW … Do not
   read files, explore code, or execute workflow steps yourself"* — correct when a **user** invokes
   the skill, a **self-call** when the agent does. The nested `task` follows at the subagent's turn 1
   (`parentId` present), and the pattern repeats one more level.

**Observed depth 2 — three instantiations for one requested review.** Reproducible: `spec-auditor`
1 top-level + 2 re-entrant in **both** bundles; `reality-assessor` the same in `20260903T000910Z`.
(What terminates the recursion at depth 2 is not established; the innermost instance does the work.)

### Cost

From `subagent.completed.totalTokens`, counting only instantiations **beyond the first** per agent:

| bundle | duplicated tokens | of all subagent tokens |
|---|---|---|
| `20260903T000910Z` (dev, AS-EXPECTED 38·7·0) | 755,169 (spec-auditor ×2, reality-assessor ×2) | **24.1 %** of 3,137,720 |
| `20260831T024753Z` (dev) | 603,588 (spec-auditor ×2) | **19.2 %** of 3,141,583 |

That is roughly a fifth to a quarter of all subagent work performed twice or three times, on a run
whose session cost 36.99 AIU.

## Decision

1. **Correct the Parity-Map.** "Verification fan-out to 5 review agents" is **not** 🟡 for a
   skill-hop-instead-of-delegation reason — the delegation is direct and parallel. The tracked
   divergence is the **re-entry loop**, and it is a defect with a fix, not a platform limitation.
2. **Fix it in the generator (zero-touch).** `build.sh` step 8e inserts one guard sentence right
   after each `reviews-*` body's ACTION REQUIRED imperative: *if you are already that agent (invoked
   via `task` with this `agent_type`), do not delegate — perform the review directly*. The user-facing
   invocation path keeps working; the self-call stops at the agent. `make validate` WS5.18 fails the
   build if any of the five generated commands loses the guard. Version → `2.2.3+fork.3`
   (installer-facing change).
3. **Do not retire the ×5 allowlist yet.** The `invoked_skill(reviews-*)` tokens are still expected
   until a live run shows otherwise; retiring them now would be fitting the model to a hoped-for
   outcome.

## Honest limits of this finding

- **Not proven Copilot-only.** The obvious framing is "commands become model-invocable skills on
  Copilot, so this cannot happen on Claude". Not asserted here: a Claude Code session with this
  plugin loaded also lists `maister:reviews-*` in its Skill tool namespace, so the surface plausibly
  exists on both. What is *measured* is that the loop fires on Copilot and what it costs there; the
  Claude side is unmeasured (there is no Claude-side L2 harness).
- **The fix is unproven in the wild.** It is a prompt-level instruction to a model, so it will be
  believed only when a live development drive shows `spec-auditor` starting once. Expected signal on
  the next operator-approved sweep: re-entrant `subagent.started` count = 0, subagent tokens down
  ~20 %, conformance unchanged (AS-EXPECTED) and the #88 oracles still `=pass`. If it does not hold,
  the fallback is dropping the imperative from the generated bodies entirely.
- **The verdict is unaffected either way** — no predicate keys on re-entry, so this is a cost and
  fidelity defect, not a conformance one.

## Consequences

- First mechanism-level cost saving found by measurement rather than by adopting a third-party
  output-shaping trick — a direct input for [#110](https://github.com/robmar-net/maister/issues/110),
  whose harness now has an obvious first arm (`plain` vs `re-entry-guarded`) with a pre-registered
  expected effect.
- [#106](https://github.com/robmar-net/maister/issues/106) group A (the 7 skill-hop 🟡 rows) is
  answered by this ADR: their shared premise was the same wrong causal story.
- WP-C1 is closed as **fixed**, not as a documented why-not.
