# L2 Reference Derivation — `research`

Derivation record for `research.skeleton.json`: every reference entry traced to the workflow
model it is derived from. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `research` |
| Source (read-only citation source) | `plugins/maister/skills/research/SKILL.md` |
| maister_version | `2.2.2` |
| workflow_model_version | `1` |
| Sibling JSON hash | `12c51927084065a5c19dadd29c82a65438dfb029d7ceba0e484319dbed54c7f0` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) |

Bare `:N` anchors cite the source SKILL.md above; other sources carry an explicit path (all under
`plugins/maister/skills/`, read-only). Rows follow on-disk array order. Partition sizes: 9
required + 17 optional + 0 allowlist = 26 rows. Partition rationale (genesis `db26a46`,
[CALIBRATION-LOG.md](CALIBRATION-LOG.md) entry 2): the Phase-1 research foundation is required;
conditional brainstorming/design phases, their artifacts, and the root skill are optional.

## Required (9)

| predicate | partition | citation | note |
|---|---|---|---|
| `phase_completed(1)` | required | :102 | Phase Configuration table (:100-107): Phase 1 "Research foundation (init, plan, gather, synthesize)" — unconditional foundation |
| `delegated(research-planner)` | required | :153 | P1 Step 2: "Use Task tool with `subagent_type: maister:research-planner`" |
| `delegated(information-gatherer)` | required | :170-177 | P1 Step 3: launch all N gatherers in ONE message (parallel execution pattern); N adaptive but ≥1 always |
| `delegated(research-synthesizer)` | required | :184 | P1 Step 4: "Use Task tool with `subagent_type: maister:research-synthesizer`" |
| `created_artifact(analysis/synthesis.md)` | required | :181 | P1 Step 4 Artifacts: `analysis/synthesis.md` (also in phase Output list :128) |
| `created_artifact(outputs/research-report.md)` | required | :181 | P1 Step 4 Artifacts: `outputs/research-report.md` (also :128) |
| `gate_fired(ask)` | required | :198-200 | P1 exit: "MANDATORY GATE … Invoke `AskUserQuestion` now" (:198) — fires on every path |
| `task_status(completed)` | required | :107; orchestrator-framework/references/orchestrator-patterns.md:254 | Terminal phase "Completing research" (:107); shared state model defines `status: … completed` reached at finalization |
| `reached_terminal(completion)` | required | :377 | P6: "→ End of workflow" |

## Optional (17)

| predicate | partition | citation | note |
|---|---|---|---|
| `phase_completed(2)` | optional | :103, :233-235 | Beyond-foundation continuation; P2 routing (:233-235) decides whether 3/5/6 run — only the foundation is required by the model |
| `phase_completed(3)` | optional | :104, :246 | Skip-if `brainstorming_enabled = false` (user choice in P2, or `--no-brainstorm` flag) |
| `phase_completed(4)` | optional | :105, :274 | Skip-if `brainstorming_enabled = false` |
| `phase_completed(5)` | optional | :106, :317 | Skip-if `design_enabled = false` |
| `phase_completed(6)` | optional | :107 | Terminal summary phase; optional per genesis partition rationale (foundation-only runs may surface completion without a distinct P6 event) |
| `invoked_skill(research)` | optional | :2 | Skill name `maister:research`; entry-point-dependent — a run may arrive via `/maister:work` routing or as an embedded research phase instead of a direct root-skill invocation |
| `delegated(solution-brainstormer)` | optional | :252, :246 | P3 delegation; phase skippable (`brainstorming_enabled = false`) |
| `delegated(solution-designer)` | optional | :330, :317 | P5 delegation; phase skippable (`design_enabled = false`) |
| `delegated(explore)` | optional | platform divergence (no SKILL.md anchor) | The research model delegates only planner/gatherers/synthesizer/brainstormer/designer; Copilot's harness may additionally spawn its built-in `explore` agent during gathering — platform surface, not model-mandated |
| `created_artifact(planning/research-brief.md)` | optional | :135, :131 | P1 Step 1 artifact; intermediate planning artifact — resume paths (:131) may skip re-creating it |
| `created_artifact(planning/research-plan.md)` | optional | :148, :131 | P1 Step 2 artifact; intermediate, resume-skippable |
| `created_artifact(planning/sources.md)` | optional | :148, :131 | P1 Step 2 artifact; intermediate, resume-skippable |
| `created_artifact(outputs/solution-exploration.md)` | optional | :243, :246 | P3 Output; phase skippable |
| `created_artifact(outputs/high-level-design.md)` | optional | :314, :317 | P5 Output; phase skippable |
| `created_artifact(outputs/decision-log.md)` | optional | :314, :317 | P5 Output; phase skippable |
| `gate_fired(permission)` | optional | platform divergence (no SKILL.md anchor) | Copilot permission prompts are a harness surface, not model-mandated |
| `gate_fired(exit_plan_mode)` | optional | platform divergence (no SKILL.md anchor) | The research model gates via AskUserQuestion, not plan mode; Copilot's plan-approval surface may additionally emit this event |

## Allowlist (0)

No allowlist entries.
