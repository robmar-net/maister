#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE="$ROOT/plugins/maister"
OUT="$ROOT/plugins/maister-copilot"

# Cross-platform sed in-place (macOS needs '' arg, Linux doesn't)
sedi() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# Transformer language decision (WS1 / audit L4): bash + grep/sed (via sedi) for
# the context-free bulk passes, plus perl for the kind-aware reference rewrite in
# step 4. perl gives portable \b word boundaries and a uniform -i (no BSD-vs-GNU
# sed divergence) and ships on both macOS and ubuntu-latest CI — no new heavy
# runtime dep. python3/node remain fallbacks. All passes are deterministic so a
# rebuild on unchanged source stays byte-identical (CI auto-commit is a no-op).

rm -rf "$OUT"
cp -r "$CORE" "$OUT"
# WS2: keep hooks/ — the Claude-format hooks.json (SessionStart + PreToolUse,
# ${CLAUDE_PLUGIN_ROOT}) fires unchanged on Copilot CLI (live T8/T9); no deletion.
# WS2b: overlay the Copilot-specific destructive-command guard. Copilot's PreToolUse
# payload carries no agent identifier (verified live), so the Claude guard's subagent
# gating is a no-op there; the override asks the user to CONFIRM any destructive command
# (permissionDecision "ask" — Copilot honors it and does NOT bypass it under
# --allow-all-tools). Only the OUTPUT hook is replaced; the Claude source hook is untouched.
cp "$SCRIPT_DIR/hooks-overrides/block-destructive-commands.sh" "$OUT/hooks/block-destructive-commands.sh"
chmod +x "$OUT/hooks/block-destructive-commands.sh"
# WS2c: overlay the Copilot-specific SessionStart skill-invocation reminder. On Copilot a
# plugin's root CLAUDE.md is NOT loaded (verified 1.0.73 + GitHub Docs), so behavioral
# invariants that Claude gets from CLAUDE.md (user-confirmed rollback; artifact anchoring)
# must ride the SessionStart hook — the only plugin->model free-text channel. The override
# appends those two rules to the reminder's additionalContext. Claude source hook untouched.
cp "$SCRIPT_DIR/hooks-overrides/skill-invocation-reminder.sh" "$OUT/hooks/skill-invocation-reminder.sh"
chmod +x "$OUT/hooks/skill-invocation-reminder.sh"

# WS2d: drop the SessionStart `compact`-matched entry from hooks.json. On Copilot, SessionStart
# does NOT support a matcher and has no `compact` source (sources: startup/resume/new); a real
# compaction fires `preCompact` (before), never SessionStart, and there is no `postCompact`
# (verified live + hooks-configuration reference). Shipped unchanged, Copilot IGNORES the matcher
# and fires post-compact-reminder on EVERY session start (over-fire + misleading "post-compaction"
# wording), while true post-compaction nudging is impossible. So de-register it here; its
# state-reread nudge is folded (reworded) into the WS2c skill-invocation reminder that already
# fires every start. The orphaned post-compact-reminder.sh is left in place (still exercised by the
# L1 harness) but unwired. Claude source hooks.json is untouched — SessionStart:compact works there.
# Guarded: the compact block must match exactly once.
perl -0777 -i -pe '
  $c = s/      \{\n        "matcher": "compact",\n.*?\n      \},\n//s;
  END { exit($c == 1 ? 0 : 1) }
' "$OUT/hooks/hooks.json" || { echo "FAIL: WS2d: SessionStart compact block not found exactly once in \$OUT/hooks/hooks.json (source drift?)" >&2; exit 1; }

# WS2e (#95): normalize the model-facing nomenclature inside the SessionStart hooks' injected
# `additionalContext` to Copilot terms — the SAME two rewrites the *.md pipeline applies
# (AskUserQuestion -> ask_user, step 7; /maister:* -> /*, step 4e). The hooks are the only
# plugin->model channel not otherwise transformed (they are copied verbatim above), so without
# this the injected reminder shipped in Claude source nomenclature (`AskUserQuestion`, `/maister:*`)
# while the rest of the variant said `ask_user` / `/*` — a silent source-vs-generated drift, and
# the "no maister: in output" guards were *.md-scoped so they never caught it (issue #95).
# SAFE as a file-level sed: these two tokens appear ONLY in the injected additionalContext string,
# never in the maintainer comments (which intentionally contrast Claude vs Copilot and must stay).
# Guarded by `make validate` (WS5.15). Claude source hooks are untouched (only $OUT is edited).
for f in "$OUT"/hooks/*.sh; do
  sedi -e 's/AskUserQuestion/ask_user/g' -e 's|/maister:\*|/*|g' "$f"
done

# 1. Update plugin.json name + description (targeted string edits only — NO jq/python JSON
#    round-trip, so key order and byte-identity are preserved; keeps CI auto-commit a no-op).
sedi -e 's/"name": "maister"/"name": "maister-copilot"/' \
     -e 's#for Claude Code#for GitHub Copilot CLI#' "$OUT/.claude-plugin/plugin.json"

# 1b. Declare the MCP servers in the manifest so INSTALLED plugins load them. Copilot reads a
#     plugin's `.mcp.json` directly only via `--plugin-dir`; for an installed plugin, the
#     `mcpServers` field in plugin.json is the primary mechanism (per the CLI plugin reference).
#     Without it, `copilot` reports "Loaded MCP config from installed plugins: 0 server(s)" and
#     the bundled Playwright MCP never starts — breaking mockup-studio's visual companion and
#     e2e-test-verifier in normal (installed) use. Point it at the shipped root `.mcp.json`.
#     Inserted after the (now-renamed) name line via perl for a portable, byte-stable edit.
#     Guarded by `make validate` (WS5.13). Claude source plugin.json stays untouched.
perl -0777 -i -pe '
  $c = s/("name": "maister-copilot",\n)/$1  "mcpServers": ".mcp.json",\n/;
  END { exit($c == 1 ? 0 : 1) }
' "$OUT/.claude-plugin/plugin.json" || { echo "FAIL: step 1b: could not insert mcpServers into plugin.json (name line not found once?)" >&2; exit 1; }

# 2. Strip plugin prefix from command names: "maister:foo" → "foo"
#    Plugin system adds the plugin-id prefix automatically
find "$OUT/commands" -name "*.md" | while read f; do
  sedi 's/^name: maister:/name: /' "$f"
done

# 3. Strip plugin prefix from skill names: "maister:foo" → "foo"
find "$OUT/skills" -name "*.md" | while read f; do
  sedi 's/^name: maister:/name: /' "$f"
done

# 3b. (#86 T2) Map agent-level `model:` frontmatter aliases to Copilot catalog ids. Copilot HONORS
#     agent-level `model:` (probe #86 T1 on 1.0.82: an agent with `model: gpt-5.4` ran on gpt-5.4, not
#     the orchestrator default). But a Claude alias that is NOT a Copilot catalog id (e.g. `haiku`)
#     ERRORS at delegation time ("Model 'haiku' is not available") and the agent silently falls back to
#     the default model — a hidden quality regression. So rewrite the known Claude aliases to the live
#     Copilot catalog (ids verified from the 1.0.82 model list in the probe); leave `inherit` (a
#     recognized keyword that resolves to the session/default and ships working today); FAIL LOUD on any
#     other value so a new upstream alias forces a map update instead of shipping a runtime error.
#     Claude source agents (`plugins/maister/agents/**`) stay untouched — only $OUT is edited.
#     Guarded by `make validate` (WS5.17). See docs/adr/0002-copilot-agent-model-mapping.md.
for f in "$OUT"/agents/*.md; do
  mv=$(grep -m1 '^model:' "$f" | sed 's/^model:[[:space:]]*//' | tr -d '[:space:]')
  [ -z "$mv" ] && continue
  case "$mv" in
    inherit) : ;;                                                                            # keyword — leave
    haiku)  sedi 's/^model:[[:space:]]*haiku[[:space:]]*$/model: claude-haiku-4.5/'  "$f" ;;
    sonnet) sedi 's/^model:[[:space:]]*sonnet[[:space:]]*$/model: claude-sonnet-5/'  "$f" ;;
    opus)   sedi 's/^model:[[:space:]]*opus[[:space:]]*$/model: claude-opus-5/'      "$f" ;;
    *) echo "FAIL: unknown agent model alias '$mv' in $f — extend the #86 T2 map in build.sh with a Copilot catalog id (or map it to 'inherit')" >&2; exit 1 ;;
  esac
done

# 4. Kind-aware reference rewrite (registry-driven prose classification).
#    Replaces the former flat `s/maister:/maister-/g`, which mangled all three
#    entity kinds. Runs AFTER the name-strip steps (2-3) so `name:` frontmatter
#    is already bare. Reference-Naming Contract (live-verified, Copilot 1.0.73):
#      agent  maister:<name> -> <PLUGIN_ID>:<name>   (plugin-id auto-prefix)
#      skill  maister:<name> -> <name>               (bare; `skill` tool)
#      cmd    maister:<name> -> <name>               (bare; flat command)
#    Exclusions are automatic (the pattern requires the `maister:` colon form):
#      maister-copilot (plugin id), .maister/ paths, maister-plugins marketplace.

# 4a. Build the three name-set registries from the SOURCE tree ($CORE).
core_agents=$(for f in "$CORE"/agents/*.md; do basename "$f" .md; done | LC_ALL=C sort)
core_skills=$(for d in "$CORE"/skills/*/; do basename "$d"; done | LC_ALL=C sort)
core_commands=$(find "$CORE/commands" -name '*.md' | while read f; do basename "$f" .md; done | LC_ALL=C sort)

# 4b. Assert the load-bearing pairwise disjointness (agent vs skill, agent vs
#     command) so the single-lookup classification is sound; fail the build if not.
overlap_agent_skill=$(LC_ALL=C comm -12 <(echo "$core_agents") <(echo "$core_skills"))
overlap_agent_command=$(LC_ALL=C comm -12 <(echo "$core_agents") <(echo "$core_commands"))
if [ -n "$overlap_agent_skill" ] || [ -n "$overlap_agent_command" ]; then
  echo "FAIL: name-set overlap breaks reference classification" >&2
  [ -n "$overlap_agent_skill" ] && echo "  agent<->skill: $overlap_agent_skill" >&2
  [ -n "$overlap_agent_command" ] && echo "  agent<->command: $overlap_agent_command" >&2
  exit 1
fi

# 4c. Derive the agent prefix from the generated plugin id (not a hardcoded literal).
PLUGIN_ID=$(grep -m1 '"name"' "$OUT/.claude-plugin/plugin.json" | sed 's/.*"name":[[:space:]]*"\([^"]*\)".*/\1/')
case "$PLUGIN_ID" in
  maister*) : ;;
  *) echo "FAIL: could not derive plugin id (got '$PLUGIN_ID')" >&2; exit 1 ;;
esac

# 4d. Build one perl program covering every name, processed LONGEST-FIRST so a
#     shorter name that is a prefix of a longer one (e.g. skill `research` vs
#     agent `research-planner`) never wins. The (?![a-z0-9-]) lookahead already
#     blocks partial matches; longest-first is belt-and-suspenders. Output is
#     order-independent (rules are disjoint and never match each other's output),
#     so the rewrite stays byte-identical across rebuilds.
perl_prog=$(
  {
    for n in $core_agents; do echo "A $n"; done
    for n in $core_skills $core_commands; do echo "B $n"; done
  } | awk '{ print length($2), $0 }' | LC_ALL=C sort -k1,1nr -k3,3 | while read len kind name; do
    if [ "$kind" = "A" ]; then
      printf 's/\\bmaister:\\Q%s\\E(?![a-z0-9-])/%s:%s/g;\n' "$name" "$PLUGIN_ID" "$name"
    else
      printf 's/\\bmaister:\\Q%s\\E(?![a-z0-9-])/%s/g;\n' "$name" "$name"
    fi
  done
)

find "$OUT" -name "*.md" | while read f; do
  perl -0pi -e "$perl_prog" "$f"
done

# 4e. Translate the non-literal `maister:` reference forms that are not registry
#     names (the perl pass in 4d leaves them): a `skill:` placeholder, a
#     slash-command glob, and any illustrative COMPOUND `maister:<x>:<y>` token.
#     A compound is never a real reference (references are single-segment), so it
#     is an illustrative example — e.g. product-design's `/maister:feature:new`
#     "does-not-exist" counter-example. Stripping the `maister:` prefix here keeps
#     the Claude source 100% untouched (zero-touch) while clearing the token from
#     the Copilot output (satisfies the no-`maister:`-in-output contract).
find "$OUT" -name "*.md" | while read f; do
  sedi -e 's|maister:\[orchestrator-name\]|[orchestrator-name]|g' \
       -e 's|/maister:\*|/*|g' \
       -e 's|maister:\([a-z][a-z0-9-]*:[a-z][a-z0-9-]*\)|\1|g' "$f"
done

# 4f. Fail loud on ANY residual `maister:` reference token. Safe because 4e cleared
#     the placeholder/glob and the compound illustrative form, so a clean build has
#     zero `maister:` — a residual now means a genuinely unknown single-segment ref.
residual=$(grep -rnE 'maister:' "$OUT" --include='*.md' || true)
if [ -n "$residual" ]; then
  echo "FAIL: unresolved maister:<name> reference token(s) after rewrite:" >&2
  echo "$residual" >&2
  exit 1
fi

# 5. (removed) Multi-select downgrade — NO LONGER APPLIED.
#    This step used to rewrite "multi-select" -> "sequential single-select" on the assumption
#    that Copilot's ask_user could not do multi-select. That assumption is FALSE on Copilot CLI
#    1.0.7x: the builtin `ask_user` tool takes a `requestedSchema` (JSON Schema) whose
#    `properties` is a MAP of fields — so it supports BOTH multiple questions per call AND
#    multi-select (array field type, rendered as "Select zero or more" checkboxes). Verified
#    live on 1.0.74 (form with 3 question-tabs + a "space toggle" multi-select field) plus the
#    captured builtin tool schema. Downgrading multi-select therefore removed a working
#    capability and produced worse UX than Claude. The source's conceptual "(multi-select)"
#    guidance is correct as-is; step 7 (AskUserQuestion -> ask_user) already handles the tool
#    name. See the "No multi-select" removal in the platform note (step 9) and the dropped
#    validate check.

# 6. Replace CLAUDE.md references with copilot equivalents in skills. The `.claude/CLAUDE.md`
#    path form is handled FIRST so it maps whole → .github/copilot-instructions.md instead of the
#    garbled .claude/.github/... collateral; the standalone CLAUDE.md form follows (WS3.3).
find "$OUT/skills" -name "*.md" | while read f; do
  sedi -e 's#\.claude/CLAUDE\.md#.github/copilot-instructions.md#g' \
       -e 's#CLAUDE\.md#.github/copilot-instructions.md#g' "$f"
done

# 7. Replace AskUserQuestion with copilot's ask_user tool. Runs BEFORE the platform-note append
#    (step 9) so the note's literal "instead of `AskUserQuestion`" survives — no "instead of
#    ask_user" tautology (WS3.4).
find "$OUT" -name "*.md" | while read f; do
  sedi 's/AskUserQuestion/ask_user/g' "$f"
done

# 7b. Rewrite Claude task/delegation tool names to their Copilot CLI equivalents (WS3.5).
#    Live-verified against Copilot CLI 1.0.74 (see compat-tests/L1-FINDINGS.md and issue #19):
#      • Delegation is the `task` tool with param `agent_type` — Copilot's schema has NO
#        `subagent_type` (0 occurrences) and the run.sh C4 contract drives `task(agent_type)`.
#      • There is NO `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet` tool. Task items and their
#        dependencies live in Copilot's SQL session store — the `sql` tool over the pre-seeded
#        `todos` (id,title,description,status[pending|in_progress|done],created_at,updated_at)
#        and `todo_deps` (todo_id,depends_on) tables. Shipped unchanged, these Claude names point
#        at phantom tools; the model only limps along by improvising the SQL itself (non-
#        deterministic — unacceptable for dependency-ordered task groups).
#    Order is specific-first: `TaskUpdate addBlockedBy` (a dependency EDGE → todo_deps) is
#    mapped before the bare `TaskUpdate` (a row status update → todos); the leftover standalone
#    `addBlockedBy` (the two-span `` `TaskUpdate` with `addBlockedBy` `` form) then maps to the
#    `todo_deps` table. All rules are fixed strings → order-independent output, determinism holds.
#    NOTE (documented residual): Claude's status value `completed` differs from Copilot's `done`;
#    that enum is NOT rewritten here (too many unrelated "completed" tokens) — the plugin CLAUDE.md
#    platform note calls it out, and the model maps it at runtime.
find "$OUT" -name "*.md" | while read f; do
  sedi \
    -e 's/TaskUpdate addBlockedBy/INSERT INTO todo_deps/g' \
    -e 's/addBlockedBy/todo_deps/g' \
    -e 's/TaskCreate/INSERT INTO todos/g' \
    -e 's/TaskUpdate/UPDATE todos/g' \
    -e 's/TaskList/SELECT * FROM todos/g' \
    -e 's/TaskGet/SELECT * FROM todos/g' \
    -e 's/subagent_type/agent_type/g' \
    -e 's/Task tool/task tool/g' \
    "$f"
done

# 8. Branding scrub (WS3.2) across output *.md. The audit-named false platform-behavior claims are
#    neutralized FIRST (so the blanket brand swap can't re-mangle them into a still-false "GitHub
#    Copilot CLI's built-in plan mode"): quick-plan's built-in-plan-mode attribution and
#    orchestrator-patterns' `auto`-permission-mode basis. Then the plain "Claude Code" platform
#    references and the Claude doc URLs. `.` matches the apostrophe in "Code's" (avoids shell
#    quoting). Untouched — no "Claude Code" substring: ${CLAUDE_PLUGIN_ROOT}, CLAUDE.md,
#    .claude-plugin, .maister/, maister-copilot. The platform-note heredoc is appended AFTER this
#    step, so its legitimate "Key differences from Claude Code" comparison is preserved.
find "$OUT" -name "*.md" | while read f; do
  sedi -e 's#Claude Code.s built-in plan mode#an ordinary plan-mode session#g' \
       -e 's#Claude Code.s `auto` permission mode#An `auto` (non-interactive) permission mode#g' \
       -e 's#Claude Code#GitHub Copilot CLI#g' \
       -e 's#code\.claude\.com#docs.github.com/copilot#g' \
       -e 's#claude\.ai/code#docs.github.com/copilot#g' \
       "$f"
done

# 8a. Standalone assistant-name scrub (WS3.2b / T5). Step 8 only maps the PRODUCT string
#     "Claude Code"; the bare assistant name "Claude" survives in prose (transcript lines
#     "Claude: [Executes …]" in docs-manager, "developers and Claude" in migration refs). Map
#     it to "Copilot" to match the variant. Runs AFTER step 8 so "Claude Code" is already gone
#     (no "Copilot Code"). perl gives portable \b; \bClaude\b is case-sensitive so it never
#     touches CLAUDE_*, .claude, claude-plugin, or claude-md (all differently-cased).
#     EXCLUDES the root CLAUDE.md: that file is an intentional, banner-labeled carry-over of the
#     Claude doc (see step 10), so its "Claude" mentions must stay.
find "$OUT" -name "*.md" ! -name "CLAUDE.md" | while read f; do
  perl -i -pe 's/\bClaude\b/Copilot/g' "$f"
done

# 8b. Reframe the standalone review workflows for the Copilot invocation surface.
#     Copilot surfaces a plugin's `commands/*.md` as SKILLS, not slash commands
#     (live-verified, 1.0.73: `copilot skill list` shows reviews-*/work as
#     source:plugin, path:.../commands, enabled). The Claude source presents them as
#     `/reviews-*` slash commands with a Usage column — correct on Claude, a
#     non-existent surface on Copilot. Rewrite ONLY the "Review & Audit Commands"
#     section (anchored on its unique heading, up to the next `### `) into skill form,
#     and drop the `/work` slash. Claude source ($CORE) is untouched — this operates on
#     $OUT only. Guard: the perl sub must match exactly once, else the build fails loudly
#     (a source reword must not silently drop this transform). The wider slash-vs-skill
#     framing of the other command tables is intentionally out of scope here (epic follow-up).
perl -0777 -i -pe '
  $c = s{### Review & Audit Commands\n.*?\n(\n### )}{### Review & Audit Skills

On Copilot CLI these are **skills** (auto-registered from the plugin `commands/` files, not slash commands). Invoke by naming the skill, e.g. "use the `reviews-code` skill".

| Skill | Arguments | Purpose |
|-------|-----------|---------|
| `reviews-code` | `[path] [--scope=SCOPE]` | Automated code quality, security, performance analysis |
| `reviews-pragmatic` | `[path]` | Detect over-engineering, ensure code matches project scale |
| `reviews-spec-audit` | `[spec-path]` | Independent spec audit for completeness and clarity |
| `reviews-reality-check` | `[task-path]` | Validate work actually solves the problem |
| `reviews-production-readiness` | `[path] [--target=ENV]` | Pre-deployment verification with GO/NO-GO recommendation |
$1}s;
  END { exit($c == 1 ? 0 : 1) }
' "$OUT/CLAUDE.md" || { echo "FAIL: step 8b: 'Review & Audit Commands' section not found exactly once in \$OUT/CLAUDE.md (source drift?)" >&2; exit 1; }

# 8c. Drop the `/work` slash reference (Copilot: `work` is a skill, not a slash command).
sedi 's#`/work`#`work`#g' "$OUT/CLAUDE.md"

# 8d. Remove the "GitHub Copilot CLI Documentation" section (the blind URL-swap produced 404
#     links — docs.github.com/copilot/docs/en/... — and the "built-in tools" gist it cites is a
#     CLAUDE CODE tools reference, wrong for this variant; Copilot fetches its own docs via the
#     built-in fetch_copilot_cli_documentation tool). Runs AFTER step 8 (heading already
#     "GitHub Copilot CLI Documentation", URLs already swapped) and BEFORE step 9's append, so
#     the section is the file tail and deletes cleanly to EOF. This also removes all
#     code.claude.com residue from CLAUDE.md, so `make validate` (WS5.5) stays green without a
#     carve-out. Guard: must match exactly once (fail loudly on source drift).
perl -0777 -i -pe '
  $c = s/\n+## GitHub Copilot CLI Documentation\b.*\z/\n/s;
  END { exit($c == 1 ? 0 : 1) }
' "$OUT/CLAUDE.md" || { echo "FAIL: step 8d: 'GitHub Copilot CLI Documentation' section not found exactly once in \$OUT/CLAUDE.md (source drift?)" >&2; exit 1; }

# 9. Add platform note to plugin's CLAUDE.md — appended LAST, after the ask_user (step 7) and
#    branding (step 8) global passes, so its literal `AskUserQuestion` and its "Key differences
#    from Claude Code" comparison are authored final and not clobbered.
cat >> "$OUT/CLAUDE.md" << 'EOF'

## Platform: Copilot CLI

This is the Copilot CLI variant. Key differences from Claude Code:
- **Structured `ask_user` forms**: `ask_user` takes a `requestedSchema` (JSON Schema) whose `properties` map allows **several fields (questions) in one call** and **multi-select** array fields (rendered as "select zero or more"). Group related decisions into one form; use a multi-select field for genuinely non-exclusive choices — do NOT downgrade to sequential single-select.
- **Command names**: No plugin prefix in names (e.g., `development`); the plugin system adds the plugin-id prefix automatically
- **Commands as skills**: plugin `commands/*.md` files are surfaced as **skills** (auto-registered from the `commands/` directory), not slash commands, on Copilot CLI. Invoke a workflow by naming its skill (e.g. the `work` skill, or a `reviews-*` skill) rather than as a slash command.
- **Project instructions file**: Use `.github/copilot-instructions.md` instead of `CLAUDE.md`. If the project uses `AGENTS.md`, support that as well.
- **User questions**: Use `ask_user` tool instead of `AskUserQuestion`
- **Delegation to agents**: Use the `task` tool with `agent_type: "maister-copilot:<agent>"` (Copilot's delegation tool; there is no `Task`/`subagent_type` call). Copilot infers and runs the named custom agent.
- **Task/todo tracking**: There is no `TaskCreate`/`TaskUpdate`/`TaskList` tool on Copilot CLI. Task items and their dependencies live in the SQL session store — use the `sql` tool over the pre-seeded tables `todos` (`id`, `title`, `description`, `status`, `created_at`, `updated_at`) and `todo_deps` (`todo_id`, `depends_on`). Create with `INSERT INTO todos (...)`, update state with `UPDATE todos SET status = 'in_progress'|'done' WHERE id = '...'` (note: the status value is `done`, not `completed`), record a dependency with `INSERT INTO todo_deps (todo_id, depends_on) VALUES (...)`, and list/check with `SELECT * FROM todos`.
- **Destructive-command guard**: Copilot hook payloads carry no agent identifier, so (unlike Claude) the guard can't scope to subagents. The Copilot variant instead asks you to confirm any destructive shell command (`git reset --hard`, `rm -rf`, …) via `permissionDecision: ask`; under `--allow-all-tools` the command is held until confirmed (fail-closed in headless runs). This is **by design**: run destructive-heavy workflows **interactively** so you can confirm. Fully headless autonomous orchestration is not a supported mode anyway — orchestrators gate on `ask_user`, which Copilot does not expose in headless `-p`. In headless a matched destructive command is denied-and-continued (not a deadlock), so a legitimate `rm -rf`/`git clean` simply won't run; a human at the prompt approves it.
- **No post-compaction hook**: Copilot's `SessionStart` has no `matcher` and no `compact` source (sources: startup/resume/new); a compaction fires `preCompact` (before), never `SessionStart`, and there is no `postCompact`. So the Claude `SessionStart:compact` reminder is de-registered here (Copilot would otherwise fire it on *every* start), and its "re-read `orchestrator-state.yml`" nudge is folded into the always-on `SessionStart` reminder — the closest available substitute.
EOF

# 10. Prepend a human-facing banner to the TOP of CLAUDE.md — authored LAST so no sed pass
#     touches it. Copilot does NOT load a plugin's root CLAUDE.md into model context (verified
#     1.0.73 + GitHub Docs), so this file is a maintainer-facing carry-over of the Claude doc.
#     The banner says so and points at the real Copilot runtime sources (SessionStart hook +
#     each SKILL.md). Uses a temp file to prepend (portable, no in-place head insert).
cat > "$OUT/CLAUDE.md.banner" << 'EOF'
> ⚠️ **Not loaded by Copilot CLI — maintainer reference only.**
> GitHub Copilot CLI does **not** read a plugin's root `CLAUDE.md` into model context. A
> plugin's runtime components are agents, skills, commands, hooks, and MCP/LSP servers — not a
> root instructions file (verified on CLI 1.0.73 and the official GitHub Copilot plugin docs).
> This file is a human-facing carry-over of the Claude plugin's documentation, kept for people
> reading the installed plugin. **Source of truth for Copilot runtime behavior:** the
> `SessionStart` hook (`hooks/skill-invocation-reminder.sh`) and each skill's `SKILL.md`.
> Some slash-command, tooling, and platform references below describe the Claude variant.

EOF
cat "$OUT/CLAUDE.md" >> "$OUT/CLAUDE.md.banner"
mv "$OUT/CLAUDE.md.banner" "$OUT/CLAUDE.md"

echo "Built Copilot CLI variant at $OUT"
