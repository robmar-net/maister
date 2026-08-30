#!/bin/bash
# #57 PostToolUse state-normalizer PROTOTYPE.
#
# Registered as a PostToolUse hook (matcher: Edit — Copilot's apply-patch file tool; verified live
# 2026-08-30 on Copilot 1.0.82 that PostToolUse fires and carries tool_result). Reads the payload on
# stdin, recovers the written file path, and if it is orchestrator-state.yml, canonicalizes it.
#
# MODE (env STATE_NORMALIZER_MODE):
#   shadow  (DEFAULT, drift-safe) — write the canonical form to a SIBLING file
#           orchestrator-state.canonical.yml; NEVER touch the model's working file. Rationale: Copilot
#           writes the state file via incremental `*** Update File:` patches (observed 6-18 per run),
#           so rewriting it in place would desync the file from the model's expected content and break
#           the next patch on context mismatch. The shadow gives any reader a conformant artifact
#           without that risk. (Companion change: the L2 extractor prefers the shadow when present.)
#   in-place — rewrite the working file. ONLY safe if the workflow always re-reads state before its
#           next patch (unverified). Behind this flag pending a live drift test.
#
# Decision-neutral: logs nothing to stdout, exits 0.
set +e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANON="${STATE_NORMALIZER_CANON:-$DIR/canonicalize-orchestrator-state.mjs}"
MODE="${STATE_NORMALIZER_MODE:-shadow}"

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT"    | jq -r '.cwd // empty' 2>/dev/null)
RESULT=$(printf '%s' "$INPUT" | jq -r '(.tool_result.text_result_for_llm // .tool_result // "") | tostring' 2>/dev/null)
PATCH=$(printf '%s' "$INPUT"  | jq -r '(.tool_input // "") | tostring' 2>/dev/null)

# recover any path ending in orchestrator-state.yml from the result text or the patch header
PATHS=$( { printf '%s\n' "$RESULT"; printf '%s\n' "$PATCH"; } \
  | grep -oE '[^ "]*orchestrator-state\.yml' | sort -u )

for p in $PATHS; do
  case "$p" in /*) abs="$p" ;; *) abs="${CWD%/}/$p" ;; esac
  [ -f "$abs" ] || continue
  if [ "$MODE" = "in-place" ]; then
    node "$CANON" --in-place "$abs" 2>/dev/null
  else
    node "$CANON" "$abs" > "${abs%.yml}.canonical.yml" 2>/dev/null
  fi
done
exit 0
