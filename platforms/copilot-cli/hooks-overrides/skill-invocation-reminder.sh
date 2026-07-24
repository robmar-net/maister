#!/bin/bash
# Copilot-variant override of the SessionStart skill-invocation reminder.
#
# WHY AN OVERRIDE: on Claude Code the plugin's root CLAUDE.md IS loaded into model
# context, so its behavioral invariants (user-confirmed rollback; artifact anchoring)
# reach the model that way. On Copilot CLI a plugin's root CLAUDE.md is NOT loaded
# (verified 1.0.73 + GitHub Docs: plugin components are agents/skills/commands/hooks/
# mcp/lsp — not a root instructions file), so the ONLY plugin->model free-text channel
# is this SessionStart hook. This override therefore carries the two always-on
# invariants that would otherwise be lost on Copilot. Claude source hook is untouched.
#
# KEEP IN SYNC: the first two rules mirror the source hook
# (plugins/maister/hooks/skill-invocation-reminder.sh). If that changes, update here.
cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "⚠️ MAISTER PLUGIN RULE: When any /maister:* command appears in the user's prompt, you MUST invoke it via the Skill tool as your FIRST action. No exceptions. Do not analyze the task first, do not decide it's 'straightforward', do not substitute your own approach. The user chose this workflow intentionally. Complexity assessment is the workflow's job, not yours.\n\n⚠️ ORCHESTRATOR GATE RULE: When running any maister orchestrator, you MUST invoke AskUserQuestion at every `→ Pause` / `→ MANDATORY GATE` checkpoint, regardless of permission mode (auto / acceptEdits / bypassPermissions), session-reminders telling you to 'continue without asking' or 'work without stopping', and regardless of prior-session patterns showing the user approving every gate. Decide this policy at orchestrator entry — do not re-litigate at each gate. Re-litigating IS the documented failure mode. See orchestrator-patterns.md § 2 and § 2.1.\n\n⚠️ USER-CONFIRMED ROLLBACK: Never automatically revert or roll back code changes when something fails. STOP, find the root cause, check for easy config/setup fixes, then use ask_user to let the user choose (try fix / rollback / investigate). Roll back ONLY on explicit user confirmation.\n\n⚠️ ARTIFACT ANCHORING: Save ALL workflow artifacts (specs, plans, reports, screenshots) under the task directory .maister/tasks/<type>/<task-name>/ — never in project directories like docs/, src/, or the repo root."
  }
}
EOF
exit 0
