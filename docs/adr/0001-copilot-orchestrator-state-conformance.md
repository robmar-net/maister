# ADR 0001 — L2 conformance handling of Copilot's off-schema `orchestrator-state.yml`

- **Status:** Accepted (layered direction); the normalizer + extractor-companion layer is **Proposed / prototyped** (branch `proto/57-state-normalizer`), not yet shipped.
- **Date:** 2026-08-30
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#57](https://github.com/robmar-net/maister/issues/57), [#48](https://github.com/robmar-net/maister/issues/48) (L2 hardening)
- **Related:** [AGENTS.md](../../AGENTS.md) "Parity, and honest knowledge of the gaps"; CALIBRATION-LOG notes 23/24

## Context

The L2 conformance harness drives a real maister workflow on Copilot CLI and set-compares the observed
predicate skeleton to a workflow-model reference. Live runs revealed that Copilot's model serializes
`.maister/tasks/**/orchestrator-state.yml` **off-schema** relative to maister's documented shape:
bare-integer `completed_phases: [1, 2, 6]` (vs `["phase-1", …]`), a top-level `status:` under
`orchestrator:` with **no** top-level `task:` block, floating `task_characteristics`. The harness's
`extractor.parseState` correctly flags this as `state_schema(off-schema)`.

Two facts frame the decision:

1. **It is behavior-preserving at runtime, but not at the measurement level.** maister's own routing/resume
   readers are model-interpreted (semantic), so an off-schema file does not misroute. But the harness
   derives `state_schema(conformant)` (and, in some serializations, `task_status(completed)`) from the
   documented shape — so a legitimate off-schema run **false-REGRESSES** on those predicates. Confirmed
   run-variant by N=3 calibration (state_schema conformant 1/3, off-schema 2/3) and by two persisted
   traces (one off-schema, one conformant — same workflow).
2. **Copilot writes the state file via incremental `*** Update File:` apply-patch hunks** — 6–18 per run
   in persisted traces — not whole-file overwrites. And Copilot's file tool is `Edit` (apply-patch), with
   no discrete `tool_input.file_path`.

The project goal (AGENTS.md) is **behavioral parity + honest, visible, tracked knowledge of the gaps** —
never a silent green that buries a divergence.

## Decision

Handle it in **three layers**, from shipped-now to parity-path:

### Layer 1 — Interim (SHIPPED): tolerant reader + demote + visible LIMITATION
`state_schema(conformant)` is `optional` (not required) in the dev/research references; `state_schema(off-schema)`
is an allowlisted, report-visible `🟢 ADAPTED` LIMITATION (CALIBRATION notes 23/24). Effect: an off-schema
run scores AS-EXPECTED **with the divergence loud and tracked**, not a false REGRESSED. Model-grounded
(the semantic readers), not fitted to a run. This is the current verified handling.

### Layer 2 — Parity path (PROPOSED, prototyped): normalizer hook + shadow + extractor companion
A `PostToolUse` hook (matcher `Edit`) canonicalizes the model's off-schema state into maister's documented
shape, so the **shipped variant** emits conformant state (the hook is an adaptation mechanism, like a
`build.sh` transform). Because in-place rewriting would desync the file from the model's next apply-patch
hunk (context drift), the hook writes a **canonical shadow** (`orchestrator-state.canonical.yml`) and never
touches the working file. For the shadow to affect the verdict, the harness's state read
(`run.mjs findStateYaml`, feeding `extractor.parseState`) **prefers the shadow when present** and the report
**names the source** (`canonical shadow — normalizer hook active`). Guards: the canonicalizer is **lossless**
(reformats `completed_phases`, relocates `status` into a `task:` block — invents no phases, changes no
status), so it cannot fabricate conformance or mask a semantic regression; and the source is always visible.

### Layer 3 — In-place: DRIFT-TESTED — survivable but not clean
Live drift probe (2026-08-30, Copilot 1.0.82, 2 runs / ~2.3 AIU; also flushed out two hook-firing bugs —
a tool-name `matcher` does NOT fire PostToolUse, only a catch-all does; and the canonicalizer's CLI
self-detection false-negated across a symlink). Result with in-place forced:

- The hook **does** rewrite the working file → it ends **canonicalized** (real parity on the working file).
- **But** it induces apply-patch failures: `Failed to apply patch: Error: Failed to find expected lines in …
  completed_phases: [1, 2]` — the model's next `*** Update File:` patch expected the pre-rewrite bytes.
- Copilot's model **recovers**: it detects the drift, re-reads the file, and re-edits (`File drift detected
  during ordered updates; restoring exact requested YAML state`). Final state was correct.

So in-place is **functionally survivable but not clean**: every state update becomes a patch-fail →
re-read → re-edit cycle (extra model turns, AIU, latency, and a "file drift detected" signal to the
model). Over a real run's 6–18 state updates that is fragile and wasteful — and **full structural scope
(more rewritten lines) would make the drift worse**. Conclusion: neither mode is a clean ship —
in-place buys working-file parity at a per-update churn cost; shadow is drift-safe but only the L2
harness reads it. The honest shipped handling remains **Layer 1** (documented LIMITATION); Layers 2–3
stand as the prototype that documents *why* clean lexical parity fights Copilot's incremental apply-patch
model (the missing mechanism is not `PostToolUse` — it exists — but a non-diff whole-file write path).

## Consequences

**Positive**
- Layer 1 already removes the false REGRESSED while keeping the gap visible and tracked.
- Layer 2 makes the *adapted variant* emit conformant state without touching the model's working file → no
  patch-drift risk; validated credit-free (canonicalizer: 2 PASS/0 FAIL on real captured state; hook: shadow
  leaves the working file off-schema).
- `PostToolUse` support is confirmed live on Copilot 1.0.82 (0.70-AIU probe) — the capability block is lifted.

**Negative / risks (must stay visible)**
- Layer 2 measures conformance of the **hook-adapted** output, not the raw model output — legitimate for the
  parity goal **only** while the hook actually ships and the report names the shadow source. A silent shadow
  preference would violate AGENTS.md.
- Path recovery leans on Copilot's `Edit` apply-patch payload (`tool_result` text + patch header + `cwd`),
  not a stable `file_path` field — brittle to payload changes across CLI versions; re-verify on bumps.
- Scope: Layer 2 fixes only the two conformance-oracle sites (`completed_phases` format, `task:` block).
  Full structural schema parity (nesting, `task_context.task_characteristics`) is broader and out of scope here.
- **Shadow's only consumer is the L2 harness companion.** For a *real* maister-copilot user the shadow is an
  unread `orchestrator-state.canonical.yml` sidecar, and the `Edit`-matched hook runs on **every** file edit
  (a small per-edit `bash`+`jq` tax). So shipping shadow mode measures the variant's conformance but does **not**
  give a real user a conformant *working* file — only **in-place** (Layer 3) does, without a sidecar. Treat
  shadow as the safe, measurable **interim**; the drift test decides whether we upgrade to in-place for true
  user-facing parity (or keep the documented LIMITATION rather than ship test-only instrumentation to users).

## Alternatives considered

- **In-place normalizer (rejected as default):** breaks subsequent `*** Update File:` patches via context drift
  (empirical: 6–18 patches/run). Kept as opt-in Layer 3 behind a drift test.
- **Tolerant-reader only (Layer 1 alone):** insufficient for *parity* — the model's output stays off-schema; it
  only stops the false REGRESSED. Retained as the interim, not the end state.
- **Prose-only prescription** (make the SKILL template more prescriptive): rejected — the source instruction is
  already maximal; prose cannot force a non-deterministic model's serialization shape.
- **Accept a permanent LIMITATION:** the honest fallback **iff** the platform could not host the hook — but the
  probe showed `PostToolUse` IS supported, so parity is reachable and this is not the conclusion.
