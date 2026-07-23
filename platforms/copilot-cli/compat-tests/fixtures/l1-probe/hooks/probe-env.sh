#!/bin/bash
# L1b probe (SessionStart) — capture whether Copilot exports $CLAUDE_PROJECT_DIR.
#
# The plugin's real post-compact-reminder.sh keys off "$CLAUDE_PROJECT_DIR/.maister/tasks";
# $CLAUDE_PROJECT_DIR is a Claude-Code-specific env var. This probe records, from inside a
# real Copilot hook environment, whether that var is set (and, for contrast, whether the
# Copilot-provided ${CLAUDE_PLUGIN_ROOT} IS set). Appends to a run-local log only.
#
# Uses ${VAR-<UNSET>} (not :-) so an unset var is distinguishable from a set-but-empty one.
LOG="${CLAUDE_PLUGIN_ROOT}/l1-probe-env.log"
echo "L1_ENV_PROBE CLAUDE_PROJECT_DIR=[${CLAUDE_PROJECT_DIR-<UNSET>}] CLAUDE_PLUGIN_ROOT=[${CLAUDE_PLUGIN_ROOT-<UNSET>}]" >> "$LOG"
echo "L1_ENV_PROBE_CLAUDE_VARS: $(env | grep -i '^CLAUDE' | cut -d= -f1 | sort | tr '\n' ',' )" >> "$LOG"
exit 0
