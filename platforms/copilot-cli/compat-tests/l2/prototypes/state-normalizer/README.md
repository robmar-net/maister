# #57 PROTOTYPE — orchestrator-state.yml normalizer (PostToolUse)

Working prototype for the "lexical parity" fix tracked in [#57](https://github.com/robmar-net/maister/issues/57):
canonicalize Copilot's off-schema `orchestrator-state.yml` into the shape the L2 extractor scores as
`state_schema(conformant)`. **NOT wired into `build.sh` / the shipped plugin** — this is a tracked
prototype pending the deployment decisions below.

## Files
- `canonicalize-orchestrator-state.mjs` — core transform (zero-dep, line-based, mirrors `extractor.parseState`): bare-int `completed_phases` → `phase-N`; promote a fallback-only `status:` into a real top-level `task:` block. Idempotent. CLI: `node canonicalize-…mjs <file> [--in-place]`.
- `normalize-orchestrator-state.sh` — PostToolUse hook wrapper. Recovers the written path from the `Edit` payload (`tool_result.text_result_for_llm` "Updated N file(s): <abspath>" and/or the `*** Update File:` patch header + `cwd`), and canonicalizes when the basename is `orchestrator-state.yml`.
- `hooks.json` — registration snippet (PostToolUse, matcher `Edit`).
- `test-canonicalize.mjs` — credit-free proof harness.

## Evidence it works (credit-free, against REAL captured state files)
`node test-canonicalize.mjs <captured orchestrator-state.yml files>` → **2 PASS / 0 FAIL**:
- `20260829T235511Z` (off-schema): 2 divergences (bare-int phases + top-level status, no `task:` block) → **FIXED → 0 divergences, conformant, status+phases derivable**.
- `20260830T002503Z` (M2, already conformant): **idempotent no-op** (unchanged).

Hook end-to-end (synthetic PostToolUse/Edit payload in the live-observed shape):
- **shadow mode** → writes conformant `orchestrator-state.canonical.yml`, working file **untouched** (still off-schema) — drift-safe.
- **in-place mode** → working file rewritten to conformant.

## Why shadow is the default (the empirical blocker)
Copilot writes `orchestrator-state.yml` via **incremental `*** Update File:` apply-patch hunks** — observed **6–18 per run** in persisted traces. A hook that **rewrites the working file in place** would desync it from what the model believes it wrote, so the next `*** Update File:` patch can fail on context mismatch. Shadow mode (`STATE_NORMALIZER_MODE=shadow`, default) sidesteps this by writing a canonical **sibling** and never touching the working file. `in-place` is opt-in, gated on a live test of whether the workflow re-reads state before each patch.

## Companion — IMPLEMENTED on this branch (drives the end-to-end proof)
`run.mjs findStateYaml` now **prefers `orchestrator-state.canonical.yml` when present** and returns its
source, which the report **names** (`State source: canonical shadow — normalizer hook active`) — never a
silent preference (per [ADR 0001](../../../../../../docs/adr/0001-copilot-orchestrator-state-conformance.md)).

**Credit-free end-to-end proof** (replay of the real off-schema bundle `20260829T235511Z`):

| | Verdict | `state_schema` |
|---|---|---|
| baseline (no shadow) | AS-EXPECTED — 14 PASS · **1 LIMITATION** · 0 FAIL | `off-schema` |
| + shadow + companion | AS-EXPECTED — 14 PASS · **0 LIMITATION** · 0 FAIL | **`conformant`** |

Full L2 unit suite still 137 pass / 0 fail / 2 skip; `make build` / `validate` / `check-deterministic` green.

## Now WIRED into the build (this branch)
The shipped files live in `platforms/copilot-cli/hooks-overrides/` (`normalize-orchestrator-state.sh`,
`canonicalize-orchestrator-state.mjs`); `build.sh` WS2e/WS2f copies them into `plugins/maister-copilot/hooks/`
and registers a `PostToolUse:Edit` entry (default mode **shadow**). Verified: `make build` / `validate` /
`check-deterministic` green (byte-identical rebuild with the hook), L2 suite 137/0/2, L1 `--no-live` AS-EXPECTED.

## Remaining gates before this is a real (mergeable) PR
1. ~~Extractor companion~~ — **done** (above).
2. ~~Build wiring~~ — **done** (WS2e/WS2f).
3. **In-place safety / shipped-mode decision:** shadow's only consumer is the L2 harness — a real user gets an
   unread sidecar + a per-edit `jq` tax. A live `in-place` drift test decides whether we upgrade to in-place
   (real user parity, no sidecar) or keep shadow / a documented LIMITATION. **This is the deciding gate — see ADR 0001.**
4. **L1 coverage for the new hook:** the PostToolUse normalizer has no L1 check yet (only the 3 original hooks).
5. **Scope:** fixes the two conformance-oracle sites; full structural schema parity is broader.

## Correction logged (honesty)
An earlier #57 comment claimed off-schema state "knocks out `task_status(completed)`". The extractor's
`parseTaskStatus` **fallback** reads a top-level `status:` (indent ≤2) and *returns* it (flagging a
divergence), so the observed off-schema shape (`orchestrator.status`) still yields `task_status`. The
N=3 `task_status(completed)` 1/3 flap therefore has an **undetermined** cause (likely status serialized
at a non-fallback-readable position in 2 runs), not simply off-schema. This prototype's proven win is
`state_schema(conformant)`; its effect on the `task_status` flap is contingent on that flap's real cause.
