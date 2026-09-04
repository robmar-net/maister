# ADR 0008 — Copilot overrides the model pin **per subagent**: measure the mix and refuse a mismatched comparison, never enumerate a catalog

- **Status:** Accepted — 2026-09-05
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#129](https://github.com/robmar-net/maister/issues/129) (this change), [#110](https://github.com/robmar-net/maister/issues/110) (cost research), [#123](https://github.com/robmar-net/maister/issues/123) (the tier-2/tier-3 sweeps that measured it)
- **Related:** [ADR 0002](0002-copilot-agent-model-mapping.md) (per-agent `model:` mapping — the lever this ADR finds insufficient), [ADR 0007](0007-l2-hygiene-default-and-bundle-provenance.md) (bundle-first cost, `KNOWN_RATES` already demoted to a cross-check), [#123](https://github.com/robmar-net/maister/issues/123), [#130](https://github.com/robmar-net/maister/issues/130) (`research-synthesizer` on `claude-sonnet-5` = 80 % of a research drive — the quality-versus-price call this ADR deliberately does not make), [#131](https://github.com/robmar-net/maister/issues/131) (`gate_fired_at(phase-5)` flapping — the other finding of the same sweeps), `docs/copilot-parity-runbook.md` § "A/B arms"

## Context

#110 compares cost arms (`plain`, `lean`, `caveman`, …) on the L2 harness. Every arm is driven with
`COMPAT_L2_MODEL=gpt-5.6-luna`, which becomes `sessionOptions.model` on `createSession` and is persisted
in the bundle. Every agent in `plugins/maister-copilot/agents/` carries `model: inherit` (sole explicit
pin: `claude-haiku-4.5` on `project-analyzer`, ADR 0002). The reasonable expectation was therefore that a
drive is served entirely by the pinned model, and that an AIU delta between two arms is the arms' doing.

The #123 sweeps falsified that. The pin covers the **main session only**. Copilot re-decides the model
**per delegation**, at `subagent.configured` time, and that decision can land on a model an order of
magnitude more expensive than the pin — enough that one subagent outweighs every token-slimming lever
under test. Any arm-to-arm AIU comparison made without checking the served-model set is therefore not a
weak comparison; it is an invalid one.

## What the bundles actually show

**The mechanism, from one drive's own events** (`reports/20260904T212138Z`, scenario `development`, arm
`plain`, `sessionOptions.model = gpt-5.6-luna`). Twenty-three `subagent.configured` events; twenty-two
name `gpt-5.6-luna` or `gpt-5.4-mini`, and exactly one names something else:

```
subagent.configured  maister-copilot:test-suite-runner
  {"model":"claude-sonnet-5","reasoningEffort":"high","multiTurn":false}
```

The matching `subagent.started` reports `model=gpt-5.6-luna` — **the two events disagree**, and the nine
`assistant.usage` events joined to that `agentId` were all served by `claude-sonnet-5`. `isAuto` is
`false` on every usage event in the bundle, so this is not an "auto model" feature reporting itself. The
session was pinned; the agent said `model: inherit`; the runtime chose anyway.

**The price of one such delegation** (all figures re-derived from the bundles' own
`tokenDetails[].costPerBatch / batchSize`, never from a table):

| drive | scenario | agent served `claude-sonnet-5` | usage events | its AIU | drive total | off-pin share |
|---|---|---|---|---|---|---|
| `20260904T205106Z` | research | `maister-copilot:research-synthesizer` | 12 | 82.31615 | 105.006005 | 78 % |
| `20260904T212138Z` | development (`plain`) | `maister-copilot:test-suite-runner` | 9 | 23.59004 | 66.417379 | 36 % |
| `20260904T213801Z` | development (`lean`) | none | — | — | 37.95 | — |
| `20260904T214857Z` | development (`plain`) | none | — | — | 47.476803 | — |

Observed `claude-sonnet-5` rate: **200 / 20 / 250 / 1000** AIU per 1 M tokens (input / cache_read /
cache_write / output) — ten times `gpt-5.6-luna`'s 20 / 2 / 25 / 120. The apparent 43 % gap between
`plain` (66.4) and `lean` (38.0) on `development` is almost entirely this one delegation, not the arm.

**Two further consequences already visible in the evidence directory.** The #110 tier estimates
(research 13.5, development 37) were wrong for the same reason — actual 105 and 47–66. And
`cost-report` rendered `unknown-model` for `claude-sonnet-5`, i.e. the report presented a *missing row in
an informational drift table* with the vocabulary of a defect.

## Decision

1. **Measure the mix, in the report, from the bundle alone.** `cost-report.mjs` gains a `modelMix`
   section (markdown `## Model mix`, and in `--json`): the `pin`
   (`meta.sessionOptions.model` ?? `meta.model` — nothing else, no default), the per-model split
   (`calls` / `aiu` / `tokens`), and `offPin` = everything whose `assistant.usage.data.model !== pin`
   with its `models`, `calls`, `aiu`, `share` of the drive total, and `byAgent` — the joined agent name,
   the model it was served, and **the `subagent.configured` model**, which is the evidence line for the
   mechanism above. The verdict is `on-pin` / `off-pin`.
2. **`ab-compare` refuses a mismatch rather than printing a misleading table.** Bundles that are
   `comparable: yes` and whose served-model sets differ are refused —
   `served-model mismatch: <set> vs <majority set>`, exit 2 — unless `--allow-model-mix` is passed, which
   lists them as `no (model mix)` under a visible `WARNING:` line. A new `models` column makes the set
   visible on every row.
3. **No hardcoded model catalog, anywhere.** Every model id in both tools comes from the bundle's own
   events; every price comes from that event's own `tokenDetails`. The provider's model list rotates
   faster than this repository can track it, and a tool that carries a list quietly turns "a model we
   have not seen" into "a model that is wrong".
   - `KNOWN_RATES` is therefore **demoted in wording to what it always was in behaviour**: a rate-drift
     detector. A model absent from it renders `no cross-check row` (an absence of evidence), never
     `unknown-model`. A model present at a *different* observed rate renders a drift **warning** naming
     the model, the table value and the observed value. Neither ever enters a total.
   - The `models` column shortens ids to their last dash-separated segment **only** when that is
     unambiguous across the whole table and is actually a name (`gpt-5.6-luna` → `luna`; the `5` of
     `claude-sonnet-5` is a version number, so that table prints full ids). No nickname map.
4. **Null stays null.** With no pin recorded, every `offPin` field is `null` (unknown), never 0, and the
   verdict is `null` — as is the case with a pin but no usage event. `offPin.aiu` is a real `0` only when
   usage was observed and none of it was off-pin. This is ADR 0007 / spec R7's discipline, unchanged.
5. **Pinning agents to concrete model ids is OUT OF SCOPE and stays out.** The question "should
   `research-synthesizer` be allowed to spend 82 of a drive's 105 AIU?" is tracked separately in
   [#130](https://github.com/robmar-net/maister/issues/130). Three reasons, in order of weight:
   - **Catalog rot.** A concrete `model: claude-sonnet-5` line is a bet on a model id that the provider
     rotates on its own schedule. Twenty-five agent files carrying such a bet is twenty-five files that
     silently degrade — the exact failure this ADR refuses to build into the tools.
   - **Generated-plugin surface.** `plugins/maister-copilot/**` is generated by `build.sh` from
     `plugins/maister/**`; a model pin would have to be a build transform (ADR 0002's territory), be kept
     in sync across both trees and every upstream merge, and would become installer-visible.
   - **It is a product call, not a measurement call.** Choosing which agent may spend ten times more is a
     quality-versus-price decision about the product, and it needs the measurement in this ADR first —
     what the runtime picks, how often, and what it buys. Measuring is a precondition for deciding; doing
     both in one change would let the decision be made by accident.
6. **The runbook states the rule once.** § "A/B arms": check the model mix before comparing arms;
   `ab-compare` refuses a mismatch; `cost-report`'s `## Model mix` shows the off-pin AIU.

No file under `plugins/**`, `platforms/copilot-cli/build.sh` or `hooks-overrides/**` changed; `make build`
is byte-identical and the fork version does not move (harness and docs only).

## Honest limits

1. **We cannot prove *why* the runtime picks a stronger model.** No event says so. The only correlates in
   hand are the two flags on that one `subagent.configured` payload —
   `reasoningEffort: high` and `multiTurn: false` — where the other twenty-two carry `multiTurn: true`
   and (mostly) no `reasoningEffort`. That is a correlation on **n = 2** observed delegations across 16
   drives, not a mechanism. Do not present it as one; do not tune anything to it.
2. **n is small and one-sided.** Two off-pin delegations, both `claude-sonnet-5`, both on 2026-09-04,
   both on Copilot CLI 1.0.82. Whether the choice is deterministic, load-dependent, prompt-dependent or
   account-dependent is unknown. A future drive could see a different model, or none.
3. **The guard is a comparability check, not a cost control.** It stops an invalid comparison from being
   printed; it does not stop the spend. A sweep can still burn 82 AIU on one subagent — it will simply be
   visible and refused as a comparison row afterwards.
4. **`offPin` is literal: it is every model that is not the pin**, including `gpt-5.4-mini` on the
   built-in `explore` agent, which is the platform's ordinary behaviour rather than the surprise this ADR
   is about. Separating "expected non-pin model" from "surprise" would require exactly the hardcoded
   catalog Decision 3 forbids, so the report keeps the literal rule and the `byAgent` table shows which
   is which. Consequence: nearly every `development` drive reads `off-pin` (mini via `explore`); read the
   per-agent rows, not only the verdict.
5. **`servedModels` in meta v2 is not the guard's input.** `ab-compare` derives the set from the events
   (`assistant.usage.data.model`) so a bundle whose meta was written by an older harness, or whose
   `servedModels.main` is `null` (as on all three 2026-09-04 drives above), is still guarded correctly.
6. **A same-set comparison is not thereby a valid one.** Matching served-model sets remove *this*
   confounder only; the per-model call counts can still differ, and ADR 0007's caveats about
   pre-hygiene bundles and legacy arms all still apply.

## Consequences

- A sweep now has a mechanical precondition: `ab-compare <bundles…>` must exit 0 before any AIU delta is
  quoted. A mismatch is a refusal with a named reason, not a footnote.
- The #110 tier estimates and every AIU figure quoted from the 2026-09-04 research and `plain`
  development drives are marked *model-mixed* — they measure the runtime's model lottery as much as the
  arm, and are not comparable to a same-set drive.
- `cost-report` no longer reads as broken when the provider ships a model we have not priced before; it
  reads as "no cross-check row", and it says loudly when a rate we *did* record has moved.
- Whether any lever can pin subagent models at all — session option, `model:` frontmatter (ADR 0002), or
  nothing — and whether we would want to use it, remain open in
  [#130](https://github.com/robmar-net/maister/issues/130); this ADR deliberately answers only "can we
  still compare arms honestly?" (yes — by refusing when we cannot).
