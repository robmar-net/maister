# ADR 0004 — `phase_completed(N)` is derived from execution witnesses, never from `orchestrator-state.yml`

- **Status:** Accepted — 2026-09-03
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#71](https://github.com/robmar-net/maister/issues/71) (split from [#63](https://github.com/robmar-net/maister/issues/63) item 10), [#76](https://github.com/robmar-net/maister/issues/76)
- **Related:** [ADR 0001](0001-copilot-orchestrator-state-conformance.md) (off-schema state), [#57](https://github.com/robmar-net/maister/issues/57), [AGENTS.md](../../AGENTS.md) "Parity, and honest knowledge of the gaps", CALIBRATION note 39

## Context

L2's verdict is a comparison of an observed predicate skeleton against a workflow-model reference. Until
now one family of *required* predicates — `phase_completed(N)` — was read from
`orchestrator-state.yml`: the single artifact Copilot demonstrably **diverges on**. ADR 0001 and #57
document that divergence (no top-level `task:` block, bare-integer `completed_phases`,
`phase_summaries`-derived completion, key variance), and the harness answered it with an increasingly
tolerant parser plus a union of completion signals.

That is the wrong direction of travel. A tolerant parser makes the verdict depend on how well we
guessed the shapes an LLM might serialize next; a shape we have not seen yet becomes a false
INCOMPLETE (the MEDIUM-2 sanity floor) or a false REGRESSED (a required token missing). The parity
stance we actually want is stronger and simpler: **do not depend on the thing the platform diverges
on.**

## Decision

`phase_completed(N)` is emitted **only** from execution witnesses — the phase's own documented
footprint in the event stream and the task tree.

- Each scenario declares a `phaseWitnesses` map (`l2/scenarios/development.mjs`, `l2/scenarios/research.mjs`),
  every entry citing the phase's SKILL.md **Execute**/**Output** lines. A phase is emitted only when
  *all* of its witnesses are observed.
- `extractor.witnessedPhaseRecords` runs over the event+tree records and stamps `source: 'witness'`,
  so the report says where each token came from. Matching tolerates the `maister:`/`maister-copilot:`
  plugin prefix and supports the `verification/*` prefix form — the same two normalizations
  `normalize.mjs` applies later, and nothing else.
- The state parse **stays**, for `task_characteristic`, `task_status`, the `state_schema(conformant|off-schema)`
  conformance token and report diagnostics. It has **zero verdict weight**: it can neither add a phase
  the run did not leave a footprint for, nor remove one it did (both directions are unit-asserted).
- The MEDIUM-2 sanity floor keys on the witness derivation, and applies only to scenarios that model
  phases at all (`quick-bugfix`, `destructive-guard`, `work`, `init` declare no map and emit none).

## The tradeoff this ADR exists to record

#71 required an explicit decision on phases with **no unique witness**. Ours, per phase:

| Phase | Witness | Honest reading |
|---|---|---|
| dev 1, 2, 5, 7, 8, 11 · research 1, 3, 5 | delegation(s) + the phase's documented artifact(s) | **Strong.** Independent, falsifiable, model-cited. |
| dev 10 (Verification Options Prompt, SKILL.md:395) | `gate_fired_at(phase-10)` | **Direct but wording-sensitive.** The phase's documented Execute *is* the `AskUserQuestion` prompt, so the gate is not a proxy — it is the whole footprint. It does inherit gateMap regex sensitivity ([#75](https://github.com/robmar-net/maister/issues/75) was exactly that). Accepted: the regex is derived from SKILL.md's own wording and widened only against the model, never fitted to a run. Observed present in both live 1.0.82 development bundles. |
| dev 14 (Finalization, :538) · research 6 (Completion, :357) | `reached_terminal(completion)` | **Corroborative, not detecting.** Neither phase writes an artifact; the terminal predicate is already required, so these tokens cannot fail while it passes. Kept for map continuity and labelled tautological — the same honesty the Parity-Map applies to "Terminal completion". |
| research 2 (Optional Phases Decision, :204) | *none* | **Coverage loss, accepted and documented.** Its only documented Output is "Updated `orchestrator-state.yml`" — under witness derivation it is unobservable. It is `optional` in the reference, so no verdict changes; the committed research fixture snapshot drops the token. Re-modelling it would mean reading state for exactly one predicate, i.e. keeping the dependency this ADR removes. |
| research 4 (Solution Convergence, :267) | `gate_fired_at(phase-4)` | Same class as dev 10; `optional`, so the sensitivity carries no verdict risk. |

The alternative we rejected — "keep a narrow state read for exactly the unwitnessable phases, clearly
labelled" (#71's option B) — buys one optional research token at the price of leaving a state
dependency in the extractor forever. Given the whole point is that off-schema state can never move the
verdict, the coverage loss is the cheaper, more honest side of the trade.

## Consequences

- **A state file that lies or fails to parse cannot move the verdict.** Off-schema serialization is now
  purely a reported conformance fact (`state_schema(off-schema)`, a tracked LIMITATION), not a verdict input.
- **Skeletons are reproducible from events + tree alone**, which is also what makes credit-free replay
  trustworthy.
- **Predicate-frozen and hash-neutral.** No reference JSON was edited; no grammar head was added; no
  `schema_version`/`workflow_model_version` bump (the workflow model did not change — its *measurement*
  did). `--check-reference ×4` stays CURRENT at wm v6.
- **Verified neutral on every persisted bundle.** All six were replayed before and after: verdicts
  identical (development 38·7·0 AS-EXPECTED and 37·3·3 REGRESSED; quick-bugfix 4·0·0; destructive-guard
  1·0·1 REGRESSED; work 4·0·0; init 6·0·0 — the two REGRESSED are pre-existing baselines). Suite 179
  pass / 0 fail / 2 skipped, including `test/witness-phases.test.mjs`, which asserts that every required
  `phase_completed(N)` in the committed references has a witness relation.
- **New maintenance duty:** an upstream SKILL.md change that renames a phase's documented artifact or
  delegation now moves a phase token. That is the intended failure mode — it surfaces as a diff against
  the model instead of being absorbed silently by a tolerant parser — and the `phaseWitnesses` map is
  the single place to re-cite.
