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

## Negative control (detection power)

A green L2 cell only proves the run didn't go red — the negative control proves L2 **can** go red.
It stages a deliberately broken TEMP COPY of the generated plugin (the real `plugins/maister-copilot`
is never touched) and expects a REGRESSED verdict naming the knocked-out predicate.

### One command (live; SPENDS AI CREDITS — ~1 research run, ~15 AIU)
```bash
COMPAT_L2_YES=1 bash platforms/copilot-cli/compat-tests/l2/run.sh --scenario=research --mutation=M2
```
**Expected: REGRESSED (exit 1)** with the classified diff naming exactly the intended knockout:
`delegated(research-planner)` | missing | candidate-regression, plus `delegated(research-planner-renamed)`
| extra. This is the **live-validated detection proof** (Stage-1, issue #48): M2 renames the agent
FILE (`agents/research-planner.md`) along with its frontmatter `name:` and the SKILL delegation
reference — the file rename is what changes the registered agent identity (see Findings below).

The M1 command still runs, but M1 is a **documented NON-detecting target** on quick-bugfix — do not
use it to prove detection power (see Findings, finding 1):
```bash
COMPAT_L2_YES=1 bash platforms/copilot-cli/compat-tests/l2/run.sh --scenario=quick-bugfix --mutation=M1
```
`--mutation=<id>` calls `l2/mutations/mutate.sh`, which copies the plugin into an id-named temp dir
(`l2-mutant-<id>-*` — the id shows up on the report's "Plugin under test" line as provenance), applies
one regex-anchored fail-closed edit, and repoints the plugin dir. The mutant is removed on exit;
`COMPAT_KEEP_RUNDIR` does not apply to it.

| Mutation | Target | Knocked-out predicate | Live status (Stage-1) |
|---|---|---|---|
| **M1** — gate-removed | `quick-bugfix` `SKILL.md` (plan-approval gate stripped) | `gate_fired(ask)` | **Live-run AS-EXPECTED — NOT a valid detector** on quick-bugfix: `gate_fired(ask)` is emitted by multiple `ask_user` sites (finding 1); stripping only the plan gate leaves siblings that mask it. Documented non-detecting target. |
| **M2** — delegation-renamed | `research`: agent FILE `agents/research-planner.md` + frontmatter `name:` + SKILL delegation reference all renamed `-renamed` (`development`: same pattern for `gap-analyzer`) | `delegated(research-planner)` / `delegated(gap-analyzer)` | **Live-validated REGRESSED** (research): missing `delegated(research-planner)` + extra `delegated(research-planner-renamed)` — exactly the intended knockout. **This is the detection proof.** |
| **M3** — artifact-suppressed | `development` + `research` `SKILL.md` (artifact instructions removed at anchored sites) | `created_artifact(spec.md)` / `created_artifact(research-report.md)` | Machinery-only; no live run (future spend gate) |

### Findings (live) — Stage-1 platform mechanics

Three discoveries from the 4-run Stage-1 exploration (full journey: the task's
`verification/negative-control-finding.md`), each binding on future mutation design:

1. **`gate_fired(ask)` is non-specific** — the extractor maps it from ANY `user_input.requested`
   event, and quick-bugfix has multiple independent `ask_user` sites besides the plan-approval gate.
   Stripping only the gate leaves siblings that still fire an ask → not a usable detection target
   on quick-bugfix (would need predicate sub-typing first).
2. **Renaming a SKILL delegation reference self-heals** — with the agent still registered, the model
   cannot resolve the renamed reference and routes to the real agent anyway; `delegated(<agent>)`
   still fires.
3. **Copilot registers plugin agents by FILENAME, not frontmatter `name:`** — renaming the
   frontmatter alone leaves the agent callable under its file stem. A `delegated()` knockout must
   rename the agent FILE (`agents/<agent>.md`). This is why M2 renames the file — and what finally
   produced the clean predicate-precise REGRESSED.

### Why M1 runs under a NEUTRAL prompt

The committed quick-bugfix scenario prompt itself instructs the model to "present a fix plan for
approval" — with the plugin's gate stripped, the model could still ask **because the prompt commands
it**, and the run would measure prompt-following, not the plugin contract (the M1 prompt confound;
decided in ADR-001 of the Stage-1 task analysis, trigger: spec-audit finding M-2). So for
`--mutation=M1` **only**, `run.sh` automatically exports `COMPAT_PROMPT_FILE` pointing at the
versioned `l2/mutations/m1-neutral-prompt.txt` — same seeded bug, "use the maister quick-bugfix
workflow", zero plan/approval phrasing. Positive (no-flag) runs never set it; env unset → `run.mjs`
default path is byte-identical.

### Acceptance (fail-closed)

**PASS requires ALL of** (for the validated M2/research control):
- exit code 1 and stdout verdict `REGRESSED`;
- the report's classified-diff contains the row `delegated(research-planner)` | missing | candidate-regression (an extra `delegated(research-planner-renamed)` row is expected alongside);
- the report's "Plugin under test" line shows an `l2-mutant-M2-*` path (mutation provenance in the artifact).

**Non-pass outcomes — the ADR-001 fallback ladder governs, verbatim** (original M1 plan, preserved
as run history — Stage-1 played out exactly per rung 2: M1 came back AS-EXPECTED, the finding was
documented, and M2 on research became the validated control):

> 1. **Run 1 (authorized):** M1 + neutral prompt → expect REGRESSED/`gate_fired(ask)`.
> 2. If **AS-EXPECTED** (model plans anyway out of trained habit, no prompt pressure): that is a
>    REAL finding — "quick-bugfix M1 is not detectable via the gate predicate on this model" —
>    document it; **do not retry blindly**. Next candidate: **M2 on research** (no confound by
>    construction) — requires a NEW explicit spend gate (~tens of AIU). Alternative cheap probe
>    first: rerun **credit-free** checks of the mutated copy to confirm the strip; the ladder decision
>    goes to the operator.
> 3. If **INCOMPLETE (harness-side)**: one retry (already authorized).
> 4. If **REGRESSED for a different predicate**: finding, not a pass — stop, report, operator gate.

**Re-run rule**: re-run the negative control after any grammar change (Stages 2–4) and on each new
Copilot CLI version alongside the positive run. This is formalized and extended per scenario in the
[L2 re-run cadence policy](#l2-re-run-cadence-policy) below.

### Cost

*(All figures in this section are pre-hygiene — instructions leaked; pre-#120 hook — see ADR 0007; not back-filled.)*
The validated M2/research (agent-file rename) run cost **14.79 AIU / 60 weighted requests**. The
full Stage-1 negative-control exploration cost **~39.97 AIU / 180 requests across 4 runs**
(M1 1.44, M2 v1 13.91, M2 v2 9.83, M2 v3 14.79). Measure future negative-control runs with the query in
[Cost — where to read it](#cost--where-to-read-it) — but record the ISO start AND end timestamps and
bound the query at BOTH ends (`created_at >= '<ISO-start>' AND created_at <= '<ISO-end>'`); the base
query bounds only the start and would sweep in later sessions. Since #122 the bundle is the primary source
(`cost-report.mjs reports/<ts>`) and the query is the cross-check.

> **Research cost is highly variable — do NOT budget `N × single-run`.** A `research` drive that
> *skips* brainstorming/design (a "narrow investigation" the model self-routes past) costs ~13–14 AIU;
> one that *executes* them runs ~5–7× that. Observed live: single foundation/skip runs 13.21 / 13.96 AIU,
> but a `--runs=3` noise calibration (2026-08-30, Copilot 1.0.82) cost **275.14 AIU / 244 req** because
> 1 of the 3 drives went deep (`gate_count(ask)=9`, full brainstorming+design). Estimate research N>1
> against the **deep-run** cost (~90–100 AIU/run), not the skip-run cost, and gate the spend accordingly.
> N>1 **does** persist one replay bundle per run — `reports/<ts>/run-<i>/` (`run.mjs` `persistDirFor`;
> `test/replay-multirun.test.mjs`) — but its `replay-meta.json` carries `cost: null` (the DB window read is
> per sweep, not per run). Per-run cost and verdict come credit-free from the bundle:
> `node platforms/copilot-cli/compat-tests/l2/tools/cost-report.mjs reports/<ts>/run-<i> [--verdict]`
> (or `run.mjs --replay=reports/<ts>/run-<i>`). *(The pre-#122 text here said N>1 does not persist; it did.)*

## L2 re-run cadence policy

L2 is the **occasional** layer (L0/L1 are the per-build guardrails; L2 runs on demand). This policy
formalizes and extends the negative-control [re-run rule](#negative-control-detection-power) into a
per-scenario cadence so the workflow-model references do not drift silently between explicit runs.

**Triggers — when to re-run which scenario:**

- **On EVERY Copilot CLI version bump** — re-run the **quick-bugfix** L2 scenario **and** the
  **negative control** (the M2/research mutant) alongside the positive run. A CLI bump is the highest
  drift risk (the harness greps Copilot-internal log strings that change per version), so the cheap
  positive+negative pair is mandatory on each new CLI release.
- **Research — monthly.** Re-run the **research** scenario at least once a month to catch slow
  behavioural drift that no CLI bump surfaced.
- **Development — quarterly, OR on a triggering generator change.** Re-run the **development** scenario
  every quarter, **or** immediately whenever a generator change touches the orchestrator `SKILL.md`
  **rewrite rules** or anything under **`hooks-overrides/`** — both alter the workflow behaviour the L2
  reference models, so they invalidate the reference out-of-band from the calendar cadence.

Any reference re-derivation triggered by these runs is logged per the governance rule in
[`CALIBRATION-LOG.md`](../platforms/copilot-cli/compat-tests/l2/reference/CALIBRATION-LOG.md).

### Hooks at L2 — the `destructive-guard` witness contract

The `destructive-guard` micro-scenario promotes `hook_effect` from a dead grammar entry to a live L2
predicate by **observing** the Copilot guard's decision rather than asserting a hard-coded outcome:

- **Witness = observe the real decision.** The `observe-destructive-guard` `onPermissionRequest`
  responder reads the hook decision off the request —
  `req.permissionDecision ?? req.hookSpecificOutput.permissionDecision` — together with the
  `Maister guard: destructive command` reason marker, and records `hook_effect(destructive_guard=ask)`
  to a per-run `hookDecisions` sink. `=ask` is witnessed / contract-derived from the deterministic
  [`block-destructive-commands.sh`](../platforms/copilot-cli/hooks-overrides/block-destructive-commands.sh)
  contract, **never fitted** to a run.
- **Credit-free build over a recorded fixture.** The emit is proven credit-free: a synthetic request
  plus a faithful recorded `permission.requested` fixture (`kind`+`command`+`requestId` only — **no**
  fabricated decision field) drive the extractor through `extract({…, hookDecisions})`.
- **DEFERRED PAID — the exact live `PermissionRequest` shape.** Whether the SDK actually hands the
  responder the hook decision on `req` is only knowable from a live seat-consuming run; that
  confirmation is a deferred paid follow-up. The responder is therefore built **defensively** —
  nullish-coalesced reads plus a **command-regex fallback** (mirroring the hook's own destructive
  regex) so the emit still lands from the observed `rm -rf …` command if the decision field is absent.
- **Replay-faithful.** The `hookDecisions` sink is per-run observed data (unlike `gateMap`/`minCounts`,
  which replay re-derives from the scenario), so it is persisted into `replay-meta.json` and read back
  by `runReplay`. A `--replay` of a destructive-guard bundle therefore reproduces
  `hook_effect(destructive_guard=ask)` exactly; dev/research/quick-bugfix bundles persist an empty sink
  → replay stays byte-identical.

## Where results are recorded — the **fork wiki**

Live conformance/compat results are recorded on the **`robmar-net/maister` wiki** (not in-repo — the
timestamped reports under `compat-tests/reports/` are **git-ignored** run artifacts). Update the wiki
after a meaningful live run:

- **[Parity-Map](https://github.com/robmar-net/maister/wiki/Parity-Map)** — the **per-behavior** map (`maister-copilot` vs documented maister), keyed by behavior not version: ✅ verified · 🟢 adapted · 🟡 limitation · 🔴 gap · ⚪ unverified, with an honest header count of the ⚪ rows. Every row's status links its evidence; every 🟡 must carry a fix-or-why-not (ADR), never "only visibility" (#76). **Update rule (same discipline as the matrix):** every live run, every `build.sh`/hook adaptation, and every new allowlist/optional/rule entry MUST update the corresponding Parity-Map row(s). Refresh evidence with `node platforms/copilot-cli/compat-tests/l2/tools/parity-evidence.mjs <reports/<ts>>` over the persisted bundles; the CI guard (`parity-coverage.mjs` → `docs/parity/inventory.json`) fails the build when an upstream skill/agent/command/hook is added/removed until the snapshot **and** the map absorb it. The page's **header census** is generated, never hand-counted: after editing the map run `node platforms/copilot-cli/compat-tests/l2/tools/parity-header.mjs <wiki-clone>/Parity-Map.md` and paste the printed line; CI re-checks it on every wiki edit (`wiki-census-check.yml`, `gollum`-triggered, `--check`).
- **[Compatibility-Matrix](https://github.com/robmar-net/maister/wiki/Compatibility-Matrix)** — the living matrix, one row per `(maister version, Copilot CLI version, model, OS)` × layer (L0/L1/L2). This is the headline record. **Re-run policy:** re-run the live layers (and record a new matrix row) on each new Copilot CLI release **and** on a model change (a different requested/served model is a distinct matrix cell — cost and behaviour are not comparable across models).
- **[L2-Trace-Equivalence](https://github.com/robmar-net/maister/wiki/L2-Trace-Equivalence)** — L2 (workflow-model conformance) design + per-scenario status; the page keeps its historical name/URL.
- **L0-Wiring-Contracts**, **L1-Hook-Effects**, **Copilot-CLI-Runtime-Notes**, **Running-the-Tests**, **Testing-Framework-Overview**, **Home**.

Clone/edit the wiki: `git clone https://github.com/robmar-net/maister.wiki.git`.

## Cost — where to read it

**Bundle-first (#122, ADR 0007).** Every L2 drive persists its typed trace in `reports/<ts>/events.json`
(or `reports/<ts>/run-<i>/` for N>1), and each `assistant.usage` event carries `copilotUsage.totalNanoAiu`
plus a per-class `tokenDetails[]` with the price actually charged. The cost of a bundle is therefore
derivable **exactly, credit-free, from the bundle alone** — proven on `20260903T000910Z`: Σ `totalNanoAiu`
/ 1e9 = **36.99498 AIU** = the DB window read = `session.usage_checkpoint`, Δ 0.000000.

```bash
node platforms/copilot-cli/compat-tests/l2/tools/cost-report.mjs <bundle> [--json] [--recover] [--verdict]
```
- default: markdown — AIU total / by class (`input`, `cache_read`, `cache_write`, `output`) / by model / by
  agent, the covariates (`systemTokensInitial`, `toolDefinitionTokens`, reads, skill bytes, cache breaks,
  gates, hook fires, wall minutes, served models), the cross-check rows against `meta.cost` and the
  checkpoint, and the bundle's provenance (arm, digest, source commit, or the legacy-map row). Every metric
  is `null` when its source event is absent — never 0.
- `--json`: the same as one deterministic object. `--recover`: the plugin dir the drive actually loaded,
  read from `skill.invoked.data.path` (for pre-provenance bundles; `null` + reason when there is no
  path-bearing event). `--verdict`: one line `verdict: <AS-EXPECTED|REGRESSED|INCOMPLETE> PASS n ·
  LIMITATION n · SKIP n · FAIL n (scenario <id>, reference <hash8>[, reason])`, exit 0/1/2 — the same derivation
  `--replay` uses, **without writing a report** (it does restage `rundir/run-tests.sh` for the outcome
  oracle — an mtime bump, bytes identical; [#127](https://github.com/robmar-net/maister/issues/127)).
- Read-only: `cost-report.mjs` never writes into the bundle.

**Cross-check (was the source of truth before #122).** Copilot's SDK/CLI usage is NOT in
`~/.copilot/data.db` (`sessions` is empty there); the billing record is
**`~/.copilot/session-store.db` → `assistant_usage_events`** — one row per request; **AIU =
`total_nano_aiu` / 1e9**, weighted premium requests ≈ `SUM(request_multiplier)`; scope by `created_at`
(ISO). Use it to confirm a bundle total or to cost a session that left no bundle — the bundle wins on any
disagreement, because the DB window can sweep in other sessions (see "Scope by `session_id`" below).
```bash
sqlite3 ~/.copilot/session-store.db \
  "SELECT printf('%.1f',SUM(total_nano_aiu)/1e9) AIU, printf('%.0f',SUM(request_multiplier)) req \
   FROM assistant_usage_events WHERE created_at >= '<ISO-start>';"
```
- Pre-#122 L2 reports say "AIU: unknown" because 1.0.75+ SDK sessions carry no `session.shutdown` usage;
  `meta.cost` on a persisted bundle is that DB window read (null on N>1 per-run bundles) — run
  `cost-report.mjs` on the bundle instead.

### AIU is an exact linear function of tokens (#110)

`total_nano_aiu` is not opaque: it is Σ over four token classes of `tokenCount × price`. **The primary
source of the price is the bundle itself** — each `assistant.usage` event's
`copilotUsage.tokenDetails[] {tokenType, tokenCount, costPerBatch, batchSize}` records the rate actually
charged for that request (`costPerBatch / batchSize × 1e6 / 1e9` = AIU per 1 M tokens), and
`cost-report.mjs` re-reads it **per event**, so a mid-sweep re-pricing cannot skew a total. The table
below is the `KNOWN_RATES` constant it cross-checks against (`price check` column: `ok` /
`drift: <class> observed X expected Y` / `no cross-check row`) — a **staleness detector**, not a model
catalog (#129): it may disagree, it never enters a total, and a model missing from it is an absence of
evidence, not a defect (the provider's model list rotates faster than this table). A `drift:` row also
prints a visible warning line under the report's `## By model` table:

| model | `input` | `cache_read` | `cache_write` | `output` | (AIU per 1 M tokens) |
|---|---|---|---|---|---|
| `gpt-5.6-luna` | 20 | 2 | 25 | 120 | observed on all six 1.0.82 bundles |
| `gpt-5.4-mini` | 75 | 7.5 | 0 | 450 | observed (`explore` subagents) |
| `claude-haiku-4.5` | 100 | 10 | 125 | 500 | from the 2026-08 DB fit (below) |
| `claude-sonnet-4.6` | 300 | 30 | 375 | 1500 | from the 2026-08 DB fit (below) |

Note the fourth class: **`cache_write`** is billed (luna 25 vs 20 for fresh input) — the earlier 3-class
fit folded it into `fresh_in`, which is why that fit could only match models whose cache-write rate
equals the input rate.

**History — the 3-class per-1k fit (2026-08).** Before the bundle carried `tokenDetails`, the table was
recovered by fitting `total_nano_aiu` against `(fresh_input, cache_read, output)` per model over 6,555
local 1.0.82 requests in `session-store.db`; predicting from it reproduced the recorded value with a
**mean absolute error of 0.00000 AIU/request for `gpt-5.4` (n=1162) and `gpt-5.4-mini` (n=530)**
(0.001–0.002 for the smaller Claude samples). Kept as the record of how the linearity was first shown;
the per-1k rates are the per-1M rates above ÷ 1000:

```
AIU = fresh_in/1000 * r_f  +  cache_read/1000 * r_c  +  output/1000 * r_o
      where fresh_in = input_tokens - cache_read_tokens
```

| model | `r_f` (fresh in) | `r_c` (cached in) | `r_o` (output) |
|---|---|---|---|
| `gpt-5.4` | 0.250 | 0.025 | 1.500 |
| `gpt-5.4-mini` | 0.075 | 0.0075 | 0.450 |
| `gpt-5.6-terra` | 0.3125 | 0.025 | 1.500 |
| `claude-sonnet-5` | 0.250 | 0.020 | 1.000 |
| `claude-sonnet-4.6` | 0.375 | 0.030 | 1.500 |
| `claude-haiku-4.5` | 0.125 | 0.010 | 0.500 |
| `gemini-3.5-flash` | 0.150 | 0.015 | 0.900 |

Three consequences for how this project spends credits:

1. **Output costs 4–6× fresh input and 40–60× cached input per token.** Chatty artifacts are not free.
2. **Cached context is re-billed every turn** (~10% of the fresh rate), so run cost ≈
   `context_size × turn_count`. Anything that adds *turns* is expensive even when it adds no words.
3. **A saving can be predicted credit-free** from token/byte deltas and the table above — spend
   credits only to confirm the prediction and the conformance/oracle verdicts.

Two cautions, both load-bearing:

- **Rates are re-priced in place.** `gpt-5.6-luna` moved 0.137 → 0.027 AIU/1k fresh input between
  2026-07 and 2026-08, which is why a single fit across its history lands at R²≈0.45 while every
  other model is 1.000. Re-derive after a CLI release or a model rotation — an independent reason the
  matrix is keyed by `(maister, CLI, model, OS)`.
- **The public GitHub billing docs describe a different meter.** They present "one premium request per
  prompt × model multiplier" — that is the legacy `request_multiplier` column (still recorded, still
  worth reporting), NOT the token-metered AIU this runbook treats as authoritative. Reasoning from the
  docs alone leads to the wrong conclusion that output length is free.

Cross-check the table against the local store (credit-free — reads only, no session is driven); the
bundle's `tokenDetails` remain the primary source:

```bash
sqlite3 ~/.copilot/session-store.db \
  "SELECT model, COUNT(*) n, SUM(input_tokens-cache_read_tokens) fresh, \
          SUM(cache_read_tokens) cached, SUM(output_tokens) out, \
          ROUND(SUM(total_nano_aiu)/1e9,3) aiu \
   FROM assistant_usage_events GROUP BY model ORDER BY n DESC;"
```

**Scope by `session_id`, not the window alone (#63 item 5).** A both-ends `created_at` window still
**double-counts** when other Copilot activity (a concurrent CLI, or the overlapping windows of an N>1
sweep) falls inside it. `assistant_usage_events` carries a per-request `session_id`; `readCost` now scopes
the SUM to the run's session **when a `sessionId` is supplied and the column exists**, else it falls back
to the window-only SUM (unchanged). It also does `GROUP BY model` to fill the run's *actual* model from
the **billing record** (more reliable than the often-empty `session.shutdown` usage). The `run.mjs`
side captures the SDK `ctx.sessionId` best-effort from the input handler (a run that fires no gate has no
session id → window-only).
```bash
# session-scoped, per-model (the precise read):
sqlite3 ~/.copilot/session-store.db \
  "SELECT model, printf('%.1f',SUM(total_nano_aiu)/1e9) AIU, printf('%.1f',SUM(request_multiplier)) req \
   FROM assistant_usage_events \
   WHERE created_at >= '<ISO-start>' AND created_at <= '<ISO-end>' AND session_id = '<session-id>' \
   GROUP BY model;"
```
> ✅ **LIVE SCHEMA CONFIRMED (2026-08-30, Copilot 1.0.82) — gap narrowed.** The column names `session_id`
> and `model` **are present on a real `session-store.db`** — verified **credit-free** by pointing `readCost`
> at the operator's own DB: the `pragma_table_info` probe activated both refinements, the session filter
> scoped correctly (a real busy session read 160 AIU vs 292 AIU window-only), and `GROUP BY model` returned
> a real per-model split (`claude-sonnet-4.6` 232 AIU + `gpt-5.6-luna` 60 AIU). ✅ **`ctx.sessionId` ↔ DB
> `session_id` CORRELATION CONFIRMED** by the item-9 development drive (1.0.82, run `20260830T155522Z`):
> the run captured `ctx.sessionId` and its session-scoped `readCost` returned **47.49 AIU** — the real
> non-zero total of DB session `9489d88c…` (a non-matching id would have summed to ~0), proving the SDK id
> is a valid `assistant_usage_events.session_id` key. The double-count-avoidance *value* is shown
> separately by the multi-session read above (160 vs 292 AIU). The item-5 gap is now fully closed; the
> schema-probe still degrades safely on any future name change.
- Rough guide: `research` L2 ≈ tens of AIU; `development` L2 ≈ a few hundred AIU (~1-2 dev runs can dent a monthly quota). Prefer credit-free checks; run live only when you must.
  **Caveat:** these figures were measured on Copilot 1.0.74–1.0.81 and are **pre-hygiene (instructions
  leaked; pre-#120 hook)** — every drive before #122 carried the operator's custom instructions
  (≈ 15 K tokens per main prompt, ADR 0007); they are NOT back-filled or corrected. AIU weighting and request
  multipliers change across CLI versions, and per-run vs per-arc figures are NOT directly
  comparable — the `session-store.db` query above is the source of truth.

  **Reconciliation (issue #48 historical figures).** The figures cited in issue #48 — e.g.
  ~320 AIU / 232 requests for one 1.0.75 `development` run vs ~152 AIU / 662 requests for the whole
  1.0.81 arc — are **NOT directly comparable and are NOT reproducible cross-version**: one is
  per-run and the other per-arc, and both the AIU weighting and the `request_multiplier` changed
  across those CLI versions. They are deliberately **NOT transcribed or back-filled into this repo**
  (they can't be reproduced, so pinning them here would be fitting numbers to a single vanished run).
  Going forward the single source of truth is the `session-store.db` query above, **bounded at BOTH
  ends** (`created_at >= '<ISO-start>' AND created_at <= '<ISO-end>'`) — the start-only base query
  sweeps in later sessions and overcounts. Record the ISO window with each live run and read the cost
  from the DB; do not carry historical figures forward. All figures on this page dated before #122
  (2026-09-04) are **pre-hygiene (instructions leaked; pre-#120 hook)**; the first `plain` drive of #123 is
  the new baseline and nothing older is back-filled against it.

### Pinning the model (`COMPAT_L2_MODEL`) + deferred live confirmation

- **`COMPAT_L2_MODEL`** — env that pins the *requested* model for a live L2 run (metadata only; it is
  threaded into `createSession({model})` defensively and surfaced in the report header, the stdout
  verdict line, and the persisted `replay-meta.json`, but it is **never a conformance predicate** — the
  workflow-model grammar, references, hashes, and snapshots are unchanged). Resolution precedence is
  `opts.model ?? COMPAT_L2_MODEL ?? scenario.model` (scenario default is `null` = account/SDK default).
  There is **no `--model=` CLI flag** this stage; the env var is the only override. A requested model
  that the runtime-resolved SDK does not recognise may be silently ignored; the report degrades the
  *actual* model to `unknown` when `modelMetrics` is absent (now back-filled from the `GROUP BY model`
  billing read when available — #63 item 5), and requested-vs-actual divergence is surfaced rather than
  asserted.
- **Default model pin — DECISION (#63 item 5): keep the harness default UNPINNED (`null` = account/SDK
  default).** Rationale: (1) a hard-pinned model the seat lacks would **fail closed** and make every live
  run INCOMPLETE — worse than recording whatever the account serves; (2) the served model is a distinct
  **matrix cell** (cost and behaviour are not comparable across models), so the source of truth is the
  *actual* model **recorded per run** (now read from the billing record), not a repo-side pin; (3) the
  workflow-model references/hashes are model-independent, so a pin would add a failure mode without adding
  conformance signal. **For cross-run comparability**, an operator SHOULD pin explicitly via
  `COMPAT_L2_MODEL=<model>` for a given sweep (the latest-generation Claude, e.g. `claude-opus-4-8`, is the
  sensible choice when the seat has it) and record that value alongside the actual served model in the
  matrix row. The default staying unpinned is the safe, honest baseline; the explicit pin is the operator's
  comparability lever.
- **DEFERRED paid live confirmation (operator-gated).** Two things remain **unconfirmed credit-free** and
  are the single seat-consuming follow-up, gated behind explicit operator approval (no spend without it):
  (1) does `createSession({model})` actually **pin the served model** (vs the SDK ignoring an unknown
  key), and (2) does the **post-run cost window read correctly** against a real live `session-store.db`
  (both-ends bound over the run's ISO window). Everything else in this stage is proven credit-free over a
  committed fixture DB + unit tests; this live pin+read is the only item that consumes a seat and is
  therefore held back.

### A/B arms (#122, ADR 0007) — staged from a pinned commit, self-describing bundles

```bash
bash platforms/copilot-cli/compat-tests/l2/run.sh --variant=<arm> --commit=<sha> [--scenario=<id>]   # SPENDS AI CREDITS
```
`--variant=<arm>` stages a THROWAWAY copy of `plugins/maister-copilot` from **`git archive <sha>`**
(never the working tree — another session switching branches cannot contaminate an arm) via
`l2/variants/variant.sh`, applies the arm's manifest transforms to that copy, and drives it. The pin is
mandatory: `--commit=<sha>` or env `COMPAT_VARIANT_COMMIT` (the flag wins). Pin for a sweep, always:
`COMPAT_L2_MODEL=gpt-5.6-luna`, Copilot CLI **1.0.82**, an explicit commit, and the same reference hash
across arms (recorded per bundle as `referenceHash`).

**Env the harness accepts** (each is persisted in the bundle's `replay-meta.json`):

| env | set by | meaning |
|---|---|---|
| `COMPAT_VARIANT_COMMIT` | operator (or `--commit`) | commit the arm is staged from; ignored without `--variant` |
| `COMPAT_L2_HTML_OUTPUT` | operator, `0` \| `1` | `html_output` seeded into `<rundir>/.maister/config.yml` (every scenario but `init`); manifest wins, else this, else `1`; `run.sh` resolves it once and re-exports it normalized so its mirror rundir and `run.mjs`'s agree; anything but `0`/`1` → exit 2 |
| `COMPAT_L2_SKIP_INSTR` | operator, `0` \| `1` | `createSession` `skipCustomInstructions`; manifest wins, else this, else **`1`** (hygiene default) |
| `COMPAT_L2_EXCLUDED_TOOLS` | operator, comma list | `createSession` `excludedTools` (e.g. `mcp:playwright`); manifest wins, else this, else absent |
| `COMPAT_L2_EFFORT` | operator | `createSession` `reasoningEffort` (e.g. `low`); manifest wins, else this, else absent |
| `COMPAT_VARIANT`, `COMPAT_ARM_MANIFEST`, `COMPAT_VARIANT_COMMIT` | **exported by `run.sh`** on a `--variant` run | arm name, path to `l2/variants/arms/<arm>.json`, pin — never set by hand |
| `COMPAT_MUTATION` | **exported by `run.sh`** on a `--mutation` run | mutant id (mutants self-describe too) |
| `COMPAT_ARMS_DIR` | `variants.test.mjs` only | manifest-dir seam of `variant.sh`; `run.sh` never sets it |

**The five manifests** (`l2/variants/arms/<arm>.json`, `manifestSchema: 1`; every arm states
`skipCustomInstructions` explicitly):

| arm | role |
|---|---|
| `plain` | hygiene-corrected control for every delta — the new reference baseline (no transforms) |
| `plain-legacy` | `plain` with the custom-instruction leak re-admitted (`skipCustomInstructions: false`): quantifies the leak once and bridges `20260831T022952Z` informationally |
| `lean` | low-risk product bundle: `excludedTools: ["mcp:playwright"]` + `html_output: false` + the leaf-worker guard appended to **all 25** `agents/*.md` (ADR 0007 Decision 7) |
| `caveman` | falsification arm: the condensed Caveman rules spliced into the SessionStart `additionalContext` of the staged copy; expected LIMITATIONs/REGRESSED are the finding — never relax a reference |
| `terse` | round 2 (#125), staged not scheduled: the narrowed no-narration rule; enters only if `caveman` moves T1 AIU beyond the `plain` spread |

**`variant.sh <arm> --commit=<sha>`** (`bash l2/variants/variant.sh -h`): stdout is exactly one line —
the staged path; the final stderr line is `variant.sh: <arm> staged from <commit> (tree <oid>) digest
sha256:<…> at <path>`. Exit **2** = usage / unknown arm / missing `--commit` / bad manifest / unknown
commit or no plugin tree — **nothing created**; exit **1** = archive, anchor or verification miss — the
partial copy is **removed**; exit **0** = extracted, transformed, every invariant verified against a second
pristine extraction. `run.mjs` is the sole authority for the persisted `pluginDigest` / `treeOid` /
`referenceHash` (computed before the credit-spend confirm — `variant.sh`'s stderr digest is informational,
not a second channel); any provenance failure is exit 2 and spends nothing.

**Parse-time rejects, credit-free.** Unknown arm (`--variant=bogus`), `--variant` with `--mutation`
(mutually exclusive), `--variant` without a pin, `--commit` without `--variant` — all exit 2 in `run.sh`
**before** `--check-reference`, the sandbox allowlist and the seat preflight. The credit-freeness of
`--variant=bogus` comes from that parse-time reject, NOT from `NO_COPILOT_PATH` (which `run.sh` ignores).
`--keep-rundir` / `COMPAT_KEEP_RUNDIR` do **not** retain a staged arm (same as mutants).
`--check-reference` is unaffected by `COMPAT_L2_HTML_OUTPUT`.
An invalid arm name — path-shaped, dot-leading or dash-leading (`--variant=../plain`, `.plain`, `-x`),
or any character outside letters, digits, `. _ -` (matched under `LC_ALL=C`) — is the fifth parse-time
reject, before the manifest lookup; `run.sh`'s rule is a superset of the charset rule `variant.sh` applies
(which does not need the leading-dash case: its own arg parser already refuses `-`-prefixed tokens).
A sixth exit-2 path guards case-insensitive filesystems: when `--variant=PLAIN` resolves to `plain.json`
on APFS, the manifest read compares `arm` with the typed name and exits 2 with
`arm/manifest name mismatch` — still before the seat preflight, the trap and the de-shadow.

**Env hygiene before a sweep.** `env | grep COMPAT_L2_` must be **empty except `COMPAT_L2_MODEL`**: an
ambient `COMPAT_L2_SKIP_INSTR` / `COMPAT_L2_HTML_OUTPUT` / `COMPAT_L2_EXCLUDED_TOOLS` / `COMPAT_L2_EFFORT`
silently alters a `plain` arm (it is recorded in the bundle's `sessionOptions` / `sandboxSeeds`, but nothing
compares it across arms). `run.mjs` resolves and validates every seam **once, before the credit-spend
confirm** (a typo such as `COMPAT_L2_SKIP_INSTR=yes` is exit 2, nothing spent) and passes the resolved
objects into every drive.

**What the report header now says** (live and `--replay` render byte-identically for a v2 bundle):
`Plugin under test` / `Variant` / `Plugin source` (`git-archive <oid8> (tree <oid8>, version <v>)` — the
pin is resolved to its 40-hex commit oid at drive time and stored as `pluginSource.commit`, the operator's
spelling kept as `pluginSource.commitRef` and shown as `(ref <spelling>; …)` only when it differs — or
`working-tree (version <v>)`) / `Plugin digest` (`sha256:…`) / `Session options` (the exact object passed
to `createSession`). For a `git-archive` bundle the `Plugin under test` line leads with the durable identity,
`` `git-archive <oid8> (tree <oid8>)` (name: `maister-copilot`; staged at `<vanished mktemp path>`) ``; a
working-tree bundle keeps the plain recorded path. A pre-provenance bundle (`metaSchema < 2`) listed in the committed
`l2/variants/legacy-arms.json` renders `<legacyArm> (legacy map — pre-provenance bundle)` with the
recovered plugin dir (or `UNATTRIBUTED (pre-provenance bundle; legacy map — no path-bearing event)`);
one that is not listed renders `UNATTRIBUTED (pre-provenance bundle; cost-report --recover shows the
loaded path)` and `unknown (pre-provenance bundle)`. The live `PLUGIN_DIR` is never read on the replay
path. Never add a post-#122 ts to the legacy map — provenance must come from the bundle.

**Check the model mix BEFORE comparing arms** ([#129](https://github.com/robmar-net/maister/issues/129),
[ADR 0008](adr/0008-copilot-overrides-the-model-pin-per-subagent.md)): `COMPAT_L2_MODEL` pins the **main
session only** — Copilot re-decides the model per delegation at `subagent.configured` time and ignores both
the pin and the agent's `model: inherit`, and one `claude-sonnet-5` subagent is worth ~24 AIU on a
development drive and ~82 on research (ten times `gpt-5.6-luna`), which is more than every arm lever
combined. `ab-compare` therefore **refuses** two bundles whose served-model sets differ
(`served-model mismatch: <set> vs <majority set>`, exit 2; `--allow-model-mix` lists them as
`no (model mix)` under a warning), and `cost-report`'s `## Model mix` section shows the pin, the verdict
(`on-pin` / `off-pin`) and the off-pin AIU with the agent and `subagent.configured` model that carried it.

**Attribution check** — `node platforms/copilot-cli/compat-tests/l2/tools/ab-compare.mjs <bundle-dir>... [--json] [--allow-mutants] [--allow-model-mix]`
prints one row per bundle — `ts | scenario | arm | source (meta / legacy-map) | comparable (yes / no (legacy) /
no (mutant) / no (model mix)) | commit | AIU | models` — and **refuses** (one `REFUSED: <ts> — <reason>` line
each, exit 2) anything it cannot attribute: `mutant <id> (pass --allow-mutants)`,
`unattributed (driven without --variant)`,
`pre-provenance bundle not in legacy-arms.json`, `served-model mismatch: <set> vs <majority set>` (#129,
pass `--allow-model-mix`), and — an amendment to spec R8's three reasons, so one
broken directory in a glob does not abort the rest — `unreadable bundle: <detail>`. With `--allow-mutants`
a mutant bundle (always `variant: null`, since `run.sh` forbids `--variant` with `--mutation`) is listed as a
**visible** row, arm `mutant <id>`, source `meta`, comparable `no (mutant)`, commit from `pluginSource` — never
hidden, never comparable. No ranking, Δ or tier logic lives here (#123). Today it lists the six persisted
bundles as six `legacy-map` rows, exit 0.

**Replay-overwrite caveat** ([#127](https://github.com/robmar-net/maister/issues/127), pre-existing):
`--replay=reports/<ts>` writes `reports/l2-trace-equivalence-<ts>.md` — the **same file** the live drive
wrote — so a replay replaces the live report of that ts (the bundle is untouched). First hit:
`20260831T022952Z`. That is why the six real replays that prove #122's neutrality are run by the operator
**last** (CALIBRATION #40), and why test replays only ever use 2099-series ts stamps.

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

**These rows are HISTORICAL live verdicts at the stated CLI version** — the per-scenario PASS counts
predate the **#63 gate-witness recalibration** (why the current credit-free *effective-required* counts
differ: development 37, research 15 effective), and every one of them is **pre-hygiene (instructions
leaked; pre-#120 hook)** — ADR 0007; not back-filled. What is **CURRENT** today is the post-#122
credit-free state: `--check-reference` **×6** (development / research / quick-bugfix / **destructive-guard**
/ work / init) CURRENT (**workflow-model v6**, hash-neutral — no reference JSON edited), the full
pipeline / replay / cost / provenance / variants / ab-compare unit suite green (230 tests / 228 pass / 0 fail /
2 skipped, 2026-09-04 after the verification fix passes — recorded in CALIBRATION #40 and its amendment), `make build` byte-identical (`2.2.3+fork.4` unchanged), and the six persisted
bundles replaying to the CALIBRATION #39 verdicts with their legacy-map arm in the header (verified 2026-09-04
in the isolated worktree on copies of the bundles — CALIBRATION #40; the replay-overwrite caveat is #127). **#76 WP-D live sweep (2026-08-30, Copilot 1.0.82, ~39.5 AIU total):** all four
scenarios driven live on the WP-D/WP-D2 harness — `destructive-guard`, `research` clean; `quick-bugfix` and
`development` each caught a real harness modeling gap (fixed credit-free, PRs #81/#82) then replay-confirmed
AS-EXPECTED.

| Layer / scenario | Copilot CLI | Verdict |
|---|---|---|
| L0 / WS7 (7 contracts) | 1.0.76 & 1.0.81 | ✅ 7/7 (live) |
| L2 research | **1.0.82** (WP-D sweep) | ✅ AS-EXPECTED (**13 PASS · 0 LIMITATION · 0 FAIL**, **12.41 AIU**, `20260830T195404Z`) — confirmed the #81 fix (`standards`/`todos` modeled) live. Earlier: 1.0.81 9/9 diff NONE; 1.0.82 `--runs=3` noise-cal 275.14 AIU (see Cost) |
| L2 development | **1.0.82** (WP-D sweep) | ✅ AS-EXPECTED (**37 PASS · 3 LIMITATION · 0 FAIL**, **24.75 AIU**, `20260830T195810Z`) **after** fix #82. Raw drive REGRESSED on `phase_completed(3)`: the model ran the TDD Red Gate (conditional phase 3) with `has_reproducible_defect=false` — phases 3/9 were unmodeled; added optional (CALIBRATION #31). This run also showed `outcome(spec-structure)=fail` as a tracked LIMITATION (spec.md did not open with `## TL;DR`) — the WP-D2 oracle working; structure oracle stays OPTIONAL (varies across runs). Prior item-9 run `20260830T155522Z`: 37/6/0, 47.49 AIU. |
| L2 quick-bugfix | **1.0.82** (WP-D sweep) | ✅ AS-EXPECTED (**4 PASS · 0 LIMITATION · 0 FAIL**, **1.53 AIU**, `20260830T192629Z`) **after** fix #81. Raw drive REGRESSED on `standards(index_read)` extra — quick-bugfix reads INDEX.md (SKILL.md:52) but the global emit was modeled only on development; added optional (CALIBRATION #30). Earlier: 1.0.81 2/2 diff NONE. |
| L2 destructive-guard | **1.0.82** (WP-D sweep) | ✅ AS-EXPECTED (**2 PASS · 0 LIMITATION · 0 FAIL**, **0.84 AIU**, `20260830T192611Z`) live — first 1.0.82 verdict; live guard-fire `hook_effect(destructive_guard=ask)` confirmed. |

_(Record each new live run in the [Compatibility Matrix](https://github.com/robmar-net/maister/wiki/Compatibility-Matrix).)_

### Product correctness — the **Product correct** line (issue #88)

Parity has three layers: **(a)** the workflow ran to shape (`phase_*`, `delegated`, `precedes`), **(b)**
the deliverable *works* (`outcome(tests-pass)`), and **(c)** the deliverable is *materially correct* —
it did the thing it was supposed to do. Layer (c) is measured by deterministic, **offline**, planted-fact
oracles (no network ground truth, no LLM judge):

| Scenario | Oracle | What it checks | Status |
|---|---|---|---|
| research | `outcome(research-answer)` (`report-contains`) | the report names the planted unreachable command `frobnicate` AND draws the unreachable/dead-code conclusion (ground truth planted in `sandbox/sample-cli-research`: `cmd_frobnicate` defined + documented but absent from the dispatcher `case`) | ✅ **live `=pass`** 1.0.82 — fork `20260831T123056Z` + upstream `20260831T131021Z`; **REQUIRED** (promoted, CALIBRATION #36) |
| development | `outcome(greet-edges)` (restaged `run-edge-tests.sh`) | the `--greet` deliverable preserves a multi-word name verbatim AND fails a bare `--greet` with non-zero exit + `usage` on stderr | ✅ **live `=pass`** 1.0.82 — fork `20260831T123617Z` + upstream `20260831T131702Z`; **REQUIRED** (promoted, CALIBRATION #36) |

**What this measures — honestly:** model × workflow, almost not the generator translation (the prose is
~100% upstream's). In the upstream-vs-fork comparison the **Product correct** line is *expected to come
out identical on both builds* — a legitimate result to publish. Its real value is a **quality canary**
for model rotations / CLI releases: the layer where "the new default model can't draw a conclusion from
code anymore" becomes a red verdict instead of a vibe. The grep graders are a cheap, unambiguous FLOOR
(a one-token match can false-pass), **not** a rubric — documented as such in the reference derivations.
**Result (first live sweep, 1.0.82, 2026-08-31): identical on both builds** — `research-answer` +
`greet-edges` `=pass` on the fork AND on the untouched upstream build (`COMPAT_PLUGIN_DIR` control,
`SkillPanel/maister` @ `f75ef4f`). The canary reads green, as predicted. The same upstream `development`
drive was product-correct (`greet-edges=pass`) **while its workflow shape REGRESSED 27·3·10** (the maister
subagent chain replaced by Copilot's generic `general-purpose`) — a correct deliverable produced by
bypassing the orchestration, exactly the structure the fork enforces. Both `=pass` verdicts were **PROMOTED to
required** (CALIBRATION #36) after a 2nd clean fork run each (research `20260831T142630Z`, development
`20260831T143100Z`) — a future `=fail` is now a genuine regression (the canary fires). The upstream runs
are the informational control, not counted toward promotion. See CALIBRATION #35/#36 +
[Why This Fork](https://github.com/robmar-net/maister/wiki/Why-This-Fork).

To reproduce the upstream side: `git archive` the upstream `plugins/maister-copilot` and drive with
`COMPAT_PLUGIN_DIR` (procedure in the wiki's "How to repeat").
