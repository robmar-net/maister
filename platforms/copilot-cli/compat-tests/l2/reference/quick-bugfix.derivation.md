# L2 Reference Derivation — `quick-bugfix`

Derivation record for `quick-bugfix.skeleton.json`: every reference entry traced to the workflow
model it is derived from. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `quick-bugfix` |
| Source (read-only citation source) | `plugins/maister/skills/quick-bugfix/SKILL.md` |
| maister_version | `2.2.3` |
| workflow_model_version | `1` |
| Sibling JSON hash | `9855340d04a2efb2bdef6541c736641aa16a9e35b6a1031184e2e95f2f24ff36` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) |

Bare `:N` anchors cite the source SKILL.md above (read-only). Rows follow on-disk array order.
Partition sizes: 3 required + 2 optional + 0 allowlist = 5 rows. The skeleton is deliberately
minimal because the model is: ":9 — 'No orchestrator state, no task directory, no subagents.'"

## Required (3)

| predicate | partition | citation | note |
|---|---|---|---|
| `invoked_skill(quick-bugfix)` | required | :2, :9 | Skill name `maister:quick-bugfix`; the workflow runs entirely inside this one skill — "No orchestrator state, no task directory, no subagents" (:9), so no phase/delegation/artifact predicates exist to require |
| `gate_fired(ask)` | required | :91, :122-124 | DIVERGENCE-TAGGED — see honesty note 1. The model's mandatory plan gate is EnterPlanMode (:91) with a blocking ExitPlanMode gate (:122-124); the required `ask` maps that gate to Copilot's plan-approval surface |
| `reached_terminal(completion)` | required | :171-173 | Step 7: "Summary" — "Provide completion summary" is the workflow's terminal step |

## Optional (2)

| predicate | partition | citation | note |
|---|---|---|---|
| `gate_fired(permission)` | optional | platform divergence (no SKILL.md anchor) | Copilot permission prompts are a harness surface, not model-mandated; may or may not fire depending on session permission mode |
| `gate_fired(exit_plan_mode)` | optional | :91, :122-124 | Same plan-gate mapping as honesty note 1: whether Copilot's plan-approval surface emits a distinct exit event (in addition to the required `ask`) is platform-dependent, so it cannot be required |

## Allowlist (0)

No allowlist entries.

## Honesty notes

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
