.PHONY: build validate check-deterministic test-copilot test-hooks clean watch

build:
	bash platforms/copilot-cli/build.sh

validate:
	@echo "Checking no colons in command names..."
	@! grep -r '^name:.*:' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: colons in command names" && exit 1)
	@echo "Checking commands are flat (no subdirectories)..."
	@test $$(find plugins/maister-copilot/commands -mindepth 2 -name "*.md" 2>/dev/null | wc -l) -eq 0 || (echo "FAIL: nested command directories found" && exit 1)
	@echo "Checking no CLAUDE.md references in skills..."
	@! grep -ri 'CLAUDE\.md' plugins/maister-copilot/skills/ 2>/dev/null || (echo "FAIL: CLAUDE.md references found in skills" && exit 1)
	@echo "Checking no maister- prefix in copilot command names..."
	@! grep -r '^name: maister-' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: maister- prefix in command names" && exit 1)
	@echo "Checking no maister: prefixes in copilot variant..."
	@! grep -r 'maister:' plugins/maister-copilot/ --include="*.md" 2>/dev/null || (echo "FAIL: maister: prefix found" && exit 1)
	@echo "Checking no wrong maister-<word> tokens (WS5.1)..."
	@! grep -rhoE 'maister-[a-z][a-z-]+' plugins/maister-copilot --include='*.md' | grep -vxE 'maister-copilot|maister-plugins' || (echo "FAIL: forbidden maister-<word> token(s) found above (only maister-copilot is allowed)" && exit 1)
	@echo "Checking agent references are namespaced as maister-copilot:<name> (WS5.2)..."
	@AGENTS=$$(ls plugins/maister/agents/*.md | xargs -n1 basename | sed 's/\.md$$//' | paste -sd'|' -); \
	! grep -rnE 'agent_type: ["`]('"$$AGENTS"')["`]' plugins/maister-copilot --include='*.md' || (echo "FAIL: bare (non-namespaced) agent ref found above; agents must be maister-copilot:<name>" && exit 1)
	@! grep -rnE 'maister-copilot:(development|migration|quick-plan)([^a-z-]|$$)' plugins/maister-copilot --include='*.md' || (echo "FAIL: skill referenced as maister-copilot:<skill> above; skills/commands must be bare" && exit 1)
	@echo "Checking argument-hint is a string, not a YAML array (WS5.3)..."
	@! grep -rnE '^argument-hint:[[:space:]]*\[' plugins/maister-copilot --include='*.md' || (echo "FAIL: argument-hint must be a quoted string, not an unquoted YAML array" && exit 1)
	@echo "Checking hooks/ is present in the output (WS5.4)..."
	@test -d plugins/maister-copilot/hooks && test -f plugins/maister-copilot/hooks/hooks.json || (echo "FAIL: plugins/maister-copilot/hooks/ or hooks/hooks.json is missing" && exit 1)
	@echo "Checking branding residue and plugin description (WS5.5)..."
	@! grep -rnE 'code\.claude\.com|claude\.ai/code|## Claude Code Documentation' plugins/maister-copilot --include='*.md' || (echo "FAIL: Claude Code residue (doc URLs or docs-section heading) found above" && exit 1)
	@grep -q 'GitHub Copilot CLI' plugins/maister-copilot/.claude-plugin/plugin.json || (echo "FAIL: plugin.json description must mention 'GitHub Copilot CLI'" && exit 1)
	@echo "Checking no standalone 'Claude' assistant-name leak outside CLAUDE.md (WS5.11)..."
	@! grep -rnE '\bClaude\b' plugins/maister-copilot --include='*.md' | grep -v '/CLAUDE.md:' || (echo "FAIL: standalone 'Claude' found above (should be 'Copilot'); the root CLAUDE.md is exempt (intentional carry-over). Regenerate with make build" && exit 1)
	@echo "Checking no AskUserQuestion residual (must be ask_user) (WS5.9)..."
	@! grep -rl 'AskUserQuestion' plugins/maister-copilot/skills plugins/maister-copilot/commands plugins/maister-copilot/agents --include='*.md' 2>/dev/null || (echo "FAIL: AskUserQuestion residual found above (should be rewritten to ask_user); regenerate with make build" && exit 1)
	@echo "Checking no Claude task/delegation tool-name residual (TaskCreate/TaskUpdate/TaskList/TaskGet/subagent_type) (WS5.11)..."
	@! grep -rnE 'TaskCreate|TaskUpdate|TaskList|TaskGet|subagent_type' plugins/maister-copilot/skills plugins/maister-copilot/commands plugins/maister-copilot/agents --include='*.md' 2>/dev/null || (echo "FAIL: Claude task/delegation tool-name residual found above (should be task(agent_type) / sql todos+todo_deps); regenerate with make build" && exit 1)
	@echo "Checking the destructive-command guard is the Copilot 'ask' override (WS5.10)..."
	@grep -q 'permissionDecision": "ask"' plugins/maister-copilot/hooks/block-destructive-commands.sh || (echo "FAIL: output destructive-command guard is not the Copilot 'ask' override (build.sh WS2b overlay missing?)" && exit 1)
	@echo "All checks passed"

# WS5.7: determinism guard, kept OUT of `validate` (double-build) so validate stays fast.
# Two consecutive builds must produce a byte-identical tree, so the plugin.json
# targeted-string-edit + all rewrites preserve byte-identity and CI auto-commit stays a no-op.
check-deterministic:
	@echo "Determinism check: building twice and comparing byte-identity (WS5.7)..."
	@$(MAKE) build >/dev/null 2>&1; \
	H1=$$(find plugins/maister-copilot -type f | sort | xargs shasum | shasum); \
	$(MAKE) build >/dev/null 2>&1; \
	H2=$$(find plugins/maister-copilot -type f | sort | xargs shasum | shasum); \
	if [ "$$H1" = "$$H2" ]; then echo "PASS: rebuild is byte-identical"; else echo "FAIL: non-deterministic rebuild (tree hashes differ)"; exit 1; fi

# WS7: committed Copilot CLI compatibility harness — the acceptance + regression
# mechanism. Rebuilds the plugin, then loads it into a real Copilot CLI and asserts the
# 7 runtime contracts (plugin/skills/agents/task/skill/hooks/mcp), emitting a timestamped
# report under platforms/copilot-cli/compat-tests/reports/. Green on a correct build, red
# on any runtime-contract regression. See platforms/copilot-cli/compat-tests/README.md.
# The full run needs an authenticated Copilot seat (a few AI credits); for CI without a
# seat, run the harness directly with --no-live for the auth-free subset.
test-copilot:
	$(MAKE) build
	bash platforms/copilot-cli/compat-tests/run.sh

# L1 — hook-EFFECT checks. Where test-copilot (L0) proves the three maister hooks *fire*, this
# verifies each hook's EFFECT on Copilot CLI and honestly reports where that effect is a no-op.
# Rebuilds the plugin, then runs deterministic hook-script contracts (no credits) plus one live
# Copilot session (task subagent + probe hooks; a few AI credits). A LIMITATION verdict is the
# CORRECT detection of a platform divergence, not a failure — the run only goes red on an
# UNEXPECTED regression (a hook script's logic breaking). For CI without a seat, run the script
# directly with --no-live for the deterministic subset. See compat-tests/L1-FINDINGS.md.
test-hooks:
	$(MAKE) build
	bash platforms/copilot-cli/compat-tests/l1-hook-effects.sh

clean:
	rm -rf plugins/maister-copilot/

watch:
	fswatch -o plugins/maister/ | xargs -n1 -I{} make build
