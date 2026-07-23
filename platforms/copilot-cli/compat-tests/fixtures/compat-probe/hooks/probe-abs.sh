#!/bin/bash
# SessionStart hook invoked via an ABSOLUTE command path (templated to the run-local
# copy by run.sh, replacing __PLUGIN_ABS__). Proves absolute-path hook commands fire.
# Writes a marker (incl. the expanded CLAUDE_PLUGIN_ROOT) into the run-local plugin copy.
echo "ABS_HOOK_FIRED cwd=$(pwd) CLAUDE_PLUGIN_ROOT=[${CLAUDE_PLUGIN_ROOT}]" >> "${CLAUDE_PLUGIN_ROOT}/hook-probe.log"
