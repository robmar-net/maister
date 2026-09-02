# ADR 0002 — Per-agent `model:` on Copilot: honored, so map the aliases (not a LIMITATION)

- **Status:** Accepted — 2026-09-03
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#86](https://github.com/robmar-net/maister/issues/86) (WP-G), [#76](https://github.com/robmar-net/maister/issues/76) (Parity Map)
- **Related:** [AGENTS.md](../../AGENTS.md) "Upstream-merge tripwires" (`feat/model-tiering`); [ADR 0001](0001-copilot-orchestrator-state-conformance.md)

## Context

maister agents can pin a model via `model:` frontmatter. On master 23 agents carry `model: inherit`
and one (`project-analyzer`) carries `model: haiku`; upstream's live `feat/model-tiering` branch adds
`sonnet` as well. `build.sh` did **not** transform `model:` at all, so the Claude aliases were passed
through verbatim into the generated `maister-copilot` agents. Whether Copilot honors agent-level
`model:` — and what it does with a value that is not a Copilot catalog id — was **unknown**, and that
unknown blocked merging `feat/model-tiering` (a per-agent tiering feature that would silently no-op or
break if the mapping were wrong).

## Probe (#86 T1, throwaway 2-agent plugin, Copilot CLI 1.0.82, ~1 AIU)

- Agent `tiered` (`model: gpt-5.4`, a valid catalog id) → `subagent.started.data.model = **gpt-5.4**`
  — distinct from the orchestrator default `gpt-5.6-luna`. **Agent-level `model:` IS honored.**
- Agent `aliased` (`model: haiku`, a Claude alias not in Copilot's catalog) → the delegation
  tool-execution returned `success:false` with `"Model 'haiku' is not available. Available models:
  claude-sonnet-5, claude-fable-5, claude-opus-5, …, claude-haiku-4.5, gpt-5.6-luna, …"`, and the
  sub-agent ran on the **default** `gpt-5.6-luna` instead. **Failure mode: a per-invocation runtime
  error + silent fallback to the default model — not a load-time fail-closed, not a clean silent
  ignore.** A wrong-model run with a surfaced error is a hidden quality regression.

The probe also captured the live catalog, which supplies the exact mapping targets
(`claude-haiku-4.5`, `claude-sonnet-5`, `claude-opus-5`).

## Decision

Per-agent model control on Copilot is **possible**, so this is a **fix**, not a documented LIMITATION.
`build.sh` (step 3b) maps agent `model:` frontmatter over `$OUT/agents/**`:

| Claude `model:` | Copilot output | Rationale |
|---|---|---|
| `inherit` | left as-is | recognized keyword → session/default; ships working today |
| `haiku` | `claude-haiku-4.5` | nearest Copilot catalog id |
| `sonnet` | `claude-sonnet-5` | nearest Copilot catalog id |
| `opus` | `claude-opus-5` | nearest Copilot catalog id (pre-mapped; not yet used upstream) |
| anything else | **build FAILS** | an unmapped alias would error at delegation → force a map update |

`make validate` (**WS5.17**) independently fails if a generated agent still carries a bare Claude alias
(`haiku`/`sonnet`/`opus`), so a regression cannot ship. Claude source agents stay zero-touch.

## Consequences

- The already-shipped defect — `project-analyzer: model: haiku`, which errored at delegation on Copilot
  and ran on the wrong model — is fixed (→ `claude-haiku-4.5`).
- Merging upstream `feat/model-tiering` is unblocked **once this lands**: its `sonnet`/`haiku`/`inherit`
  values are all covered; a new alias trips the build-fail, which is the intended tripwire.
- Per-agent "model actually used" is already surfaced per run by `tools/parity-evidence.mjs`
  (`subagent.started/completed .data.model`), so the Parity-Map Agents/Model-routing rows can cite it
  (#86 T3/T5).
- **Not** asserted: that `claude-haiku-4.5`/`claude-sonnet-5` are the *quality-equivalent* of Claude's
  haiku/sonnet — only that they are valid catalog ids that load. Model×workflow quality parity stays a
  per-run canary (see #88 product-correctness), not a claim made here.

## Alternatives rejected

- **Pass `model:` through unchanged** — ships the runtime "not available" error + wrong-model fallback.
- **Drop every `model:` key (always omit)** — discards the operator's/upstream's deliberate tiering
  intent, which the probe proved Copilot *does* honor.
- **Map unknown → omit silently** — hides new upstream aliases; the build-fail surfaces them instead.
