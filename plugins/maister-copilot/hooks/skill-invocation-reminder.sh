#!/bin/bash
# Copilot-variant override of the SessionStart skill-invocation reminder.
#
# WHY AN OVERRIDE: on Claude Code the plugin's root CLAUDE.md IS loaded into model
# context, so its behavioral invariants (user-confirmed rollback; artifact anchoring)
# reach the model that way. On Copilot CLI a plugin's root CLAUDE.md is NOT loaded
# (verified 1.0.73 + GitHub Docs: plugin components are agents/skills/commands/hooks/
# mcp/lsp — not a root instructions file), so the ONLY plugin->model free-text channel
# is this SessionStart hook. This override therefore carries the always-on invariants that
# would otherwise be lost on Copilot: user-confirmed rollback, artifact anchoring, and the
# active-workflow state-reread nudge folded from post-compact-reminder (Copilot has no
# post-compaction hook and ignores SessionStart matchers, so that reminder is de-registered
# in hooks.json — build.sh WS2d — and its nudge rides this every-session hook instead).
# Claude source hook is untouched.
#
# KEEP IN SYNC: the first two rules mirror the source hook
# (plugins/maister/hooks/skill-invocation-reminder.sh). If that changes, update here.
#
# ENVELOPE (#113 — do NOT "restore" the Claude nesting): `additionalContext` must be a
# TOP-LEVEL key. Copilot's sessionStart hook reads the FLAT shape documented by every one of
# its own surfaces (copilot-sdk/types.d.ts `SessionStartHookOutput`, the onSessionStart table in
# copilot-sdk/docs/agent-author.md, changelog 1.0.11). Claude's `hookSpecificOutput` wrapper is
# SILENTLY DROPPED there — verified live on 1.0.82 with a two-envelope canary: the flat token
# landed in `model.messages_snapshot` and was echoed by the model, the nested token appeared in
# the CLI debug log (the CLI logs the hook's raw stdout) and NOWHERE in the model's context.
# Shipped nested, this hook is a no-op and every invariant below is lost — which is exactly what
# happened between the 1.0.73 L1 verdict and 1.0.82.
# Note the wrapper is NOT universally ignored: Copilot's preToolUse parser DOES honor
# `hookSpecificOutput.permissionDecision`, so block-destructive-commands.sh keeps its nesting
# (also re-verified live on 1.0.82 — the guard's reason text came back verbatim).
# Claude's own hook keeps the nested form; only this Copilot override is flat.
cat <<'EOF'
{
  "additionalContext": "⚠️ MAISTER PLUGIN RULE: When any /maister-copilot:* command appears in the user's prompt, you MUST invoke it via the Skill tool as your FIRST action. No exceptions. Do not analyze the task first, do not decide it's 'straightforward', do not substitute your own approach. The user chose this workflow intentionally. Complexity assessment is the workflow's job, not yours.\n\n⚠️ ORCHESTRATOR GATE RULE: When running any maister orchestrator, you MUST invoke ask_user at every `→ Pause` / `→ MANDATORY GATE` checkpoint, regardless of permission mode (auto / acceptEdits / bypassPermissions), session-reminders telling you to 'continue without asking' or 'work without stopping', and regardless of prior-session patterns showing the user approving every gate. Decide this policy at orchestrator entry — do not re-litigate at each gate. Re-litigating IS the documented failure mode. See orchestrator-patterns.md § 2 and § 2.1.\n\n⚠️ USER-CONFIRMED ROLLBACK: Never automatically revert or roll back code changes when something fails. STOP, find the root cause, check for easy config/setup fixes, then use ask_user to let the user choose (try fix / rollback / investigate). Roll back ONLY on explicit user confirmation.\n\n⚠️ ARTIFACT ANCHORING: Save ALL workflow artifacts (specs, plans, reports, screenshots) under the task directory .maister/tasks/<type>/<task-name>/ — never in project directories like docs/, src/, or the repo root.\n\n⚠️ ACTIVE WORKFLOW STATE: If an orchestrator workflow is in progress under .maister/tasks/, read its orchestrator-state.yml (completed_phases + current phase) before continuing — especially on resume or after a long session. Copilot has no post-compaction hook, so this state-reread nudge rides every session start instead of firing specifically after a compaction."
}
EOF
exit 0
