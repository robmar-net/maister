# ADR 0003 — Parallel fan-out works on Copilot; "concurrency = 1" was a measurement artifact

- **Status:** Accepted — 2026-09-03
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#84](https://github.com/robmar-net/maister/issues/84) (WP-C1), [#76](https://github.com/robmar-net/maister/issues/76)
- **Related:** [AGENTS.md](../../AGENTS.md) "Parity, and honest knowledge of the gaps"; `tools/parity-evidence.mjs`

## Context

#84 opened on the strongest-looking parity gap we had: `parity-evidence.mjs` reported **peak sibling
subagent concurrency = 1** on the development bundle, implying maister's documented parallel fan-out
(codebase-analyzer's Explore wave, the implementation-verifier's "send ALL enabled subagents in a
SINGLE message", the plan-executor's waves) had collapsed to sequential on Copilot — an N× wall-clock
regression. The open question was whether the cause was (a) the `reviews-*` skill-hop, (b) the model
never emitting multiple `task` calls in one message, or (c) the platform executing one message's tool
calls serially. Each has a different fix, so the ticket forbade guessing.

## Investigation (credit-free, over the persisted development bundle `20260831T024753Z`)

Reading the raw event stream (not the summary) overturned the premise:

- **The model DOES batch.** `tool.execution_start` events with `toolName: "task"` carry a `turnId`.
  Grouping by it: **turn 7 emitted 4 `task` calls, turn 4 emitted 2, turn 1 emitted 3** — all in one
  assistant turn. Cause (b) is refuted.
- **Copilot DOES run them concurrently.** In stream order, turn 7 shows **four `tool.execution_start`
  before any `tool.execution_complete`**, and the completions arrive **out of start order** (a hallmark
  of parallel execution, not FIFO serial). Turn 7's four agents were all `explore` (the
  codebase-analyzer fan-out); turn 4's two were `implementation-completeness-checker` +
  `code-reviewer` (the verifier review fan-out). Cause (c) is refuted.
- **So where did "concurrency = 1" come from?** `parallelWaves()` measured overlap of
  `[start, start+durationMs]` windows taken from `subagent.started`. But that event carries **no
  timestamp and no parentId** (real 1.0.82 keys: `toolCallId, agentName, agentDisplayName,
  agentDescription, model, resumable, agentType, executionMode`). So every delegation hit
  `if (d.start == null) continue` and was dropped → the sweep saw no siblings → "no wave". The tool's
  own test fixture had *added* `timestamp`/`parentId` that real events lack, so the test passed while
  the measurement was blind on real data.

**The gap was in our measurement, not on the platform.** Parallel fan-out works.

## Decision

Fix the **measurement**, not `build.sh` (nothing to fix in the generator). `parity-evidence.mjs` now
derives parallel fan-out from data real events actually carry:

- **`wavesByTurn`** — group `tool.execution_start(task)` by `turnId`; each turn with ≥2 is a wave.
- **`peakTaskConcurrency`** — max simultaneously-open `task` executions, scanning
  `tool.execution_start` (+1) / `tool.execution_complete` (−1) in stream order (no timestamps needed).

Real dev bundle now reports **✅ 4× peak** (waves: 4× explore, 3×, 2×). The test fixture was rewritten
to the real event shape so it can no longer pass while blind.

**Live confirmation (T4, `--scenario=development`, Copilot 1.0.82, bundle `20260903T000910Z`,
AS-EXPECTED 38 PASS · 7 LIMITATION · 0 FAIL, 36.995 AIU):** a fresh live run reports **✅ 6× peak**
concurrency — including a **5-way verifier review wave** in one turn (`implementation-completeness-checker`
+ `code-reviewer` + `code-quality-pragmatist` + `production-readiness-checker` + …), the exact "send ALL
enabled subagents in a SINGLE message (up to 5 parallel `task` calls)" that `implementation-verifier/SKILL.md`
documents. Independently reproduces the credit-free finding, on the very wave #84 claimed was serialized to 1.

## Consequences

- **Parallel fan-out is NOT a parity gap.** The Parity-Map "Parallel waves" row moves off the implied
  ⚪/🟡 to reflect observed multi-way concurrency (Explore ×4, reviews ×2), cited from the bundle.
- **The `reviews-*` skill-hop is a SEPARATE, already-tracked matter** (commands surfaced as skills →
  🟡). Some reviews (e.g. `spec-audit`) route through the `reviews-*` skill and so run in their own
  turn; the verifier's *direct* `task` reviews (turn 4) run concurrently. The ×5 `reviews-*` allowlist
  entries therefore **stay** — the skill hop still occurs — and are not retired by this ADR.
- **A conformance-tool measurement can lie two ways** (here: a fixture richer than reality). Evidence
  tools that shape parity verdicts get fixtures built from *real* captured events, not idealized ones.
- No new grammar/reference/CALIBRATION: `parity-evidence.mjs` is a read-only reporting tool, not part
  of the L2 verdict.

## Alternatives rejected

- **A `build.sh` fan-out nudge / skill-flag** (#84 T3) — unnecessary; the model already batches and the
  platform already parallelizes.
- **Trusting the old number and documenting a LIMITATION** — would have enshrined a measurement bug as
  a platform gap, the exact "silent false red" AGENTS.md forbids.
