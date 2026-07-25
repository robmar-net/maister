# L2 — Trace-Equivalence Testing (Design / RFC)

> **Status:** ✅ **Implemented + proven live.** The harness ships in [`l2/`](l2/) (`make test-l2`);
> equivalence was confirmed on a live **Copilot CLI 1.0.74** run — the maister-copilot development
> workflow's predicate skeleton **conforms** to the reference (**AS-EXPECTED**) after a justified N=1
> reference calibration. The `--runs=N` noise-calibration mode is built + credit-free-tested; the live
> **N=3** band-measurement is deferred (monthly Copilot AI-credit quota). A **second scenario**
> (`research`) is now implemented + credit-free-tested — a generalized extractor tree profile, a
> `--scenario=<id>` selector, and a model-derived reference — with its live drive likewise deferred.
> The design below is retained as the rationale of record; where the build refined it, notes say so.
> **Layer:** L2 of the Copilot-CLI compatibility framework. L0 (wiring) and L1 (hook
> effects) already ship; see [`README.md`](README.md) and [`L1-FINDINGS.md`](L1-FINDINGS.md).
> **Upstream framework proposal:** SkillPanel/maister#9 · **Epic:** robmar-net/maister#3

## TL;DR

- **What:** the highest layer of the compat framework — prove that the **generated
  `maister-copilot` plugin drives the same workflow behaviour on GitHub Copilot CLI that
  `maister` drives on Claude Code**, well enough to catch a regression when a new Copilot
  release (or a generator change) silently breaks something.
- **Why a whole layer:** proof of equivalence ≈ regression detection. We **cannot predict
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

**Proof of equivalence ≈ regression detection.** A regression is a break in equivalence
versus a known-good baseline. Because we cannot predict *where* a future Copilot version — or
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
| **L2** — trace equivalence (this doc) | Does a *whole workflow run* behave equivalently end-to-end? | expensive | occasionally (major Copilot release / large generator change) |

L0/L1 are the fast guardrails. L2 is the deep, occasional equivalence proof that also covers
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
gate_fired_at(phase-5)                       # workflow paused for a user decision (ask_user)
hook_effect(destructive_guard = ask)         # observed hook behaviour
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

**Granularity is the whole game.** Too fine (exact args, exact ordering) → even same-platform
runs disagree → the skeleton is empty → no signal. Too coarse (just "did it finish") → real
regressions slip through. Predicate sets are the sweet spot; the exact predicate schema is an
open item (§12).

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
  documented phase model, confirmed by a few Claude runs), **commit it as the reference**,
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
  artifact — and **the reference is stale**. It must be **re-derived on Claude** for the new
  maister version before L2 can judge Copilot again. In short: *touch the workflow → rebuild
  the golden skeleton.*
- **Generator-only changes** (`build.sh`, naming rewrites, hook overrides) that do **not**
  change workflow *behaviour* do **not** require re-deriving the reference — they are exactly
  what L2 is meant to test. Re-run Copilot conformance against the existing reference.
- **Version stamp.** Store the reference with `maister vX.Y.Z` + a skeleton content hash, so a
  drift between "reference maister version" and "current maister version" is detectable and
  forces a rebuild rather than silently comparing against an outdated golden.

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
allowlist's governance (who adds to it, how it's reviewed) is an open item (§12).

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

1. **development** *(first built; proven live)* — the full chain: analyse → spec → plan → implement
   → verify, gates, parallel implementation waves, hooks. The richest trace, and the scenario the
   MVP conformance loop was proven on (AS-EXPECTED, Copilot 1.0.74).
2. **research** *(implemented; live deferred)* — a *different* orchestrator: a planner + parallel
   information-gatherers + a synthesizer (plus conditional brainstorming/design), a different agent
   set and phase model, no implementation phase. Catches breakage the development path wouldn't
   touch. Credit-free plumbing (generalized tree profile + model-derived reference) is committed +
   unit-tested; the live drive awaits AI-credit quota.
3. **quick-bugfix** *(planned)* — short, gated via plan-mode (`ExitPlanMode`), cheap. Uniquely probes
   the plan-mode gate the other two don't. Needs a seeded-bug sandbox, and its predicate skeleton is
   thin under the current grammar (skill + plan gate + terminal), so it is a deliberate next step.

The MVP was proven on #1; #2 is implemented credit-free; #3 is the next scenario.

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

Per scenario, an **equivalence report**:

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
4. **Allowlist governance** (§6) — how expected-difference entries are added and reviewed.
5. **Reference-staleness guard** (§5) — how strictly to enforce the maister-version stamp
   (warn vs hard-fail).

## 13. Phasing

1. **Spike** — prove we can deterministically answer `ask_user` on Copilot. Go/no-go for L2.
2. **Extractor** — reduce a run (task-dir + `orchestrator-state.yml` + log) to a predicate
   set; define the schema.
3. **MVP** — one scenario (**development**), sandbox, reference derived + committed, proven live
   (AS-EXPECTED, Copilot 1.0.74, N=1). `--runs=N` noise-calibration built; live N=3 deferred (quota).
4. **Scale** — add further scenarios behind `--scenario=<id>`. **research** is implemented +
   credit-free-tested (live deferred); **quick-bugfix** is the next planned scenario. Wire reports
   into the compatibility matrix (#9).

---

*This document is the design of record for L2. L1 findings that motivate it (e.g. the
destructive-guard adaptation that must be allowlisted as an expected difference) live in
[`L1-FINDINGS.md`](L1-FINDINGS.md).*
