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

The validated M2/research (agent-file rename) run cost **14.79 AIU / 60 weighted requests**. The
full Stage-1 negative-control exploration cost **~39.97 AIU / 180 requests across 4 runs**
(M1 1.44, M2 v1 13.91, M2 v2 9.83, M2 v3 14.79). Measure future negative-control runs with the query in
[Cost — where to read it](#cost--where-to-read-it) — but record the ISO start AND end timestamps and
bound the query at BOTH ends (`created_at >= '<ISO-start>' AND created_at <= '<ISO-end>'`); the base
query bounds only the start and would sweep in later sessions.

> **Research cost is highly variable — do NOT budget `N × single-run`.** A `research` drive that
> *skips* brainstorming/design (a "narrow investigation" the model self-routes past) costs ~13–14 AIU;
> one that *executes* them runs ~5–7× that. Observed live: single foundation/skip runs 13.21 / 13.96 AIU,
> but a `--runs=3` noise calibration (2026-08-30, Copilot 1.0.82) cost **275.14 AIU / 244 req** because
> 1 of the 3 drives went deep (`gate_count(ask)=9`, full brainstorming+design). Estimate research N>1
> against the **deep-run** cost (~90–100 AIU/run), not the skip-run cost, and gate the spend accordingly.
> The re-run rule ("after any grammar change and on each new CLI version") also states: N>1 does **not**
> persist a replay trace, so there is no credit-free re-score of an N>1 run.

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

- **[Compatibility-Matrix](https://github.com/robmar-net/maister/wiki/Compatibility-Matrix)** — the living matrix, one row per `(maister version, Copilot CLI version, model, OS)` × layer (L0/L1/L2). This is the headline record. **Re-run policy:** re-run the live layers (and record a new matrix row) on each new Copilot CLI release **and** on a model change (a different requested/served model is a distinct matrix cell — cost and behaviour are not comparable across models).
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
> a real per-model split (`claude-sonnet-4.6` 232 AIU + `gpt-5.6-luna` 60 AIU). **The only residual
> unverified point** (tracked to [issue #63 item 9](https://github.com/robmar-net/maister/issues/63)) is
> whether the SDK's `ctx.sessionId` captured in `run.mjs` **equals** the DB's `session_id` value — that
> needs a live L2 drive to correlate. The schema-probe still degrades safely on any future name change.
- Rough guide: `research` L2 ≈ tens of AIU; `development` L2 ≈ a few hundred AIU (~1-2 dev runs can dent a monthly quota). Prefer credit-free checks; run live only when you must.
  **Caveat:** these figures were measured on Copilot 1.0.74–1.0.81; AIU weighting and request
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
  from the DB; do not carry historical figures forward.

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
differ: development 37, research 15 effective). What is **CURRENT** today is the credit-free conformance:
`--check-reference` **×4** (development / research / quick-bugfix / **destructive-guard**) + the full
pipeline / replay / cost unit suite, all green (workflow-model v5). A **full live matrix refresh at the
current CLI (1.0.82) across all four scenarios — including a first recorded `destructive-guard` live
verdict — is tracked to [issue #63 item 9](https://github.com/robmar-net/maister/issues/63)** (spend-gated).

| Layer / scenario | Copilot CLI | Verdict |
|---|---|---|
| L0 / WS7 (7 contracts) | 1.0.76 & 1.0.81 | ✅ 7/7 (live) |
| L2 research | 1.0.81 · N=3 re-run 1.0.82 | ✅ AS-EXPECTED (9/9, diff NONE) live; 1.0.82 `--runs=3` noise-cal 275.14 AIU (see Cost) |
| L2 development | 1.0.81 | ✅ AS-EXPECTED (25/25, diff NONE) live — post-#46 parser fix |
| L2 quick-bugfix | 1.0.81 | ✅ AS-EXPECTED (2/2 vs pre-calibration partition, diff NONE — see CALIBRATION-LOG note 4) live |
| L2 destructive-guard | — | credit-free CURRENT (`--check-reference` + scenario/replay tests); **live verdict pending the item-9 sweep** |

_(Record each new live run in the [Compatibility Matrix](https://github.com/robmar-net/maister/wiki/Compatibility-Matrix).)_
