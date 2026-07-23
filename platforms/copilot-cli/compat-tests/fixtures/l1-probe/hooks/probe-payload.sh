#!/bin/bash
# L1a probe (PreToolUse, matcher Bash) — capture the raw payload Copilot delivers to a
# Bash PreToolUse hook, so we can prove whether it carries an agent identifier.
#
# Copilot sends the SAME payload to every matching PreToolUse/Bash hook, so what this probe
# logs is byte-for-byte what the real block-destructive-commands.sh guard receives. The
# guard's whole subagent-gating branch depends on `.agent_type`; if that key is absent the
# guard falls through its "main agent (no agent_type) -> allow" path and never blocks.
#
# This probe is decision-neutral: it logs and exits 0 (no permissionDecision), leaving the
# real guard's verdict untouched. Appends to a run-local log only.
LOG="${CLAUDE_PLUGIN_ROOT}/l1-probe-payload.log"
INPUT=$(cat)
KEYS=$(printf '%s' "$INPUT" | jq -cS 'keys' 2>/dev/null || echo '<jq-failed>')
AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_type // "<ABSENT>"' 2>/dev/null)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // "<none>"' 2>/dev/null)
echo "L1_PAYLOAD keys=${KEYS} agent_type=${AGENT} command=[${CMD}]" >> "$LOG"
exit 0
