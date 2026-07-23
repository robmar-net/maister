# Copilot CLI Compatibility Harness (WS7)

A committed, reproducible, **side-effect-free** harness that loads the freshly-built
`plugins/maister-copilot/` into a **real GitHub Copilot CLI** and asserts 7 runtime
contracts, emitting a timestamped markdown report. It is the acceptance + regression
mechanism for the generator remediation: **green** on a correct build, **red** on any
runtime-contract regression.

It formalizes the ad-hoc `~/Projects/maister-tests/` prototype (see
`COMPAT-TEST-REPORT.md`, reproduction commands T1–T13) into repo-committed scripts +
minimal fixtures, with **no dependence on the operator's home directory contents**.

## Run it

```bash
make test-copilot          # from repo root: runs `make build`, then the harness
# or directly:
bash platforms/copilot-cli/compat-tests/run.sh
bash platforms/copilot-cli/compat-tests/run.sh --no-live   # auth-free subset (CI without a seat)
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

## Environment overrides

| Var | Default | Purpose |
|-----|---------|---------|
| `COMPAT_NO_LIVE=1` | unset | auth-free subset (same as `--no-live`) |
| `COMPAT_PLUGIN_DIR` | `<repo>/plugins/maister-copilot` | plugin under test (point at a mangled build for a **regression** check) |
| `COMPAT_PROBE_AGENT` | `gap-analyzer` | agent used for contract 4 |
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

`reports/compat-report-*.md` are **git-ignored** run artifacts (the directory is kept via
`.gitkeep`). Each records the exact Copilot version + per-check results and is the
consumable evidence for CI (WS6) and the separate compatibility-matrix ticket.
