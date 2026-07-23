#!/bin/bash
# ============================================================================
# GitHub Copilot CLI variant of the destructive-command guard (generator override)
# ============================================================================
#
# This is NOT the Claude hook. build.sh copies this file over the Claude guard in the
# GENERATED plugin only; the Claude source hook
# (plugins/maister/hooks/block-destructive-commands.sh) stays 100% untouched (zero-touch).
#
# ── WHY A SEPARATE COPILOT VARIANT? ────────────────────────────────────────
# The Claude guard blocks destructive commands from non-whitelisted SUBAGENTS, keyed on
# the PreToolUse payload's `agent_type` (main agent = allowed; rogue subagent in a
# parallel wave = denied, so it can't clobber siblings with `git reset --hard` / `rm -rf`).
#
# GitHub Copilot CLI's PreToolUse payload carries NO agent identifier — verified live on
# Copilot CLI 1.0.73: the payload keys are only
# [cwd, hook_event_name, session_id, timestamp, tool_input, tool_name] for BOTH main-agent
# and task-subagent calls, and no Copilot-set env var identifies the caller either. So the
# Claude guard's `agent_type` gating can never fire on Copilot — shipped unchanged, it is a
# SILENT NO-OP (its `[ -z "$AGENT_TYPE" ] && exit 0` branch always wins → nothing is blocked).
#
# ── WHY "ask" (and not "deny" or nothing)? ─────────────────────────────────
# With no way to tell main from subagent, the three options are:
#   1. no-op   (ship the Claude guard as-is) → zero protection. Rejected.
#   2. "deny"  (block every destructive command) → also blocks the MAIN agent's legitimate
#              `git reset --hard` / `rm -rf` (temp cleanup, intentional resets). Breaks
#              normal use. Rejected.
#   3. "ask"   (confirm every destructive command) → the user approves the legitimate ones
#              and declines a rogue/hallucinated one. Needs no agent identity. CHOSEN.
#
# ── WHY "ask" ACTUALLY WORKS ON COPILOT (verified 1.0.73) ──────────────────
# Copilot honors `permissionDecision: "ask"` AND does not bypass it under --allow-all-tools:
#   • interactive        → the user gets a confirmation prompt before the command runs;
#   • headless/no-human  → the command is HELD (not executed) = fail-closed / safe.
# Net vs Claude: slightly stricter (the main agent's destructive commands now also confirm),
# which is a safety improvement, not a regression.
#
# The clean long-term fix is a Copilot FR to add an agent identifier to the hook payload;
# until then, "ask" is the best available behavior. See compat-tests/L1-FINDINGS.md.
# ============================================================================

INPUT=$(cat)

# Extract the command precisely when jq is available; otherwise scan the raw payload
# (a safe fallback — at worst it asks slightly more often, never less).
if command -v jq >/dev/null 2>&1; then
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
  [ -z "$COMMAND" ] && COMMAND="$INPUT"
else
  COMMAND="$INPUT"
fi

# Same destructive patterns as the Claude guard (kept in sync for parity).
if printf '%s' "$COMMAND" | grep -qEi 'git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*$|git\s+clean|git\s+push\s+(-f|--force)|rm\s+-rf'; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "Maister guard: destructive command — confirm before running: ${COMMAND:0:80}"
  }
}
EOF
  exit 0
fi

exit 0
