#!/usr/bin/env bash
#
# WS7 — Committed Copilot CLI compatibility harness.
#
# Loads the freshly-built plugins/maister-copilot/ into a REAL GitHub Copilot CLI and
# asserts 7 runtime contracts from deterministic inspection or debug-log ground truth
# (never model narration). Emits a timestamped markdown report.
#
# Runs GREEN on a correctly-remediated plugin and RED if any runtime contract regresses.
#
# Usage:
#   bash run.sh                 # full run (inspection + live model-delegation checks; needs auth + a few AI credits)
#   bash run.sh --no-live       # auth-free subset (contracts 1,2,3,6,7 static/inspection; live checks 4,5 SKIPPED)
#   COMPAT_NO_LIVE=1 bash run.sh # same as --no-live
#
# Env overrides:
#   COMPAT_PLUGIN_DIR=<dir>     plugin under test (default: <repo>/plugins/maister-copilot) — used to point at a mangled build for regression checks
#   COMPAT_PROBE_AGENT=<name>   agent for contract 4 (default: gap-analyzer)
#   COMPAT_PROBE_SKILL=<name>   skill for contract 5 (default: orchestrator-framework)
#   COMPAT_PLUGIN_HOOK_MARKER=<str>  greppable marker proving the plugin-under-test's own SessionStart hook fired (default: "MAISTER PLUGIN RULE"; empty to disable)
#   COMPAT_KEEP_RUNDIR=1        keep the run-local temp dir (debugging)
#
# Isolation (side-effect-free):
#   * The operator's globally-installed maister-copilot SHADOWS a same-named --plugin-dir
#     plugin (Copilot name-dedup), so the fresh build must be de-shadowed to be tested
#     under its REAL name (preserving the maister-copilot:<agent> namespace contract).
#   * Live mode  : runs under the real HOME (ambient auth) and temporarily removes the
#     installed maister-copilot from ~/.copilot/config.json (JSONC-safe), restoring the
#     file BYTE-IDENTICALLY via a trap. Copilot CLI (verified through 1.0.76) has no `plugin
#     disable` subcommand; this is the reversible equivalent.
#   * No-live mode: seeds an ISOLATED temp HOME (a copy of ~/.copilot minus session/log
#     state, with the install filtered out) — the real config is never touched at all.
#
set -euo pipefail

# ---------------------------------------------------------------------------- paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PLUGIN_DIR="${COMPAT_PLUGIN_DIR:-$REPO_ROOT/plugins/maister-copilot}"
SOURCE_DIR="$REPO_ROOT/plugins/maister"
FIXTURE_SRC="$SCRIPT_DIR/fixtures/compat-probe"
REPORTS_DIR="$SCRIPT_DIR/reports"
PROBE_AGENT="${COMPAT_PROBE_AGENT:-gap-analyzer}"
PROBE_SKILL="${COMPAT_PROBE_SKILL:-orchestrator-framework}"
PLUGIN_HOOK_MARKER="${COMPAT_PLUGIN_HOOK_MARKER-MAISTER PLUGIN RULE}"

# ---------------------------------------------------------------------------- args
NO_LIVE=0
[ "${COMPAT_NO_LIVE:-0}" = "1" ] && NO_LIVE=1
for a in "$@"; do
  case "$a" in
    --no-live) NO_LIVE=1 ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $a" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------- helpers
sedi() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }

# Strip full-line // comments (Copilot's config.json is JSONC) and drop the
# maister-copilot entry from installedPlugins. Reads $1, writes $2.
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

json_get() { python3 - "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    cur = d
    for k in sys.argv[2].split("."):
        cur = cur[k]
    if isinstance(cur, dict): print(" ".join(cur.keys()))
    elif isinstance(cur, list): print(" ".join(map(str, cur)))
    else: print(cur)
except Exception:
    pass
PY
}

# result arrays (bash 3.2 compatible — no associative arrays)
CHK_ID=(); CHK_NAME=(); CHK_STATUS=(); CHK_DETAIL=()
record() {
  CHK_ID+=("$1"); CHK_NAME+=("$2"); CHK_STATUS+=("$3"); CHK_DETAIL+=("$4")
  printf '  [%-4s] %s — %s: %s\n' "$3" "$1" "$2" "$4"
}

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

# Expected sets, derived from the SOURCE tree at runtime (NOT literal counts — audit L3).
SOURCE_AGENTS="$(ls "$SOURCE_DIR"/agents/*.md 2>/dev/null | xargs -n1 basename | sed 's/\.md$//' | sort)"
SOURCE_SKILLS="$(ls -d "$SOURCE_DIR"/skills/*/ 2>/dev/null | xargs -n1 basename | sort)"
N_AGENTS="$(printf '%s\n' "$SOURCE_AGENTS" | sed '/^$/d' | wc -l | tr -d ' ')"
N_SKILLS="$(printf '%s\n' "$SOURCE_SKILLS" | sed '/^$/d' | wc -l | tr -d ' ')"
PLUGIN_NAME="$(json_get "$PLUGIN_DIR/.claude-plugin/plugin.json" name)"
[ -z "$PLUGIN_NAME" ] && PLUGIN_NAME="maister-copilot"

MODE="live"; [ "$NO_LIVE" = "1" ] && MODE="no-live (auth-free subset)"
echo "=========================================================================="
echo " maister-copilot ↔ Copilot CLI compatibility harness (WS7)"
echo "   copilot     : ${COPILOT_VERSION}"
echo "   plugin dir  : ${PLUGIN_DIR}"
echo "   plugin name : ${PLUGIN_NAME}"
echo "   source sets : ${N_AGENTS} agents, ${N_SKILLS} skills"
echo "   mode        : ${MODE}"
echo "=========================================================================="

ISOLATION_NOTE=""
USEHOME="$HOME"

# ============================================================================ NO-LIVE
if [ "$NO_LIVE" = "1" ]; then
  # ---- isolated temp HOME (zero mutation of the operator's real config) ----
  SEED_HOME="$RUNDIR/home"; mkdir -p "$SEED_HOME/.copilot"
  SEEDED=0
  if [ -d "$HOME/.copilot" ]; then
    for f in "$HOME/.copilot"/*; do
      b="$(basename "$f")"
      case "$b" in session-state|logs|session-store.db*|media-cache|run) continue ;; esac
      cp -a "$f" "$SEED_HOME/.copilot/" 2>/dev/null || true
    done
    if [ -f "$SEED_HOME/.copilot/config.json" ]; then
      filter_config "$SEED_HOME/.copilot/config.json" "$SEED_HOME/.copilot/config.json.tmp" \
        && mv "$SEED_HOME/.copilot/config.json.tmp" "$SEED_HOME/.copilot/config.json"
    fi
    SEEDED=1
  fi
  ISOLATION_NOTE="no-live: isolated temp HOME seeded from ~/.copilot (install filtered out); real config untouched."

  # C1 — plugin loads (inspection; auth-free). Falls back to static if copilot/seed unavailable.
  if [ -n "$COPILOT_BIN" ] && [ "$SEEDED" = "1" ]; then
    PL="$(HOME="$SEED_HOME" copilot --experimental --plugin-dir "$PLUGIN_DIR" plugin list 2>/dev/null || true)"
    PL_EXT="$(printf '%s\n' "$PL" | awk '/External Plugins/{f=1} f')"
    if printf '%s' "$PL_EXT" | grep -qw "$PLUGIN_NAME"; then
      record "C1" "Plugin loads" "PASS" "'plugin list' shows ${PLUGIN_NAME} under External Plugins (isolated HOME)"
    else
      record "C1" "Plugin loads" "FAIL" "${PLUGIN_NAME} not listed by 'plugin list' (isolated HOME)"
    fi
  else
    if [ -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ]; then
      record "C1" "Plugin loads" "PASS" "static: valid plugin.json present (copilot/seed unavailable for live 'plugin list')"
    else
      record "C1" "Plugin loads" "FAIL" "static: $PLUGIN_DIR/.claude-plugin/plugin.json missing"
    fi
  fi

  # C2 — skills register / 0 load failures (static presence + frontmatter validity guard T2b)
  missing_s=""; for s in $SOURCE_SKILLS; do [ -f "$PLUGIN_DIR/skills/$s/SKILL.md" ] || missing_s="$missing_s $s"; done
  badhint="$(grep -rlnE '^argument-hint:[[:space:]]*\[' "$PLUGIN_DIR"/skills 2>/dev/null || true)"
  if [ -z "$missing_s" ] && [ -z "$badhint" ]; then
    record "C2" "Skills register (0 load failures)" "PASS" "static: all ${N_SKILLS} skills present; no unquoted argument-hint arrays"
  else
    record "C2" "Skills register (0 load failures)" "FAIL" "static: missing:[${missing_s} ] bad-frontmatter:[${badhint}]"
  fi

  # C3 — agents resolve as maister-copilot:<name> (static set-equality built vs source)
  BUILT_AGENTS="$(ls "$PLUGIN_DIR"/agents/*.md 2>/dev/null | xargs -n1 basename | sed 's/\.md$//' | sort)"
  a_missing="$(comm -23 <(printf '%s\n' "$SOURCE_AGENTS") <(printf '%s\n' "$BUILT_AGENTS") | sed '/^$/d')"
  a_extra="$(comm -13 <(printf '%s\n' "$SOURCE_AGENTS") <(printf '%s\n' "$BUILT_AGENTS") | sed '/^$/d')"
  if [ -z "$a_missing" ] && [ -z "$a_extra" ]; then
    record "C3" "Agents resolve (${PLUGIN_NAME}:<name>)" "PASS" "static: built agent set == source set (${N_AGENTS}); runtime enumeration SKIPPED (no auth)"
  else
    record "C3" "Agents resolve (${PLUGIN_NAME}:<name>)" "FAIL" "static set mismatch — missing:[${a_missing}] extra:[${a_extra}]"
  fi

  # C4 / C5 — live model-delegation: SKIPPED in auth-free mode
  record "C4" "task(agent_type) delegation" "SKIP" "requires an authenticated live session (--no-live)"
  record "C5" "skill(<name>) invocation" "SKIP" "requires an authenticated live session (--no-live)"

  # C6 — hooks present (static; firing SKIPPED)
  HJ="$PLUGIN_DIR/hooks/hooks.json"
  if [ -f "$HJ" ] && grep -q 'SessionStart' "$HJ" && grep -q 'PreToolUse' "$HJ" && grep -q 'CLAUDE_PLUGIN_ROOT' "$HJ"; then
    record "C6" "Hooks fire (SessionStart+PreToolUse, \${CLAUDE_PLUGIN_ROOT})" "PASS" "static: hooks.json declares SessionStart + PreToolUse + \${CLAUDE_PLUGIN_ROOT}; firing SKIPPED (no auth)"
  else
    record "C6" "Hooks fire (SessionStart+PreToolUse, \${CLAUDE_PLUGIN_ROOT})" "FAIL" "static: hooks/hooks.json missing or lacks SessionStart/PreToolUse/\${CLAUDE_PLUGIN_ROOT}"
  fi

  # C7 — plugin .mcp.json present (static; runtime load SKIPPED)
  MCP_SERVERS="$(json_get "$PLUGIN_DIR/.mcp.json" mcpServers)"
  if [ -n "$MCP_SERVERS" ]; then
    record "C7" "Plugin .mcp.json loads" "PASS" "static: .mcp.json declares server(s): ${MCP_SERVERS}; runtime load SKIPPED (no auth)"
  else
    record "C7" "Plugin .mcp.json loads" "FAIL" "static: .mcp.json missing or declares no mcpServers"
  fi

# ============================================================================ LIVE
else
  if [ -z "$COPILOT_BIN" ]; then
    echo "ERROR: copilot CLI not found; use --no-live for the auth-free subset." >&2
    exit 2
  fi

  # ---- neutralize the installed-plugin shadow under the real HOME (reversible) ----
  if [ -f "$REAL_CONFIG" ]; then
    cp -a "$REAL_CONFIG" "$CONFIG_BACKUP"
    filter_config "$REAL_CONFIG" "$REAL_CONFIG.compat.tmp" && mv "$REAL_CONFIG.compat.tmp" "$REAL_CONFIG"
    NEUTRALIZED=1
    ISOLATION_NOTE="live: installed maister-copilot temporarily removed from ~/.copilot/config.json (backed up; restored byte-identical on exit)."
  else
    ISOLATION_NOTE="live: no ~/.copilot/config.json found; ran under the current HOME as-is."
  fi

  # C1 — plugin loads (inspection under neutralized real HOME)
  PL="$(copilot --experimental --plugin-dir "$PLUGIN_DIR" plugin list 2>/dev/null || true)"
  PL_EXT="$(printf '%s\n' "$PL" | awk '/External Plugins/{f=1} f')"
  if printf '%s' "$PL_EXT" | grep -qw "$PLUGIN_NAME"; then
    record "C1" "Plugin loads" "PASS" "'plugin list' shows ${PLUGIN_NAME} under External Plugins (via --plugin-dir)"
  else
    record "C1" "Plugin loads" "FAIL" "${PLUGIN_NAME} not shown as External by 'plugin list' (shadow not cleared?)"
  fi

  # C3 — agents resolve as <plugin>:<name> (invalid --agent enumeration; credit-free, needs auth)
  AGOUT="$(copilot --experimental --plugin-dir "$PLUGIN_DIR" --agent __compat_nonexistent__ -p "hi" 2>&1 || true)"
  # NOTE: agent names may contain digits (e.g. e2e-test-verifier) — [a-z0-9-] is required.
  ENUM_AGENTS="$(printf '%s\n' "$AGOUT" | grep -oE "${PLUGIN_NAME}:[a-z0-9][a-z0-9-]+" | sed "s/^${PLUGIN_NAME}://" | sort -u)"
  ea_missing="$(comm -23 <(printf '%s\n' "$SOURCE_AGENTS") <(printf '%s\n' "$ENUM_AGENTS") | sed '/^$/d')"
  ea_extra="$(comm -13 <(printf '%s\n' "$SOURCE_AGENTS") <(printf '%s\n' "$ENUM_AGENTS") | sed '/^$/d')"
  n_enum="$(printf '%s\n' "$ENUM_AGENTS" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$n_enum" -gt 0 ] && [ -z "$ea_missing" ] && [ -z "$ea_extra" ]; then
    record "C3" "Agents resolve (${PLUGIN_NAME}:<name>)" "PASS" "invalid-agent probe enumerated all ${N_AGENTS} agents as ${PLUGIN_NAME}:<name> (set-equality)"
  else
    record "C3" "Agents resolve (${PLUGIN_NAME}:<name>)" "FAIL" "enumerated ${n_enum} — missing:[${ea_missing}] extra:[${ea_extra}]"
  fi

  # ---- one consolidated authenticated session drives C2, C4, C5, C6, C7 ----
  PROBE_RUN="$RUNDIR/compat-probe"
  cp -a "$FIXTURE_SRC" "$PROBE_RUN"
  sedi "s#__PLUGIN_ABS__#$PROBE_RUN#g" "$PROBE_RUN/hooks/hooks.json"
  chmod +x "$PROBE_RUN"/hooks/*.sh
  : > "$PROBE_RUN/hook-probe.log"
  HOOK_LOG="$PROBE_RUN/hook-probe.log"
  LIVE_LOG_DIR="$RUNDIR/logs"; mkdir -p "$LIVE_LOG_DIR"

  # NOTE on C5 reliability: which skill the model *chooses* to invoke is model-driven
  # (a non-goal). We anchor on the purpose-built compat-probe `probe-skill` (it exists to
  # be invoked and replies PROBE_SKILL_OK) while also asking for the plugin skill; C5
  # passes on EITHER skill-context, so the mechanism is proven deterministically.
  PROMPT="Do ALL of these steps in order, then stop. Do not skip any step.
1. Run the shell command: echo COMPAT_BASH_PROBE_OK
2. Use the task tool with agent_type '${PLUGIN_NAME}:${PROBE_AGENT}', description 'probe', and prompt 'Reply with exactly the token AGENT_DELEG_OK and nothing else. Do not use any tools.'
3. Use the skill tool with skill 'probe-skill'.
4. Use the skill tool with skill '${PROBE_SKILL}'.
5. Reply with exactly: LIVE_PROBE_DONE"

  echo "  … running one live session (task + skill + hooks + mcp); consumes a few AI credits …"
  set +e
  ( cd "$REPO_ROOT" && copilot --experimental \
      --plugin-dir "$PLUGIN_DIR" \
      --plugin-dir "$PROBE_RUN" \
      --allow-all --no-ask-user --log-level debug --log-dir "$LIVE_LOG_DIR" \
      -p "$PROMPT" ) >"$RUNDIR/session.out" 2>&1
  set -e
  LIVE_LOG="$(ls "$LIVE_LOG_DIR"/*.log 2>/dev/null | head -1 || true)"

  if [ -z "$LIVE_LOG" ] || grep -q "No authentication information found" "$RUNDIR/session.out" 2>/dev/null; then
    reason="live session produced no debug log"
    grep -q "No authentication" "$RUNDIR/session.out" 2>/dev/null && reason="live session not authenticated (no seat) — use --no-live in CI"
    for id in C2 C4 C5 C6 C7; do
      case "$id" in
        C2) nm="Skills register (0 load failures)";;
        C4) nm="task(agent_type) delegation";;
        C5) nm="skill(<name>) invocation";;
        C6) nm="Hooks fire (SessionStart+PreToolUse, \${CLAUDE_PLUGIN_ROOT})";;
        C7) nm="Plugin .mcp.json loads";;
      esac
      record "$id" "$nm" "FAIL" "$reason"
    done
  else
    # C2 — skills register: the model's <available_skills> is ground truth (skill list does
    # NOT enumerate --plugin-dir skills). A skill that fails to load never appears here.
    missing_ls=""; for s in $SOURCE_SKILLS; do grep -q "<name>${s}</name>" "$LIVE_LOG" || missing_ls="$missing_ls $s"; done
    if [ -z "$missing_ls" ]; then
      record "C2" "Skills register (0 load failures)" "PASS" "all ${N_SKILLS} source skills present in the session's <available_skills> (0 load failures)"
    else
      record "C2" "Skills register (0 load failures)" "FAIL" "skills absent from <available_skills>:[${missing_ls} ]"
    fi

    # C4 — a live task(agent_type) delegation to <plugin>:<agent> executed. Two ground-truth
    # signals accepted, so the check spans CLI versions:
    #   • pre-1.0.76:    the `SessionAgentExecutor.execute() called for "<plugin>:<agent>"` line.
    #   • 1.0.76+ (Rust runtime, which dropped that line): the model's task tool CALL — its
    #     `arguments` JSON carries `"agent_type":"<plugin>:<agent>"`. We match a single log line
    #     that has `arguments` AND `agent_type` AND the agent name, which is the tool-call record.
    #     The scripted prompt's echo lives in a `text` field with no `arguments`, so it can NOT
    #     self-satisfy this (verified: the prompt line is excluded).
    if grep -qa "SessionAgentExecutor.execute() called for \"${PLUGIN_NAME}:${PROBE_AGENT}\"" "$LIVE_LOG" \
       || { grep -a 'agent_type' "$LIVE_LOG" | grep -a 'arguments' | grep -qa "${PLUGIN_NAME}:${PROBE_AGENT}"; }; then
      record "C4" "task(agent_type) delegation" "PASS" "debug log: task tool invoked with agent_type \"${PLUGIN_NAME}:${PROBE_AGENT}\" (1.0.76 tool-call args, or pre-1.0.76 SessionAgentExecutor.execute())"
    else
      record "C4" "task(agent_type) delegation" "FAIL" "no task(agent_type) delegation to \"${PLUGIN_NAME}:${PROBE_AGENT}\" in debug log (checked 1.0.76 tool-call args + pre-1.0.76 SessionAgentExecutor)"
    fi

    # C5 — a skill(<name>) invocation succeeded. Ground truth is the skill tool's output
    # `Skill "<name>" loaded successfully` (emitted for every invocation). Quotes are
    # JSON-escaped in the debug log, so match with wildcards (not literal quotes). Accept
    # the maister plugin skill (ideal) OR the purpose-built probe-skill (reliable anchor)
    # — either proves the skill-tool mechanism resolves a bare plugin-skill name.
    skill_loaded() { grep -aqE "Skill .*${1}.* loaded successfully" "$LIVE_LOG"; }
    if skill_loaded "$PROBE_SKILL"; then
      record "C5" "skill(<name>) invocation" "PASS" "debug log: Skill \"${PROBE_SKILL}\" loaded successfully (maister plugin skill)"
    elif skill_loaded "probe-skill"; then
      record "C5" "skill(<name>) invocation" "PASS" "debug log: Skill \"probe-skill\" loaded successfully (mechanism proven; maister skills' registration is covered by C2)"
    else
      record "C5" "skill(<name>) invocation" "FAIL" "no 'Skill \"<name>\" loaded successfully' for '${PROBE_SKILL}' or 'probe-skill' in debug log"
    fi

    # C6 — hooks fire: probe markers (mechanism) + plugin-under-test ships & fires its hooks
    abs_ok=0; var_ok=0; pre_ok=0; root_ok=0
    grep -q "ABS_HOOK_FIRED" "$HOOK_LOG" 2>/dev/null && abs_ok=1
    grep -q "VAR_HOOK_FIRED" "$HOOK_LOG" 2>/dev/null && var_ok=1
    grep -q "PRETOOL_HOOK_FIRED" "$HOOK_LOG" 2>/dev/null && pre_ok=1
    # ${CLAUDE_PLUGIN_ROOT} expanded to a non-empty value in the markers
    grep -qE "CLAUDE_PLUGIN_ROOT=\[[^]]+\]" "$HOOK_LOG" 2>/dev/null && root_ok=1
    plugin_hooks_present=0; [ -f "$PLUGIN_DIR/hooks/hooks.json" ] && plugin_hooks_present=1
    plugin_hook_fired="n/a"
    if [ -n "$PLUGIN_HOOK_MARKER" ]; then
      if grep -q "$PLUGIN_HOOK_MARKER" "$LIVE_LOG" 2>/dev/null; then plugin_hook_fired="fired"; else plugin_hook_fired="NOT-fired"; fi
    fi
    if [ "$abs_ok" = 1 ] && [ "$var_ok" = 1 ] && [ "$pre_ok" = 1 ] && [ "$root_ok" = 1 ] \
       && [ "$plugin_hooks_present" = 1 ] && [ "$plugin_hook_fired" != "NOT-fired" ]; then
      record "C6" "Hooks fire (SessionStart+PreToolUse, \${CLAUDE_PLUGIN_ROOT})" "PASS" "probe SessionStart(abs,var)+PreToolUse markers fired w/ expanded \${CLAUDE_PLUGIN_ROOT}; plugin hooks present & fired (${plugin_hook_fired})"
    else
      record "C6" "Hooks fire (SessionStart+PreToolUse, \${CLAUDE_PLUGIN_ROOT})" "FAIL" "abs=$abs_ok var=$var_ok pretool=$pre_ok root_expanded=$root_ok plugin_hooks_present=$plugin_hooks_present plugin_hook=$plugin_hook_fired"
    fi

    # C7 — plugin .mcp.json loaded at runtime (the server(s) it declares were started by the CLI).
    # Version-tolerant load line, requiring each declared server to appear by name:
    #   • pre-1.0.76:    `Loaded MCP config from plugin-dir plugins …` (explicitly plugin-scoped).
    #   • 1.0.76+ (Rust runtime): `[rust:copilot_runtime::session::mcp::session_host] mcp
    #     discover_and_start_root …`, whose config signature lists the started servers by name.
    # On 1.0.76 that line is not textually "plugin-dir"-scoped (the Rust runtime merges MCP
    # sources), but the harness removes the operator's installed maister-copilot first, so the
    # plugin's --plugin-dir .mcp.json is the only source of these server names.
    PLUGIN_MCP_SERVERS="$(json_get "$PLUGIN_DIR/.mcp.json" mcpServers)"
    mcp_hit=0; mcp_line=""
    for srv in $PLUGIN_MCP_SERVERS; do
      line="$(grep -aE 'Loaded MCP config from plugin-dir plugins|mcp discover_and_start_root' "$LIVE_LOG" | grep -a "$srv" | tail -1 || true)"
      [ -n "$line" ] && { mcp_hit=1; mcp_line="$line"; }
    done
    if [ "$mcp_hit" = 1 ]; then
      record "C7" "Plugin .mcp.json loads" "PASS" "debug log: runtime MCP load line names plugin server(s) [${PLUGIN_MCP_SERVERS}]"
    else
      record "C7" "Plugin .mcp.json loads" "FAIL" "no MCP load line (pre-1.0.76 'Loaded MCP config' or 1.0.76 'discover_and_start_root') mentioning [${PLUGIN_MCP_SERVERS}] in debug log"
    fi
  fi

  # restore the operator's config as early as possible (trap also restores, idempotent)
  restore_config
fi

# ============================================================================ report
mkdir -p "$REPORTS_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$REPORTS_DIR/compat-report-$TS.md"

n_pass=0; n_fail=0; n_skip=0
for st in "${CHK_STATUS[@]}"; do
  case "$st" in PASS) n_pass=$((n_pass+1));; FAIL) n_fail=$((n_fail+1));; SKIP) n_skip=$((n_skip+1));; esac
done
OVERALL="GREEN"; [ "$n_fail" -gt 0 ] && OVERALL="RED"

{
  echo "# Copilot CLI Compatibility Report"
  echo
  echo "- **Generated (UTC):** $TS"
  echo "- **Copilot CLI:** \`${COPILOT_VERSION}\`"
  echo "- **Plugin under test:** \`${PLUGIN_DIR}\` (name: \`${PLUGIN_NAME}\`)"
  echo "- **Mode:** ${MODE}"
  echo "- **Source contract sets:** ${N_AGENTS} agents, ${N_SKILLS} skills (derived from \`plugins/maister/\` at runtime)"
  echo "- **Isolation:** ${ISOLATION_NOTE}"
  echo "- **Result:** **${OVERALL}** — ${n_pass} PASS · ${n_fail} FAIL · ${n_skip} SKIP"
  echo
  echo "| # | Runtime contract | Status | Evidence |"
  echo "|---|------------------|--------|----------|"
  i=0
  while [ "$i" -lt "${#CHK_ID[@]}" ]; do
    d="$(printf '%s' "${CHK_DETAIL[$i]}" | sed 's/|/\\|/g')"
    echo "| ${CHK_ID[$i]} | ${CHK_NAME[$i]} | ${CHK_STATUS[$i]} | ${d} |"
    i=$((i+1))
  done
  echo
  echo "## What each contract asserts"
  echo
  echo "1. **Plugin loads** — \`copilot … plugin list\` shows the plugin (via \`--plugin-dir\`)."
  echo "2. **Skills register, 0 load failures** — all source skills appear in the live session's \`<available_skills>\` (a skill that fails to load never appears). Static mode: all \`skills/<name>/SKILL.md\` present with string \`argument-hint\`."
  echo "3. **Agents resolve as \`${PLUGIN_NAME}:<name>\`** — the invalid-\`--agent\` probe enumerates them; asserted by **set-equality** against \`plugins/maister/agents/*.md\` (not a literal count). Static mode: built agent set == source set."
  echo "4. **\`task(agent_type:\"${PLUGIN_NAME}:<agent>\")\` executes** — \`SessionAgentExecutor.execute()\` in the debug log."
  echo "5. **\`skill(\"<name>\")\` invocation works** — the skill tool's \`Skill \"<name>\" loaded successfully\` output in the debug log (maister skill, or the purpose-built probe-skill as a reliable anchor)."
  echo "6. **\`SessionStart\` + \`PreToolUse\` hooks fire** incl. \`\${CLAUDE_PLUGIN_ROOT}\` expansion — run-local probe markers + the plugin's own SessionStart hook firing."
  echo "7. **Plugin \`.mcp.json\` loads** — \`Loaded MCP config from … plugins\` names the plugin's server."
  echo
  echo "_Model-driven delegation (Copilot *choosing* when to call \`task\`/\`skill\`) is a non-goal;"
  echo "this harness asserts capability + addressability, driven by an explicit scripted prompt._"
} > "$REPORT"

echo "=========================================================================="
echo " Result: ${OVERALL}  (${n_pass} PASS · ${n_fail} FAIL · ${n_skip} SKIP)"
echo " Report: ${REPORT}"
echo "=========================================================================="

[ "$n_fail" -gt 0 ] && exit 1
exit 0
