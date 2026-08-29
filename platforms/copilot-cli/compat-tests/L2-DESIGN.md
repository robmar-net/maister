# L2 — Workflow-Model Conformance Testing (Design / RFC)

*(formerly: Trace-Equivalence Testing)*

> **Status:** ✅ **Implemented + conformance-verified live.** The harness ships in [`l2/`](l2/)
> (`make test-l2`); all **three scenarios'** predicate skeletons **conform** to their committed
> workflow-model references on live **Copilot CLI 1.0.81** runs — **development AS-EXPECTED
> (25/25, post-#46 parser fix)**, **research AS-EXPECTED (9/9)**, **quick-bugfix AS-EXPECTED
> (2/2 — judged pre-calibration; see CALIBRATION-LOG note 4)**. Scenarios are selected with `--scenario=<id>`; each has a model-derived committed
> reference. The `--runs=N` noise-calibration mode is built + credit-free-tested; the live
> **N=3** band-measurement is deferred (monthly Copilot AI-credit quota).
> The design below is retained as the rationale of record; where the build refined it, notes say so.
> **Layer:** L2 of the Copilot-CLI compatibility framework. L0 (wiring) and L1 (hook
> effects) already ship; see [`README.md`](README.md) and [`L1-FINDINGS.md`](L1-FINDINGS.md).
> **Upstream framework proposal:** SkillPanel/maister#9 · **Epic:** robmar-net/maister#3

## TL;DR

- **What:** the highest layer of the compat framework — assert that the **generated
  `maister-copilot` plugin, driven on GitHub Copilot CLI, conforms to maister's documented
  workflow model**, well enough to catch a regression when a new Copilot
  release (or a generator change) silently breaks something.
- **Why a whole layer:** conformance-to-model checking ≈ regression detection. We **cannot predict
  where** a break will land, so a narrow check ("just test hooks") gives false confidence.
  L2 casts the **broadest observable net** and compares it at a level that survives LLM
  non-determinism.
- **How, in one line:** run each workflow **N times**, reduce every run to a **set of
  boolean predicates** (a "trace"), keep only the predicates that are **stable across the N
  runs** (the "skeleton"), and diff the skeletons. Stable-within-platform but
  different-across = a real divergence; anything inside the noise = ignore.
- **Baseline model (decided):** **Conformance** — derive an expected skeleton once (the
  reference), version it to a maister release, then routine L2 runs only exercise **Copilot**
  and check against that reference. (The alternative — running Claude live every time —
  is more expensive and adds Claude's own noise; see §5.)
- **Cost:** expensive (N × workflows × many subagents). Runs **occasionally** (major Copilot
  releases / larger generator changes), unlike cheap-and-often L0/L1.

## Key decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Baseline model | **Conformance** (derive + version a reference skeleton; routine runs exercise Copilot only) | Half the cost of live-differential; removes Claude's non-determinism and Claude's gate-driving problem from the loop. See §5. |
| Sample size `N` | **Adaptive: start at 3**, extend only if the 3 runs are highly divergent | Cheap common case; spend more samples only where the noise band is actually wide. See §4. |
| Trace representation | **Set of predicates**, not a raw tool-call transcript | Predicates are stable under legitimate non-determinism; transcripts are not. See §3. |

---

## 1. Guiding principle

**Conformance to the workflow model ≈ regression detection.** A regression is a break in
conformance versus a known-good baseline. Because we cannot predict *where* a future Copilot version — or
a generator change — will break the generated plugin, any narrow checker gives false
confidence. So the design goal is to capture the **broadest observable execution trace** and
compare it; a wide net catches the unknown-unknowns.

The remaining art is comparing at a level that is **stable under legitimate
non-determinism** — both engines are LLM-driven, so a raw content or tool-by-tool diff is
always non-empty and meaningless. L2's whole design is about picking that level.

## 2. Where L2 sits

| Layer | Question it answers | Cost | Cadence |
|-------|---------------------|------|---------|
| **L0** — wiring (`make test-copilot`) | Does the generated plugin *load & register* (plugin/skills/agents/task/skill/hooks/mcp)? | cheap, deterministic | every build / Copilot version |
| **L1** — hook effects (`make test-hooks`) | Does each hook have the *right effect* (and where is it a no-op)? | cheap, deterministic | every build / Copilot version |
| **L2** — workflow-model conformance (this doc) | Does a *whole workflow run* conform to the documented workflow model end-to-end? | expensive | occasionally (major Copilot release / large generator change) |

L0/L1 are the fast guardrails. L2 is the deep, occasional conformance check that also covers
everything L0/L1 don't explicitly assert (phase ordering, delegation graph, gate placement,
artifact production, terminal success).

## 3. Core idea: a trace is a *set of predicates*

Comparing raw tool-call sequences is hopeless — even two runs of the *same* workflow on the
*same* platform differ a lot (wording, question count, order of parallel agents). So a
"trace" is **not** a transcript. It is a **set of discrete boolean predicates** extracted
from the run's artifacts and logs. Examples:

```
phase_completed(5)                         # from orchestrator-state.yml: completed_phases
task_characteristic(ui_heavy) = false      # gap-analyzer output written to state
delegated(gap-analyzer)                     # a task/agent_type call appeared in the log
delegated(specification-creator)
invoked_skill(codebase-analyzer)
created_artifact(implementation/spec.md)    # task-dir tree
gate_fired_at(phase-5)                       # GATE PLACEMENT (§3.2): a mandatory ask gate fired on
                                             # phase 5 — the extractor's per-scenario gateMap regex
                                             # placed the user_input.requested question on its phase.
                                             # IS a grammar head (GRAMMAR_HEADS, normalize.mjs:46).
gate_count(ask) = 7                          # REPORT-ONLY census (§3.2): K ask gates fired this run.
                                             # Grammar head (normalize.mjs:47) but never modelled /
                                             # never diffed — a variable K is not a regression.
outcome(tests-pass) = pass                   # FUNCTIONAL ORACLE (§3.1): the scenario's deliverable
                                             # actually runs and passes — asserted post-drive in the
                                             # rundir. IS a grammar head (GRAMMAR_HEADS, normalize.mjs:47),
                                             # unlike hook_effect below.
hook_effect(destructive_guard = ask)         # illustrative ONLY — hook_effect is intentionally
                                             # outside the implemented L2 grammar (GRAMMAR_HEADS,
                                             # normalize.mjs:38-48); hook behaviour is L1's concern
reached_terminal(completion)                 # workflow finished, not stalled/errored
```

Predicates are **far more stable across runs** than sequences, and they are exactly the
"broad observable net" we want. Two sources feed them:

- **Artifact trace** — the filesystem the workflow produces: the task-dir tree plus the
  structured fields of `orchestrator-state.yml` (`completed_phases`, `task_characteristics`,
  `options`). High-signal and platform-independent (the same workflow writes the same
  artifacts regardless of engine, modulo content).
- **Execution trace** — the delegation/gate/hook events, extracted from the run log: which
  agents/skills were invoked, where the run gated for the user, which hooks fired and with
  what effect, and whether it reached terminal success.
- **Functional-oracle trace** *(added issue #48, Stage 2)* — the `outcome(<id>)` predicate: the
  scenario's produced deliverable is actually **run** and checked to work. Unlike the two traces
  above (which observe *that the workflow moved*), the oracle observes *that the work is correct*.
  See §3.1.
- **Gate-placement trace** *(added issue #48, Stage 3)* — the `gate_fired_at(phase-N)` and
  report-only `gate_count(ask)=K` predicates: they enrich the execution trace's raw `gate_fired(ask)`
  by placing each fired mandatory gate on **the phase it belongs to** and counting the run's gates.
  Coupled to the state trace by a conditional `rules[]` promotion so a phase that completed without
  firing its mandatory exit gate is REGRESSED. See §3.2.
- **Order / fan-out / schema trace** *(added issue #48, Stage 4)* — three heads that harden the
  execution trace's shape: `precedes(a,b)` (an ADJACENT delegation-order edge), `min_count(delegated(x))=K`
  (a fan-out floor), and `state_schema(conformant|off-schema)` (state-serialization conformance). Plus a
  **credit-free replay** path that reproduces any recorded verdict from a persisted bundle. See §3.3.

**Granularity is the whole game.** Too fine (exact args, exact ordering) → even same-platform
runs disagree → the skeleton is empty → no signal. Too coarse (just "did it finish") → real
regressions slip through. Predicate sets are the sweet spot; the exact predicate schema is an
open item (§12).

### 3.1 The functional oracle — `outcome(<id>) = pass | fail`

*(issue #48, Stage 2; `WORKFLOW_MODEL_VERSION` bumped 1→2)*

The state/event/tree traces confirm a workflow **moved** — phases completed, agents delegated,
artifacts appeared. They do **not** confirm the deliverable **works**: a run can produce a
`spec.md`, an `implementation-plan.md`, and touched source files, reach terminal success, and
still ship a broken feature. `outcome(<id>)` closes that gap. It is a **grammar head**
(`GRAMMAR_HEADS`, [`normalize.mjs:47`](l2/normalize.mjs)) — it **is** part of the implemented L2
grammar (unlike the illustrative `hook_effect`, which is intentionally *outside* it and remains
L1's concern). Its token shape mirrors `task_characteristic`: a free-form id and a boolean-ish
value, `outcome(<id>)=pass|fail` ([`normalize.mjs:111-113`](l2/normalize.mjs)). It asserts one
thing: **the scenario's deliverable actually runs and succeeds**, evaluated **post-drive /
pre-cleanup in the throwaway rundir**.

#### Trust model

The oracle executes model-adjacent code, so it is built to be **un-neuterable by the model under
test** ([`extractor.mjs:478-617`](l2/extractor.mjs)):

- **Where it runs.** Post-drive, pre-cleanup, in the throwaway rundir, with `cwd = rundir`
  ([`extractor.mjs:543-547`](l2/extractor.mjs)). The rundir is discarded after extraction.
- **Restaged oracle (MEDIUM-5 tamper-resistance).** For command-type outcomes the trusted
  script (default `run-tests.sh`) is **re-copied from the committed sandbox template over the
  model-touched rundir copy** immediately before it runs
  ([`extractor.mjs:528-539`](l2/extractor.mjs)). The model's own copy of the oracle is discarded,
  so it cannot weaken its own test.
- **Commands are committed, never model-authored.** Every command string and assertion lives in
  the committed scenario files ([`l2/scenarios/*.mjs`](l2/scenarios/)), not in anything the model
  produced.
- **Sandboxed execution.** 30 s fixed POSIX-`sh` timeout
  (`OUTCOME_TIMEOUT_MS = 30000`, [`extractor.mjs:491`](l2/extractor.mjs)), no network, `sh -c`
  only.

Per scenario:

| Scenario | id | Oracle | Pass condition |
|----------|----|--------|----------------|
| **development** | `tests-pass` | `sh run-tests.sh` (restaged) | exit 0. The sandbox `run-tests.sh` includes a `--greet` deliverable check that **fails on the pristine tree** (HIGH-3), so the oracle only passes when the workflow genuinely added the feature — real detection power, not a rubber stamp. |
| **quick-bugfix** | `bug-fixed` | `sh run-tests.sh` (restaged) | exit 0 — requires the seeded `upper` bug to be fixed. |
| **research** | `report-produced` | `research-deliverables` content assertion | `outputs/research-report.md` present and **≥ 200 bytes / ≥ 5 non-blank lines / ≥ 1 markdown heading**, **and** `analysis/synthesis.md` present ([`extractor.mjs:567-598`](l2/extractor.mjs)). |

#### Fail-closed semantics

- **Any non-pass is a `fail`.** Mismatch, fails-to-run (ENOENT), or timeout all normalize to
  `outcome(<id>)=fail` ([`extractor.mjs:552-562`](l2/extractor.mjs)) → a **candidate regression**
  → **REGRESSED**, never a silent pass.
- **Outcome-aware short-circuit (MEDIUM-2 → MEDIUM-4).** The sanity floor that downgrades a
  "zero completed phases but artifacts exist" run to **INCOMPLETE** is now **suppressed when any
  outcome failed** ([`extractor.mjs:644-649`](l2/extractor.mjs)): a failing functional oracle is
  the most trustworthy signal we have and must surface as **REGRESSED**, not be masked as an
  inconclusive INCOMPLETE.
- **Id-namespace guard is HYGIENE, not floor protection.** Outcome ids may not start with
  `phase_completed` / `task_characteristic` / `task_status` (`OUTCOME_ID_NAMESPACE_GUARD`,
  [`extractor.mjs:493-512`](l2/extractor.mjs)). This only keeps ids from shadowing state-predicate
  namespaces in reports/derivations — it protects **no floor**: an emitted `outcome(...)` token
  can never match the `STATE_SOURCED` / widened-F3 regex regardless of its id.
- **Model-version bump.** Adding a required predicate to the grammar is a workflow-model change,
  so `WORKFLOW_MODEL_VERSION` is bumped **1→2** ([`compare.mjs:29`](l2/compare.mjs)); a reference
  stamped v1 now reads as stale and forces a re-derive ([`compare.mjs:207-222`](l2/compare.mjs)).
  All three references were re-stamped and each edit logged in
  [`l2/reference/CALIBRATION-LOG.md`](l2/reference/CALIBRATION-LOG.md) entries **#10 (development),
  #11 (research), #12 (quick-bugfix)**.

### 3.2 Gate placement — `gate_fired_at(phase-N)`, `gate_count(ask)=K`, and the `rules[]` contract

*(issue #48, Stage 3; `WORKFLOW_MODEL_VERSION` bumped 2→3. Demonstrated credit-free over an enriched
recorded fixture — **NO live run**.)*

The execution trace already records **that** an interactive gate fired (`gate_fired(ask)` — a
**required** predicate in every reference). It does **not** record **where**: maister's orchestrators
place a MANDATORY GATE at each phase exit, and a silently-dropped gate on the *executed* path is
exactly the kind of conformance break L2 exists to catch. Stage 3 makes gate placement a first-class,
verified decision with two new grammar heads, a conditional promotion rule, a deterministic
gate-answerer, and a report section.

#### The two heads

Both are grammar heads — in **both** `GRAMMAR_HEADS` and `buildToken`
([`normalize.mjs:38-50`](l2/normalize.mjs), [`:107-113`](l2/normalize.mjs)) — so a head present in one
but not the other would silently drop the token (the dead-entry trap):

- **`gate_fired_at(phase-N)`** — a mandatory `ask` gate fired on phase `N`. The payload is the
  **literal phase tag** `phase-N` (NO `normalizePhase` strip — the tag *is* the payload, not a bare
  number), mirroring `gate_fired`/`phase_completed`.
- **`gate_count(ask)=K`** — `K` interactive `ask` gates fired this run. Mirrors the `=value` heads
  (`task_characteristic`/`outcome`). It is **REPORT-ONLY** (see below).

#### Placement — the extractor `gateMap`

The extractor widens its `user_input.requested` handling
([`extractor.mjs:334-355`](l2/extractor.mjs)) to run a **per-scenario `gateMap`** — an ordered
`[{re, phase}]` list of case-insensitive regexes over the gate's `data.question`. On the **first**
matching regex it emits `gate_fired_at(phase-<phase>)`; it **always** also pushes the unconditional
`gate_fired(ask)` (that required predicate must never be lost — the phase gate is *additional*, not a
replacement). After the event loop, **exactly once**, if ≥1 `user_input.requested` was seen it emits
`gate_count(ask)=K` with `K` = the count of those events ([`extractor.mjs:375-380`](l2/extractor.mjs)).
`gateMap` rides the same threading seam as Stage-2's `outcome` — `extractFromEvents(events, gateMap = [])`
([`extractor.mjs:303`](l2/extractor.mjs)), defaulted `[]` so callers that pass no map are unaffected
(no `gate_fired_at`, only `gate_fired(ask)` + `gate_count`).

The regexes are **derived verbatim from each phase's distinctive MANDATORY-GATE prompt in the
scenario's SKILL.md, never fitted to a run** (development `gateMap`: phases 2–13; research: phases
1, 4, 5; quick-bugfix: `gateMap = []` — its plan-mode gate is Step-numbered, not phase-numbered, so no
`gate_fired_at` is invented). This is the same discipline as reference derivation (§5): the workflow
model is the source of truth.

#### `gate_count(ask)=K` is REPORT-ONLY

`K` is inherently variable across legitimate runs, so it must never be diffed. It is emitted, surfaced
in the observed skeleton and the `## Gates` report section, but placed in **no** reference
`required`/`optional` and therefore **never** in `computeHash`. `compare` excludes the whole
`gate_count(` head from the `extra` diff via `isReportedOnly(p)`
([`compare.mjs:61-63`](l2/compare.mjs), [`:113-115`](l2/compare.mjs)), so any `K` is structurally
incapable of classifying as a CANDIDATE_REGRESSION. (Rejected alternative: model `K` as `optional` —
exact-match `optional` pins one `K`, so every other `K` becomes an unmodeled extra → false REGRESSED.)

#### The `rules[]` contract — a completed phase must fire its mandatory gate

A fired-somewhere gate is not enough; conformance requires the gate to fire **on the phase that
completed**. Each reference carries a conditional `rules[]` of shape
`{ when: "phase_completed(N)", require: "gate_fired_at(phase-N)" }`, **derived from the SKILL.md gate
markers, never fitted to a run**. `compare` expands these into synthetic required predicates
([`compare.mjs:94-104`](l2/compare.mjs)): for each rule whose `when` is **observed**, its `require` is
promoted into `effectiveRequired`. A rule whose `when` is **absent** adds nothing — a gate that
legitimately never fires (its phase never ran) must not false-alarm. The consequence:

> a phase that **completed** on the executed path but **did not** fire its mandatory exit gate leaves
> its promoted `require` in `missing` → CANDIDATE_REGRESSION → `overall = REGRESSED`,
> `exitCode = EXIT.REGRESSED`. A silently-dropped mandatory gate can no longer pass as conformant.

**Completed ∩ ruled coupling invariant.** A `gate_fired_at(phase-N)` is promoted to *required*
**only when both** hold: `phase_completed(N)` is observed **and** phase `N` has a rule (is *ruled*).
So the two sets that matter are each scenario's `completed_phases ∩ ruled` — dev
`{1,2,5,6,7,8,10,11,14} ∩ {2..13}` = **{2,5,6,7,8,10,11}**; research `{1..6} ∩ {1,4,5}` = **{1,4,5}**.
Every such phase's gate event must carry the verbatim SKILL text its `gateMap` regex matches, or the
promoted-required predicate goes missing (a self-inflicted REGRESSED). Symmetrically, every **fireable**
`gate_fired_at(phase-N)` (every phase in that scenario's `rules[]`) is **also modelled `optional`** in
the reference: this keeps a gate that fired on an *un-completed* / off-path phase from classifying as
an unmodeled `extra` (the same treatment as `gate_fired(permission)` / `gate_fired(exit_plan_mode)`).
The `optional` row absorbs the off-path case; the `rules[]` row enforces the on-path case.

#### Governance — Option-A rules-in-hash + version bumps + CALIBRATION triad

Adding `rules[]` to a reference is a workflow-model change, so it is governed like every other
reference edit (§6):

- **Rules-in-hash (Option A).** `computeHash` appends one sorted `rule:<when>=><require>` token per
  rule ([`compare.mjs:181-194`](l2/compare.mjs)), so a `rules[]` edit re-stamps the hash. **Critically,
  ZERO tokens when `rules` is absent/empty** — `rules:[]` hashes identically to a rules-field-absent
  reference, protecting the pre-Stage-3 fixtures and quick-bugfix's empty-rules reference.
- **`schema_version` 1→2** across all three references, so an old reference re-stamps cleanly.
- **`WORKFLOW_MODEL_VERSION` 2→3** ([`compare.mjs:29`](l2/compare.mjs)); `check-reference` keys
  staleness on it, so a v2 reference reads as stale and forces a re-derive.
- **Pinned-hash triad.** New hashes recomputed under the staged algorithm and pinned per reference
  (development `ea0a5951…`, research `40378fab…`, quick-bugfix `0893abf4…`); each edit is logged in
  [`l2/reference/CALIBRATION-LOG.md`](l2/reference/CALIBRATION-LOG.md) entries **#13 (development),
  #14 (research), #15 (quick-bugfix)**, with SKILL.md gate-marker citations, the Option-A / version-bump
  rationale, and the full `hash old→new`, plus matching `*.derivation.md` `## Rules (N)` rows.

#### Deterministic answering — `chooseAnswer` + `## Gates`

Gates must be **answered** (never suppressed via `--no-ask-user`, which would remove the very placement
we verify — §7), the same way every run, without a Copilot seat to prove routing. The inline responder
is extracted to a module-level, exported, unit-testable `chooseAnswer(req, answerMap)`
([`run.mjs:127-146`](l2/run.mjs)): it scans the scenario's `answerMap` (`[{re, choice, phase?}]`,
first-match-wins) against `req.question`, resolving the mapped `choice` against `req.choices` (else
freeform) → `{ matched:true, mappedPhase, fallback:false }`; an unmatched question falls to the
deterministic floor `choices?.[0] ?? 'yes'` → `{ matched:false, fallback:true }` — a **visibly-flagged
`responder_fallback`**, so a drifted or unmodeled gate prompt surfaces instead of being silently
absorbed. Each answered gate is captured in a per-run `gateLog` sink
([`run.mjs:724`](l2/run.mjs), [`:743-753`](l2/run.mjs)) that feeds a report **`## Gates`** section
([`run.mjs:515-527`](l2/run.mjs)) — a `Question · Answer given · Mapped phase · Source` table in call
order, fallback rows tagged `responder-fallback` — plus glossary bullets for both new heads
([`run.mjs:581-582`](l2/run.mjs)).

#### Acceptance — fixture-based, no live run

Stage 3 is proven **credit-free over an enriched recorded fixture**: each scenario's
`events.sample.json` carries exactly one `user_input.requested` per completed∩ruled phase (with the
verbatim SKILL gate text on `data.question`), the `expected-skeleton.json` snapshots are regenerated to
gain `gate_fired_at(phase-N)` + `gate_count(ask)=K` + the retained `gate_fired(ask)`, and both pipeline
tests' `compare(...)` stays AS-EXPECTED. No Copilot seat is consumed. Cross-run `gateLog` aggregation
(the noise-band analog for gates) is deliberately a Stage-4+ concern (§12).

### 3.3 Order spine, fan-out floor, schema conformance + credit-free replay

*(issue #48, Stage 4; `WORKFLOW_MODEL_VERSION` bumped 3→4 ([`compare.mjs:29`](l2/compare.mjs)). Demonstrated
credit-free over enriched recorded fixtures AND a round-trip replay bundle — **NO live run**.)*

Stages 2–3 verified that a workflow *moved*, that its deliverable *works*, and that gates fired *on the
right phase*. They do **not** constrain the **order** delegations happen in, the **fan-out** a phase
fans to, or whether the orchestrator serialized its state on-schema. A run can delegate the right agents
in the wrong sequence, spawn one gatherer where the model mandates a fan-out, or emit a top-level
`status:` with no `task:` block — all conformance breaks the set-of-predicates skeleton was blind to.
Stage 4 adds three grammar heads, a witness-aware floor narrowing, and a **replay/persist** contract that
makes any verdict reproducible without a Copilot seat.

#### The three new heads

All three are grammar heads — in **both** `GRAMMAR_HEADS` and `buildToken`
([`normalize.mjs:45-60`](l2/normalize.mjs), [`:134-149`](l2/normalize.mjs)); the dead-entry-trap invariant
(§3.2) applies, so each is listed in both or its token silently vanishes.

- **`precedes(a,b)`** — an ADJACENT delegation-**order** edge. The payload is a single **OPAQUE comma
  string** `"a,b"` — the comma lives *inside* one payload (there is NO 2-arg head, NO `normalizePhase`,
  NO split); the extractor already assembled the adjacent-pair string and normalize passes it through
  literal ([`normalize.mjs:134-138`](l2/normalize.mjs)). The extractor emits one token per adjacent chain
  pair **iff both endpoints were observed AND `a` precedes `b` in first-sight order**
  ([`extractor.mjs:449-460`](l2/extractor.mjs)); a present-but-out-of-order pair is **silent**, leaving the
  required edge missing → REGRESSED (order violated). The emitted payload uses the chain's own **bare**
  names, so the token is prefix-independent.
- **`min_count(delegated(x))=K`** — a fan-out **floor**, implemented by **token-expansion (Option b)**.
  For each requested name the extractor emits one token per `k` in `1..observedCount`
  ([`extractor.mjs:465-476`](l2/extractor.mjs)); the reference asserts the exact `=K` by **SET
  MEMBERSHIP** — the token is present iff `observed ≥ K` — so `compare` needs **no `≥` logic anywhere**.
  `count = 0` emits nothing. Token shape mirrors the `=value` heads
  ([`normalize.mjs:139-144`](l2/normalize.mjs)).
- **`state_schema(conformant|off-schema)`** — state-serialization **conformance**. A 1-arg literal head
  ([`normalize.mjs:145-149`](l2/normalize.mjs)) emitted **only when state actually exists**
  (`stateYaml != null`), so **quick-bugfix — which writes NO orchestrator state — emits no token at all**
  ([`extractor.mjs:758-770`](l2/extractor.mjs)). It is state-sourced *by name* but is a **conformance
  token, NOT a downgrade-eligible floor predicate** (see the floor gate below).

#### `state_schema` LIMITATION + the dedicated `schemaDivergences[]` signal

`state_schema(off-schema)` carries a real **LIMITATION**: it detects only **serialization** divergence
(the orchestrator wrote a non-canonical shape — e.g. a top-level `status:` with no `task:` block), not
semantic state drift. Its correctness hinges on a **dedicated, absence-free signal**: `parseState` returns
a `schemaDivergences[]` array that is populated **ONLY** by true off-schema serialization
([`extractor.mjs:293-310`](l2/extractor.mjs)), kept **separate from the `parseWarnings` grab-bag** (which
also carries *legitimate absences* like research's missing `task_characteristics` block). `conformant` keys
on `schemaDivergences.length === 0`, **NOT** `parseWarnings` — so research's legitimately-absent
characteristics block never emits a false `off-schema`. The head is therefore **dev + research only**;
**quick-bugfix is N/A** (no state).

#### Witness-aware floor narrowing — the `require`-prefix disambiguation gate

Stage 4 tightens the widened-F3 sanity floor (§3.1 / [`run.mjs:1064-1108`](l2/run.mjs)). The floor may
downgrade a REGRESSED to INCOMPLETE only when *every* candidate regression is a MISSING state-sourced
predicate (`phase_completed` / `task_characteristic` / `task_status`) **while the state parser warned AND
artifacts exist**. The Stage-4 narrowing adds a **witness test** for a missing `phase_completed(N)`: a
phase is downgrade-eligible **only if it is genuinely un-witnessed**. `witnessTokensForPhase`
([`compare.mjs:100-115`](l2/compare.mjs)) reads the reference `rules[]` for phase `N`, and a
**`require`-prefix disambiguation gate** decides which rules count as witnesses:

- `WITNESS_REQUIRE_RE = /^(delegated|created_artifact|invoked_skill)\(/` ([`compare.mjs:86`](l2/compare.mjs))
  — only these three prefixes are **witnesses**.
- `gate_fired_at(` rules (the §3.2 gate-placement contract) and the `min_count(` fan-out rule **share the
  same `rules[]` array** and are **filtered OUT** — they are enforcement rules, not run-happened witnesses.

The gate is **tight**: if a witnessed phase's `phase_completed(N)` is missing, it downgrades **only when
≥1 of its witnesses is actually present in `observed`** (the phase demonstrably ran; the state parser just
failed to record it). If **all** witnesses are also absent, the phase is genuinely un-witnessed and
**STAYS REGRESSED** ([`run.mjs:1079-1093`](l2/run.mjs)). This keeps the floor from masking a real dropped
phase while still absorbing pure state-parse noise. It is **N=1-only** — the floor lives in
`finalizeSingleRun`.

#### The replay / persist contract — credit-free verdict reproduction

A live N=1 drive now **persists a replayable trace bundle** and `--replay` **reproduces any recorded
verdict without a Copilot seat**:

- **Bundle layout.** `reports/<ts>/{events.json, rundir/, replay-meta.json}` — the merged typed event
  stream, a full copy of the throwaway rundir (`.maister/tasks/<taskType>/<dir>/…`), and a metadata
  sidecar (`{scenario, taskType, copilotVersion, sdkPath, ts, originalMode:'live', maisterVersion}`)
  ([`run.mjs:825-846`](l2/run.mjs)).
- **Credit-free dispatch BEFORE the SDK import.** `--replay` returns in `main()` **above** `runLive`,
  before any `import(sdkPath)` — exactly like `--check-reference`
  ([`run.mjs:1247-1249`](l2/run.mjs)). It spends **no seat and no AI credit**; a missing/ bogus `sdkPath`
  is never loaded.
- **Re-execute-outcome fidelity.** Replay does **not** replay a cached verdict — it reconstructs
  `extract()`'s three rundir inputs from the bundle and **RE-RUNS the outcome oracle** against the
  persisted rundir copy (restaging from the committed sandbox template), then reuses `finalizeSingleRun`
  unchanged ([`run.mjs:975-1021`](l2/run.mjs)). Same inputs → same normalized skeleton → **byte-identical
  verdict / exit code / report** a live run would land. The report `Mode:` line reads
  `replayed (from <dir>)`.
- **Persist-before-INCOMPLETE.** The persist step is placed **before** the `ex.incomplete` early return,
  so the INCOMPLETE runs a maintainer most wants to diagnose **also** get a bundle
  ([`run.mjs:819-824`](l2/run.mjs)). It is best-effort — wrapped in try/catch, a persist failure logs to
  stderr and **never** breaks the live verdict.
- **Precondition.** `runReplay` validates the bundle exists (`--replay directory not found` →
  `EXIT.INCOMPLETE` / exit 2), never a false verdict ([`run.mjs:975-981`](l2/run.mjs)).

#### The N=1-vs-N>1 floor / persist asymmetry

Both the witness-aware floor and the persist step are **N=1-only**, by construction:

- **Persist** is keyed by the report `ts`; `persistTs` is non-null **only when `N === 1`**
  ([`run.mjs:951-957`](l2/run.mjs)), so an N>1 batch never persists (multiple runs would collide on a
  single `ts`) and never emits a per-run bundle.
- **The floor** lives in `finalizeSingleRun`; the N>1 path (`finalizeMultiRun`, §4 noise calibration)
  has its own stable/noise partition and does not run the single-run floor.

**N>1 for the Stage-4 heads is deferred to Stage 5** — cross-run aggregation of `precedes` / `min_count`
noise bands, and per-run persist without `ts` collision, are named follow-ups (§12), not a gap in the
N=1 contract landed here.

#### Governance + acceptance

`WORKFLOW_MODEL_VERSION` is bumped **3→4**, so every Stage-3 reference re-stamps stale and forces a
re-derive; the new `rules[]` (witness + `min_count`) ride the same Option-A rules-in-hash seam (§3.2), and
each reference edit is logged in [`l2/reference/CALIBRATION-LOG.md`](l2/reference/CALIBRATION-LOG.md) with
its SKILL.md order/fan-out citation. Stage 4 is proven **credit-free**: the pipeline fixtures gain
`precedes` / `min_count` / `state_schema` and stay AS-EXPECTED, the witness-floor unit tests pin the tight
downgrade gate, and a **replay round-trip test** (`test/replay.test.mjs`) stages a bundle from the committed
research fixtures and asserts `node run.mjs --replay=<dir>` reproduces the recorded verdict at exit 0 with
`Mode: replayed` — while a nonexistent bundle exits 2. No Copilot seat is consumed.

## 4. Noise calibration

Both engines are non-deterministic, so we **measure** the noise instead of guessing a
threshold:

1. Run the workflow **N times** on a platform. Each run → a predicate set.
2. A predicate present in **all N** runs is **stable** → part of the **skeleton** (the
   invariant we trust). A predicate that comes and goes is **noise** → discarded.
3. Compare skeletons (§5). A predicate that is stable on one side but absent on the other is a
   **candidate divergence**; anything in the noise band is ignored.

**Adaptive N (decided).** Start with **N = 3**. If the three runs largely agree (small noise
band, stable skeleton), stop — 3 is enough. **Only if the three are highly divergent**
(the skeleton is small / many predicates flap) do we add more runs, because a wide noise band
means 3 samples can't separate signal from noise. This keeps the common case cheap and spends
samples only where they're needed.

## 5. Baseline model: **Conformance** (decided)

Two ways to get something to compare against:

- **(A) Differential** — run maister on **live Claude** N times *and* Copilot N times every
  time, then diff the two freshly-built skeletons. Measures real Claude behaviour, but costs
  2× and folds Claude's own non-determinism (and the hard problem of driving Claude
  non-interactively — §7) into every run.
- **(B) Conformance (CHOSEN)** — derive the **expected skeleton once** (from maister's
  documented **workflow model** — the SKILL.md files are the source of truth; Claude runs are
  confirmatory, not the derivation source), **commit it as the reference**,
  and let routine L2 runs exercise **only Copilot**, checking its skeleton against the
  reference. Cheaper, repeatable per Copilot version, and it removes Claude's noise and
  Claude's gate-driving problem from the routine loop.

We pick **(B)**. It reframes L2 from "run both engines and compare" to "**assert Copilot's
workflow trace conforms to the reference skeleton**" — which is precisely a regression test.

### The reference is versioned to maister — and rebuilt when maister changes

The reference skeleton encodes *maister's expected behaviour*, so it is **pinned to a maister
release**. This is the key operational rule (raised in review):

- **Change maister's Claude source in a way that changes workflow behaviour** — add/reorder a
  phase, change which agent a phase delegates to, change gate placement, rename an
  artifact — and **the reference is stale**. It must be **re-derived from the workflow model
  (the SKILL.md files)** for the new maister version before L2 can judge Copilot again. In
  short: *touch the workflow → rebuild the golden skeleton.*
- **Generator-only changes** (`build.sh`, naming rewrites, hook overrides) that do **not**
  change workflow *behaviour* do **not** require re-deriving the reference — they are exactly
  what L2 is meant to test. Re-run Copilot conformance against the existing reference.
- **Version stamp.** Store the reference with `maister vX.Y.Z` + a skeleton content hash, so a
  drift between "reference maister version" and "current maister version" is detectable and
  forces a rebuild rather than silently comparing against an outdated golden.
- **Derivation records.** Each committed reference's entry-by-entry derivation from the model —
  every predicate's SKILL.md citation, or its documented divergence justification — is recorded
  in [`l2/reference/development.derivation.md`](l2/reference/development.derivation.md),
  [`l2/reference/research.derivation.md`](l2/reference/research.derivation.md), and
  [`l2/reference/quick-bugfix.derivation.md`](l2/reference/quick-bugfix.derivation.md).

A lightweight guard can compare the committed reference's maister version against the current
one and **fail loudly** ("reference skeleton is for maister v2.2.2, repo is v2.3.0 — re-derive
before running L2") instead of producing a misleading pass/fail.

## 6. Normalization layer

The two platforms name the same concepts differently, so both skeletons are mapped to a
**canonical form** before diffing:

| Canonical | Claude | Copilot |
|-----------|--------|---------|
| `DELEGATE(agent=…)` | `Task(subagent_type: "maister:…")` | `task(agent_type: "maister-copilot:…")` |
| `INVOKE_SKILL(skill=…)` | `Skill(skill: "maister:…")` | `skill("…")` |
| `GATE(ask)` | `AskUserQuestion` | `ask_user` |
| plugin-id prefixes | `maister:` | `maister-copilot:` |

Plus an explicit **allowlist of expected differences** — divergences we already understand and
accept (e.g. the destructive-guard's `deny`→`ask` adaptation from L1, or naming-only
differences). An allowlisted difference is reported as *expected*, not as a regression. The
allowlist's governance is **resolved** — it is governed by
[`l2/reference/CALIBRATION-LOG.md`](l2/reference/CALIBRATION-LOG.md): any edit to a committed
reference (required, optional, or allowlist) requires a log entry with a workflow-model
citation or an explicit platform-divergence justification.

## 7. The interactive-gate problem (the crux / make-or-break)

> **✅ RESOLVED (Copilot CLI 1.0.73) — see [`L2-SPIKE-FINDINGS.md`](L2-SPIKE-FINDINGS.md).**
> The bundled Node SDK (`@github/copilot-sdk`) answers this directly:
> `createSession({ onUserInputRequest, onPermissionRequest, onExitPlanModeRequest })` lets a
> client answer `ask_user` / permission / plan-mode gates deterministically **while they still
> fire**, and a typed `SessionEvent` stream (`session.on` / `getEvents`) supplies the trace.
> (`copilot --acp` and `--output-format json` also exist; the SDK is the cleanest path.) The
> analysis below is kept for context.

maister workflows **pause at gates** (`ask_user` / `AskUserQuestion`) for a user decision. To
run a workflow N times unattended we need a **deterministic auto-responder** that answers each
gate the same way every time (e.g. always pick the recommended default). This is the single
biggest feasibility risk, and it is **asymmetric**:

- **Copilot.** `--no-ask-user` *disables* asking — but that **changes the trace** (gates no
  longer fire, and gate placement is part of what we want to verify), so it's not a clean
  substitute. We instead need to *answer* gates. **Spike first:** does Copilot's
  programmatic / SDK (ACP) mode expose a callback to answer `ask_user`? (The ACP bridge that
  would enable this was proposed upstream but not yet shipped.) **Fallback:** drive the TUI
  with a `pexpect`-style expect-script.
- **Claude.** Driving maister fully headless with auto-answered `AskUserQuestion` is *harder*
  still. **This is a major argument for the Conformance baseline (§5): if we don't run Claude
  live in the routine loop, the Claude-side gate problem disappears** — we only need to solve
  gate-answering on **Copilot**.

**First step (DONE): a short spike** confirmed we can programmatically answer `ask_user` on
Copilot CLI 1.0.73 via the SDK — see [`L2-SPIKE-FINDINGS.md`](L2-SPIKE-FINDINGS.md). The
`pexpect` fallback is not needed. Next is a live smoke test of the SDK loop (spike → MVP).

## 8. Sandbox project

Workflows act on a codebase, so runs need a fixed, small **sandbox project**:

- **Small** — fast and cheap to run through a full workflow.
- **Deterministic start** — reset with `git` between runs (identical starting state every
  time).
- **Rich enough** — has code to analyse, a place to add a feature, and a test to run, so it
  actually exercises the phases each scenario targets (e.g. a known reproducible bug for the
  bugfix scenario).

## 9. Scenarios (exercising different mechanisms)

Chosen to stress different parts of the engine, so the net is genuinely broad. Selected at run time
with `--scenario=<id>` (default `development`); each has its own committed
`reference/<id>.skeleton.json`.

1. **development** *(first built; conformance verified live)* — the full chain: analyse → spec →
   plan → implement → verify, gates, parallel implementation waves, hooks. The richest trace, and
   the scenario the MVP conformance loop was first verified on (AS-EXPECTED, Copilot 1.0.74);
   latest live verification: AS-EXPECTED 25/25 on Copilot 1.0.81 (post-#46 parser fix).
2. **research** *(implemented; conformance verified live)* — a *different* orchestrator: a planner +
   parallel information-gatherers + a synthesizer (plus conditional brainstorming/design), a
   different agent set and phase model, no implementation phase. Catches breakage the development
   path wouldn't touch. Credit-free plumbing (generalized tree profile + model-derived reference) is
   committed + unit-tested; verified live: AS-EXPECTED 9/9 on Copilot 1.0.81.
3. **quick-bugfix** *(shipped; conformance verified live)* — short, gated via plan-mode
   (`ExitPlanMode`), cheap. Uniquely probes the plan-mode gate the other two don't. Uses a
   seeded-bug sandbox; its predicate skeleton is deliberately thin under the current grammar
   (events-only shape: skill + plan gate + terminal). Verified live: AS-EXPECTED 2/2 (pre-calibration partition; CALIBRATION-LOG note 4) on Copilot
   1.0.81.

All three scenarios are implemented and conformance-verified live on Copilot 1.0.81.

## 10. Cost & cadence

`N × scenarios × (a workflow that itself spawns many subagents)` is expensive in both wall
time and model credits. Therefore:

- Run L2 **occasionally** — on major Copilot releases or larger generator changes — not per
  build. L0/L1 are the per-build guardrails.
- **Cache the reference skeleton** (the Conformance baseline) so routine runs pay only for
  the Copilot side.
- Use **adaptive N** (§4) to avoid over-sampling the easy cases.
- **No silent caps:** if a run bounds coverage (fewer scenarios, capped N), the report must
  say so explicitly — a truncated run must not read as "everything passed".

## 11. Output / report

Per scenario, a **conformance report** (the report filename slug `l2-trace-equivalence-*.md`
is retained as a stable, historical artifact identifier):

- the Copilot skeleton and the reference skeleton,
- the diff, each entry classified as **expected** (allowlisted — §6) or **candidate
  regression**,
- the observed noise band and the final N used,
- version stamps: maister version, `copilot --version`, OS.

Results feed the per-version **compatibility matrix** (SkillPanel/maister#9), keyed by
`(maister version, Copilot version, OS)` — the same keying L0/L1 reports use.

## 12. Open questions / decisions still to make

1. **Gate-answering mechanism** (§7) — programmatic `ask_user` callback vs `pexpect`. *Spike
   first; this gates everything.*
2. **Exact predicate schema** (§3) — the precise list of predicates and their granularity.
3. **Sandbox shape** (§8) — one shared sandbox vs one per scenario; language/stack.
4. **Allowlist governance** (§6) — ✅ **RESOLVED**: governed by
   [`l2/reference/CALIBRATION-LOG.md`](l2/reference/CALIBRATION-LOG.md) — any reference edit
   requires a log entry with a workflow-model citation or a divergence justification.
5. **Reference-staleness guard** (§5) — how strictly to enforce the maister-version stamp
   (warn vs hard-fail).

## 13. Phasing

1. **Spike** — prove we can deterministically answer `ask_user` on Copilot. Go/no-go for L2.
2. **Extractor** — reduce a run (task-dir + `orchestrator-state.yml` + log) to a predicate
   set; define the schema.
3. **MVP** — one scenario (**development**), sandbox, reference derived + committed, conformance
   verified live (AS-EXPECTED, Copilot 1.0.74, N=1). `--runs=N` noise-calibration built; live N=3
   deferred (quota).
4. **Scale** — add further scenarios behind `--scenario=<id>`. **research** is implemented +
   verified live (AS-EXPECTED 9/9, Copilot 1.0.81); **quick-bugfix** is shipped + verified live
   (AS-EXPECTED 2/2 pre-calibration, Copilot 1.0.81; CALIBRATION-LOG note 4). Wire reports into the compatibility matrix (#9).

---

*This document is the design of record for L2. L1 findings that motivate it (e.g. the
destructive-guard adaptation that must be allowlisted as an expected difference) live in
[`L1-FINDINGS.md`](L1-FINDINGS.md).*
