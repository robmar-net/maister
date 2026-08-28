# Copilot CLI Conformance & Compatibility — Runbook

How we verify that the generated **maister-copilot** variant, on a live GitHub Copilot CLI,
**conforms to maister's documented workflow model** (the `SKILL.md` files), where we record
results, and the gotchas learned the hard way. The repo docs are the **source of truth** for
each claim; the wiki summarizes and links back to them. Downstream-only (see
[`AGENTS.md`](../AGENTS.md)): we adapt to upstream + Copilot CLI changes; we never push upstream.

## The three test layers

| Layer | What it proves | Entry point |
|-------|----------------|-------------|
| **L0 — wiring/runtime (WS7)** | The built plugin LOADS on a live Copilot CLI: plugin/skills/agents register, `task(agent_type)` delegates, `skill()` invokes, hooks fire, `.mcp.json` loads (7 contracts). | `make test-copilot` → `compat-tests/run.sh` |
| **L1 — hook effects** | Each maister hook's EFFECT on Copilot (or an honest LIMITATION where it's a no-op/adapted). | `make test-hooks` → `compat-tests/l1-hook-effects.sh` |
| **L2 — workflow-model conformance** | A whole workflow's TRACE (delegations, skills, gates, artifacts, phases, terminal) conforms to a committed workflow-model reference — the behavioral conformance check. | `make test-l2` → `compat-tests/l2/run.sh` |

## Running it

### Credit-free (no seat, no AI credits) — run these freely
```bash
make build && make validate          # static conventions of the generated variant
make check-deterministic             # byte-identical rebuild (cross-OS invariant)
node --test platforms/copilot-cli/compat-tests/l2/test/*.test.mjs   # L2 pure-module + pipeline unit suite
bash platforms/copilot-cli/compat-tests/l2/run.sh --check-reference  # L2 reference staleness/tamper (per scenario)
```

### Live (needs an authenticated Copilot seat; SPENDS AI CREDITS)
```bash
make test-copilot                                                   # L0 / WS7 (one scripted session)
make test-hooks                                                     # L1 (one session)
COMPAT_L2_YES=1 bash platforms/copilot-cli/compat-tests/l2/run.sh --scenario=research      # L2, lighter
COMPAT_L2_YES=1 bash platforms/copilot-cli/compat-tests/l2/run.sh --scenario=development   # L2, HEAVIEST
```
- `COMPAT_L2_YES=1` (or `--yes` to `run.mjs`) confirms the credit spend non-interactively; otherwise it prompts / fail-closes.
- `COMPAT_KEEP_RUNDIR=1` keeps the sandbox rundir (inspect `orchestrator-state.yml` for deviations).
- **`development` is expensive** (full analyse→spec→plan→implement→verify; ~20-25 min). Run it in the background — it will exceed a foreground timeout.
- Verdicts (exit code): **AS-EXPECTED** (green) / **REGRESSED** (real divergence) / **INCOMPLETE** (no verdict — timeout / session error / sanity-floor; NOT a pass, NOT a regression).

## Where results are recorded — the **fork wiki**

Live conformance/compat results are recorded on the **`robmar-net/maister` wiki** (not in-repo — the
timestamped reports under `compat-tests/reports/` are **git-ignored** run artifacts). Update the wiki
after a meaningful live run:

- **[Compatibility-Matrix](https://github.com/robmar-net/maister/wiki/Compatibility-Matrix)** — the living matrix, one row per `(maister version, Copilot CLI version, OS)` × layer (L0/L1/L2). This is the headline record.
- **[L2-Trace-Equivalence](https://github.com/robmar-net/maister/wiki/L2-Trace-Equivalence)** — L2 (workflow-model conformance) design + per-scenario status; the page keeps its historical name/URL.
- **L0-Wiring-Contracts**, **L1-Hook-Effects**, **Copilot-CLI-Runtime-Notes**, **Running-the-Tests**, **Testing-Framework-Overview**, **Home**.

Clone/edit the wiki: `git clone https://github.com/robmar-net/maister.wiki.git`.

## Cost — where to read it

Copilot's SDK/CLI usage is NOT in `~/.copilot/data.db` (`sessions` is empty there). The authoritative
per-request cost is:

- **`~/.copilot/session-store.db` → `assistant_usage_events`** — one row per request; **AIU = `total_nano_aiu` / 1e9**, weighted premium requests ≈ `SUM(request_multiplier)`; scope by `created_at` (ISO).
```bash
sqlite3 ~/.copilot/session-store.db \
  "SELECT printf('%.1f',SUM(total_nano_aiu)/1e9) AIU, printf('%.0f',SUM(request_multiplier)) req \
   FROM assistant_usage_events WHERE created_at >= '<ISO-start>';"
```
- L2 reports say "AIU: unknown" because 1.0.75+ SDK sessions carry no `session.shutdown` usage — read the DB instead.
- Rough guide: `research` L2 ≈ tens of AIU; `development` L2 ≈ a few hundred AIU (~1-2 dev runs can dent a monthly quota). Prefer credit-free checks; run live only when you must.
  **Caveat:** these figures were measured on Copilot 1.0.74–1.0.81; AIU weighting and request
  multipliers change across CLI versions, and per-run vs per-arc figures are NOT directly
  comparable — the `session-store.db` query above is the source of truth.

## Gotchas & maintenance history (READ before debugging a red/incomplete L2)

- **Copilot serializes `orchestrator-state.yml` in ≥3 shapes** (inherent LLM non-determinism). `extractor.parseState` needs a fallback per shape; a shape it can't parse trips the sanity floor to a **false INCOMPLETE** (not a regression). Known variants:
  1. `orchestrator.completed_phases: [1,2,5,…]` (bare integers) — handled (PR #39).
  2. `phase_summaries: { phase-1:, phase-2:, … }` map, no `completed_phases` — handled (PR #44).
  3. `phases: [ {id:N, name, status: completed}, … ]` sequence (`phase_summaries` uses NAMED keys) — 1.0.81 development.
  When a new variant appears: capture the state (`COMPAT_KEEP_RUNDIR=1`), add a fixture under `l2/test/fixtures/extractor/`, extend `parseState`, add a unit test, verify OFFLINE (no new live run needed to prove the parse).
- **INCOMPLETE ≠ FAIL.** The sanity floor fail-closes when state is unparseable while artifacts exist, to avoid a false REGRESSED. Check the classified diff — `NONE` means behavior conforms; the block is a parse gap, not a divergence.
- **`isMain` symlink false-green (fixed #43):** `run.mjs` compared `path.resolve(argv[1])` vs realpath-derived `import.meta.url`; on macOS `/tmp`→`/private/tmp` they disagreed → `main()` never ran → silent exit 0. Now compares realpaths.
- **Harness greps Copilot-internal log strings that change per CLI version.** The 1.0.76 Rust-runtime rewrite dropped the old `SessionAgentExecutor.execute()` (C4) and `Loaded MCP config …` (C7) lines; detection is now version-tolerant (PR #42). Expect to update detection on future CLI internals changes.
- **When to re-derive the L2 reference:** any change to maister's *workflow behaviour* (phase/delegation/gate/artifact) invalidates the reference → re-derive from the workflow model (the `SKILL.md` files). Generator-only (`build.sh`) changes do NOT — those are what L2 tests. Any reference edit must be logged per the governance rule in [`CALIBRATION-LOG.md`](../platforms/copilot-cli/compat-tests/l2/reference/CALIBRATION-LOG.md) (workflow-model citation or divergence justification required).

## Latest verified (maister 2.2.3)

| Layer / scenario | Copilot CLI | Verdict |
|---|---|---|
| L0 / WS7 (7 contracts) | 1.0.76 & 1.0.81 | ✅ 7/7 |
| L2 research | 1.0.81 | ✅ AS-EXPECTED (9/9, diff NONE) |
| L2 development | 1.0.81 | ✅ AS-EXPECTED (25/25, diff NONE) — post-#46 parser fix |
| L2 quick-bugfix | 1.0.81 | ✅ AS-EXPECTED (2/2 vs pre-calibration partition, diff NONE — see CALIBRATION-LOG note 4) |

_(Record each new live run in the [Compatibility Matrix](https://github.com/robmar-net/maister/wiki/Compatibility-Matrix).)_
