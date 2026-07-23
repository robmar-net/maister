#!/bin/bash
# PreToolUse hook (matcher: Bash) — fires before a shell/bash tool call.
# Proves PreToolUse hooks fire; records the expanded CLAUDE_PLUGIN_ROOT.
echo "PRETOOL_HOOK_FIRED cwd=$(pwd) CLAUDE_PLUGIN_ROOT=[${CLAUDE_PLUGIN_ROOT}]" >> "${CLAUDE_PLUGIN_ROOT}/hook-probe.log"
