# L2 Reference Derivation — `research`

Derivation record for `research.skeleton.json`: every reference entry traced to the workflow
model it is derived from. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `research` |
| Source (read-only citation source) | `plugins/maister/skills/research/SKILL.md` |
| maister_version | `2.2.2` |
| workflow_model_version | `4` |
| Sibling JSON hash | `28c435405f39363597f752b1cc80d71602933df366d5cb842d06aaec0b5994b4` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) |

Bare `:N` anchors cite the source SKILL.md above; other sources carry an explicit path (all under
`plugins/maister/skills/`, read-only). Rows follow on-disk array order. Partition sizes: 13
required + 20 optional + 5 rules + 1 allowlist = 39 rows. Partition rationale (genesis `db26a46`,
[CALIBRATION-LOG.md](CALIBRATION-LOG.md) entry 2): the Phase-1 research foundation is required;
conditional brainstorming/design phases, their artifacts, and the root skill are optional.

## Required (13)

| predicate | partition | citation | note |
|---|---|---|---|
| `phase_completed(1)` | required | :102 | Phase Configuration table (:100-107): Phase 1 "Research foundation (init, plan, gather, synthesize)" — unconditional foundation |
| `delegated(research-planner)` | required | :153 | P1 Step 2: "Use Task tool with `subagent_type: maister:research-planner`" |
| `delegated(information-gatherer)` | required | :170-177 | P1 Step 3: launch all N gatherers in ONE message (parallel execution pattern); N adaptive but ≥1 always |
| `delegated(research-synthesizer)` | required | :184 | P1 Step 4: "Use Task tool with `subagent_type: maister:research-synthesizer`" |
| `created_artifact(analysis/synthesis.md)` | required | :181 | P1 Step 4 Artifacts: `analysis/synthesis.md` (also in phase Output list :128) |
| `created_artifact(outputs/research-report.md)` | required | :181 | P1 Step 4 Artifacts: `outputs/research-report.md` (also :128) |
| `gate_fired(ask)` | required | :198-200 | P1 exit: "MANDATORY GATE … Invoke `AskUserQuestion` now" (:198) — fires on every path |
| `outcome(report-produced)=pass` | required | :181, :128 | FUNCTIONAL ORACLE (issue #48, Stage 2). P1 Step 4 Artifacts (:181, phase Output :128) mandate `outputs/research-report.md`: a correct research run's terminal deliverable is a produced report, so the functional `report-produced` outcome is a passing deliverable check on that artifact |
| `task_status(completed)` | required | :107; orchestrator-framework/references/orchestrator-patterns.md:254 | Terminal phase "Completing research" (:107); shared state model defines `status: … completed` reached at finalization |
| `reached_terminal(completion)` | required | :377 | P6: "→ End of workflow" |
| `precedes(research-planner,information-gatherer)` | required | :153→:170 | ORDER (issue #48, Stage 4): the P1 research-planner delegation (:153) precedes the parallel information-gatherer fan-out (:170) — plan precedes gather |
| `precedes(information-gatherer,research-synthesizer)` | required | :170→:184 | The information-gatherer fan-out (:170) precedes the research-synthesizer delegation (:184) — gather precedes synthesize |
| `state_schema(conformant)` | required | :107, orchestrator-framework/references/orchestrator-patterns.md | STATE SCHEMA (issue #48, Stage 4): the research orchestrator-state serialization matches maister's documented schema (canonical `completed_phases` + top-level `task:` block). Research legitimately omits `task_characteristics` (no gap-analyzer), which the extractor treats as an ABSENCE (a `parseWarnings` entry, NOT a `schemaDivergences` entry), so a conformant research state is correctly `conformant`, not off-schema (C1 regression guard) |

## Optional (20)

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
| `gate_fired_at(phase-1)` | optional | :198 | Fireable phase-1 exit gate (see `## Rules`); optional row keeps an observed-but-unpromoted gate from classifying as an unmodeled extra |
| `gate_fired_at(phase-4)` | optional | :302 | Fireable phase-4 exit gate (brainstorming complete → high-level design) |
| `gate_fired_at(phase-5)` | optional | :351 | Fireable phase-5 exit gate (design complete → output generation) |

## Rules (5)

The `rules[]` array carries THREE kinds of relation, told apart by the `require`-token PREFIX (this
prefix keys the run.mjs floor via `WITNESS_REQUIRE_RE`, see L2-DESIGN): `gate_fired_at(` = a Stage-3
**gate-placement** rule (3, below); `delegated(` = a Stage-4 **witness** relation (1, P1); `min_count(`
= a Stage-4 **count** rule (1, below).

### Gate-placement rules (Stage 3, 3)

Each rule promotes its `require` predicate to *required* ONLY when
its `when` predicate (`phase_completed(N)`) is observed — a gate whose phase never completed cannot
false-alarm. Derived EXACTLY from the mandatory-gate exit markers in the source SKILL.md (research
has a MANDATORY-GATE exit on phases 1, 4, and 5), never fitted to a run. Every `require` row is also
modelled in `## Optional` above so an observed-but-unpromoted gate is not an unmodeled extra.

| when | require | citation |
|---|---|---|
| `phase_completed(1)` | `gate_fired_at(phase-1)` | :198 ("Research foundation complete … Continue to brainstorming evaluation?", :200) |
| `phase_completed(4)` | `gate_fired_at(phase-4)` | :302 ("Brainstorming complete. Continue to high-level design?", :304) |
| `phase_completed(5)` | `gate_fired_at(phase-5)` | :351 ("Design complete. Continue to output generation?", :353) |

### Witness relation + count rule (Stage 4, 2)

| when | require | kind | citation |
|---|---|---|---|
| `phase_completed(1)` | `delegated(research-planner)` | P1 witness | :153 (P1 Step 2: "Use Task tool with `subagent_type: maister:research-planner`") |
| `phase_completed(1)` | `min_count(delegated(information-gatherer))=2` | count rule ([OQ-1]) | :164-170 (P1 gather: default-4 / cap-8 parallel gatherer fan-out) — conditional on P1 completing; honesty note below |

## Allowlist (1)

| predicate | partition | citation | note |
|---|---|---|---|
| `state_schema(off-schema)` | allowlist | :100-107 (parser tolerance) | LIMITATION (issue #48, Stage 4) — the tolerant state parser accepts documented off-schema orchestrator-state serializations (bare-int `completed_phases`, `phase[-_]` tolerance, `phase_summaries` as phase source, `phases:` sequence with `id|number|phase` key, top-level `status:` without a `task:` block, floating `task_characteristics`); a research run whose state diverges is allowlisted, not REGRESSED |

## Honesty notes

**Note — research `min_count(delegated(information-gatherer))=2` is a CONDITIONAL count rule with a
disclosed false-REGRESS window ([OQ-1]).** The `=2` floor rests on the model's default-4 / cap-8
parallel-gatherer fan-out language (`research/SKILL.md:164-170`), but information-gatherer is dispatched
by the `source_category` param (`:176`), NOT a literal `subagent_type:`; the name surfaces in the
Execute / phase-config summary (`:102`, `:127`). Because there is no clean observable that means "≥2
sources were warranted", the rule is placed CONDITIONALLY (`when: phase_completed(1)`), not hard-required:
a legitimate single-source research run that completes P1 WOULD false-REGRESS. Mitigation: the committed
research fixture carries ≥2 gatherers (`test/fixtures/research/events.sample.json`, e5+e6) so the
reference validates AS-EXPECTED; the documented fallback is to demote the rule to `optional`. Disclosed,
not fitted to a run.
