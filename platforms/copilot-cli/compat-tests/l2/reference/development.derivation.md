# L2 Reference Derivation — `development`

Derivation record for `development.skeleton.json`: every reference entry traced to the workflow
model it is derived from. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `development` |
| Source (read-only citation source) | `plugins/maister/skills/development/SKILL.md` |
| maister_version | `2.2.2` |
| workflow_model_version | `3` |
| Sibling JSON hash | `ea0a59515602f4811b1d6271435559a23663fbd5502af64e5a2119c0e0e2d37e` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) |

Bare `:N` anchors cite the source SKILL.md above; other sources carry an explicit path (all under
`plugins/maister/skills/`, read-only). Rows follow on-disk array order. Partition sizes: 26
required + 33 optional + 12 rules + 5 allowlist = 76 rows.

## Required (26)

| predicate | partition | citation | note |
|---|---|---|---|
| `phase_completed(1)` | required | :109 | Phase Configuration table (:107-122): Activation "Always" |
| `phase_completed(2)` | required | :110 | Activation "Always" |
| `phase_completed(5)` | required | :113 | Activation "Always" |
| `phase_completed(7)` | required | :115 | Activation "Always" |
| `phase_completed(8)` | required | :116 | Activation "Always" |
| `phase_completed(10)` | required | :118 | Activation "Always" |
| `phase_completed(11)` | required | :119 | Activation "Always" |
| `phase_completed(14)` | required | :122 | Activation "Always" |
| `delegated(gap-analyzer)` | required | :147 | P2: "Task tool - `maister:gap-analyzer` subagent" |
| `delegated(specification-creator)` | required | :285 | P5: "Task tool - `maister:specification-creator` subagent" |
| `delegated(implementation-planner)` | required | :332 | P7: "Task tool - `maister:implementation-planner` subagent" |
| `delegated(task-group-implementer)` | required | implementation-plan-executor/SKILL.md:96 | Sub-delegation of the P8 skill (:358): every task group runs via `maister:task-group-implementer` |
| `invoked_skill(codebase-analyzer)` | required | :132 | P1: "Skill tool - `maister:codebase-analyzer`" |
| `invoked_skill(implementation-verifier)` | required | :446 | P11 Step 1: "Invoke Skill tool - `maister:implementation-verifier`" |
| `invoked_skill(implementation-plan-executor)` | required | :358 | P8: "Skill tool - `maister:implementation-plan-executor`" |
| `created_artifact(implementation/spec.md)` | required | :291 | P5 Output list includes `implementation/spec.md` |
| `created_artifact(implementation/implementation-plan.md)` | required | :333 | P7 Output: `implementation/implementation-plan.md` |
| `created_artifact(implementation/work-log.md)` | required | :359 | P8 Output: implemented code + `implementation/work-log.md` |
| `created_artifact(verification/*)` | required | :441 | P11 Output: `verification/implementation-verification.md` + optional review reports |
| `task_characteristic(has_reproducible_defect)=false` | required | :149, :202 | Characteristic set by gap-analyzer (:149); Stage 0's pinned task input has no reproducible defect, so the value is scenario-fixed and P3 skip-if (:202) applies |
| `task_characteristic(ui_heavy)=false` | required | :149, :221-222 | Scenario-fixed by the pinned task input; P4 skip-if (:221-222) applies |
| `task_characteristic(involves_data_operations)=false` | required | :149 | One of the 5 gap-analyzer characteristics (:149, default :583); scenario-fixed by the pinned task input (no data operations) |
| `gate_fired(ask)` | required | :176-180 | P2 exit gate always invokes AskUserQuestion — "There is no path through Phase 2 that bypasses `AskUserQuestion`" (:180) |
| `outcome(tests-pass)=pass` | required | :441, :359 | FUNCTIONAL ORACLE (issue #48, Stage 2). P11 verification (:441) produces `verification/implementation-verification.md` — a correct run's implemented code (P8, :359) passes its test suite, so the functional `tests-pass` outcome is a passing deliverable check, not merely a modeled delegation |
| `task_status(completed)` | required | :545 | P14 State: "Set `task.status: completed`" |
| `reached_terminal(completion)` | required | :553 | P14: "→ End of workflow" |

## Optional (33)

| predicate | partition | citation | note |
|---|---|---|---|
| `phase_completed(6)` | optional | :114, :309 | Activation "Always (conditional)" (:114); "Recommended: Always … User can skip" (:309, gate :311) |
| `delegated(spec-auditor)` | optional | :305 | P6 delegation; skippable per :309 |
| `delegated(implementation-completeness-checker)` | optional | implementation-verifier/SKILL.md:120 | Sub-delegation inside the verifier; surfacing depends on the P10 verification-scope selection (:425) and platform (see allowlist note) |
| `delegated(test-suite-runner)` | optional | implementation-verifier/SKILL.md:107 | Skipped entirely when `skip_test_suite: true` (implementation-verifier/SKILL.md:113) |
| `delegated(code-reviewer)` | optional | implementation-verifier/SKILL.md:125 | Gated on `code_review_enabled` (user-selected at P10 Q1 :425) |
| `delegated(code-quality-pragmatist)` | optional | implementation-verifier/SKILL.md:130 | Gated on `pragmatic_review_enabled` |
| `delegated(reality-assessor)` | optional | implementation-verifier/SKILL.md:140 | Gated on `reality_check_enabled` |
| `delegated(production-readiness-checker)` | optional | implementation-verifier/SKILL.md:135 | Gated on `production_check_enabled` |
| `invoked_skill(development)` | optional | :2 | Skill name `maister:development`; entry-point-dependent — a run may arrive via `/maister:work` routing instead of a direct root-skill invocation |
| `task_characteristic(creates_new_entities)=true` | optional | :149 | Both-optional pair — see honesty note 2 (tautology guard) |
| `task_characteristic(creates_new_entities)=false` | optional | :149 | Both-optional pair — see honesty note 2 (tautology guard) |
| `task_characteristic(modifies_existing_code)=true` | optional | :149 | Both-optional pair — see honesty note 2 (tautology guard) |
| `task_characteristic(modifies_existing_code)=false` | optional | :149 | Both-optional pair — see honesty note 2 (tautology guard) |
| `gate_fired(permission)` | optional | platform divergence (no SKILL.md anchor) | Copilot permission prompts are a harness surface, not model-mandated; may or may not fire depending on session permission mode |
| `gate_fired(exit_plan_mode)` | optional | platform divergence (no SKILL.md anchor) | The development model gates via AskUserQuestion, not plan mode; Copilot's plan-approval surface may additionally emit this event |
| `phase_completed(12)` | optional | :120, :508 | Activation "When `e2e_enabled`" (:120); skip-if `options.e2e_enabled = false` (:508) |
| `phase_completed(13)` | optional | :121, :530 | Activation "When `user_docs_enabled`" (:121); skip-if `options.user_docs_enabled = false` (:530) |
| `delegated(explore)` | optional | codebase-analyzer/SKILL.md:97 | Sub-delegation of the P1 skill: `subagent_type="Explore"`, adaptive role count — presence and multiplicity vary |
| `delegated(codebase-analysis-reporter)` | optional | codebase-analyzer/SKILL.md:110 | Sub-delegation of the P1 skill; report synthesis step |
| `delegated(user-docs-generator)` | optional | :525, :530 | P13 delegation; phase conditional on `user_docs_enabled` |
| `delegated(e2e-test-verifier)` | optional | :503, :508 | P12 delegation; phase conditional on `e2e_enabled` |
| `gate_fired_at(phase-2)` | optional | :174 | Fireable phase-2 exit gate (see `## Rules`); optional row keeps an observed-but-unpromoted gate from classifying as an unmodeled extra |
| `gate_fired_at(phase-3)` | optional | :206 | Fireable phase-3 exit gate (TDD red gate) |
| `gate_fired_at(phase-4)` | optional | :237 | Fireable phase-4 exit gate (UI mockups) |
| `gate_fired_at(phase-5)` | optional | :294 | Fireable phase-5 exit gate (specification audit) |
| `gate_fired_at(phase-6)` | optional | :313 | Fireable phase-6 exit gate (implementation planning) |
| `gate_fired_at(phase-7)` | optional | :340 | Fireable phase-7 exit gate (implementation) |
| `gate_fired_at(phase-8)` | optional | :370 | Fireable phase-8 exit gate (verification) |
| `gate_fired_at(phase-9)` | optional | :389 | Fireable phase-9 exit gate (TDD gate passed) |
| `gate_fired_at(phase-10)` | optional | :432 | Fireable phase-10 exit gate (standard verifications / E2E / user docs decisions) |
| `gate_fired_at(phase-11)` | optional | :490 | Fireable phase-11 exit gate (Continue to Phase 12) |
| `gate_fired_at(phase-12)` | optional | :510 | Fireable phase-12 exit gate (E2E complete) |
| `gate_fired_at(phase-13)` | optional | :532 | Fireable phase-13 exit gate (Documentation complete) |

## Rules (12)

Gate-placement rules (Stage 3). Each rule promotes its `require` predicate to *required* ONLY when
its `when` predicate (`phase_completed(N)`) is observed — a gate whose phase never completed cannot
false-alarm. Derived EXACTLY from the mandatory-gate exit markers in the source SKILL.md (phases 2–13;
phases 1 & 14 have no exit gate), never fitted to a run. Every `require` row is also modelled in
`## Optional` above so an observed-but-unpromoted gate is not an unmodeled extra.

| when | require | citation |
|---|---|---|
| `phase_completed(2)` | `gate_fired_at(phase-2)` | :174 ("Continue to Phase 3/4/5: `<title>`?", :186-189) |
| `phase_completed(3)` | `gate_fired_at(phase-3)` | :206 ("TDD red gate complete. Continue to Phase 4?", :208) |
| `phase_completed(4)` | `gate_fired_at(phase-4)` | :237 ("UI mockups complete … Continue to Phase 5?", :239) |
| `phase_completed(5)` | `gate_fired_at(phase-5)` | :294 ("… Continue to specification audit?", :296) |
| `phase_completed(6)` | `gate_fired_at(phase-6)` | :313 ("… Continue to implementation planning?", :315) |
| `phase_completed(7)` | `gate_fired_at(phase-7)` | :340 ("… Continue to implementation?", :342) |
| `phase_completed(8)` | `gate_fired_at(phase-8)` | :370 ("… Continue to verification?", :372) |
| `phase_completed(9)` | `gate_fired_at(phase-9)` | :389 ("TDD gate passed. Continue to Phase 10?", :391) |
| `phase_completed(10)` | `gate_fired_at(phase-10)` | :432 ("Which standard verifications to run?" / "Enable E2E…" / "Generate user documentation?", :425-430) |
| `phase_completed(11)` | `gate_fired_at(phase-11)` | :490 ("… Continue to Phase 12?", :492) |
| `phase_completed(12)` | `gate_fired_at(phase-12)` | :510 ("E2E complete. Continue to Phase 13?", :512) |
| `phase_completed(13)` | `gate_fired_at(phase-13)` | :532 ("Documentation complete. Continue to Phase 14?", :534) |

## Allowlist (5)

| predicate | partition | citation | note |
|---|---|---|---|
| `invoked_skill(reviews-code)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `invoked_skill(reviews-pragmatic)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `invoked_skill(reviews-spec-audit)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `invoked_skill(reviews-reality-check)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `invoked_skill(reviews-production-readiness)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |

## Honesty notes

**Note 2 — input-dependent characteristic pairs (tautology guard).**
`task_characteristic(creates_new_entities)=true` AND `=false` both sit in optional — likewise the
`modifies_existing_code` pair. This is deliberate, not an oversight: these characteristics are
legitimately input-dependent (the task input, not the workflow model, determines their values), so
the reference must accept either value. Making one value required would make the check a tautology
against a specific run rather than a conformance check against the model (tautology guard,
genesis `6938a8f` — see [CALIBRATION-LOG.md](CALIBRATION-LOG.md) entry 1). The three
characteristics pinned as required `=false` above are fixed by Stage 0's pinned scenario input,
which is why they are not both-optional pairs.

**Note 3 — the 5 allowlist `reviews-*` entries.**
Citation: `implementation-verifier/SKILL.md:108-142`. On Claude, the implementation-verifier
delegates review work to Task subagents (`code-reviewer`, `code-quality-pragmatist`,
`production-readiness-checker`, `reality-assessor` — the already-optional
`delegated(code-reviewer)` etc. rows above model exactly these). On Copilot, the same review work
can surface as direct invocations of the `reviews-*` skills instead. The entries are allowlisted
as LIMITATION (platform divergence in how the same modeled work surfaces), not added to the model.
