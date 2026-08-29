# L2 Reference Derivation — `quick-bugfix`

Derivation record for `quick-bugfix.skeleton.json`: every reference entry traced to the workflow
model it is derived from. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `quick-bugfix` |
| Source (read-only citation source) | `plugins/maister/skills/quick-bugfix/SKILL.md` |
| maister_version | `2.2.3` |
| workflow_model_version | `5` |
| Sibling JSON hash | `817a43ee572b7ae910352d78d940b15dfd78d53dc1039513f859674a3ee401c5` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) |

Bare `:N` anchors cite the source SKILL.md above (read-only). Rows follow on-disk array order.
Partition sizes: 4 required + 2 optional + 0 rules + 0 allowlist = 6 rows. The skeleton is
deliberately minimal because the model is: ":9 — 'No orchestrator state, no task directory, no
subagents.'"

## Required (4)

| predicate | partition | citation | note |
|---|---|---|---|
| `invoked_skill(quick-bugfix)` | required | :2, :9 | Skill name `maister:quick-bugfix`; the workflow runs entirely inside this one skill — "No orchestrator state, no task directory, no subagents" (:9), so no phase/delegation/artifact predicates exist to require |
| `gate_fired(ask)` | required | :91, :122-124 | DIVERGENCE-TAGGED — see honesty note 1. The model's mandatory plan gate is EnterPlanMode (:91) with a blocking ExitPlanMode gate (:122-124); the required `ask` maps that gate to Copilot's plan-approval surface |
| `outcome(bug-fixed)=pass` | required | :171-173 | FUNCTIONAL ORACLE (issue #48, Stage 2). Step 7 verify is a terminal deliverable check — the fix must actually resolve the defect ("Provide completion summary" only after the bug is confirmed fixed); a correct run therefore produces a passing `bug-fixed` functional outcome |
| `reached_terminal(completion)` | required | :171-173 | Step 7: "Summary" — "Provide completion summary" is the workflow's terminal step |

## Optional (2)

| predicate | partition | citation | note |
|---|---|---|---|
| `gate_fired(permission)` | optional | platform divergence (no SKILL.md anchor) | Copilot permission prompts are a harness surface, not model-mandated; may or may not fire depending on session permission mode |
| `gate_fired(exit_plan_mode)` | optional | :91, :122-124 | Same plan-gate mapping as honesty note 1: whether Copilot's plan-approval surface emits a distinct exit event (in addition to the required `ask`) is platform-dependent, so it cannot be required |

## Rules (0)

`rules[] = []` — intentionally empty. quick-bugfix is a Step-numbered workflow (Steps 1–7) whose
only mandatory gate is the EnterPlanMode/ExitPlanMode plan gate (:91, :122-124), not a set of
phase-numbered exit gates. There are no `phase_completed(N)` predicates to key a gate-placement rule
on, so no `gate_fired_at(phase-N)` predicate is invented; the required un-phased `gate_fired(ask)`
(honesty note 1) remains the sole gate predicate. schema/wm are still bumped (1→2 / 2→3) in lockstep
with the sibling references (rules-in-hash Option A contributes zero tokens here).

## Allowlist (0)

No allowlist entries.

## Honesty notes

**Note 2 — quick-bugfix carries NO Stage-4 predicate (issue #48, Stage 4).** The order-spine /
count / state-schema predicates do not apply here: the workflow has no orchestrator state, no task
directory, and no subagents (`:9` — "No orchestrator state, no task directory, no subagents"). With
no `subagent.started` events there is no `precedes` chain and no `min_count` fan-out to model; with
no `stateYaml`, `findStateYaml` returns `null` and the extractor emits NO `state_schema` record at
all, so `state_schema(conformant)` would be an unsatisfiable required token (permanent REGRESSED) and
`state_schema(off-schema)` has no state surface to allowlist. The reference therefore stays
predicate-frozen; the ONLY Stage-4 change is the lockstep governance bump (`schema_version` 2→3,
`workflow_model_version` 3→4) with a `computeHash` re-stamp (CALIBRATION #18).

**Note 1 — required `gate_fired(ask)` is divergence-tagged (do not read it as a model-mandated
AskUserQuestion).** The SKILL.md's mandatory gate is a plan gate: "Use the `EnterPlanMode` tool to
present the fix plan for user approval" (:91), with a blocking ExitPlanMode section-completeness
gate (:122-124). Copilot has no plan-mode tool, so the required `ask` maps that plan gate to
Copilot's plan-approval surface — it is NOT derived from a model-mandated AskUserQuestion call.
The SKILL.md's actual AskUserQuestion uses (:43, :81, :150) are all conditional side-paths (no
bug context; ambiguous root cause; reproduction test unexpectedly passes) and therefore cannot
justify a required entry. This row is Stage 0's template case for "platform divergence →
documented justification": the citation names the diverging model anchor and the justification
states the mapping explicitly instead of pretending the model mandates `ask`.
`gate_fired(exit_plan_mode)` sits in optional for the same mapping reason.
