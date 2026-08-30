# L2 Reference Derivation — `development`

Derivation record for `development.skeleton.json`: every reference entry traced to the workflow
model it is derived from. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `development` |
| Source (read-only citation source) | `plugins/maister/skills/development/SKILL.md` |
| maister_version | `2.2.2` |
| workflow_model_version | `5` |
| Sibling JSON hash | `77b935c141d259b366b73c29126ae0584b34738529125e3591742a2b597f8907` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) |

Bare `:N` anchors cite the source SKILL.md above; other sources carry an explicit path (all under
`plugins/maister/skills/`, read-only). Rows follow on-disk array order. Partition sizes: 32
required + 33 optional + 21 rules + 6 allowlist = 92 rows.

## Required (32)

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
| `precedes(gap-analyzer,specification-creator)` | required | :147→:285 | ORDER (issue #48, Stage 4): the P2 gap-analyzer delegation (:147) fans out before the P5 specification-creator delegation (:285) — analyse precedes spec |
| `precedes(specification-creator,implementation-planner)` | required | :285→:332 | P5 specification-creator (:285) precedes P7 implementation-planner (:332) — spec precedes plan |
| `precedes(implementation-planner,task-group-implementer)` | required | :332→implementation-plan-executor/SKILL.md:96 | P7 implementation-planner (:332) precedes the P8 executor's per-group task-group-implementer fan-out (implementation-plan-executor/SKILL.md:96) — plan precedes implement |
| `precedes(task-group-implementer,implementation-verifier)` | required | implementation-plan-executor/SKILL.md:96→:446 | The P8 task-group-implementer fan-out (implementation-plan-executor/SKILL.md:96) precedes the P11 implementation-verifier invocation (:446) — implement precedes verify |
| `min_count(delegated(task-group-implementer))=1` | required | implementation-plan-executor/SKILL.md:87-99 | COUNT (issue #48, Stage 4): the plan executor delegates ONE task-group-implementer per task group (implementation-plan-executor/SKILL.md:87-99), so a correct dev run fans out ≥1 — token-expansion `=1..c`, reference asserts the floor `=1` |
| `state_schema(conformant)` | optional | :107-122, orchestrator-framework/references/orchestrator-patterns.md | STATE SCHEMA (issue #48, Stage 4; **demoted required→optional in [#57](https://github.com/robmar-net/maister/issues/57)**): a conformant serialization matches maister's documented schema (canonical `completed_phases` + top-level `task:` block). **It is NOT hard-required** because the runtime routing/resume readers (`development/SKILL.md:247`, `orchestrator-patterns.md:358-360`) are model-interpreted and *semantic* — a bare-int `completed_phases` or a top-level `status:` is read for the same meaning — so an off-schema serialization is behavior-preserving, not a functional regression. The divergence stays visible via the `state_schema(off-schema)` allowlist LIMITATION (🟢 ADAPTED); lexical parity would need a deterministic post-write normalizer hook (tracked in #57). Keyed on the dedicated `schemaDivergences` signal (NOT `parseWarnings`), so legitimate absences do not mark off-schema. Model-grounded demotion (readers are semantic), NOT fitted to a run |

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

## Rules (21)

The `rules[]` array carries TWO kinds of relation, told apart by the `require`-token PREFIX (this
prefix keys the run.mjs floor via `WITNESS_REQUIRE_RE`, see L2-DESIGN): `gate_fired_at(` = a Stage-3
**gate-placement** rule (12, below); `delegated(` / `created_artifact(` / `invoked_skill(` = a
Stage-4 **witness** relation (9, below). A witness relation records that a completed phase must be
corroborated by an event/tree witness rather than self-report alone; the floor reads it to decide
REGRESSED-vs-INCOMPLETE for a missing `phase_completed(N)`.

### Gate-placement rules (Stage 3, 12)

Each rule promotes its `require` predicate to *required* ONLY when its `when` predicate is observed —
a gate whose phase never ran cannot false-alarm. Derived EXACTLY from the mandatory-gate exit markers
in the source SKILL.md (phases 2–13; phases 1 & 14 have no exit gate), never fitted to a run. Every
`require` row is also modelled in `## Optional` above so an observed-but-unpromoted gate is not an
unmodeled extra.

**#63 item 1 (#59): CONDITIONAL-phase gates are keyed on the phase's EXECUTION WITNESS, not
`phase_completed(N)`** — same fix as research. Always-executed phases (2, 5, 7, 8, 10, 11) keep
`phase_completed(N)`. Skippable phases (3/9 TDD — skip-if no `has_reproducible_defect` `:202`/`:385`;
4 UI mockups — skip-if not `ui_heavy` `:221-222`; 6 spec-audit — skippable `:305`/`:309`; 12/13 E2E &
user-docs — `:503`/`:525`) are keyed on the witness that only appears when the phase runs, so a
skip-marked `phase_completed(N)` no longer false-REGRESSes on the exit gate (the same #59 class the N=3
run surfaced for research). The `task_characteristic(...)=true` `when` is dormant in this reference
scenario (which pins `=false`) and only promotes when the characteristic is genuinely true — the one
deliberate state-file exception (documented).

| when | require | citation |
|---|---|---|
| `phase_completed(2)` | `gate_fired_at(phase-2)` | :174 ("Continue to Phase 3/4/5: `<title>`?", :186-189) — always-run |
| `task_characteristic(has_reproducible_defect)=true` | `gate_fired_at(phase-3)` | TDD-red runs only with a reproducible defect (:202 "Skip if `has_reproducible_defect` is false"); exit gate :206 ("TDD red gate complete. Continue to Phase 4?", :208) |
| `task_characteristic(ui_heavy)=true` | `gate_fired_at(phase-4)` | UI mockups run only when `ui_heavy` (:221-222 skip-if); exit gate :237 ("UI mockups complete … Continue to Phase 5?", :239) |
| `phase_completed(5)` | `gate_fired_at(phase-5)` | :294 ("… Continue to specification audit?", :296) — always-run |
| `delegated(spec-auditor)` | `gate_fired_at(phase-6)` | spec-auditor delegated ⇒ spec-audit RAN (:305/:309 skippable); exit gate :313 ("… Continue to implementation planning?", :315) |
| `phase_completed(7)` | `gate_fired_at(phase-7)` | :340 ("… Continue to implementation?", :342) — always-run |
| `phase_completed(8)` | `gate_fired_at(phase-8)` | :370 ("… Continue to verification?", :372) — always-run |
| `task_characteristic(has_reproducible_defect)=true` | `gate_fired_at(phase-9)` | TDD-green runs only with a reproducible defect (:385 skip-if); exit gate :389 ("TDD gate passed. Continue to Phase 10?", :391) |
| `phase_completed(10)` | `gate_fired_at(phase-10)` | :432 ("Which standard verifications to run?" / "Enable E2E…" / "Generate user documentation?", :425-430) — always-run |
| `phase_completed(11)` | `gate_fired_at(phase-11)` | :490 ("… Continue to Phase 12?", :492) — always-run |
| `delegated(e2e-test-verifier)` | `gate_fired_at(phase-12)` | e2e-test-verifier delegated ⇒ E2E RAN (:503 skip-if `e2e_enabled=false`); exit gate :510 ("E2E complete. Continue to Phase 13?", :512) |
| `delegated(user-docs-generator)` | `gate_fired_at(phase-13)` | user-docs-generator delegated ⇒ user-docs RAN (:525 skip-if); exit gate :532 ("Documentation complete. Continue to Phase 14?", :534) |

### Witness relations (Stage 4, 9)

Each witness relation names the event/tree token that MUST corroborate a completed phase (P2/P5/P7/P8/P11).
Every witness token below is ALSO an independently-required predicate (see `## Required`), so
rules-expansion is a benign no-op (guarded by `!effectiveRequired.includes`); the rows exist to be
hashed and read by the run.mjs floor. P2's witness is `delegated(gap-analyzer)` ONLY — the extractor's
dev profile does NOT emit `created_artifact(analysis/gap-analysis.md)`, so it must not be a witness.

| when | require | witnesses | citation |
|---|---|---|---|
| `phase_completed(2)` | `delegated(gap-analyzer)` | P2 | :147 (P2 "Task tool - `maister:gap-analyzer` subagent") |
| `phase_completed(5)` | `delegated(specification-creator)` | P5 | :285 (P5 "Task tool - `maister:specification-creator` subagent") |
| `phase_completed(5)` | `created_artifact(implementation/spec.md)` | P5 | :291 (P5 Output list includes `implementation/spec.md`) |
| `phase_completed(7)` | `delegated(implementation-planner)` | P7 | :332 (P7 "Task tool - `maister:implementation-planner` subagent") |
| `phase_completed(7)` | `created_artifact(implementation/implementation-plan.md)` | P7 | :333 (P7 Output: `implementation/implementation-plan.md`) |
| `phase_completed(8)` | `delegated(task-group-implementer)` | P8 | :358, implementation-plan-executor/SKILL.md:96 (P8 executor sub-delegates one task-group-implementer per group) |
| `phase_completed(8)` | `created_artifact(implementation/work-log.md)` | P8 | :359 (P8 Output: implemented code + `implementation/work-log.md`) |
| `phase_completed(11)` | `invoked_skill(implementation-verifier)` | P11 | :446 (P11 Step 1: "Invoke Skill tool - `maister:implementation-verifier`") |
| `phase_completed(11)` | `created_artifact(verification/*)` | P11 | :441 (P11 Output: `verification/implementation-verification.md`) |

## Allowlist (6)

| predicate | partition | citation | note |
|---|---|---|---|
| `invoked_skill(reviews-code)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `invoked_skill(reviews-pragmatic)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `invoked_skill(reviews-spec-audit)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `invoked_skill(reviews-reality-check)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `invoked_skill(reviews-production-readiness)` | allowlist | implementation-verifier/SKILL.md:108-142 | LIMITATION — platform divergence, see honesty note 3 |
| `state_schema(off-schema)` | allowlist | :107-122 (parser tolerance) | LIMITATION (issue #48, Stage 4) — the tolerant state parser accepts documented off-schema orchestrator-state serializations (bare-int `completed_phases`, `phase[-_]` tolerance, `phase_summaries` as phase source, `phases:` sequence with `id|number|phase` key, top-level `status:` without a `task:` block, floating `task_characteristics`); a run whose state diverges is allowlisted, not REGRESSED |

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
