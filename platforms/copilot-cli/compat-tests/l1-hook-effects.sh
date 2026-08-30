#!/usr/bin/env bash
#
# L1 — hook-EFFECT compatibility checks for the maister-copilot build on GitHub Copilot CLI.
#
# L0 (run.sh / `make test-copilot`) proves the three maister hooks *fire*. L1 verifies each
# hook's EFFECT on Copilot. Where an effect is adapted or a no-op, it says so honestly; a
# LIMITATION verdict is the CORRECT detection of a platform divergence, not a harness bug.
#
# The three hooks under test in the BUILT plugin (plugins/maister-copilot/hooks/):
#   1. block-destructive-commands.sh (PreToolUse/Bash) — the Copilot OVERRIDE (build.sh WS2b
#      overlays platforms/copilot-cli/hooks-overrides/ over the Claude source): since Copilot's
#      payload has no agent identifier, it emits `permissionDecision: "ask"` on destructive
#      patterns (confirm-before-run) instead of the Claude guard's agent-scoped deny.
#   2. post-compact-reminder.sh      (SessionStart:compact) — emits an additionalContext
#      reminder iff "$CLAUDE_PROJECT_DIR/.maister/tasks" exists.
#   3. skill-invocation-reminder.sh  (SessionStart)         — always emits the /maister:*
#      -> Skill-tool additionalContext rule.
#
# Verdicts on Copilot CLI 1.0.73:
#   L1c  skill-invocation reminder  -> PASS   (Copilot injects SessionStart additionalContext)
#   L1a  destructive-command guard  -> PASS   (adapted: the Copilot override emits permissionDecision:
#        "ask"; Copilot honors it and does NOT bypass under --allow-all-tools — destructive commands
#        are held fail-closed in headless. Root cause of the adaptation: payload omits agent_type.)
#   L1b  post-compact reminder      -> data-driven ($CLAUDE_PROJECT_DIR presence is measured in a
#        sanitized env — LIMITATION if unset, PASS if Copilot supplies it; this is the "verify me"
#        question, so the harness reports what it actually observes, not an assumed outcome)
#
# Usage:
#   bash l1-hook-effects.sh              # full run: deterministic contracts + one live session (a few AI credits)
#   bash l1-hook-effects.sh --no-live    # auth-free subset: deterministic contracts only (live checks SKIPPED)
#   COMPAT_NO_LIVE=1 bash l1-hook-effects.sh   # same as --no-live
#
# Env overrides:
#   COMPAT_PLUGIN_DIR=<dir>   built plugin under test (default: <repo>/plugins/maister-copilot)
#   COMPAT_PROBE_AGENT=<name> subagent used to drive the live destructive-command probe (default: gap-analyzer)
#   COMPAT_KEEP_RUNDIR=1      keep the run-local temp dir (debugging)
#
# Isolation (side-effect-free): mirrors run.sh. Live mode temporarily removes the installed
# maister-copilot from ~/.copilot/config.json (backed up; restored byte-identical via trap) so
# the fresh --plugin-dir build is de-shadowed. The destructive probe only ever targets a
# throwaway temp marker under the run dir; the real repo and ~/.copilot are never mutated.
#
set -euo pipefail

# ---------------------------------------------------------------------------- paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PLUGIN_DIR="${COMPAT_PLUGIN_DIR:-$REPO_ROOT/plugins/maister-copilot}"
L1PROBE_SRC="$SCRIPT_DIR/fixtures/l1-probe"
REPORTS_DIR="$SCRIPT_DIR/reports"
PROBE_AGENT="${COMPAT_PROBE_AGENT:-gap-analyzer}"

GUARD="$PLUGIN_DIR/hooks/block-destructive-commands.sh"
PCHOOK="$PLUGIN_DIR/hooks/post-compact-reminder.sh"
SKILLHOOK="$PLUGIN_DIR/hooks/skill-invocation-reminder.sh"
NORMHOOK="$PLUGIN_DIR/hooks/normalize-orchestrator-state.sh"   # #57 PostToolUse state normalizer

# ---------------------------------------------------------------------------- args
NO_LIVE=0
[ "${COMPAT_NO_LIVE:-0}" = "1" ] && NO_LIVE=1
for a in "$@"; do
  case "$a" in
    --no-live) NO_LIVE=1 ;;
    -h|--help) sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $a" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------- helpers
sedi() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }

# Strip full-line // comments (Copilot config.json is JSONC) and drop the maister-copilot
# entry from installedPlugins. Reads $1, writes $2. (Same as run.sh.)
filter_config() {
  python3 - "$1" "$2" <<'PY'
import json, re, sys
src, dst = sys.argv[1], sys.argv[2]
raw = open(src).read()
stripped = "\n".join(l for l in raw.splitlines() if not re.match(r"^\s*//", l))
c = json.loads(stripped)
if isinstance(c.get("installedPlugins"), list):
    c["installedPlugins"] = [p for p in c["installedPlugins"] if p.get("name") != "maister-copilot"]
json.dump(c, open(dst, "w"), indent=2)
PY
}

# Feed a JSON payload (stdin) to the real built guard; capture stdout (a permissionDecision
# JSON when the command matches a destructive pattern, or empty = allow).
guard_out() { printf '%s' "$1" | bash "$GUARD" 2>/dev/null || true; }
is_ask()    { printf '%s' "$1" | grep -Eq '"permissionDecision"[[:space:]]*:[[:space:]]*"ask"'; }

# result arrays (bash 3.2 compatible)
CHK_ID=(); CHK_HOOK=(); CHK_NAME=(); CHK_STATUS=(); CHK_DETAIL=()
record() {
  CHK_ID+=("$1"); CHK_HOOK+=("$2"); CHK_NAME+=("$3"); CHK_STATUS+=("$4"); CHK_DETAIL+=("$5")
  printf '  [%-11s] %-8s %s\n              -> %s\n' "$4" "$1" "$3" "$5"
}

OBSERVED_KEYS=""   # payload keys observed live, surfaced in the report footer

# Per-hook one-line findings for the report's summary table. Guard/skill findings are robust
# (established deterministically / expected-PASS); the post-compact finding is set from the
# live L1b.ii env probe, since whether Copilot supplies $CLAUDE_PROJECT_DIR is the open question.
GUARD_FINDING="**Adapted & fixed** for Copilot: the payload has no \`agent_type\`, so build.sh (WS2b) overlays a Copilot variant that emits \`permissionDecision: \"ask\"\` on destructive patterns. Copilot honors \`ask\` and does not bypass it under \`--allow-all-tools\` (held fail-closed in headless) -> destructive commands are **gated (PASS)**."
PC_FINDING="Script logic intact; effect depends on whether Copilot supplies \`\$CLAUDE_PROJECT_DIR\` (see L1b.ii — not evaluated without a live run)."
SKILL_FINDING="Expected: Copilot injects the SessionStart \`additionalContext\` so the reminder reaches the model (verified live unless \`--no-live\`)."

# ---------------------------------------------------------------------------- run dir + trap
RUNDIR="$(mktemp -d)"
NEUTRALIZED=0
REAL_CONFIG="$HOME/.copilot/config.json"
CONFIG_BACKUP="$RUNDIR/config.json.orig"

restore_config() {
  if [ "$NEUTRALIZED" = "1" ] && [ -f "$CONFIG_BACKUP" ]; then
    cp -a "$CONFIG_BACKUP" "$REAL_CONFIG" 2>/dev/null || true
    NEUTRALIZED=0
  fi
}
cleanup() {
  restore_config
  [ "${COMPAT_KEEP_RUNDIR:-0}" = "1" ] || rm -rf "$RUNDIR"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------- preflight
COPILOT_BIN="$(command -v copilot || true)"
COPILOT_VERSION="(copilot not found)"
if [ -n "$COPILOT_BIN" ]; then
  COPILOT_VERSION="$(copilot --version 2>/dev/null | head -1 | tr -d '\r')"
fi
PLUGIN_NAME="maister-copilot"
if [ -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ]; then
  PLUGIN_NAME="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("name","maister-copilot"))' "$PLUGIN_DIR/.claude-plugin/plugin.json" 2>/dev/null || echo maister-copilot)"
fi

# Sanity: the three hooks must exist in the build (else nothing to test).
for h in "$GUARD" "$PCHOOK" "$SKILLHOOK"; do
  if [ ! -f "$h" ]; then
    echo "ERROR: expected hook not found in build: $h" >&2
    echo "       (run 'make build' first, or set COMPAT_PLUGIN_DIR)" >&2
    exit 2
  fi
done

MODE="live"; [ "$NO_LIVE" = "1" ] && MODE="no-live (deterministic contracts only)"
echo "=========================================================================="
echo " maister-copilot hook-EFFECT checks (L1)"
echo "   copilot    : ${COPILOT_VERSION}"
echo "   plugin dir : ${PLUGIN_DIR} (name: ${PLUGIN_NAME})"
echo "   mode       : ${MODE}"
echo "=========================================================================="

ISOLATION_NOTE="deterministic contracts run the built hook scripts directly (no copilot, no config mutation)."

# ============================================================================
# SECTION A — DETERMINISTIC CONTRACT TESTS (always; no auth, no credits)
# ============================================================================
echo "-- Section A: deterministic hook-script contracts --"

# ---- L1a.i — destructive guard: Copilot OVERRIDE emits `ask` on destructive, allows safe ----
# The built OUTPUT guard is the Copilot variant (build.sh WS2b). It gates on the command alone
# (no agent_type), emitting permissionDecision:"ask" for destructive patterns and nothing (allow)
# for safe ones. Fed the exact Copilot payload shape (tool_name:"Bash", .tool_input.command).
ask_rm=$(guard_out '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}')
ask_reset=$(guard_out '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}')
allow_safe=$(guard_out '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}')
if is_ask "$ask_rm" && is_ask "$ask_reset" && [ -z "$allow_safe" ]; then
  record "L1a.i" "guard" "Copilot override asks on destructive, allows safe" "PASS" \
    "Copilot-shape 'rm -rf …' and 'git reset --hard' -> permissionDecision:\"ask\"; safe 'echo hi' -> no decision (allow). The override gates destructive commands by pattern (no agent_type needed) -> the guard is FIXED for Copilot, not a no-op."
else
  record "L1a.i" "guard" "Copilot override asks on destructive, allows safe" "FAIL" \
    "REGRESSION: expected ask(rm -rf)+ask(git reset --hard)+allow(echo hi). Got ask_rm=$(is_ask "$ask_rm" && echo yes || echo no) ask_reset=$(is_ask "$ask_reset" && echo yes || echo no) safe_out_len=${#allow_safe}. Is build.sh WS2b overlaying hooks-overrides/?"
fi

# ---- L1b.i — post-compact reminder: script logic intact + env-gating confirmed ----
PC_PROJ="$RUNDIR/pc-proj"; mkdir -p "$PC_PROJ/.maister/tasks"
pc_emit=$(CLAUDE_PROJECT_DIR="$PC_PROJ" bash "$PCHOOK" 2>/dev/null || true)
pc_silent=$(env -u CLAUDE_PROJECT_DIR bash "$PCHOOK" 2>/dev/null || true)
if printf '%s' "$pc_emit" | grep -q 'additionalContext' && [ -z "$pc_silent" ]; then
  record "L1b.i" "post-compact" "reminder script logic + env-gating" "PASS" \
    'Emits additionalContext when $CLAUDE_PROJECT_DIR points at a dir containing .maister/tasks; emits NOTHING when $CLAUDE_PROJECT_DIR is unset. Logic intact — but the effect is gated on the Claude-specific $CLAUDE_PROJECT_DIR (see L1b.ii for its presence on Copilot).'
else
  record "L1b.i" "post-compact" "reminder script logic + env-gating" "FAIL" \
    "REGRESSION: expected additionalContext when CLAUDE_PROJECT_DIR set w/ .maister/tasks and silence when unset. emit_has_ctx=$(printf '%s' "$pc_emit" | grep -q additionalContext && echo yes || echo no) unset_out_len=${#pc_silent}."
fi

# ---- L1d — orchestrator-state normalizer (#57): off-schema Edit -> conformant canonical shadow ----
# Feed the built PostToolUse hook the Copilot Edit-payload shape (tool_result carries the written path)
# for an OFF-SCHEMA orchestrator-state.yml, in the shipped default (shadow) mode. Assert it writes a
# conformant sibling (task: block + phase-N completed_phases) and LEAVES the working file off-schema
# (drift-safe). This is the deterministic script contract; whether Copilot FIRES it live is a separate
# live concern (the hook is registered catch-all because a tool-name matcher does not fire — see build.sh WS2f).
if [ -f "$NORMHOOK" ]; then
  NORM_TMP="$RUNDIR/norm"; mkdir -p "$NORM_TMP"
  printf 'orchestrator:\n  status: completed\n  completed_phases: [1, 2]\n' > "$NORM_TMP/orchestrator-state.yml"
  norm_payload='{"hook_event_name":"PostToolUse","tool_name":"Edit","cwd":"'"$NORM_TMP"'","tool_input":"*** Update File: orchestrator-state.yml","tool_result":{"text_result_for_llm":"Updated 1 file(s): '"$NORM_TMP"'/orchestrator-state.yml"}}'
  printf '%s' "$norm_payload" | STATE_NORMALIZER_MODE=shadow bash "$NORMHOOK" 2>/dev/null
  NORM_SHADOW="$NORM_TMP/orchestrator-state.canonical.yml"
  norm_ok=0
  if [ -f "$NORM_SHADOW" ] \
     && grep -q '^task:' "$NORM_SHADOW" \
     && grep -q 'completed_phases: \["phase-1", "phase-2"\]' "$NORM_SHADOW" \
     && grep -q 'completed_phases: \[1, 2\]' "$NORM_TMP/orchestrator-state.yml"; then
    norm_ok=1
  fi
  if [ "$norm_ok" = "1" ]; then
    record "L1d" "state-normalizer" "off-schema Edit -> conformant canonical shadow (working file untouched)" "PASS" \
      "Fed the Copilot Edit-payload shape for an off-schema orchestrator-state.yml (bare-int completed_phases, orchestrator.status, no task: block). The hook wrote orchestrator-state.canonical.yml with a top-level task: block + phase-N completed_phases, and left the working file off-schema (shadow mode, drift-safe). Normalizer script EFFECT confirmed."
  else
    record "L1d" "state-normalizer" "off-schema Edit -> conformant canonical shadow (working file untouched)" "FAIL" \
      "expected orchestrator-state.canonical.yml with 'task:' block + phase-N completed_phases, working file left off-schema. shadow_exists=$([ -f "$NORM_SHADOW" ] && echo yes || echo no). Is build.sh WS2e overlaying the normalizer + canonicalizer? Is node available for the canonicalizer?"
  fi
else
  record "L1d" "state-normalizer" "off-schema Edit -> conformant canonical shadow (working file untouched)" "FAIL" \
    "normalize-orchestrator-state.sh not found in the built plugin ($NORMHOOK). Is build.sh WS2e overlaying it?"
fi

# ============================================================================
# SECTION B — LIVE CHECKS (one combined Copilot session; SKIPPED in --no-live)
# ============================================================================
if [ "$NO_LIVE" = "1" ]; then
  record "L1c"    "skill-invocation" "reminder injected into SessionStart additionalContext" "SKIP" "requires an authenticated live session (omit --no-live)."
  record "L1b.ii" "post-compact"     "\$CLAUDE_PROJECT_DIR presence on Copilot"               "SKIP" "requires an authenticated live session (omit --no-live)."
  record "L1a.ii" "guard"            "live subagent destructive command held by ask-gate"     "SKIP" "requires an authenticated live session; the override's ask behavior is already proven deterministically by L1a.i."
else
  if [ -z "$COPILOT_BIN" ]; then
    echo "ERROR: copilot CLI not found; use --no-live for the deterministic subset." >&2
    exit 2
  fi
  echo "-- Section B: one live Copilot session (task subagent + hooks); consumes a few AI credits --"

  # ---- de-shadow the installed maister-copilot (reversible; restored by trap) ----
  if [ -f "$REAL_CONFIG" ]; then
    cp -a "$REAL_CONFIG" "$CONFIG_BACKUP"
    filter_config "$REAL_CONFIG" "$REAL_CONFIG.l1.tmp" && mv "$REAL_CONFIG.l1.tmp" "$REAL_CONFIG"
    NEUTRALIZED=1
    ISOLATION_NOTE="live: installed maister-copilot temporarily removed from ~/.copilot/config.json (backed up; restored byte-identical on exit); destructive probe targets only a throwaway temp marker."
  else
    ISOLATION_NOTE="live: no ~/.copilot/config.json found; ran under the current HOME as-is."
  fi

  # ---- run-local probe plugin + throwaway destructive-command victim ----
  L1PROBE_RUN="$RUNDIR/l1-probe"
  cp -a "$L1PROBE_SRC" "$L1PROBE_RUN"
  chmod +x "$L1PROBE_RUN"/hooks/*.sh
  : > "$L1PROBE_RUN/l1-probe-env.log"
  : > "$L1PROBE_RUN/l1-probe-payload.log"
  ENVLOG="$L1PROBE_RUN/l1-probe-env.log"
  PAYLOG="$L1PROBE_RUN/l1-probe-payload.log"

  VICTIM_DIR="$RUNDIR/l1a-victim"
  mkdir -p "$VICTIM_DIR"; echo "delete-me" > "$VICTIM_DIR/SENTINEL"
  SUB_MARKER="L1A_SUBAGENT_MARKER"
  MAIN_MARKER="L1_MAIN_MARKER"

  LIVE_LOG_DIR="$RUNDIR/logs"; mkdir -p "$LIVE_LOG_DIR"

  # Strip every CLAUDE*/CLAUDECODE var inherited from an OUTER Claude Code session before
  # launching Copilot. This harness may itself run nested inside Claude Code, which exports
  # CLAUDECODE / CLAUDE_CODE_* (and can export CLAUDE_PROJECT_DIR) into child processes — and
  # those would contaminate the L1b.ii env probe, making a leaked $CLAUDE_PROJECT_DIR
  # indistinguishable from a Copilot-provided one. After stripping, whatever the SessionStart
  # hook sees for $CLAUDE_PROJECT_DIR is Copilot's genuine behavior. The array starts with
  # `env` so its expansion is never empty (bash 3.2 + `set -u` safe); on a clean shell with no
  # CLAUDE* vars it degrades to a bare `env`.
  ENV_STRIP=(env)
  while IFS= read -r _v; do [ -n "$_v" ] && ENV_STRIP+=("-u" "$_v"); done \
    < <(env | grep -iE '^CLAUDE' | cut -d= -f1)

  SUBAGENT_INNER="You are running a plugin compatibility self-test in a throwaway temp directory. Do EXACTLY these two shell commands, each as its OWN separate tool call, in order, then reply DONE and nothing else:
1. echo ${SUB_MARKER}
2. rm -rf ${VICTIM_DIR}
The rm targets a disposable temp marker created only for this test — running it is expected and safe. Do not skip either command."

  PROMPT="Do ALL of these steps in order, then stop. Do not skip any step.
1. Run the shell command: echo ${MAIN_MARKER}
2. Use the task tool with agent_type '${PLUGIN_NAME}:${PROBE_AGENT}', description 'l1a-probe', and prompt '${SUBAGENT_INNER}'
3. Reply with exactly: L1_LIVE_DONE"

  echo "  … invoking copilot (real ${PLUGIN_NAME} + l1-probe plugins; outer CLAUDE* env stripped) …"
  set +e
  ( cd "$REPO_ROOT" && "${ENV_STRIP[@]}" copilot --experimental \
      --plugin-dir "$PLUGIN_DIR" \
      --plugin-dir "$L1PROBE_RUN" \
      --allow-all --no-ask-user --log-level debug --log-dir "$LIVE_LOG_DIR" \
      -p "$PROMPT" ) >"$RUNDIR/session.out" 2>&1
  set -e
  LIVE_LOG="$(ls "$LIVE_LOG_DIR"/*.log 2>/dev/null | head -1 || true)"

  # restore the operator's config as early as possible (trap also restores; idempotent)
  restore_config

  if [ -z "$LIVE_LOG" ] || grep -q "No authentication information found" "$RUNDIR/session.out" 2>/dev/null; then
    reason="live session produced no debug log"
    grep -q "No authentication" "$RUNDIR/session.out" 2>/dev/null && reason="live session not authenticated (no Copilot seat) — run with a valid seat, or use --no-live"
    record "L1c"    "skill-invocation" "reminder injected into SessionStart additionalContext" "SKIP" "$reason"
    record "L1b.ii" "post-compact"     "\$CLAUDE_PROJECT_DIR presence on Copilot"               "SKIP" "$reason"
    record "L1a.ii" "guard"            "live subagent destructive command held by ask-gate"     "SKIP" "$reason"
  else
    # ---- L1c — skill-invocation reminder injected (expect PASS) ----
    # The distinctive text 'MAISTER PLUGIN RULE' + 'invoke it via the Skill tool' exists ONLY
    # in skill-invocation-reminder.sh's additionalContext, so its presence in the debug log
    # proves Copilot injected the plugin's SessionStart additionalContext.
    if grep -q "MAISTER PLUGIN RULE" "$LIVE_LOG" 2>/dev/null \
       && grep -q "invoke it via the Skill tool" "$LIVE_LOG" 2>/dev/null; then
      SKILL_FINDING="Copilot injects the SessionStart \`additionalContext\` -> the reminder text reaches the model -> **works** (live-confirmed)."
      record "L1c" "skill-invocation" "reminder injected into SessionStart additionalContext" "PASS" \
        "Debug log contains the reminder's distinctive text ('MAISTER PLUGIN RULE' + 'invoke it via the Skill tool') — Copilot injects the plugin's SessionStart additionalContext. Hook EFFECT confirmed."
    else
      SKILL_FINDING="Reminder text was NOT found in the session debug log -> SessionStart \`additionalContext\` injection could not be confirmed this run."
      record "L1c" "skill-invocation" "reminder injected into SessionStart additionalContext" "FAIL" \
        "reminder text NOT found in debug log (searched 'MAISTER PLUGIN RULE' + 'invoke it via the Skill tool'). Injection not confirmed."
    fi

    # ---- L1b.ii — $CLAUDE_PROJECT_DIR presence on Copilot (the "verify me" open question) ----
    # Measured in a SANITIZED environment (outer CLAUDE* stripped above), so a value here is
    # Copilot's own behavior, not leakage. We also confirm the sanitation held (no CLAUDECODE
    # survived) before trusting the reading.
    if [ -s "$ENVLOG" ]; then
      env_line="$(grep 'L1_ENV_PROBE ' "$ENVLOG" | head -1 || true)"
      vars_line="$(grep 'L1_ENV_PROBE_CLAUDE_VARS' "$ENVLOG" | head -1 || true)"
      cpd_val="$(printf '%s' "$env_line" | sed -n 's/.*CLAUDE_PROJECT_DIR=\[\([^]]*\)\].*/\1/p')"
      contaminated=0
      printf '%s' "$vars_line" | grep -q 'CLAUDECODE' && contaminated=1
      clean_note="sanitized env (outer CLAUDE* stripped; no CLAUDECODE leaked into the hook)"
      [ "$contaminated" = 1 ] && clean_note="WARNING: CLAUDECODE still present -> env sanitation did not hold; reading may be contaminated"

      if [ "$cpd_val" = "<UNSET>" ]; then
        PC_FINDING="Script logic intact, but \`\$CLAUDE_PROJECT_DIR\` is **unset** on Copilot -> the reminder is an **env-gated no-op**."
        record "L1b.ii" "post-compact" "\$CLAUDE_PROJECT_DIR presence on Copilot" "LIMITATION" \
          "\$CLAUDE_PROJECT_DIR is <UNSET> in Copilot's SessionStart hook env (${clean_note}). post-compact-reminder.sh keys off \$CLAUDE_PROJECT_DIR/.maister/tasks -> reminder is a no-op on Copilot. Correctly detected limitation."
      elif [ -z "$cpd_val" ]; then
        PC_FINDING="Script logic intact, but \`\$CLAUDE_PROJECT_DIR\` is **set-but-empty** on Copilot -> reminder path is invalid -> effective no-op."
        record "L1b.ii" "post-compact" "\$CLAUDE_PROJECT_DIR presence on Copilot" "LIMITATION" \
          "\$CLAUDE_PROJECT_DIR is set-but-EMPTY on Copilot (${clean_note}) -> TASKS_DIR = '/.maister/tasks' -> reminder is a no-op."
      elif [ "$contaminated" = 1 ]; then
        PC_FINDING="\`\$CLAUDE_PROJECT_DIR\` appeared set, but env sanitation did not hold this run -> treat as inconclusive; re-run in a clean shell."
        record "L1b.ii" "post-compact" "\$CLAUDE_PROJECT_DIR presence on Copilot" "SKIP" \
          "INCONCLUSIVE: \$CLAUDE_PROJECT_DIR=[${cpd_val}] but ${clean_note}. Cannot attribute to Copilot vs. leakage; re-run from a shell with no CLAUDE* vars."
      else
        PC_FINDING="**Copilot DOES set \`\$CLAUDE_PROJECT_DIR\`** in the plugin hook env, so the reminder's env dependency is satisfied on Copilot (contrary to the going-in assumption). Residual unknown: whether Copilot fires \`SessionStart\` with a \`compact\` matcher — out of scope."
        record "L1b.ii" "post-compact" "\$CLAUDE_PROJECT_DIR presence on Copilot" "PASS" \
          "Copilot SETS \$CLAUDE_PROJECT_DIR=[${cpd_val}] in the SessionStart hook env (${clean_note}) — verified after stripping the harness's own CLAUDE* vars. The reminder's env dependency IS satisfied on Copilot; this overturns the 'almost certainly unset' assumption. Remaining open question (out of scope): does Copilot fire SessionStart with a 'compact' matcher on real compaction?"
      fi
    else
      PC_FINDING="Script logic intact; live env probe did not fire, so \`\$CLAUDE_PROJECT_DIR\` presence on Copilot is unverified this run."
      record "L1b.ii" "post-compact" "\$CLAUDE_PROJECT_DIR presence on Copilot" "SKIP" \
        "env probe log empty (SessionStart probe hook did not fire this run)."
    fi

    # ---- L1a.ii — live: subagent destructive command HELD by the ask-gate (expect PASS) ----
    # A non-whitelisted subagent issues `rm -rf <throwaway-marker>`. The override guard returns
    # permissionDecision:"ask"; Copilot honors it and (headless, no human to confirm) HOLDS the
    # command fail-closed ("Denied by preToolUse hook (unable to ask user for confirmation)").
    # Ground truth = the marker SURVIVES. NOTE: when the guard returns a non-allow decision Copilot
    # short-circuits the remaining PreToolUse hooks, so the l1-probe payload hook does NOT log the
    # held rm — the reliable signals are the transcript's attempt + the guard's held message + the
    # surviving marker. (The probe log still captures the SAFE echo, which is where the payload
    # keys / absent agent_type come from.)
    marker_survived=0; [ -e "$VICTIM_DIR/SENTINEL" ] && marker_survived=1
    rm_attempted=0; grep -qF "rm -rf ${VICTIM_DIR}" "$RUNDIR/session.out" "$LIVE_LOG" 2>/dev/null && rm_attempted=1
    guard_held=0; grep -qE 'Maister guard: destructive|Denied by preToolUse hook' "$RUNDIR/session.out" "$LIVE_LOG" 2>/dev/null && guard_held=1
    # payload keys / agent_type from the captured (safe) subagent echo, for the report footer
    sub_line="$(grep -F "$SUB_MARKER" "$PAYLOG" 2>/dev/null | head -1 || true)"
    any_line="$(grep 'L1_PAYLOAD ' "$PAYLOG" 2>/dev/null | tail -1 || true)"
    evidence_line="${sub_line:-$any_line}"
    if [ -n "$evidence_line" ]; then
      OBSERVED_KEYS="$(printf '%s' "$evidence_line" | sed -n 's/.*keys=\(\[[^]]*\]\).*/\1/p')"
      obs_agent="$(printf '%s' "$evidence_line" | sed -n 's/.*agent_type=\([^ ]*\).*/\1/p')"
    fi
    held_ev=""; [ "$guard_held" = "1" ] && held_ev=" Transcript shows 'Denied by preToolUse hook (unable to ask user for confirmation): Maister guard: destructive command'."

    if [ "$marker_survived" = "0" ]; then
      record "L1a.ii" "guard" "live subagent destructive command held by ask-gate" "FAIL" \
        "REGRESSION: the subagent's 'rm -rf <marker>' EXECUTED (marker removed) — the ask-gate did NOT hold.${held_ev}"
    elif [ "$rm_attempted" = "1" ]; then
      record "L1a.ii" "guard" "live subagent destructive command held by ask-gate" "PASS" \
        "A non-whitelisted subagent issued 'rm -rf <marker>'; the override's ask-gate HELD it (Copilot could not ask in headless -> fail-closed) — the throwaway marker SURVIVES.${held_ev} Captured payload (safe echo) had agent_type=${obs_agent:-<ABSENT>}, keys=${OBSERVED_KEYS:-n/a} — i.e. no identifier, which is exactly why the override gates by command pattern rather than agent."
    else
      record "L1a.ii" "guard" "live subagent destructive command held by ask-gate" "SKIP" \
        "Subagent did not issue the destructive marker command this run (no 'rm -rf <marker>' in the transcript); the override's ask behavior is proven deterministically by L1a.i. Marker intact. Last payload seen: $(printf '%s' "${any_line:-<none>}" | cut -c1-80)"
    fi
  fi
fi

# ============================================================================ report
mkdir -p "$REPORTS_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORTS_DIR/l1-hook-effects-$TS.md"

n_pass=0; n_fail=0; n_skip=0; n_lim=0
for st in "${CHK_STATUS[@]}"; do
  case "$st" in
    PASS) n_pass=$((n_pass+1));;
    FAIL) n_fail=$((n_fail+1));;
    SKIP) n_skip=$((n_skip+1));;
    LIMITATION) n_lim=$((n_lim+1));;
  esac
done
# LIMITATION is an expected, correctly-detected platform divergence — it does NOT fail the run.
# Only an unexpected FAIL (a genuine regression in a hook script's logic, or a surprising
# platform behavior change) turns the run red.
OVERALL="AS-EXPECTED"; [ "$n_fail" -gt 0 ] && OVERALL="REGRESSED"

# per-hook headline verdict (worst-of the sub-checks, LIMITATION-aware)
hook_verdict() {
  local hook="$1" i st worst="PASS" has=0
  i=0
  while [ "$i" -lt "${#CHK_ID[@]}" ]; do
    if [ "${CHK_HOOK[$i]}" = "$hook" ]; then
      has=1; st="${CHK_STATUS[$i]}"
      case "$st" in
        FAIL) worst="FAIL";;
        LIMITATION) [ "$worst" != "FAIL" ] && worst="LIMITATION";;
        SKIP) [ "$worst" = "PASS" ] && worst="SKIP";;
      esac
    fi
    i=$((i+1))
  done
  [ "$has" = "1" ] && echo "$worst" || echo "n/a"
}
V_GUARD="$(hook_verdict guard)"
V_PC="$(hook_verdict post-compact)"
V_SKILL="$(hook_verdict skill-invocation)"

{
  echo "# Copilot CLI — L1 Hook-Effect Report"
  echo
  echo "- **Generated (UTC):** $TS"
  echo "- **Copilot CLI:** \`${COPILOT_VERSION}\`"
  echo "- **Plugin under test:** \`${PLUGIN_DIR}\` (name: \`${PLUGIN_NAME}\`)"
  echo "- **Mode:** ${MODE}"
  echo "- **Isolation:** ${ISOLATION_NOTE}"
  echo "- **Result:** **${OVERALL}** — ${n_pass} PASS · ${n_lim} LIMITATION · ${n_skip} SKIP · ${n_fail} FAIL"
  echo
  echo "L1 verifies each hook's **effect** (L0/\`run.sh\` verifies only that hooks *fire*). A"
  echo "**LIMITATION** is the correct detection of a real platform divergence, not a harness bug."
  echo
  echo "## Per-hook verdict"
  echo
  echo "| Hook | Verdict | One-line finding |"
  echo "|------|---------|------------------|"
  echo "| \`block-destructive-commands.sh\` | ${V_GUARD} | ${GUARD_FINDING} |"
  echo "| \`post-compact-reminder.sh\` | ${V_PC} | ${PC_FINDING} |"
  echo "| \`skill-invocation-reminder.sh\` | ${V_SKILL} | ${SKILL_FINDING} |"
  echo
  echo "## Checks"
  echo
  echo "| ID | Hook | Check | Status | Evidence |"
  echo "|----|------|-------|--------|----------|"
  i=0
  while [ "$i" -lt "${#CHK_ID[@]}" ]; do
    d="$(printf '%s' "${CHK_DETAIL[$i]}" | tr '\n' ' ' | sed 's/|/\\|/g')"
    echo "| ${CHK_ID[$i]} | ${CHK_HOOK[$i]} | ${CHK_NAME[$i]} | ${CHK_STATUS[$i]} | ${d} |"
    i=$((i+1))
  done
  echo
  if [ -n "$OBSERVED_KEYS" ]; then
    echo "## Observed PreToolUse/Bash payload keys (live)"
    echo
    echo "\`\`\`"
    echo "${OBSERVED_KEYS}   (agent_type: absent)"
    echo "\`\`\`"
    echo
  fi
  echo "## What each check does"
  echo
  echo "- **L1a.i** (deterministic) — pipes **Copilot-shape** payloads into the built OUTPUT guard"
  echo "  (the Copilot override): \`rm -rf …\` and \`git reset --hard\` must yield \`permissionDecision:\"ask\"\`,"
  echo "  and a safe \`echo hi\` must yield no decision (allow). Proves the override gates destructive"
  echo "  commands by pattern (no \`agent_type\` needed) — the guard is fixed for Copilot, not a no-op."
  echo "- **L1a.ii** (live) — drives a task subagent to run \`rm -rf <throwaway-marker>\`; a decision-neutral"
  echo "  probe hook captures the real payload (proving the guard saw the command). Asserts the marker"
  echo "  **SURVIVES** — Copilot honors the ask-gate and holds the command fail-closed in a headless run."
  echo "- **L1b.i** (deterministic) — runs the real \`post-compact-reminder.sh\` with \`\$CLAUDE_PROJECT_DIR\`"
  echo "  pointing at a temp dir containing \`.maister/tasks/\` (emits \`additionalContext\`) and with the var"
  echo "  unset (emits nothing). Proves the logic + the env dependency."
  echo "- **L1b.ii** (live) — a SessionStart probe hook records whether Copilot exports"
  echo "  \`\$CLAUDE_PROJECT_DIR\`, measured in a **sanitized** env (the harness strips its own outer"
  echo "  \`CLAUDE*\` vars first) so the reading is Copilot's behavior, not leakage from a nesting shell."
  echo "- **L1c** (live) — asserts the skill-invocation reminder's distinctive text appears in the"
  echo "  session debug log's injected SessionStart \`additionalContext\`."
  echo
  echo "_Triggering a real context compaction (post-compact-reminder's actual \`SessionStart:compact\`"
  echo "trigger) is out of scope; L1b tests the effect via the env dependency + script contract instead._"
} > "$REPORT"

echo "=========================================================================="
echo " Result: ${OVERALL}  (${n_pass} PASS · ${n_lim} LIMITATION · ${n_skip} SKIP · ${n_fail} FAIL)"
echo " Per-hook: guard=${V_GUARD}  post-compact=${V_PC}  skill-invocation=${V_SKILL}"
echo " Report: ${REPORT}"
echo "=========================================================================="

[ "$n_fail" -gt 0 ] && exit 1
exit 0
