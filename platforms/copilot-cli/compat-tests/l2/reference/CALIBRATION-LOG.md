# L2 Reference Calibration Log

Audit trail for **every edit** to the committed L2 reference JSONs
(`development.skeleton.json`, `research.skeleton.json`, `quick-bugfix.skeleton.json`).
The reference `hash` (stamped via `compare.computeHash`) detects *tampering and staleness*, but it
cannot detect **hash-neutral** moves (e.g. required↔optional) and it records no *rationale* — this
log is the only audit trail for both. The governance rule is stated **once, here**; other docs
(L2-DESIGN §6/§12, the parity runbook) link it rather than duplicating it.

## Governance rule

- **ANY edit to a committed reference JSON** — `required`, `optional`, or `allowlist`,
  **including hash-neutral required↔optional moves** — requires an entry in this log **before
  merge**.
- **Every entry needs a workflow-model citation** (a SKILL.md anchor) **or an explicit
  platform-divergence justification.** "Seen on Copilot" alone is **never** sufficient: the
  references are derived from maister's documented workflow model, not tuned to whatever a live
  run happened to emit.
- **Entry schema**: date · scenario · predicate(s) · from→to · citation/justification ·
  hash old→new (or "hash-neutral") · PR/commit.

Hashes are shown as 8-hex-char prefixes in the table; full 64-char values appear in the entry
notes. Provenance for the back-fill entries is the commit messages themselves
(`git show -s --format=%B <sha>`), not reconstruction from memory.

## Log (chronological)

| # | Date | Scenario | Predicate(s) | From→To | Citation / justification | Hash old→new | PR / commit |
|---|------|----------|--------------|---------|--------------------------|--------------|-------------|
| 1 | 2026-07-24 | development | full initial required/optional partition | ∅ → genesis | maister 2.2.2 workflow model (development SKILL.md); live N=1 confirmatory, Copilot 1.0.74, AS-EXPECTED — see note 1 | ∅ → `64b0d3b2…` | `6938a8f` |
| 2 | 2026-07-25 | research | full initial required/optional partition | ∅ → genesis | model-derived, credit-free (research orchestrator model: Phase-1 foundation required; conditional brainstorming/design + root skill optional); hash stamped via `compare.computeHash` | ∅ → `abed5d31…` | `db26a46` |
| 3 | 2026-07-26 | development | `invoked_skill(reviews-code)`, `(reviews-pragmatic)`, `(reviews-spec-audit)`, `(reviews-reality-check)`, `(reviews-production-readiness)` | absent → `optional` | "legitimate platform variance" after the 1.0.75 live run — see note 3; **retro-note: superseded by entry 7** (optional → allowlist/LIMITATION) | `64b0d3b2…` → `261ce181…` | `d92651e` |
| 4 | 2026-08-28 | quick-bugfix | full initial partition (required `invoked_skill(quick-bugfix)`, `gate_fired(ask)`, `reached_terminal(completion)`; permission/exit_plan_mode gates optional) | ∅ → genesis | maister 2.2.3; **"calibrated from the live N=1 run"** (Copilot 1.0.81, AS-EXPECTED 2/2 vs the pre-calibration 2-required partition — see note 4 figure-provenance disclosure) | ∅ → `f925c9a4…` | `86f3198` |
| 5 | 2026-08-28 | (all) | none | no reference edit | parseState completion-signal union — extractor fix for LLM state-serialization variance, **not** a workflow-model change; see note 5 | hash-neutral (no edit) | `1f6cc88` / PR #46 |
| 6 | 2026-08-28 | development | `hook_effect(destructive_guard=ask)` | `allowlist` → removed (dead entry) | predicate head is outside `GRAMMAR_HEADS` (`normalize.mjs:38-47`) — it can never be emitted into a skeleton, so the allowlist entry is unobservable by construction; see note 6 | `261ce181…` → `a48a64e3…` | PR #49 |
| 7 | 2026-08-28 | development | `invoked_skill(reviews-code)`, `(reviews-pragmatic)`, `(reviews-spec-audit)`, `(reviews-reality-check)`, `(reviews-production-readiness)` | `optional` → `allowlist`/LIMITATION | platform divergence, citation `implementation-verifier/SKILL.md:108-142` — exact reason string in note 7 | shares entry 6's re-stamp: `261ce181…` → `a48a64e3…` | PR #49 |
| 8 | 2026-08-28 | research | `hook_effect(destructive_guard=ask)` | `allowlist` → removed (dead entry) | same as entry 6: outside `GRAMMAR_HEADS` (`normalize.mjs:38-47`), unobservable by construction | `abed5d31…` → `12c51927…` | PR #49 |
| 9 | 2026-08-28 | quick-bugfix | `hook_effect(destructive_guard=ask)` | `allowlist` → removed (dead entry) | same as entry 6: outside `GRAMMAR_HEADS` (`normalize.mjs:38-47`), unobservable by construction | `f925c9a4…` → `9855340d…` | PR #49 |
| 10 | 2026-08-29 | development | `outcome(tests-pass)=pass` | absent → required | FUNCTIONAL ORACLE (issue #48, Stage 2): P11 verification (`development/SKILL.md:441`) + P8 implemented-code corroboration (:359); `workflow_model_version` 1→2 — see note 10 | `a48a64e3…` → `1180da9a…` | PR (Stage 2) |
| 11 | 2026-08-29 | research | `outcome(report-produced)=pass` | absent → required | FUNCTIONAL ORACLE (issue #48, Stage 2): P1 Step 4 Artifacts (`research/SKILL.md:181`, phase Output :128) mandate `outputs/research-report.md`; `workflow_model_version` 1→2 — see note 11 | `12c51927…` → `e823c815…` | PR (Stage 2) |
| 12 | 2026-08-29 | quick-bugfix | `outcome(bug-fixed)=pass` | absent → required | FUNCTIONAL ORACLE (issue #48, Stage 2): Step 7 verify terminal deliverable-fixed check (`quick-bugfix/SKILL.md:171-173`); `workflow_model_version` 1→2 — see note 12 | `9855340d…` → `6cff7eba…` | PR (Stage 2) |
| 13 | 2026-08-29 | development | `rules[]` phases 2–13 (12) + `gate_fired_at(phase-2..13)` optional (12) | absent → `rules[]` + `gate_fired_at` optional | GATES (issue #48, Stage 3): mandatory-gate exits `development/SKILL.md:174/:206/:237/:294/:313/:340/:370/:389/:432/:490/:510/:532`; rules-in-hash Option A + `schema_version` 1→2 + `workflow_model_version` 2→3 — see note 13 | `1180da9a…` → `ea0a5951…` | PR (Stage 3) |
| 14 | 2026-08-29 | research | `rules[]` phases 1,4,5 (3) + `gate_fired_at(phase-1,4,5)` optional (3) | absent → `rules[]` + `gate_fired_at` optional | GATES (issue #48, Stage 3): mandatory-gate exits `research/SKILL.md:198/:302/:351`; rules-in-hash Option A + `schema_version` 1→2 + `workflow_model_version` 2→3 — see note 14 | `e823c815…` → `40378fab…` | PR (Stage 3) |
| 15 | 2026-08-29 | quick-bugfix | none (`rules[] = []`) | schema/wm only | GATES (issue #48, Stage 3): Step-numbered plan gate (`quick-bugfix/SKILL.md:91`/:122-124), no phase-numbered exit gates ⇒ `rules[]` intentionally empty, no `gate_fired_at` invented; `schema_version` 1→2 + `workflow_model_version` 2→3 (zero rule tokens) — see note 15 | `6cff7eba…` → `0893abf4…` | PR (Stage 3) |
| 16 | 2026-08-29 | development | `precedes ×4` + `min_count(delegated(task-group-implementer))=1` + `state_schema(conformant)` required; 9 witness `rules[]`; `state_schema(off-schema)` LIMITATION allowlist | absent → required/rules/allowlist | ORDER+COUNT+WITNESS+STATE-SCHEMA (issue #48, Stage 4): precedes cite `development/SKILL.md:147/:285/:332/implementation-plan-executor/SKILL.md:96/:446`; min_count `implementation-plan-executor/SKILL.md:87-99`; witness rows P2/P5/P7/P8/P11; `schema_version` 2→3 + `workflow_model_version` 3→4 — see note 16 | `ea0a5951…` → `3694ce8d…` | PR (Stage 4) |
| 17 | 2026-08-29 | research | `precedes ×2` + `state_schema(conformant)` required; `min_count(delegated(information-gatherer))=2` conditional rule + P1 `delegated(research-planner)` witness rule; `state_schema(off-schema)` LIMITATION allowlist | absent → required/rules/allowlist | ORDER+COUNT+WITNESS+STATE-SCHEMA (issue #48, Stage 4): precedes cite `research/SKILL.md:153/:170/:184`; min_count `:164-170` (conditional, `source_category` honesty note); `schema_version` 2→3 + `workflow_model_version` 3→4 — see note 17 | `40378fab…` → `28c43540…` | PR (Stage 4) |
| 18 | 2026-08-29 | quick-bugfix | none (NO predicate change — state_schema NOT APPLICABLE) | schema/wm only | STATE-SCHEMA NOT APPLICABLE (issue #48, Stage 4): no orchestrator state / no subagents (`quick-bugfix/SKILL.md:9`) ⇒ no precedes/min_count/state_schema predicate; lockstep `schema_version` 2→3 + `workflow_model_version` 3→4 re-stamp only — see note 18 | `0893abf4…` → `4c882e17…` | PR (Stage 4) |
| 19 | 2026-08-29 | development | none (NO predicate change) | schema 3→4, wm 4→5 | HOOKS-AT-L2 lockstep re-stamp (issue #48, Stage 6): the new `hook_effect` grammar head (`normalize.mjs` GRAMMAR_HEADS + buildToken, inside-parens `hook_effect(destructive_guard=ask)`) expands the grammar surface, forcing a `schema_version` bump across ALL references; the guard contract (`block-destructive-commands.sh:59-60`) is the head's provenance. Predicate-frozen; Stage-3/4 lockstep precedent (entries 15/18) — see note 19 | `3694ce8d…` → `9f431947…` | PR (Stage 6) |
| 20 | 2026-08-29 | research | none (NO predicate change) | schema 3→4, wm 4→5 | HOOKS-AT-L2 lockstep re-stamp (issue #48, Stage 6): same `hook_effect` head add forces the lockstep `schema_version`/`workflow_model_version` bump; predicate-frozen — see note 20 | `28c43540…` → `16c635b4…` | PR (Stage 6) |
| 21 | 2026-08-29 | quick-bugfix | none (NO predicate change) | schema 3→4, wm 4→5 | HOOKS-AT-L2 lockstep re-stamp (issue #48, Stage 6): same `hook_effect` head add forces the lockstep bump; predicate-frozen — see note 21 | `4c882e17…` → `817a43ee…` | PR (Stage 6) |
| 22 | 2026-08-29 | destructive-guard | full initial required/optional partition (required `hook_effect(destructive_guard=ask)` + `reached_terminal(completion)`; `gate_fired(permission)`/`gate_fired(ask)` optional) | ∅ → genesis | HOOKS-AT-L2 genesis (issue #48, Stage 6): reference for the new destructive-guard micro-scenario, derived from the guard hook contract `block-destructive-commands.sh:54/:59-60` (`hookSpecificOutput.permissionDecision:"ask"`) + `L1-FINDINGS.md` §1 (Copilot honors `ask`, fail-closed, L1a.ii). Required set is model-driven (NO `outcome` — guard-firing is the predicate), `=ask` contract-derived (live confirmation deferred paid) — see note 22 | ∅ → `b0b145b0…` | PR (Stage 6) |
| 23 | 2026-08-30 | development | `state_schema(conformant)` required → optional | required → optional | STATE-SCHEMA PARITY ([#57](https://github.com/robmar-net/maister/issues/57)): the first live L2 runs showed Copilot serializes `orchestrator-state.yml` off-schema (bare-int `completed_phases`, top-level `status:` without `task:`), emitting `state_schema(off-schema)` (LIMITATION). Demoting `conformant` to optional is **model-grounded** — the runtime routing/resume readers (`development/SKILL.md:247`, `orchestrator-patterns.md:358-360`) are model-interpreted/**semantic**, so an off-schema serialization is behavior-preserving, not a functional regression; the divergence stays visible via the `state_schema(off-schema)` allowlist LIMITATION. **HASH-NEUTRAL** (conformant stays in the `required∪optional` union). NOT fitted to a run — see note 23 | `9f431947…` → `9f431947…` (unchanged) | PR (#57 interim) |
| 24 | 2026-08-30 | research | `state_schema(conformant)` required → optional | required → optional | STATE-SCHEMA PARITY ([#57](https://github.com/robmar-net/maister/issues/57)): same as #23 — the first live research run on 1.0.81 (13.21 AIU) emitted `state_schema(off-schema)`; conformant demoted to optional on workflow-model grounds (semantic runtime readers), off-schema stays a visible allowlist LIMITATION 🟢 ADAPTED. **HASH-NEUTRAL** — see note 24 | `16c635b4…` → `16c635b4…` (unchanged) | PR (#57 interim) |
| 25 | 2026-08-30 | research | gate-placement rule `when`: `phase_completed(4)`→`delegated(solution-brainstormer)`, `phase_completed(5)`→`delegated(solution-designer)` | phase-completion → execution-witness | GATE WITNESSES ([#63](https://github.com/robmar-net/maister/issues/63) item 1 / [#59](https://github.com/robmar-net/maister/issues/59)): conditional-phase (4 brainstorming, 5 design) exit gates keyed on the delegation that only fires when the phase RUNS, so a skip-marked `phase_completed(4/5)` no longer false-REGRESSes on `gate_fired_at(phase-4/5)` (N=3 evidence: `phase_completed(4/5)` stable 3/3, `gate_fired_at(phase-4/5)` 1/3). Model-cited (:246/:302, :317/:351), NOT run-fitted; validated credit-free by replaying skip-path bundle `reports/20260830T002503Z/` (2 gate FAILs disappear, M2 still REGRESSES for the intended knockout). Rule-token change → hash re-stamped (wm v5 unchanged — same model, refined rule keying) | `16c635b4…` → `b30b1e64…` | PR (#63) |
| 26 | 2026-08-30 | development | gate-placement rule `when` for phases 3/4/6/9/12/13 → execution witnesses (`task_characteristic(has_reproducible_defect)=true` [3,9], `task_characteristic(ui_heavy)=true` [4], `delegated(spec-auditor)` [6], `delegated(e2e-test-verifier)` [12], `delegated(user-docs-generator)` [13]) | phase-completion → execution-witness | GATE WITNESSES ([#63](https://github.com/robmar-net/maister/issues/63) item 1 / [#59](https://github.com/robmar-net/maister/issues/59)): same fix as #25 for dev's skippable phases; always-run 2/5/7/8/10/11 keep `phase_completed(N)`. Defends against a skip-marked `phase_completed` false-REGRESSing the conditional exit gate. The `task_characteristic(...)=true` `when` is the documented state-file exception (dormant in this `=false` reference scenario). Dev fixture: added the realistic `delegated(spec-auditor)` (phase-6 spec-audit completed ⇒ spec-auditor ran) so the witness rule is exercised — matched stays 38. Rule-token change → hash re-stamped | `9f431947…` → `77b935c1…` | PR (#63) |
| 27 | 2026-08-30 | development | `task_status(completed)` required → optional | required → optional | LEXICAL SELF-REPORT ([#63](https://github.com/robmar-net/maister/issues/63) item 2): `task_status` is the workflow's self-reported YAML status — the class #48 Stage 4 moved AWAY from. Terminal semantics are carried by the FUNCTIONAL `outcome(...)=pass` + event-witnessed `reached_terminal(completion)`; a required `task_status(completed)` false-REGRESSes when Copilot's state serialization diverges (N=3: present only 1/3, undetermined cause — item 3 N>1 persist makes it diagnosable). **HASH-NEUTRAL** (stays in required∪optional). Model-grounded, NOT fitted | `77b935c1…` → `77b935c1…` (unchanged) | PR (#63) |
| 28 | 2026-08-30 | research | `task_status(completed)` required → optional | required → optional | LEXICAL SELF-REPORT ([#63](https://github.com/robmar-net/maister/issues/63) item 2): same as #27 for research — terminal semantics carried by `outcome(report-produced)=pass` + `reached_terminal(completion)`; `task_status` is state self-report (the #48 Stage-4 "events over self-report" direction; finished in item 10). **HASH-NEUTRAL**. Model-grounded, NOT fitted | `b30b1e64…` → `b30b1e64…` (unchanged) | PR (#63) |

## Entry notes

### 1 — `6938a8f` development genesis (2026-07-24, Copilot 1.0.74, N=1)

Initial reference committed with the harness itself (maister 2.2.2). The commit message records
the model rationale for the only calibration applied to the genesis partition:

> "its predicate skeleton CONFORMS to the reference (AS-EXPECTED) after a justified N=1
> calibration — 5 legitimately-variable predicates (Explore/reporter in Phase 1; user-docs/E2E on
> creates_new_entities) moved to optional per maister's documented model (tautology guard), never
> tuned to pass."

The tautology guard (both-optional pairs for legitimately input-dependent characteristics such as
`task_characteristic(creates_new_entities)`) is a *model* rationale, so this genesis entry meets
the citation bar. Full hash: `∅ → 64b0d3b2484542871b098d5e5c0e5b1ef92288a47bcba7fa2e754392dedb790b`.

### 2 — `db26a46` research genesis (2026-07-25, model-derived)

Reference derived from the research orchestrator's documented model (planner + parallel gatherers
+ synthesizer), credit-free — no live run was used to shape the partition (the live research drive
was explicitly deferred to AI-credit quota). Hash stamped via `compare.computeHash`. Full hash:
`∅ → abed5d31d2ff2b9043ae1033c9cf2a73eb78f8c14f596e2835cd1734ea96e895`.

### 3 — `d92651e` dev: reviews-* ×5 → optional (2026-07-26, Copilot 1.0.75)

The 1.0.75 live dev run surfaced `skill.invoked` events for the reviews-* skill family. The commit
modelled them `OPTIONAL` as "legitimate platform variance (the same reviews are the
code-reviewer/pragmatist/... AGENTS already modelled optional)". Full hashes:
`64b0d3b2484542871b098d5e5c0e5b1ef92288a47bcba7fa2e754392dedb790b →
261ce1811909a55b2ba2499eb4b6848bf821c8289ef44bce2f36261d1c0e504c`.

**Retro-note**: superseded by entry 7 of this log — the reviews-* predicates moved
`optional` → `allowlist`/LIMITATION with a proper workflow-model citation
(`implementation-verifier/SKILL.md:108-142`), which is the correct home for a platform-divergence
pattern (it is not part of maister's workflow model on either platform's *model* level).

### 4 — `86f3198` quick-bugfix genesis (2026-08-28, Copilot 1.0.81)

Reference committed with the quick-bugfix scenario (maister 2.2.3); live drive AS-EXPECTED
2 PASS / 0 FAIL. The commit message states the partition was **"calibrated from the live N=1
run"** — honestly flagged here: that is exactly the practice this governance rule now prohibits
without a model citation. **Figure-provenance disclosure**: the live run was judged against the
PRE-calibration partition (2 required: `invoked_skill(quick-bugfix)` + `reached_terminal(completion)`;
`gate_fired(ask)` still optional) — hence "2 PASS". `gate_fired(ask)` was then promoted to required
in the same commit (hash-neutral move), so the COMMITTED 3-required reference was never itself
re-judged live. The observed skeleton did contain `gate_fired(ask)` (diff NONE with it in optional),
so the committed reference would pass 3/3 on that same skeleton — but that is inference from the
recorded skeleton, not a judged run. Any future live quick-bugfix drive judges the committed
3-required partition. The per-reference derivation record
(`quick-bugfix.derivation.md`) retro-supplies the SKILL.md citations for each predicate (the
required `gate_fired(ask)` is the divergence-tagged template case). Full hash:
`∅ → f925c9a423561611fa1d3ad346b45623ef1caa086e0fb24b8d28b0a7f7488319`.

### 5 — `1f6cc88` / PR #46: explicit NO-reference-edit note (2026-08-28)

The parseState completion-signal **union** fix (live 1.0.81 dev drives false-INCOMPLETE-ing
because the model serializes orchestrator-state completion non-deterministically across four
observed shapes). This was **extractor variance, not a workflow-model change** — the skeleton
otherwise CONFORMED (classified diff = NONE) — so **no reference edit was needed or made**;
the fix belongs in `extractor.mjs`, and all three reference hashes were untouched. Recorded here
so the absence of a calibration entry for that PR is itself auditable.

### 6 — dev: dead `hook_effect(destructive_guard=ask)` removal (this change)

`hook_effect` is not a member of `GRAMMAR_HEADS` (`normalize.mjs:38-47`), and `normalize` drops
every predicate whose head is outside that set (`normalize.mjs:95`) — so the predicate **can never
be emitted** into an extracted skeleton and the allowlist entry could never match anything
(hook-effect coverage lives in L1, not L2). Removing it is a pure dead-entry cleanup with no
behavioural effect. Full hashes:
`261ce1811909a55b2ba2499eb4b6848bf821c8289ef44bce2f36261d1c0e504c →
a48a64e3981717e5d0f93c243876cbf4f2fcc14f54f1a05fbc40b2d2a0acbcf2`.

### 7 — dev: reviews-* ×5 optional → allowlist/LIMITATION (this change)

Same re-stamp as entry 6 (one edit pass over `development.skeleton.json`); separate rationale.
The five predicates moved out of `optional` (they are not part of the workflow model's optional
surface) into the `allowlist` as classified LIMITATION entries, each carrying this reason string
(quoted from the reference, `reviews-code` shown; the other four differ only in the final skill
name):

> "Platform divergence (implementation-verifier/SKILL.md:108-142): on Claude the implementation-verifier delegates reviews to Task subagents (code-reviewer, code-quality-pragmatist, production-readiness-checker, reality-assessor); on Copilot the same review work surfaces as a direct invocation of reviews-code."

### 8 — research: dead `hook_effect(destructive_guard=ask)` removal (this change)

Identical rationale to entry 6. Full hashes:
`abed5d31d2ff2b9043ae1033c9cf2a73eb78f8c14f596e2835cd1734ea96e895 →
12c51927084065a5c19dadd29c82a65438dfb029d7ceba0e484319dbed54c7f0`.

### 9 — quick-bugfix: dead `hook_effect(destructive_guard=ask)` removal (this change)

Identical rationale to entry 6. Full hashes:
`f925c9a423561611fa1d3ad346b45623ef1caa086e0fb24b8d28b0a7f7488319 →
9855340d04a2efb2bdef6541c736641aa16a9e35b6a1031184e2e95f2f24ff36`.

### 10 — dev: required `outcome(tests-pass)=pass` (Stage 2 functional oracle)

FUNCTIONAL ORACLE landing (issue #48, Stage 2): the `outcome(<id>)=pass|fail` grammar head becomes
observable, so the development reference now **requires** a passing functional outcome, not merely
the modeled delegations/artifacts. Citation: `development/SKILL.md:441` (P11 verification produces
`verification/implementation-verification.md`), corroborated by `:359` (P8 implemented code) — a
correct run's implemented code passes its test suite, making `tests-pass` a genuine deliverable
check. `workflow_model_version` bumped 1→2 (the model now carries a required functional predicate;
`--check-reference` reports STALE against any v1 reference). The hash re-stamp is driven solely by
the new required predicate (`computeHash` is version-independent). Full hashes:
`a48a64e3981717e5d0f93c243876cbf4f2fcc14f54f1a05fbc40b2d2a0acbcf2 →
1180da9a65f7c5e30f3d4acc143f7cbc9c3391b4c8b3980f34ea82c703ab24a6`.

### 11 — research: required `outcome(report-produced)=pass` (Stage 2 functional oracle)

FUNCTIONAL ORACLE landing (issue #48, Stage 2). Citation: `research/SKILL.md:181` (P1 Step 4
Artifacts) and `:128` (phase Output list) both mandate `outputs/research-report.md`; the terminal
deliverable of a correct research run is a produced report, so `report-produced` is a passing
functional deliverable check. `workflow_model_version` bumped 1→2. Full hashes:
`12c51927084065a5c19dadd29c82a65438dfb029d7ceba0e484319dbed54c7f0 →
e823c815c895ee8c8a8fb16d5d8146c323dd03821ec557c8a8fb689d7c2ff497`.

### 12 — quick-bugfix: required `outcome(bug-fixed)=pass` (Stage 2 functional oracle)

FUNCTIONAL ORACLE landing (issue #48, Stage 2). Citation: `quick-bugfix/SKILL.md:171-173` (Step 7
verify — the terminal step provides the completion summary only after the deliverable defect is
confirmed fixed), so `bug-fixed` is a passing functional deliverable check on the fix itself.
`workflow_model_version` bumped 1→2. Full hashes:
`9855340d04a2efb2bdef6541c736641aa16a9e35b6a1031184e2e95f2f24ff36 →
6cff7ebaadc90cff557f6783d2bf2e1a6f71664eba8efa94ceef72b80db42215`.

### 13 — dev: `rules[]` phases 2–13 + fireable `gate_fired_at` optional rows (Stage 3 gates)

GATES landing (issue #48, Stage 3): the two new grammar heads (`gate_fired_at(phase-N)`,
`gate_count(ask)=K`) become observable and the development reference gains a `rules[]` governance
partition that promotes `gate_fired_at(phase-N)` to *required* when `phase_completed(N)` is observed
(a mandatory exit gate silently dropped on an executed path → REGRESSED). The 12 rules (phases 2–13
— every phase with a MANDATORY-GATE exit; phases 1 & 14 have none) are derived EXACTLY from the
SKILL.md gate-marker anchors, never fitted to a run:
`development/SKILL.md:174` (P2), `:206` (P3 TDD red gate), `:237` (P4 UI mockups), `:294` (P5 spec
audit), `:313` (P6 implementation planning), `:340` (P7 implementation), `:370` (P8 verification),
`:389` (P9 TDD gate passed), `:432` (P10 verification decisions), `:490` (P11 → Phase 12), `:510`
(P12 E2E complete), `:532` (P13 documentation complete). Each rule's `require` is also modelled in
`optional` (12 `gate_fired_at(phase-N)` rows) so an observed-but-unpromoted gate is not an unmodeled
extra — consistent with `gate_fired(permission)`/`gate_fired(exit_plan_mode)`. `gate_count(ask)=K`
is deliberately NOT modelled anywhere (reported-only head, excluded from `compare`'s `extra` diff),
so a variable K never false-REGRESSES. Hash re-stamp under `computeHash` Option A: one sorted
`rule:<when>=><require>` token per rule (zero tokens when `rules` absent/empty) plus the 12 new
`gate_fired_at` optional predicates plus the `schema:2` token; `schema_version` 1→2 (old refs
re-stamp cleanly), `workflow_model_version` 2→3 (`--check-reference` reports STALE against any v2
reference; `computeHash` is version-independent). Full hashes:
`1180da9a65f7c5e30f3d4acc143f7cbc9c3391b4c8b3980f34ea82c703ab24a6 →
ea0a59515602f4811b1d6271435559a23663fbd5502af64e5a2119c0e0e2d37e`.

### 14 — research: `rules[]` phases 1,4,5 + fireable `gate_fired_at` optional rows (Stage 3 gates)

GATES landing (issue #48, Stage 3). Research has a MANDATORY-GATE exit on phases 1, 4, and 5; the 3
rules are derived EXACTLY from the SKILL.md gate-marker anchors: `research/SKILL.md:198` (P1
"Research foundation complete … Continue to brainstorming evaluation?"), `:302` (P4 "Brainstorming
complete. Continue to high-level design?"), `:351` (P5 "Design complete. Continue to output
generation?"). Each `require` is also modelled `optional` (3 `gate_fired_at(phase-N)` rows). Same
Option-A rules-in-hash + `schema_version` 1→2 + `workflow_model_version` 2→3 rationale as entry 13.
Full hashes:
`e823c815c895ee8c8a8fb16d5d8146c323dd03821ec557c8a8fb689d7c2ff497 →
40378fabe738e10ae426fb60a3b78272f03fdf87d401c33209ab129502fc116c`.

### 15 — quick-bugfix: `rules[] = []` intentionally empty, schema/wm bump only (Stage 3 gates)

GATES landing (issue #48, Stage 3). quick-bugfix is a Step-numbered workflow (Steps 1–7) whose only
mandatory gate is the EnterPlanMode/ExitPlanMode plan gate (`quick-bugfix/SKILL.md:91`, :122-124),
not a set of phase-numbered exit gates — there are no `phase_completed(N)` predicates to key a
gate-placement rule on. So `rules[] = []` and **no** `gate_fired_at(phase-N)` predicate is invented;
the required un-phased `gate_fired(ask)` (divergence-tagged, derivation honesty note 1) remains the
sole gate predicate. The reference still re-stamps in lockstep with its siblings: `schema_version`
1→2 + `workflow_model_version` 2→3. Under Option A the empty `rules[]` contributes ZERO tokens, so
the re-stamp is driven solely by the `schema:1`→`schema:2` token change (backward-neutrality:
`rules:[]` ≡ rules-field-absent). Full hashes:
`6cff7ebaadc90cff557f6783d2bf2e1a6f71664eba8efa94ceef72b80db42215 →
0893abf4a0611ba742fd7b31af7937a6735d6feda2a5aa2bb706da2947103603`.

### 16 — dev: ORDER spine + COUNT floor + WITNESS relations + STATE-SCHEMA (Stage 4)

ORDER + COUNT + EVENTS-OVER-SELF-REPORT + STATE-SCHEMA landing (issue #48, Stage 4). Three new
grammar heads (`precedes`, `min_count`, `state_schema`) become observable, so the development
reference gains 6 new `required` predicates + 9 `rules[]` witness relations + 1 `allowlist`
LIMITATION:

- **`required` (+6, 26→32):** `precedes(gap-analyzer,specification-creator)`,
  `precedes(specification-creator,implementation-planner)`,
  `precedes(implementation-planner,task-group-implementer)`,
  `precedes(task-group-implementer,implementation-verifier)` — pairwise adjacent edges over the
  analyse→spec→plan→implement→verify chain, cited `development/SKILL.md:147→:285→:332→
  implementation-plan-executor/SKILL.md:96→:446`; `min_count(delegated(task-group-implementer))=1`
  (one implementer per task group, `implementation-plan-executor/SKILL.md:87-99`);
  `state_schema(conformant)` (canonical orchestrator-state serialization, keyed on the dedicated
  `schemaDivergences` signal so legitimate absences do not mark off-schema).
- **`rules[]` (+9, 12→21):** witness relations for P2/P5/P7/P8/P11 (`delegated(…)` /
  `created_artifact(…)` / `invoked_skill(…)` prefixes), told apart from the 12 Stage-3
  `gate_fired_at(` gate rules by the `require` prefix (keys the run.mjs floor). P2's witness is
  `delegated(gap-analyzer)` ONLY. Every witness token is already an independently-required
  predicate, so rules-expansion is a benign no-op; the rows exist to be hashed and read by the floor.
- **`allowlist` (+1, 5→6):** `state_schema(off-schema)` LIMITATION (tolerant parser accepts
  documented off-schema shapes).

`schema_version` 2→3 (the grammar surface is a hash token) + `workflow_model_version` 3→4
(`--check-reference` reports STALE against any v3 reference). Re-stamp under `computeHash`
(version-independent): the 6 new required predicates + the 9 `rule:<when>=><require>` witness tokens
+ the `schema:2`→`schema:3` token drive the new hash. Matched-count effect (pipeline test): dev
effective-required 33→39 (32 base + 7 promoted gates; the 9 witness rules promote already-required
tokens → no new matched). Full hashes:
`ea0a59515602f4811b1d6271435559a23663fbd5502af64e5a2119c0e0e2d37e →
3694ce8d43f3e05a7322e383a3bca56df701b9536824eaa3a048469276ae047b`.

### 17 — research: ORDER spine + STATE-SCHEMA + conditional COUNT rule + P1 witness (Stage 4)

Stage-4 landing for research (issue #48). The reference gains 3 new `required` predicates + 2
`rules[]` relations + 1 `allowlist` LIMITATION:

- **`required` (+3, 10→13):** `precedes(research-planner,information-gatherer)`,
  `precedes(information-gatherer,research-synthesizer)` (plan→gather→synthesize edges, cited
  `research/SKILL.md:153→:170→:184`); `state_schema(conformant)` — research legitimately omits
  `task_characteristics` (no gap-analyzer), which the extractor treats as an ABSENCE (a
  `parseWarnings` entry, NOT a `schemaDivergences` entry), so a conformant research state is
  correctly `conformant` (C1 regression guard).
- **`rules[]` (+2, 3→5):** the P1 witness `{when:phase_completed(1), require:delegated(research-planner)}`
  (:153); the conditional count rule `{when:phase_completed(1),
  require:min_count(delegated(information-gatherer))=2}` (:164-170). **Honesty note:**
  information-gatherer is dispatched by the `source_category` param (`:176`), not a literal
  `subagent_type:`, and there is no clean observable for "≥2 sources warranted"; the rule is placed
  CONDITIONALLY on `phase_completed(1)` and a legitimate single-source run that completes P1 WOULD
  false-REGRESS ([OQ-1]). The committed research fixture carries ≥2 gatherers so the reference
  validates AS-EXPECTED; documented fallback is to demote to `optional`. Not fitted to a run.
- **`allowlist` (+1, 0→1):** `state_schema(off-schema)` LIMITATION.

`schema_version` 2→3 + `workflow_model_version` 3→4, re-stamped via `computeHash`. Matched-count
effect (pipeline-research test): research effective-required 13→17 (13 base + 3 promoted gates + 1
promoted `min_count` rule — the `=2` token is not in `required[]` but IS present in observed, so the
conditional promotion counts as +1 matched). Full hashes:
`40378fabe738e10ae426fb60a3b78272f03fdf87d401c33209ab129502fc116c →
28c435405f39363597f752b1cc80d71602933df366d5cb842d06aaec0b5994b4`.

### 18 — quick-bugfix: STATE-SCHEMA NOT APPLICABLE, schema/wm re-stamp only (Stage 4)

Stage-4 lockstep governance bump (issue #48). quick-bugfix carries NO Stage-4 predicate: the
workflow has no orchestrator state, no task directory, and no subagents (`quick-bugfix/SKILL.md:9`).
With no `subagent.started` events there is no `precedes` chain and no `min_count` fan-out; with no
`stateYaml`, `findStateYaml` returns `null` and the extractor emits NO `state_schema` record, so
`state_schema(conformant)` would be an unsatisfiable required token (permanent REGRESSED) and
`state_schema(off-schema)` has no state surface to allowlist. The reference stays predicate-frozen
(`required` 4, `optional` 2, `rules[] = []`, `allowlist = []`); the ONLY change is the lockstep
`schema_version` 2→3 + `workflow_model_version` 3→4 re-stamp, driven solely by the
`schema:2`→`schema:3` token change (zero rule/predicate tokens). Full hashes:
`0893abf4a0611ba742fd7b31af7937a6735d6feda2a5aa2bb706da2947103603 →
4c882e17a1055c9be6f93c8e567db28cd5fcb10a13ceecd23641840282603a63`.

### 19 — dev: HOOKS-AT-L2 lockstep re-stamp, schema/wm bump only (Stage 6)

HOOKS-AT-L2 landing (issue #48, Stage 6). `hook_effect` is promoted from a dead grammar entry to a
live L2 predicate: it becomes a real member of `GRAMMAR_HEADS` AND a `buildToken` case in
`normalize.mjs` (inside-parens shape `hook_effect(destructive_guard=ask)`, byte-identical to the new
`destructive-guard` reference `required[]` token). Adding a grammar head expands the hashed grammar
surface, so ALL references re-stamp in lockstep (`schema_version` 3→4), and the workflow model gains
a live predicate head (`workflow_model_version` 4→5 — `--check-reference` reports STALE against any
v4 reference). The head's provenance is the zero-touch guard hook
`block-destructive-commands.sh:59-60` (`hookSpecificOutput.permissionDecision:"ask"`). development
carries NO predicate change (the empty-sink invariant: dev drives pass `hookDecisions=[]` → no
`hook_effect` emitted → snapshot byte-identical); the reference stays predicate-frozen and only the
`schema:3`→`schema:4` token drives the new hash (`computeHash` is version-independent; the
`workflow_model_version` is not in the hash). Stage-3/4 lockstep re-stamp precedent: entries 15/18.
Full hashes:
`3694ce8d43f3e05a7322e383a3bca56df701b9536824eaa3a048469276ae047b →
9f431947b38a08dd892dd0c0f233595200ff772ea5c794ceb2740b170b54b830`.

### 20 — research: HOOKS-AT-L2 lockstep re-stamp, schema/wm bump only (Stage 6)

HOOKS-AT-L2 landing (issue #48, Stage 6). Identical rationale to entry 19: the `hook_effect`
grammar-head add forces the lockstep `schema_version` 3→4 + `workflow_model_version` 4→5 re-stamp.
research carries NO predicate change (empty-sink invariant — `hookDecisions=[]` → no `hook_effect`
→ pipeline-research snapshot byte-identical); the reference stays predicate-frozen and the
`schema:3`→`schema:4` token alone drives the new hash. Full hashes:
`28c435405f39363597f752b1cc80d71602933df366d5cb842d06aaec0b5994b4 →
16c635b402773e7ae03c5ad0aaf5bb7cb9e5e58b7753768dca915d4e80607d92`.

### 21 — quick-bugfix: HOOKS-AT-L2 lockstep re-stamp, schema/wm bump only (Stage 6)

HOOKS-AT-L2 landing (issue #48, Stage 6). Identical rationale to entries 19/20: the `hook_effect`
grammar-head add forces the lockstep `schema_version` 3→4 + `workflow_model_version` 4→5 re-stamp.
quick-bugfix carries NO predicate change (empty-sink invariant — its drive passes `hookDecisions=[]`
→ no `hook_effect` → snapshot byte-identical); predicate-frozen, `schema:3`→`schema:4` token drives
the new hash. Full hashes:
`4c882e17a1055c9be6f93c8e567db28cd5fcb10a13ceecd23641840282603a63 →
817a43ee572b7ae910352d78d940b15dfd78d53dc1039513f859674a3ee401c5`.

### 22 — destructive-guard: GENESIS — HOOKS-AT-L2 micro-scenario reference (Stage 6)

HOOKS-AT-L2 genesis (issue #48, Stage 6). New reference committed with the `destructive-guard`
micro-scenario (maister 2.2.3, schema 4, wm 5). SOURCE is NOT a `SKILL.md` — it is the Copilot
destructive-command guard hook + the L1 live-survival finding:

- **`hook_effect(destructive_guard=ask)`** (required) — the guard matches its destructive-command
  regex (`block-destructive-commands.sh:54`) and emits `hookSpecificOutput.permissionDecision:"ask"`
  with the `Maister guard: destructive command …` reason (`:59-60`); `L1-FINDINGS.md` §1 confirms
  Copilot honors that `ask` and holds it fail-closed live (L1a.ii). A custom `onPermissionRequest`
  responder observes the decision into the per-run `hookDecisions` sink; the extractor emits the
  token from the sink entry (Option B). Token shape is INSIDE-parens, byte-identical to `buildToken`.
- **`reached_terminal(completion)`** (required) — the micro-scenario drives its single
  destructive-cleanup prompt to its terminal.
- **`gate_fired(permission)`, `gate_fired(ask)`** (optional) — platform permission/confirmation
  surfaces, not model-mandated. `gate_fired(exit_plan_mode)` NOT modeled (no plan mode);
  `invoked_skill(...)` deliberately unmodeled (a bare cleanup prompt need not route through a named
  skill; a live one is a benign extra).

Honesty: the required set is MODEL-DRIVEN — there is NO `outcome(...)=pass` (this scenario has no
functional deliverable oracle; `outcome:[]`), guard-firing IS the predicate. `=ask` is
CONTRACT-DERIVED from the deterministic hook contract, never fitted to a run; direct live
confirmation of the exact `PermissionRequest` shape is a DEFERRED PAID follow-up (the responder's
command-regex fallback covers the emit if the live `req` lacks the decision field). See
[`destructive-guard.derivation.md`](destructive-guard.derivation.md) honesty notes (a)/(b)/(c). Full
hash:
`∅ → b0b145b0cf56801e6eeb7cdfa59de19136a688857f15637c72e902ce177dda50`.

### 23 — development: STATE-SCHEMA PARITY — `state_schema(conformant)` required → optional (#57)

The first live L2 runs on Copilot 1.0.81 revealed that the model serializes `orchestrator-state.yml`
**off-schema** (bare-integer `completed_phases`, a top-level `status:` key with no top-level `task:`
block, floating `task_characteristics`) — a genuine lexical divergence from Claude's canonical output,
correctly surfaced by the `state_schema(off-schema)` LIMITATION. Investigation ([#57](https://github.com/robmar-net/maister/issues/57))
found the divergence **cosmetic, not functional**: maister's runtime routing/resume readers
(`development/SKILL.md:247` Phase-5 guard; `orchestrator-patterns.md:358-360` resume) are
model-interpreted and **semantic** ("is Phase N in `completed_phases`" resolves identically for
bare-int vs `phase-N` strings; writer and reader are the same session), so an off-schema state does
not misroute or fail resume. Requiring `state_schema(conformant)` therefore mis-categorized a
behavior-preserving serialization difference as a functional regression. **Demoted required→optional**
on workflow-model grounds (the readers are semantic — NOT fitted to the observed run). The divergence
remains **visible and tracked**: `state_schema(off-schema)` stays an allowlist LIMITATION (🟢 ADAPTED)
in every report + the matrix, and lexical parity (a deterministic post-write normalizer hook) is
tracked in #57. **HASH-NEUTRAL**: `conformant` moves within the `required∪optional` union that
`computeHash` digests, so the hash is unchanged (`9f431947…` → `9f431947…`) and `--check-reference`
stays CURRENT at v5.

### 24 — research: STATE-SCHEMA PARITY — `state_schema(conformant)` required → optional (#57)

Same rationale + mechanism as note 23, on the `research` reference. Surfaced by the first live research
run on 1.0.81 (2026-08-29, **13.21 AIU / 51 req** — the run that also confirmed Stage-5 live cost-read
and the `createSession({model})` pin threading, `model gpt-5.6-luna/unknown`). `conformant` demoted
required→optional; `state_schema(off-schema)` stays a visible allowlist LIMITATION. **HASH-NEUTRAL**
(`16c635b4…` → `16c635b4…`). Replaying that live bundle after the demotion yields **AS-EXPECTED —
14 PASS · 1 LIMITATION · 0 FAIL** (credit-free proof).

### 25 — development: WP-D CHEAP PREDICATES — `todos(created)` + `standards(index_read)` grammar heads + 2 dashboard artifacts (#76)

WP-D of the Parity-Map epic ([#76](https://github.com/robmar-net/maister/issues/76)) lands the first
batch of **cheap, credit-free predicates** — behaviors maister's development model mandates and the SDK
already surfaces, but the harness never measured. Two NEW grammar heads (`todos`, `standards`, both
1-arg literal, mirroring `task_status`) plus two entries under the EXISTING `created_artifact` head:

- `todos(created)` — the observable effect of the `TaskCreate`/`TaskUpdate` → `todos` transform
  (`development/SKILL.md:46` "Create Task Items"; `orchestrator-patterns.md` state schema). Extracted
  from `session.todos_changed` (single-shot census — emitted once if ≥1, never per-event, like
  `gate_count`).
- `standards(index_read)` — lazy standards discovery: a READ-tool read of `.maister/docs/INDEX.md`
  (`development/SKILL.md` Step 6 "Discover project documentation"; implementation-plan-executor lazy
  loading). Extracted from `tool.execution_start` with a READ_TOOLS filter (view/read/rg/glob/cat/grep)
  so `apply_patch` writes that merely MENTION the path in the state file are NOT counted as reads.
- `created_artifact(dashboard.html)` + `created_artifact(dashboard-data.js)` — the Operator Dashboard
  (`development/SKILL.md` Init Step 5 / § 8; produced at task root when `html_output=true`, the default).

**All four land OPTIONAL** (WP-D discipline: report/optional first, promote to required after ≥2 runs),
so a run lacking any of them (e.g. `html_output=false`) is AS-EXPECTED, never REGRESSED — zero
false-positive risk. **NOT fitted to a run**: every predicate cites the generated SKILL.md model line;
the real 1.0.82 dev bundle is the confirmation of *observability*, not the derivation.

**Credit-free proof**: replaying the persisted development 1.0.82 bundle (`reports/20260830T155522Z`,
the #63-item-9 run) after this landing yields **AS-EXPECTED — 37 PASS · 6 LIMITATION · 0 FAIL**, with
all four new tokens MATCHED (10 `session.todos_changed`, 27 INDEX.md reads, both dashboard files
present). Deferred to later WP-D increments (documented, tracked, NOT silent): `compaction(occurred)`
(no `session.compaction_*` event in ANY persisted bundle — belongs with the WP-C2 probe),
`parallel(...)≥2` (review agents run SEQUENTIALLY on 1.0.82 — the honest delta; needs verdict-semantics
+ ADR, overlaps #71), and the artifact-heading oracles (need a new file-content reader — WP-D2).

Hash re-stamp `77b935c1… → 8f99c546…` (schema_version 4→5 enters the digest via `schema:<n>`).

### 26 — research: WP-D LOCKSTEP re-stamp — schema 4→5 + wm 5→6, NO predicate change (#76)

Grammar-head additions (`todos`, `standards` in note 25) force the global `WORKFLOW_MODEL_VERSION`
5→6, so EVERY reference re-stamps its `workflow_model_version` (staleness keys on it) and
`schema_version` 4→5 (it enters `computeHash` via the `schema:<n>` token) to stay CURRENT. The
`research` reference gains NO predicate — `todos`/`standards`/dashboard are development-model behaviors
(research has no `.maister/docs` lazy-load step in scope here and no Operator Dashboard). **Mechanical
re-stamp only.** Hash `b30b1e64… → 2bc10f74…`. `--check-reference` CURRENT at wm v6.

### 27 — quick-bugfix: WP-D LOCKSTEP re-stamp — schema 4→5 + wm 5→6, NO predicate change (#76)

Same lockstep mechanism as note 26. `quick-bugfix` is events-only (no task tree, no state) and gains
no WP-D predicate. Mechanical re-stamp only. Hash `817a43ee… → f063ad0c…`. CURRENT at wm v6.

### 28 — destructive-guard: WP-D LOCKSTEP re-stamp — schema 4→5 + wm 5→6, NO predicate change (#76)

Same lockstep mechanism as note 26. The `destructive-guard` micro-scenario gains no WP-D predicate.
Mechanical re-stamp only. Hash `b0b145b0… → 3eb5626d…`. CURRENT at wm v6.

### 29 — development: WP-D2 ARTIFACT-STRUCTURE ORACLE — `outcome(spec|plan|verification-structure)` (#76)

WP-D2 of the Parity-Map epic ([#76](https://github.com/robmar-net/maister/issues/76)) moves the
"Artifact production — **content/structure**" map row off ⚪ (only existence was checked). A new
assertion-type outcome, `assert: 'artifact-headings'`, reads ONE produced artifact and asserts the
**Artifact Summary Contract** (`orchestrator-patterns.md § 7:408` — "every artifact opens with a
TL;DR"): the file's FIRST markdown heading is `## TL;DR`, and the file is non-stub (≥200 B). Three
oracles on the development deliverables: `outcome(spec-structure)`, `outcome(plan-structure)`,
`outcome(verification-structure)` (files `implementation/spec.md`, `implementation/implementation-plan.md`,
`verification/implementation-verification.md`).

**NO grammar bump**: `outcome` is a pre-existing head (Stage 2) — this reuses it, so `schema_version`
and `WORKFLOW_MODEL_VERSION` are UNCHANGED (v5 / v6); only the `development` reference re-stamps.

**Why the § 7 opener and NOT the body headings** (anti-fitting): the templates mandate body sections
(specification-creator `## Goal`/`## Core Requirements`/`## Success Criteria`;
implementation-planner `## Overview`/`## Standards Compliance`), but the real 1.0.82 run's WORDING
legitimately varies (`## Goal and User Journey`, `## Requirements`, `## Acceptance Criteria`,
`## Verification Results`) — asserting body headings would fit-to-run and false-fail. The § 7 `## TL;DR`
opener is the UNIFORMLY-mandated, run-stable invariant (Key Decisions / Open Questions are omit-when-
empty, § 7:425, so they are NOT asserted either). Derived from the contract, confirmed observable — not
fitted.

**Verdict semantics (no false REGRESSED on one bundle):** `outcome(<id>)=pass` lands **OPTIONAL**; the
matching `outcome(<id>)=fail` is **allowlisted as LIMITATION**. A well-structured run matches the
optional `=pass`; a structural miss surfaces the `=fail` as a VISIBLE tracked limitation, never a silent
green and never a false regression against an unproven-across-runs oracle. Promotion path: after ≥2 runs
confirm the § 7 opener on Copilot, promote `=pass` to required and retire the `=fail` allowlist entry.

**Credit-free proof**: replaying the persisted 1.0.82 dev bundle (`reports/20260830T155522Z`) yields
**AS-EXPECTED — 37 PASS · 6 LIMITATION · 0 FAIL**; all three oracles emit `=pass` (spec 2136 B, plan
1451 B, verification 1593 B — each opening with `## TL;DR`), matched as optional (LIMITATION stays 6,
not 9 → the `=fail` allowlist entries are not triggered). Hash re-stamp `8f99c546… → 93cb8144…`
(3 optional + 3 allowlist entries enter `computeHash`).

### 30 — quick-bugfix + research: WP-D CROSS-SCENARIO FIX — `standards`/`todos` are GLOBAL emits (#76)

**Corrects note 26.** Note 26 claimed "research gains no predicate" from the WP-D grammar heads. That
was WRONG: `todos(created)` and `standards(index_read)` are **event-sourced GLOBAL emits** (any run
whose events carry `session.todos_changed` / an INDEX.md read produces them), not development-only. #79
modeled them in the `development` reference ONLY, so on any OTHER scenario that reads
`.maister/docs/INDEX.md` they surfaced as an unmodelled `extra` → CANDIDATE_REGRESSION.

**Caught by the live sweep (2026-08-30):** the first live **quick-bugfix** drive on Copilot 1.0.82
(`reports/20260830T192629Z`, 1.53 AIU / 8 req) REGRESSED on a single FAIL — `standards(index_read)`
extra. quick-bugfix's SKILL.md **mandates** the read (`quick-bugfix/SKILL.md:52` Step 2 "Discover
Standards — Read `.maister/docs/INDEX.md` … this is mandatory"). Replaying the existing research
bundles (`20260829T235511Z`, `20260830T002503Z`) showed research emits **both** `standards:1` +
`todos:1` (research/SKILL.md:144 "Discover project documentation: Read `.maister/docs/INDEX.md`";
research has orchestrator phases with `TaskCreate`), so a live research drive would have regressed on
BOTH.

**Fix (credit-free, no grammar bump — heads already exist):** add `standards(index_read)` OPTIONAL to
`quick-bugfix`; add `standards(index_read)` + `todos(created)` OPTIONAL to `research`. Model-grounded
(SKILL.md citations above), OPTIONAL to match development's treatment. destructive-guard is unaffected
(guard-fire aborts before any doc read — its live drive `reports/20260830T192611Z` was AS-EXPECTED
2 PASS / 0 FAIL, 0.84 AIU).

**Credit-free proof:** post-fix replay flips quick-bugfix `20260830T192629Z` **REGRESSED → AS-EXPECTED
(4 PASS · 0 LIMITATION · 0 FAIL)** and research `20260829T235511Z` stays **AS-EXPECTED (13 PASS · 1
LIMITATION · 0 FAIL)** now matching standards+todos. Hash re-stamps: quick-bugfix `f063ad0c… →
1472c423…`, research `2bc10f74… → 6d811965…`. No schema/wm change (v5 / v6 hold).

### 31 — development: CONDITIONAL TDD PHASES — `phase_completed(3)` + `(9)` → optional (#76 live sweep)

The first live 1.0.82 development sweep run (`reports/20260830T195810Z`, 24.75 AIU / 120 req)
REGRESSED on a single FAIL: `phase_completed(3)` extra. The state recorded
`has_reproducible_defect: false` (so the required `task_characteristic(has_reproducible_defect)=false`
MATCHED — 37 PASS held) YET `completed_phases: [1,2,3,5,6,7,8,10,11,14]` includes **phase 3**: the
model exercised its latitude to run the **TDD Red Gate** (a bug-fix task) even with the characteristic
pinned false (gate "Continue to Phase 3: TDD Red Gate?" fired; `gate_fired_at(phase-3)` already
optional).

**Cause = harness modeling gap, NOT a maister failure.** Phases 3 (TDD Red) and 9 (TDD Green) are
DOCUMENTED conditional phases (`development/SKILL.md` Phase 3 activation "When has_reproducible_defect",
Phase 9 "When Phase 3 was executed") — but unlike the other conditional phases (6/12/13 already
optional), 3 and 9 were never modeled optional, because the scenario pins `has_reproducible_defect=false`
to intend the no-TDD path. The live run shows that pin is NOT absolute: the model retains latitude to
run TDD on a bug-fix. **Fix:** add `phase_completed(3)` + `phase_completed(9)` to `optional` — completing
the conditional-phase optional set. Model-grounded (both are real conditional phases), NOT fitted (the
run merely REVEALED the pin's non-absoluteness). No grammar/schema/wm change (v5 / v6 hold); dev-only
re-stamp `93cb8144… → 16f49e32…`.

**Also observed this run (NO change — the design working):** `outcome(spec-structure)=fail` surfaced as
a tracked LIMITATION (this run's spec.md did not open with `## TL;DR`), NOT a regression — exactly the
WP-D2 optional-`=pass`+allowlist-`=fail` semantics (CALIBRATION #29). This CONFIRMS the structure oracle
must stay OPTIONAL: it legitimately varies across runs, so `outcome(*-structure)=pass` is NOT promoted to
required (the ≥2-clean-runs criterion is not met — DEV82 passed, this run failed the spec opener).

**Credit-free proof:** replaying `20260830T195810Z` after the fix flips **REGRESSED → AS-EXPECTED
(37 PASS · 3 LIMITATION · 0 FAIL)** (the 3 LIMITATIONs: `reviews-spec-audit` fan-out,
`outcome(spec-structure)=fail`, `state_schema(off-schema)` — all pre-modeled/tracked).

### 32 — research: PRODUCT-CORRECTNESS oracle `outcome(research-answer)` (issue #88, A)

Issue #88 adds a **product-correctness** layer (c) on top of run-shape (a) and deliverable-works (b):
does the deliverable do the thing it was supposed to do — *correctly*. For research this is the first
such evidence (quick-bugfix already proves "found & fixed the planted defect"; research had none).

**Ground truth is planted OFFLINE in the sandbox — no network, no LLM judge** (binding anti-flake /
anti-fit rules, #88). `sample-cli` now carries ONE unreachable-but-implemented command: `cmd_frobnicate`
is defined in `cli.sh` and documented in the header + `README.md`, but has **no branch in the dispatcher
`case`** — so `sh cli.sh frobnicate x` prints `unknown command` (exit 2). The research prompt gains one
sentence: "determine whether any command that is implemented in the code is unreachable from the
dispatcher — if so, name it in the report." Answerable in the cheap codebase-only skip path (no web).

**Grader = new `assert:'report-contains'` extractor kind** (symmetric with `research-deliverables` /
`artifact-headings`; deterministic Node grep, no spend, no model). `outcome(research-answer)=pass` iff
`outputs/research-report.md` mentions token `frobnicate` **AND** matches >=1 of
`(unreachable|dead code|never (dispatched|called|reached)|not (wired|reachable|dispatched))`
(case-insensitive). Authored from the TASK SPEC before the first live run. A one-token grep can
false-pass (report names the token without concluding) — accepted as a cheap unambiguous FLOOR, not a
rubric; documented in the derivation.

**Governance:** reuses the existing `outcome` grammar head (like WP-D2 CALIBRATION #29) → **NO
schema/wm bump** (v5 / v6 hold). `outcome(research-answer)=pass` lands **OPTIONAL**; the matching
`=fail` is allowlisted as a tracked **LIMITATION** (promote `=pass` to required after >=2 clean runs).
research-only re-stamp `6d811965… → 0b07558d…`.

**Backwards-incomparable (matrix note):** bundles predating the `frobnicate` plant cannot pass this
grader — results are not comparable across the sandbox change.

**Credit-free proof:** replaying the pre-plant live research bundle `20260830T195404Z` (was 13 PASS · 0
LIMITATION · 0 FAIL) after the change flips to **AS-EXPECTED — 13 PASS · 1 LIMITATION · 0 FAIL**, the +1
LIMITATION being exactly `outcome(research-answer)=fail` (old report never mentioned `frobnicate`) —
surfaced as a tracked LIMITATION, NOT a false REGRESSED. Grader mechanics proven without spend. Live
`=pass` validation deferred to the next operator-approved sweep (~13 AIU).

**Housekeeping (this entry):** `research.derivation.md`'s header block carried pre-existing drift from
#79/#81 (it still read `workflow_model_version 5` / an even older sibling hash / "20 optional + 1
allowlist = 39 rows"). Refreshed to the current skeleton: wm 6, hash `0b07558d…`, section totals 13 + 23
+ 5 + 2 = 43. Cosmetic (the machine verdict keys on the SKELETON's hash/wm via `--check-reference`, not
the derivation header), corrected here rather than left knowingly stale while editing the file.

### 33 — development: PRODUCT-CORRECTNESS oracle `outcome(greet-edges)` (issue #88, B)

Adds parity layer (c) — deliverable is *materially correct* — to development, pinning the `--greet`
deliverable's edge behaviors as CHECKABLE surface (the run-shape and deliverable-works layers already
existed via `phase_*` / `outcome(tests-pass)`).

**Hardened edges (pinned in the development prompt):** `--greet "Ada Lovelace"` must print
`Hello, Ada Lovelace!` (multi-word preserved verbatim); bare `--greet` (no name) must exit non-zero AND
print `usage` to stderr. Existing behaviors (hello / upper / version / single-word greet) must not
regress — they remain in `run-tests.sh` behind the unchanged required `outcome(tests-pass)`.

**Oracle = new restaged command `sh run-edge-tests.sh`** (2 checks; POSIX sh; MEDIUM-5 restage so the
model cannot neuter it) → `outcome(greet-edges)=pass` iff both edges hold.

**DESIGN DECISION — separate optional oracle, NOT folded into required `outcome(tests-pass)`.** The
ticket's primary sketch was "+2 checks in run-tests.sh; tests-pass stops being 1-bit". Folding the
hardened bare-`--greet` edge into the REQUIRED `tests-pass` would make the KNOWN-GOOD 1.0.82 dev bundle
(`20260830T195810Z`, whose `--greet` prints `Hello, !` exit 0 — correct for the ORIGINAL task) fail a
required predicate → a **false REGRESSED** on credit-free replay, violating the binding "never a false
red" + "promote to required only after >=2 clean runs" rules (restated as binding in #88). So the edges
land as a SEPARATE `outcome(greet-edges)` — the ticket's explicitly-sanctioned "separate line"
alternative — OPTIONAL with `=fail` allowlisted, promoted after >=2 clean runs. `tests-pass` stays the
required, backwards-comparable feature check; it also now reports an informational k/N tally in its
evidence (the ticket's per-check-tally ask), which never changes its exit-code verdict.

**Governance:** reuses the existing `outcome` head → NO schema/wm bump (v5 / v6 hold). dev-only re-stamp
`16f49e32… → 19df242f…`. Derivation Optional/Allowlist rows added.

**Backwards-incomparable (matrix note):** bundles predating the hardened edges cannot pass `greet-edges`.

**Credit-free proof:** replaying `20260830T195810Z` after the change → **AS-EXPECTED — 37 PASS · 4
LIMITATION · 0 FAIL** (was 37 · 3 · 0). The +1 LIMITATION is exactly `outcome(greet-edges)=fail`
(evidence `1/2 checks` — multi-word ok, bare `--greet` broken), surfaced as tracked, NOT a false
REGRESSED; `outcome(tests-pass)=pass` (evidence `4/4 checks`) held. Live `=pass` validation deferred to
the next operator-approved sweep.

**Housekeeping (this entry):** `development.derivation.md`'s header block carried the same pre-existing
drift as research's (#79/#80/#82 never refreshed it): it read `workflow_model_version 5` / an old
sibling hash / "32 req + 33 opt + 21 rules + 6 allow = 92 rows". Refreshed to the current skeleton: wm 6,
hash `19df242f…`, section totals 32 + 43 + 21 + 10 = 106. Cosmetic (the verdict keys on the skeleton
hash/wm), corrected rather than left knowingly stale while editing the file.

### 34 — #88 FOLLOW-UP: research sandbox split + two harness-modeling gaps (first live #88 dev drive)

The first live #88 validation sweep on Copilot 1.0.82: **research** `20260831T123056Z` **AS-EXPECTED
13·1·0** (13.34 AIU) with **`outcome(research-answer)=pass`** — the model named the planted `frobnicate`
(cited `cli.sh:50-53` ROT13 vs dispatcher `cli.sh:58-68`, confirmed `frobnicate` → status 2) and
concluded "implemented but unreachable / dead". **development** `20260831T123617Z` produced
**`outcome(greet-edges)=pass`** (both hardened edges) + `tests-pass=pass` + all structure oracles — the
#88 dev oracle VALIDATED — but the run REGRESSED **36·3·2** on TWO gaps UNRELATED to #88 (each a
model-latitude / gate-phrasing surface, same class as WP-D #81/#82), plus revealed a sandbox-design issue
#88 introduced. All three addressed credit-free here; live `=pass` promotion still needs a 2nd clean run.

**(1) Sandbox split — the `frobnicate` plant leaked into development.** `sample-cli` was SHARED by
research + development; on the dev drive the implementation-verifier flagged `frobnicate` ("documented but
not dispatched") as a warning and ran an extra fix→re-verify cycle ("help now lists frobnicate"). Fix:
a DEDICATED `sandbox/sample-cli-research/` carries the plant (with exactly ONE discrepancy — the
dev-specific `--greet` test scaffolding + `run-edge-tests.sh` removed so `frobnicate` is unambiguous);
`sample-cli` reverted byte-identical to its pre-#88 (plant-free) state; `research.mjs`
`sandboxTemplate → sample-cli-research`. No reference/hash impact (sandbox name is not hashed);
research replay unaffected (assertion-type outcomes use no restage).

**(2) `gate_fired_at(phase-11)` missing → widen gateMap.** The Phase-11 fix→re-verify cycle phrased the
exit gate "**Verification recheck**: … Continue to Phase 14 finalization?", which the existing
`verification (passed|results|found|complete)` anchors miss. Added `recheck|re-?checked?` to the
alternation (development.mjs gateMap phase-11). Scenario-only (no reference/hash change).

**(3) `invoked_skill(quick-plan)` extra → allowlist LIMITATION.** The dev model additionally invoked the
maister `quick-plan` skill (Plan Mode) during planning — ALONGSIDE, not instead of, `implementation-planner`
(still delegated; precedes chain intact). NOT anchored in development/SKILL.md, so per the standing rule
(no SKILL.md citation → allowlist LIMITATION, never silently optional) it is allowlisted as a benign
in-family planning aid, not a mis-route. dev-only re-stamp `19df242f… → 6ba234a7…`.

**Credit-free proof:** replaying `20260831T123617Z` after (2)+(3) flips **REGRESSED 36·3·2 → AS-EXPECTED
37 PASS · 4 LIMITATION · 0 FAIL** (gate-11 now detected; quick-plan now a tracked LIMITATION;
`greet-edges=pass` held). check-reference ×4 CURRENT v6; suite green; make build byte-identical.
**Cost note:** the dev drive was 124 AIU / 187 req (premium `claude-sonnet-4.6` routing + review fan-out +
the frobnicate-triggered fix cycle) — vs 24.75 in WP-D; the sandbox split should reduce future dev cost.
**Deferred:** a 2nd clean live dev + research run (next sweep) to promote `outcome(greet-edges)=pass` /
`outcome(research-answer)=pass` from optional to required.

### 35 — #88 Product-correct: first live upstream-vs-fork sweep (1.0.82) — identical on both builds

Filled the **Product correct** comparison line. Same harness (our #88 scenarios + oracles), fork build vs
the untouched upstream `plugins/maister-copilot` (`SkillPanel/maister` @ `f75ef4f`, v2.2.3) via
`COMPAT_PLUGIN_DIR` (the documented control procedure, Why-This-Fork "How to repeat"). Credit-free code;
the drives spent real AIU (operator-approved).

| oracle | fork | upstream |
|---|---|---|
| `outcome(research-answer)` | ✅ =pass (`20260831T123056Z`, 13.34 AIU) | ✅ =pass (`20260831T131021Z`, 17.04 AIU) |
| `outcome(greet-edges)` | ✅ =pass (`20260831T123617Z`) | ✅ =pass (`20260831T131702Z`, 39.86 AIU) |

**Net: Product correct is IDENTICAL on both builds — the predicted, honest result** (product-correctness
is model×workflow, ~not the generator translation). Both upstream research/dev models named the planted
`frobnicate` + concluded unreachable, and implemented the hardened `--greet` edges correctly.

**The upstream dev run also demonstrates the fork's actual value in one shot:** it was product-correct
(`greet-edges=pass`) **while its WORKFLOW SHAPE regressed 27·3·10** — the entire maister subagent chain
(gap-analyzer / specification-creator / implementation-planner / task-group-implementer + their
precedes/min_count edges) MISSING, replaced by Copilot's generic `delegated(general-purpose)`. Upstream
produced a correct deliverable by BYPASSING the orchestration; the fork's generator makes the model run
the documented workflow (fork dev AS-EXPECTED 37·4·0 after PR #90). Product-correctness identical;
structure is where the builds diverge (consistent with the L2-development control-experiment row).

**Also confirmed:** the #88-follow-up sandbox split (PR #90) works in practice — the upstream research run
used `sample-cli-research` and its report cites "run-tests.sh checks only hello, upper, version" (no
`--greet` noise), so `frobnicate` was the sole, unambiguous discrepancy.

**Promotion status:** `=pass` stays OPTIONAL — the FORK has 1 clean live run each; the upstream runs are
the informational control, not counted toward promotion. A 2nd clean fork run (next sweep) promotes
`outcome(research-answer)=pass` / `outcome(greet-edges)=pass` to required. No reference/hash change (this
is an evidence entry, not a grammar edit). Sweep cost: ~57 AIU upstream (17.04 + 39.86) on top of the
~137 AIU fork validation.

### 36 — #88 PROMOTION: `outcome(research-answer)` + `outcome(greet-edges)` optional → REQUIRED (2 clean runs)

The WP-D2 promotion rule met: each product-correctness oracle passed on ≥2 clean live fork runs on
Copilot 1.0.82, so both `=pass` predicates are promoted from optional to REQUIRED and their `=fail`
allowlist LIMITATION entries retired. A future `=fail` (or absent `=pass`) is now a genuine
CANDIDATE_REGRESSION — the quality canary fires instead of being tracked silently.

| oracle | run 1 | run 2 | upstream control |
|---|---|---|---|
| `outcome(research-answer)=pass` | `20260831T123056Z` AS-EXPECTED (13.34 AIU) | `20260831T142630Z` AS-EXPECTED 13·1·0 (12.45 AIU) | `20260831T131021Z` =pass |
| `outcome(greet-edges)=pass` | `20260831T123617Z` (AS-EXPECTED 37·4·0 after the #90 harness fixes) | `20260831T143100Z` AS-EXPECTED 37·2·0 (74.09 AIU) | `20260831T131702Z` =pass |

**Governance:** reuses the `outcome` head → NO schema/wm bump (v5 / v6 hold). research re-stamp
`0b07558d… → e2464815…`; development re-stamp `574a23d4…` (was `6ba234a7…`). Derivations: rows moved
Optional→Required, allowlist rows removed, section counts + header hashes refreshed. Fixture updates
(the promoted required predicates must be present in the committed fixtures): pipeline snapshots
regenerated (`fixtures/{research,pipeline}/expected-skeleton.json` gain the `=pass` token); the
`pipeline`/`pipeline-research` tests inject `greet-edges`/`research-answer` `=pass` (EXPECTED_MATCHED
37→38 / 15→16); the three replay `GOOD_REPORT` fixtures (`replay`, `replay-multirun`, `run.test.mjs`)
now name `frobnicate`+unreachable so the RE-RUN oracle lands `research-answer=pass`.

**Credit-free proof:** suite 166 pass / 0 fail / 2 skip; `--check-reference ×4` CURRENT v6; make build
byte-identical. Post-change bundles replay AS-EXPECTED (research `20260831T142630Z` 14·1·0; development
`20260831T143100Z` 38·2·0 — the promoted predicate now a matched REQUIRED). **Backwards-incomparable:**
bundles predating the plant/hardening (e.g. research `20260830T195404Z`, pre-#88 dev bundles) now REGRESS
on the promoted required predicate — expected, they predate the workflow-model change and are not
re-judged.

### 37 — `work` FRONT-DOOR genesis (issue #85, #76 WP-E)

Genesis of the FIFTH scenario reference, `work.skeleton.json` — the documented ENTRY POINT
(`plugins/maister/commands/work.md`) that auto-classifies a task via the `task-classifier` subagent and
ROUTES it, rather than a workflow named directly. Model-derived (credit-free), NOT fitted to a run.

**Route-invariant required set (4).** Because the routed workflow is task-dependent (`work` "Workflow
Type Routing"), only the predicates that hold on every route are required: `invoked_skill(work)` (W:2-3,
the user-invocable entry skill), `delegated(task-classifier)` (W:6 — "invokes the task-classifier
subagent … at specific steps"; classification precedes every route), `outcome(bug-fixed)=pass` (the
Stage-2 functional oracle reused from quick-bugfix — the restaged `run-tests.sh` passes iff whatever
`work` routed to actually fixed the seeded `upper` defect), `reached_terminal(completion)`.

**Optional (5):** `invoked_skill(quick-bugfix)` (the EXPECTED route for a small scoped bug, but the
classifier may pick `development` — both fix it), plus `gate_fired(ask|permission|exit_plan_mode)` and
`standards(index_read)` (all belong to the routed workflow / platform, task-dependent). `rules[] = []`
(no phase gate invented at the entry-point layer). `allowlist[] = []` at genesis.

**Governance:** reuses existing grammar heads (`invoked_skill`/`delegated`/`outcome`/`reached_terminal`)
→ NO schema/wm bump (schema_version 5 / workflow_model_version 6 hold). Hash `∅ → b7f60681…` stamped via
`compare.computeHash`. Tree profile `work` added (empty/no-match, mirroring quick-bugfix — the routed
workflow owns its tree; unmodelled here). Wiring: `run.mjs` SCENARIOS + `run.sh` scenario→sandbox
(`sample-cli-bug`) + `l2-check.yml` `--check-reference`. Sandbox reused (`sample-cli-bug`).

**Live calibration (N=1, Copilot 1.0.82, bundle `20260903T003148Z`, 18.92 AIU).** The classifier routed
this "upper prints lowercase" bug to the FULL `development` workflow (a documented route, not the quick
path) and fixed it. All 4 route-invariant REQUIRED predicates matched — `invoked_skill(work)`,
`delegated(task-classifier)`, `outcome(bug-fixed)=pass`, `reached_terminal(completion)` — proving the
front door routes + the routed workflow produces the correct deliverable. The 16 development-route
predicates the run emitted (`invoked_skill(development|codebase-analyzer|implementation-plan-executor|
implementation-verifier|reviews-code|reviews-spec-audit)`, `delegated(explore|codebase-analysis-reporter|
gap-analyzer|specification-creator|spec-auditor|implementation-planner|task-group-implementer|
implementation-completeness-checker|code-reviewer)`, `todos(created)`) were moved required-side-untouched
into `optional` — model-grounded (each is a documented `development` marker, present in that scenario's own
reference), NOT fitted: they are optional because the route is task-dependent, so a future quick route
simply leaves them unobserved. Re-hash `b7f60681… → 59659cc3…`; the bundle now replays **AS-EXPECTED
4·0·0**. `∅ → b7f60681… → 59659cc3…` | PR (#85)

### 38 — `init` FIRST-TOUCH genesis (issue #85, #76 WP-E)

Genesis of the SIXTH scenario reference, `init.skeleton.json` — the framework-bootstrap entry point
(`skills/init/SKILL.md`), which analyses the project and builds the `.maister/docs/**` reference tree.
`init`, `project-analyzer` and `docs-manager` were ⚪ (never observed on Copilot). Model-derived
(credit-free), NOT fitted.

**Required (6):** `invoked_skill(init)` (I:1-3), `delegated(project-analyzer)` (I:49 — Task-tool codebase
analysis), `delegated(docs-operator)` (I:11/:112/:160 — all docs-manager ops run via the docs-operator
subagent), `created_artifact(INDEX.md)` (I:167 "Verify INDEX.md exists"), `outcome(init-structure)=pass`
(Stage-2 functional oracle: `.maister/docs/INDEX.md` non-trivial — exists with ≥5 non-blank lines, no
restage since init CREATES the tree), `reached_terminal(completion)`. **Optional (5):**
`invoked_skill(standards-discover)` (I:11 Phase-8 via Skill tool), `gate_fired(ask|permission|exit_plan_mode)`,
`standards(index_read)`.

**New sandbox + extractor capability.** `sample-cli-bare` (the sample CLI with NO `.maister/`) so init
bootstraps from scratch. `TREE_PROFILES.init` adds a `rootRel: .maister/docs` override to `findTaskDirs`
— the FIRST profile whose `created_artifact` root is not `.maister/tasks/<taskType>` — so INDEX.md is read
from the docs tree init writes. Harness change (not a reference edit), covered by unit suite.

**Governance:** reuses existing grammar heads → NO schema/wm bump (schema 5 / wm 6 hold). Hash
`∅ → 1984d7d6…` via `compare.computeHash`. Wiring: `run.mjs` SCENARIOS + `run.sh` scenario→sandbox
(`sample-cli-bare`) + `l2-check.yml` `--check-reference` + `run-sh` test check-5.

**PROVISIONAL — live calibration pending (spend-gated, ~5-15 AIU).** The optional/allowlist partition is
the model-derived expectation; the N=1 live drive (`run.sh --scenario=init --yes`) calibrates it and
records the AS-EXPECTED verdict + AIU (the quick-bugfix/`work`-genesis pattern). `∅ → 1984d7d6…` | PR (#85)
