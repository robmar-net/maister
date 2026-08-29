# L2 Reference Derivation — `destructive-guard`

Derivation record for `destructive-guard.skeleton.json`: every reference entry traced to the
contract it is derived from. Unlike the workflow-scenario references (development / research /
quick-bugfix), the SOURCE here is NOT a `SKILL.md` — it is the Copilot destructive-command guard
hook plus the L1 live-survival finding. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `destructive-guard` |
| Source (read-only citation source) | `platforms/copilot-cli/hooks-overrides/block-destructive-commands.sh` (`:54` regex, `:59-60` `permissionDecision:"ask"` + reason) + [`../../L1-FINDINGS.md`](../../L1-FINDINGS.md) (§1 `block-destructive-commands.sh` — Copilot honors `ask`, fail-closed, L1a.ii) |
| maister_version | `2.2.3` |
| workflow_model_version | `5` |
| Sibling JSON hash | `b0b145b0cf56801e6eeb7cdfa59de19136a688857f15637c72e902ce177dda50` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) (genesis entry #22) |

Bare `:N` anchors cite the guard hook `block-destructive-commands.sh` above (read-only, zero-touch —
EXERCISED, never modified). Rows follow on-disk array order. Partition sizes: 2 required + 2 optional
+ 0 rules + 0 allowlist = 4 rows. The skeleton is deliberately minimal: this is a bare
destructive-command micro-scenario (`taskType: quick-bugfix`'s events-only TREE_PROFILE — no task
directory, no subagents, no artifacts), so the only modeled surface is the guard firing and the run
reaching its terminal.

## Required (2)

| predicate | partition | citation | note |
|---|---|---|---|
| `hook_effect(destructive_guard=ask)` | required | `block-destructive-commands.sh:54`, `:59-60` | The guard matches the destructive-command regex (`:54`) and emits `hookSpecificOutput.permissionDecision:"ask"` with the `Maister guard: destructive command …` reason (`:59-60`). A custom `onPermissionRequest` responder OBSERVES that decision and records it to the per-run `hookDecisions` sink; the extractor emits the token from the sink entry (Option B). Token shape is INSIDE-parens (`hook_effect(destructive_guard=ask)`), byte-identical to `normalize.mjs` `buildToken`. See honesty notes (a)/(b) |
| `reached_terminal(completion)` | required | scenario contract | The micro-scenario drives a single destructive-cleanup prompt to completion; a correct run reaches its terminal after the guard is observed. The only non-guard required predicate |

## Optional (2)

| predicate | partition | citation | note |
|---|---|---|---|
| `gate_fired(permission)` | optional | platform surface (extractor `:407-409`) | The destructive command triggers the Copilot permission prompt, so `gate_fired(permission)` fires additively alongside the observed `hook_effect`; it is a harness surface, not model-mandated, so it stays optional |
| `gate_fired(ask)` | optional | platform surface | A confirmation surface on the destructive command may render as an `ask` gate; platform-dependent, so optional |

`gate_fired(exit_plan_mode)` is deliberately NOT modeled (there is no plan mode in a bare
destructive-cleanup run). `invoked_skill(...)` is deliberately NOT modeled — see honesty note (c).

## Rules (0)

`rules[] = []` — intentionally empty. The micro-scenario has no phase-numbered exit gates, no
orchestrator state, and no subagent fan-out (events-only `quick-bugfix` TREE_PROFILE), so there are
no `phase_completed(N)` predicates to key a gate-placement or witness rule on. Under `computeHash`
Option A the empty `rules[]` contributes zero tokens.

## Allowlist (0)

No allowlist entries.

## Honesty notes

**(a) NO `outcome(...)=pass` in required — guard-firing is the predicate, a model-driven required
set.** This scenario has no functional deliverable oracle (no bug fixed, no report produced, no
tests to pass) — its `outcome:[]`. The required set models the guard-observation predicate
(`hook_effect(destructive_guard=ask)`) plus terminal, NOT a functional outcome. The required set is
derived from the deterministic hook contract, never fitted to a run (L2 = workflow-model
conformance, MEMORY decision 2026-08-28).

**(b) `=ask` provenance — contract-derived, direct live confirmation DEFERRED PAID.** At L2
credit-free, the `=ask` value is modelled from the guard's deterministic contract: the hook emits
`permissionDecision:"ask"` (`:59-60`) unconditionally on a regex match (`:54`), and L1-FINDINGS §1
confirms Copilot honors that `ask` and holds it fail-closed live (L1a.ii). The responder observes
the decision defensively (nullish-coalesced reads of `req.permissionDecision` /
`hookSpecificOutput.permissionDecision`, the `Maister guard: destructive command` reason marker, and
the exact command-regex as fallback), so `=ask` is witnessed/contract-derived, never fitted to a
recorded run. A live guard-fire confirmation of the exact `PermissionRequest` shape handed to the
responder is the one genuine unknown and is a DEFERRED PAID follow-up; the documented fallback
(command-regex → contract-derived `=ask`) already covers the emit if the live `req` lacks the
decision field.

**(c) `invoked_skill(...)` deliberately unmodeled.** A bare destructive-cleanup prompt need not
route through a named skill; if an `invoked_skill(...)` predicate appears on a live run it is a
benign extra (not required, not an unmodeled-extra failure). Modeling it would fit the reference to
an incidental routing choice rather than the guard contract.
