#!/bin/bash
# SessionStart hook invoked via ${CLAUDE_PLUGIN_ROOT} in its command path (hooks.json).
# Proves Copilot expands ${CLAUDE_PLUGIN_ROOT} in hook commands AND exports it as env.
echo "VAR_HOOK_FIRED cwd=$(pwd) CLAUDE_PLUGIN_ROOT=[${CLAUDE_PLUGIN_ROOT}]" >> "${CLAUDE_PLUGIN_ROOT}/hook-probe.log"
