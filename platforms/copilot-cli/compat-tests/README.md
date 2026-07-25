# Copilot CLI Compatibility Harness (WS7)

A committed, reproducible, **side-effect-free** harness that loads the freshly-built
`plugins/maister-copilot/` into a **real GitHub Copilot CLI** and asserts 7 runtime
contracts, emitting a timestamped markdown report. It is the acceptance + regression
mechanism for the generator remediation: **green** on a correct build, **red** on any
runtime-contract regression.

## Three levels: L0 (fire) · L1 (effect) · L2 (whole-workflow equivalence)

| Level | Script / target | Asserts | Report |
|-------|-----------------|---------|--------|
| **L0** | `run.sh` / `make test-copilot` | The 7 runtime **contracts** hold — plugin/skills/agents/task/skill/hooks/mcp load & resolve, and hooks **fire**. | `reports/compat-report-*.md` |
| **L1** | `l1-hook-effects.sh` / `make test-hooks` | Each of the 3 maister hooks has its intended **effect** on Copilot — and honestly flags where the effect is a **no-op**. | `reports/l1-hook-effects-*.md` |
| **L2** | [`l2/`](./l2/) / `make test-l2` | A whole **development workflow** driven live via `@github/copilot-sdk` yields a predicate skeleton that **conforms** to a committed maister-model reference (trace equivalence). Proven live on Copilot 1.0.74 (**AS-EXPECTED**); a second scenario (`research`) is implemented credit-free, selectable with `--scenario=research`. | `reports/l2-trace-equivalence-*.md` |

L0 proves the hooks *run*; L1 proves what they *do*; **L2** proves a whole *workflow behaves
equivalently* (the layer L0/L1 don't cover). In L1 **and L2**, a **LIMITATION** verdict is the
correct detection of a real platform divergence (not a harness bug); the run only goes red on an
**unexpected regression**. Findings: [`L1-FINDINGS.md`](./L1-FINDINGS.md); L2 design + live result:
[`L2-DESIGN.md`](./L2-DESIGN.md) + [`L2-SPIKE-FINDINGS.md`](./L2-SPIKE-FINDINGS.md).

It formalizes the ad-hoc `~/Projects/maister-tests/` prototype (see
`COMPAT-TEST-REPORT.md`, reproduction commands T1–T13) into repo-committed scripts +
minimal fixtures, with **no dependence on the operator's home directory contents**.

## Run it

```bash
make test-copilot          # L0: from repo root: runs `make build`, then the harness
make test-hooks            # L1: `make build`, then the hook-effect checks
# or directly:
bash platforms/copilot-cli/compat-tests/run.sh
bash platforms/copilot-cli/compat-tests/run.sh --no-live            # L0 auth-free subset (CI without a seat)
bash platforms/copilot-cli/compat-tests/l1-hook-effects.sh          # L1 full (deterministic + one live session)
bash platforms/copilot-cli/compat-tests/l1-hook-effects.sh --no-live # L1 deterministic subset (no auth/credits)
make test-l2               # L2: `make build`, then ONE live dev-workflow trace vs the reference.
                           #     WARNING: spends AI credits — a full dev workflow is MANY premium API requests
                           #     (~1-2 runs can exhaust a monthly Copilot quota). The harness PROMPTS for
                           #     confirmation first; pass --yes / COMPAT_L2_YES=1 to skip the prompt in automation.
node platforms/copilot-cli/compat-tests/l2/run.mjs --check-reference  # L2 CREDIT-FREE: reference staleness/tamper guard
node platforms/copilot-cli/compat-tests/l2/run.mjs --runs=3 --yes     # L2 noise calibration (N=3 -> N x the credits)
bash platforms/copilot-cli/compat-tests/l2/run.sh --scenario=research --check-reference  # L2 research: CREDIT-FREE reference guard
bash platforms/copilot-cli/compat-tests/l2/run.sh --scenario=research --yes              # L2 research: live drive (spends AI credits)
```

Exit code `0` = all asserted contracts GREEN; `1` = at least one RED. A report is
written to `reports/compat-report-<UTC-timestamp>.md` recording the exact
`copilot --version` and per-check PASS/FAIL/SKIP.

### Requirements

- **GitHub Copilot CLI** on `PATH` (baseline: `1.0.73`) with **experimental features
  enabled** in its config (needed for `--plugin-dir`).
- **Full run:** an authenticated Copilot seat (the live checks consume a few AI credits).
- **`--no-live`:** no auth/credits needed — runs the inspection/static subset only.
- `python3` and a POSIX `bash`/`sed`/`grep`/`comm` (present on macOS + ubuntu-latest).

## The 7 runtime contracts

| # | Contract | How it's asserted (ground truth, not model narration) |
|---|----------|-------------------------------------------------------|
| 1 | **Plugin loads** | `copilot … plugin list` shows the plugin under *External Plugins (via --plugin-dir)* |
| 2 | **Skills register, 0 load failures** | every source skill appears in the live session's `<available_skills>` (a skill that fails to load never appears). `--no-live`: all `skills/<name>/SKILL.md` present + `argument-hint` is a string |
| 3 | **Agents resolve as `maister-copilot:<name>`** | invalid-`--agent` probe enumerates them; **set-equality** vs `plugins/maister/agents/*.md` derived at runtime (never a literal count). `--no-live`: built agent set == source set |
| 4 | **`task(agent_type:"maister-copilot:<agent>")` executes** | debug log: `SessionAgentExecutor.execute() called for "maister-copilot:<agent>"` |
| 5 | **`skill("<name>")` invocation works** | debug log: `<skill-context name="<skill>">` loaded from the plugin |
| 6 | **`SessionStart` + `PreToolUse` hooks fire (incl. `${CLAUDE_PLUGIN_ROOT}`)** | run-local probe markers (`ABS_HOOK_FIRED` / `VAR_HOOK_FIRED` / `PRETOOL_HOOK_FIRED` with an expanded `CLAUDE_PLUGIN_ROOT`) **+** the plugin's own SessionStart hook firing. `--no-live`: `hooks.json` declares SessionStart + PreToolUse + `${CLAUDE_PLUGIN_ROOT}` |
| 7 | **Plugin `.mcp.json` loads** | debug log: `Loaded MCP config from … plugins: N server(s): …` names the plugin's server. `--no-live`: `.mcp.json` declares ≥1 server |

Contracts 4 and 5 (live model-delegation) are marked **SKIPPED** in `--no-live`.

> Model-driven delegation (Copilot *choosing* when to call `task`/`skill`) is a
> **non-goal** — the harness drives an explicit scripted prompt and asserts
> **capability + addressability**, not dispatch determinism.

## L1 — hook-effect checks (`l1-hook-effects.sh`)

Verifies each of the 3 maister hooks' **effect** on Copilot. Two ship byte-identical from
`plugins/maister/hooks/` (the build rewrites only `*.md`); the **destructive-command guard is a
Copilot override** that `build.sh` (WS2b) overlays from `platforms/copilot-cli/hooks-overrides/`.
Most checks are **deterministic** (pipe payloads straight into the real built hook scripts — no
credits); a single **live** Copilot session covers the rest. Full findings:
[`L1-FINDINGS.md`](./L1-FINDINGS.md).

| ID | Hook | Check | Kind | 1.0.73 |
|----|------|-------|------|--------|
| L1a.i | `block-destructive-commands.sh` | Copilot override: `rm -rf` / `git reset --hard` → `permissionDecision:"ask"`; safe `echo hi` → allow | deterministic | PASS |
| L1a.ii | `block-destructive-commands.sh` | live subagent runs `rm -rf <marker>` → held by the ask-gate, marker **survives** | live | PASS |
| L1b.i | `post-compact-reminder.sh` | emits `additionalContext` iff `$CLAUDE_PROJECT_DIR/.maister/tasks` exists | deterministic | PASS |
| L1b.ii | `post-compact-reminder.sh` | is `$CLAUDE_PROJECT_DIR` set on Copilot? (measured in a **sanitized** env) | live | PASS¹ |
| L1c | `skill-invocation-reminder.sh` | reminder text injected into the session's SessionStart `additionalContext` | live | PASS |

**Headline:** the **destructive-command guard is fixed** for Copilot — since the payload omits
`agent_type` (agent-scoped gating is impossible), the generator overlays a Copilot variant that
emits `permissionDecision:"ask"` on destructive patterns. Copilot honors `ask`, does not bypass it
under `--allow-all-tools`, and holds it **fail-closed** in headless (`Denied by preToolUse hook
(unable to ask user for confirmation)`) — a subagent's `rm -rf` was held live, marker intact. The
**skill-invocation reminder works**.
¹ The `post-compact` reminder's env dependency **is** satisfied — Copilot sets `$CLAUDE_PROJECT_DIR`
(this overturned the going-in "probably unset" assumption; verified after stripping the harness's
own leaked `CLAUDE*` vars). Its one remaining unknown is whether Copilot honors the
`SessionStart:compact` matcher on a real compaction (out of scope).

A **LIMITATION** (none currently) would not fail the run — it is the correct detection of a
platform divergence; only an **unexpected FAIL** (a hook script's own logic regressing) exits
non-zero. `--no-live` runs the deterministic checks only and marks the live ones SKIP.

## Isolation strategy (side-effect-free)

A globally-installed `maister-copilot` **shadows** a same-named `--plugin-dir` plugin
(Copilot name-dedup), so the fresh build would not be what gets tested. The harness
de-shadows it while **keeping the real `maister-copilot` name** (renaming would break the
`maister-copilot:<agent>` namespace contract), and never leaves the operator's config
changed:

- **Live mode** runs under the real `HOME` (for ambient auth) and temporarily removes the
  installed `maister-copilot` from `~/.copilot/config.json` (JSONC-safe filter), backing
  the file up first and **restoring it byte-identically via a `trap … EXIT`**. (Copilot
  1.0.73 has no `plugin disable` subcommand; this is the reversible equivalent, verified
  by a post-run SHA compare.)
- **`--no-live` mode** seeds an **isolated temp `HOME`** (a copy of `~/.copilot` minus
  session/log state, with the install filtered out) — the operator's real config is
  never touched at all.

Everything else (logs, the probe plugin copy, its writable hook-log) lives in a
`mktemp -d` run dir that is removed on exit (`COMPAT_KEEP_RUNDIR=1` keeps it).

## Fixtures — `fixtures/compat-probe/`

A minimal probe plugin (ported from the prototype) used only to prove the **hook
mechanism** cleanly for contract 6. It ships a bare `.md` agent, a `.agent.md` agent, a
skill, a command, a Claude-format `hooks.json` (SessionStart abs + `${CLAUDE_PLUGIN_ROOT}`
var hooks, plus a PreToolUse hook), and an `.mcp.json`.

The prototype hard-coded `/Users/robmar/...` paths in the hook command + log location.
Those are **parameterized** here: the committed fixture uses `${CLAUDE_PLUGIN_ROOT}`
(for the var-path hook and the log file) and a `__PLUGIN_ABS__` placeholder (for the
absolute-path hook command), which `run.sh` substitutes with the run-local copy's path
after copying the fixture into the temp run dir. The committed fixture therefore contains
**no machine-specific absolute paths** and each run writes its hook markers into the
throwaway copy.

## Fixtures — `fixtures/l1-probe/`

A second minimal probe plugin, used by L1's one live session (loaded alongside the real build).
It is **decision-neutral** — it only observes, never affects tool decisions:

- a **SessionStart** hook (`probe-env.sh`) that records whether Copilot exports
  `$CLAUDE_PROJECT_DIR` into the hook env (for L1b.ii), and
- a **PreToolUse/Bash** hook (`probe-payload.sh`) that dumps the raw payload's keys + `agent_type`
  + command — byte-for-byte what the real guard receives, documenting the absent `agent_type` that
  is *why* the Copilot override gates by command pattern (ask) rather than by agent.

  (Note: on a destructive command the real guard returns `ask` and Copilot short-circuits the
  remaining PreToolUse hooks, so this probe logs only the *safe* calls; L1a.ii reads the held
  `rm -rf` from the session transcript + the surviving marker instead.)

Both log to `${CLAUDE_PLUGIN_ROOT}/l1-probe-*.log` (i.e. the run-local copy), so — like
`compat-probe` — the committed fixture has no machine-specific paths and writes only into its
throwaway copy.

## Environment overrides

| Var | Default | Purpose |
|-----|---------|---------|
| `COMPAT_NO_LIVE=1` | unset | auth-free subset (same as `--no-live`) |
| `COMPAT_PLUGIN_DIR` | `<repo>/plugins/maister-copilot` | plugin under test (point at a mangled build for a **regression** check) |
| `COMPAT_PROBE_AGENT` | `gap-analyzer` | subagent used for L0 contract 4 and L1's L1a.iii destructive probe |
| `COMPAT_PROBE_SKILL` | `orchestrator-framework` | skill used for contract 5 (a non-executable reference skill — no workflow launches) |
| `COMPAT_PLUGIN_HOOK_MARKER` | `MAISTER PLUGIN RULE` | greppable proof the plugin's own SessionStart hook fired (empty to disable) |
| `COMPAT_KEEP_RUNDIR=1` | unset | keep the run-local temp dir for debugging |

## Regression check

Point the harness at a deliberately broken build and confirm it goes **red**, e.g.:

```bash
tmp=$(mktemp -d); cp -a plugins/maister-copilot "$tmp/"
rm -rf "$tmp/maister-copilot/hooks"                       # break contract 6
COMPAT_PLUGIN_DIR="$tmp/maister-copilot" bash platforms/copilot-cli/compat-tests/run.sh --no-live
rm -rf "$tmp"
```

## Reports

`reports/compat-report-*.md` (L0) and `reports/l1-hook-effects-*.md` (L1) are **git-ignored**
run artifacts (the directory is kept via `.gitkeep`). Each records the exact Copilot version +
per-check results and is the consumable evidence for CI (WS6) and the separate
compatibility-matrix ticket. L1's durable, committed write-up lives in
[`L1-FINDINGS.md`](./L1-FINDINGS.md).
