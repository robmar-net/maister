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
