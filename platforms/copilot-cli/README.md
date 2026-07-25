# maister-copilot — Copilot CLI variant

`plugins/maister-copilot/` is **generated** from the Claude source (`plugins/maister/`) by
[`build.sh`](./build.sh). Never edit the generated tree or the Claude source to fix a
Copilot-only issue — fix it in `build.sh` (or the `hooks-overrides/`) so the Claude variant
stays byte-for-byte intact and a rebuild reproduces the fix.

## Build & checks

```bash
make build               # regenerate plugins/maister-copilot/ from plugins/maister/
make validate            # static contracts (naming, branding, ask_user, hooks, guard)
make check-deterministic # two builds must be byte-identical (CI auto-commit stays a no-op)
make test-copilot        # L0: load into a real Copilot CLI, assert 7 runtime contracts
make test-hooks          # L1: hook-effect checks
```

## Runtime notes (verified on Copilot CLI 1.0.73)

- **Commands are surfaced as skills.** Copilot registers a plugin's `commands/*.md` as
  **skills** (`copilot skill list` shows them, `enabled`), not slash commands. There is no
  `/reviews-code` or `/work` slash command — invoke them by skill name.
- **A plugin's root `CLAUDE.md` is NOT loaded** into model context. Plugin components are
  agents, skills, commands, hooks, and MCP/LSP servers — not a root instructions file. The
  only plugin→model free-text channel is the **`SessionStart` hook** (`additionalContext`).
  The generated `plugins/maister-copilot/CLAUDE.md` is therefore a maintainer-facing
  carry-over of the Claude doc (see the banner at its top), not a runtime input.
- **Custom instructions** are discovered from the workspace/user locations only
  (`.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md` at the repo/cwd, `$HOME/.copilot/...`),
  never from inside a plugin directory.
- **Destructive commands need a human.** The guard confirms every destructive shell command via
  `permissionDecision: ask` (no agent scoping on Copilot). Run destructive-heavy workflows
  **interactively**. In headless `--allow-all-tools` a matched command is held fail-closed
  (denied-and-continued, not a deadlock), and orchestrators can't run headless anyway
  (`ask_user` gates are unavailable in `-p`).

## Documentation

Copilot CLI has a built-in `fetch_copilot_cli_documentation` tool the model uses to consult
its own docs — the plugin does not need to embed documentation URLs. For humans:

- GitHub Copilot CLI docs: <https://docs.github.com/en/copilot/how-tos/copilot-cli>
- CLI plugin reference: <https://docs.github.com/en/copilot/reference/cli-plugin-reference>
- Adding custom instructions: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions>

## What `build.sh` does

Copies `plugins/maister/` → `plugins/maister-copilot/`, overlays the Copilot-specific hooks
(`hooks-overrides/`), then applies deterministic, guarded transforms: strip plugin-id
prefixes, kind-aware reference rewrites, `CLAUDE.md`→`.github/copilot-instructions.md` in
skills, `AskUserQuestion`→`ask_user`, a branding scrub, the review-workflows-as-skills
rewrite, removal of the (Claude-oriented) documentation-URLs section, the appended
`## Platform: Copilot CLI` note, and the top-of-file "not loaded" banner on `CLAUDE.md`.
See the numbered step comments in `build.sh`.
