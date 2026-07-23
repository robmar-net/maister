# L1 — Hook-Effect Findings (Copilot CLI 1.0.73)

L0 (`run.sh` / `make test-copilot`) proves the three maister hooks **fire** on Copilot. L1
(`l1-hook-effects.sh` / `make test-hooks`) verifies each hook's **effect**. These are **platform**
observations for GitHub Copilot CLI **1.0.73**. Two of the three hooks ship byte-identical from
`plugins/maister/hooks/` (the build only rewrites `*.md`); the **destructive-command guard is a
Copilot-specific override** that `build.sh` (WS2b) overlays from
`platforms/copilot-cli/hooks-overrides/block-destructive-commands.sh` over the Claude source
(the Claude source hook stays 100% untouched). **L1 verifies effects; the guard adaptation lives
in the generator, not in L1.**

## TL;DR

| Hook | Effect on Copilot 1.0.73 | Verdict |
|------|--------------------------|---------|
| `skill-invocation-reminder.sh` | Reminder text reaches the model via injected SessionStart `additionalContext`. | **Works (PASS)** |
| `block-destructive-commands.sh` | Payload carries **no agent identifier**, so agent-scoped gating is impossible → the Copilot override instead **asks for confirmation** on any destructive command. Copilot honors `permissionDecision:"ask"` and holds it fail-closed in headless. | **PASS (adapted)** — fixed via generator override |
| `post-compact-reminder.sh` | Its `$CLAUDE_PROJECT_DIR` dependency **is** satisfied — Copilot sets that var. The real open question is whether Copilot honors the `SessionStart:compact` matcher. | **Env dep OK (PASS)**; compact-matcher unverified |

> Note: the going-in assumption was "`$CLAUDE_PROJECT_DIR` almost certainly unset on Copilot →
> post-compact is a no-op." **Direct verification overturned that** (see below). This is exactly
> why that fact was flagged "verify with a probe env-dump."

## Observed Copilot facts (ground truth from a live 1.0.73 session)

**PreToolUse/Bash payload keys** (identical for main-agent AND task-subagent bash calls):

```
["cwd","hook_event_name","session_id","timestamp","tool_input","tool_name"]
```

- **No `agent_type`** (nor any `agent*` field) — even for a task-subagent's bash call.
- `.tool_input.command` **matches** what the guard reads (`echo …`, `rm -rf …` captured verbatim).
- Copilot **honors** `permissionDecision:"ask"` from a PreToolUse hook and does **not** bypass it
  under `--allow-all-tools`. In a headless run with no human to confirm, it holds the command
  fail-closed: `Denied by preToolUse hook (unable to ask user for confirmation): Maister guard:
  destructive command …` (verified live — L1a.ii).

**`CLAUDE_*` env vars Copilot injects into the plugin hook environment** (measured in a
**sanitized** shell — the harness strips its own outer `CLAUDE*`/`CLAUDECODE` vars first, so
these are Copilot's, not leakage from a nesting Claude Code session):

```
CLAUDE_PLUGIN_DATA   CLAUDE_PLUGIN_ROOT   CLAUDE_PROJECT_DIR
```

Copilot's plugin-hook compatibility shim supplies the **full Claude hook-env contract**,
including `$CLAUDE_PROJECT_DIR` (set to the project / cwd). SessionStart `additionalContext`
emitted by a hook **is** injected into the model's context.

## Per-hook detail

### 1. `block-destructive-commands.sh` (PreToolUse/Bash) — **ADAPTED (fixed): asks for confirmation**

- **Claude behavior:** deny destructive commands (`git reset --hard`, `rm -rf`, `git clean`,
  `git stash`, `git push -f`, `git checkout .`) from **non-whitelisted subagents**, keyed off
  `.agent_type` (so a rogue subagent in a parallel wave can't clobber siblings). Whitelisted
  agents and the main agent (empty `agent_type`) are allowed.
- **Root cause of the divergence:** Copilot's PreToolUse payload omits `agent_type` (and no
  Copilot env var identifies the caller), for BOTH main-agent and task-subagent calls. Shipped
  unchanged, the Claude guard's `[ -z "$AGENT_TYPE" ] && exit 0` branch always wins → it would be
  a **silent no-op** on Copilot. Agent-scoped gating is therefore impossible on this platform.
- **Resolution — RESOLVED via a generator override** (`build.sh` WS2b overlays
  `platforms/copilot-cli/hooks-overrides/block-destructive-commands.sh` over the Claude source in
  the *generated* plugin only; the Claude source stays zero-touch). With no way to tell main from
  subagent, the override drops agent gating and instead emits `permissionDecision:"ask"` on the
  **same destructive patterns** — confirm-before-run. (`ask` was chosen over shipping the no-op,
  and over a blanket `deny` that would also block the main agent's legitimate resets/cleanups.)
- **Verified behavior (Copilot 1.0.73):**
  - *Deterministic (L1a.i):* the built OUTPUT guard emits `permissionDecision:"ask"` for
    Copilot-shape `rm -rf …` and `git reset --hard`, and **nothing (allow)** for safe `echo hi`.
  - *Live (L1a.ii):* a real non-whitelisted `maister-copilot:gap-analyzer` subagent issued
    `rm -rf <throwaway-marker>`; Copilot **held it** — `Denied by preToolUse hook (unable to ask
    user for confirmation): Maister guard: destructive command …` — and the **marker SURVIVED**.
    So `ask` is honored, is **not** bypassed by `--allow-all-tools`, and is **fail-closed** in a
    headless run (would prompt interactively with a human present).
- **Net vs Claude:** slightly stricter (the main agent's destructive commands now also confirm),
  which is a safety improvement, not a regression. The protection is real, not a no-op.

### 2. `post-compact-reminder.sh` (SessionStart, matcher `compact`) — **env dep satisfied; compact-matcher unverified**

- **What it should do:** on a post-compaction session start, if `$CLAUDE_PROJECT_DIR/.maister/tasks`
  exists, emit an `additionalContext` reminder to re-read `orchestrator-state.yml`.
- **Verified:** Copilot **sets `$CLAUDE_PROJECT_DIR`** (= project/cwd) in the hook env, so the
  script's env dependency **is** met. (L1b.i confirms the script emits `additionalContext` when
  that var points at a dir containing `.maister/tasks`, and is silent when it is unset.)
- **Methodology (why this needed care):** the harness may run **nested inside Claude Code**,
  whose `CLAUDE_CODE_*`/`CLAUDECODE`/`CLAUDE_PROJECT_DIR` leak into child processes. An
  unsanitized probe therefore can't tell a Copilot-provided `$CLAUDE_PROJECT_DIR` from a leaked
  one. L1b.ii strips all outer `CLAUDE*` vars before launching Copilot and confirms the leak
  vars are gone (no `CLAUDECODE` in the hook env) — so the surviving `CLAUDE_PROJECT_DIR` is
  Copilot's.
- **Real residual unknown:** whether Copilot fires `SessionStart` hooks with a **`compact`**
  matcher on an actual context compaction. Triggering a real compaction on demand is **out of
  scope** for L1. This — not the env var — is the open risk for this hook on Copilot.

### 3. `skill-invocation-reminder.sh` (SessionStart, no matcher) — **PASS: works**

- **What it should do:** always emit an `additionalContext` rule ("⚠️ MAISTER PLUGIN RULE: …
  invoke it via the Skill tool …").
- **Verified (L1c):** the reminder's distinctive text (`MAISTER PLUGIN RULE` +
  `invoke it via the Skill tool`) appears in the live session's debug log as injected SessionStart
  `additionalContext` → the reminder reaches the model.
- The branding scrub does not touch it (build rewrites only `*.md`); the `.sh` is byte-identical
  to `plugins/maister/hooks/skill-invocation-reminder.sh`, so the exact text survives.

## Follow-ups

- **Guard — DONE (fixed via generator override):** the Copilot variant now asks for confirmation
  on destructive commands (verified above). No further action required for protection.
  - *Nice-to-have:* file a Copilot CLI feature request for an **agent identifier in the PreToolUse
    payload** (e.g. `agent_type`). That would let the Copilot guard restore the exact Claude
    main-vs-subagent scoping (allow the main agent, confirm/deny only subagents) instead of asking
    on every destructive command. Not a blocker — `ask` is safe today.
- **post-compact (robustness, optional):** the env dependency is already met on Copilot, so no
  fix is required for the var. A defensive generator tweak — derive the tasks dir from the
  payload's `cwd` as a fallback when `$CLAUDE_PROJECT_DIR` is absent — would make the hook
  portable to any platform that omits the var, without relying on the Claude-specific env.
- **compact matcher (verification gap):** add an L2 check (or a manual procedure) that triggers a
  real compaction and asserts whether Copilot fires the `SessionStart:compact` hook — the one
  effect L1 cannot exercise.

## How to reproduce

```bash
make test-hooks                                             # build + deterministic + one live session
bash platforms/copilot-cli/compat-tests/l1-hook-effects.sh --no-live   # deterministic subset (no auth/credits)
```

Reports land (git-ignored) in `compat-tests/reports/l1-hook-effects-<UTC>.md` with the exact
`copilot --version`, per-check PASS/LIMITATION/SKIP, and the observed payload keys.
