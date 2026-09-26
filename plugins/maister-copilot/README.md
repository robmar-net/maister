# Maister for GitHub Copilot CLI

Structured, standards-aware SDLC workflows as Copilot CLI skills, agents and commands.
This directory is the GitHub Copilot CLI variant; everything in it is generated from the
source plugin, so the two stay one codebase with two vocabularies.

> This file is **shipped inside the variant** — `build.sh` copies it to
> `plugins/maister-copilot/README.md`, so it is user-facing and obeys the variant's own
> branding contract (`make validate`, WS5.11). Maintainer notes — what the generator does,
> the agent `model:` mapping, why the generated tree is never hand-edited — live in
> [`MAINTAINERS.md`](./MAINTAINERS.md).

## Install

From a registered marketplace:

```bash
copilot plugin marketplace add SkillPanel/maister
copilot plugin install maister-copilot@maister-plugins
```

Straight from the repository, without a marketplace, using the CLI's
`<owner>/<repo>:<subdirectory>` form -- the repository is `SkillPanel/maister` and the
subdirectory is `plugins/maister-copilot`:

```bash
copilot plugin install <owner>/<repo>:<subdirectory>
```

Or run a local checkout with `copilot --plugin-dir /path/to/maister/plugins/maister-copilot`.
Add `--add-dir` for the same path when the checkout sits outside your working directory --
that grants file access to it. `--add-dir` on its own does not load a plugin.

## Export the plugin root

Copilot CLI exports no plugin-directory variable of its own. The mockup studio tells an agent
to start its preview server from the plugin's own directory, spelled `${MAISTER_PLUGIN_ROOT}`.
With the variable unset the instruction does not resolve, and the agent has to guess the path.

Point it at the directory holding `.claude-plugin/plugin.json`. Which directory that is
depends on how you installed:

```bash
# from a marketplace
export MAISTER_PLUGIN_ROOT=~/.copilot/installed-plugins/<marketplace>/maister-copilot

# straight from a repository
export MAISTER_PLUGIN_ROOT=~/.copilot/installed-plugins/_direct/<source>

# a local checkout -- the path you passed to --plugin-dir
export MAISTER_PLUGIN_ROOT=/path/to/maister/plugins/maister-copilot
```

`copilot plugin list` names what is installed. Put the export in your shell profile: it is read
at spawn time and there is no flag for it.

## Requirements

- GitHub Copilot CLI
- Node.js 20 or newer, for HTML mockups (without it, mockups fall back to ASCII)

## Runtime notes (verified on Copilot CLI 1.0.73)

- **Commands are surfaced as skills.** Copilot registers a plugin's `commands/*.md` as
  **skills** (`copilot skill list` shows them, `enabled`). Slash commands are namespaced by
  plugin id, so the bare form of a workflow name is not offered -- use the
  `maister-copilot`-prefixed slash form, or just ask in plain language and the matching
  workflow skill triggers.
- **A plugin's root `CLAUDE.md` is NOT loaded** into model context. Plugin components are
  agents, skills, commands, hooks, and MCP/LSP servers -- not a root instructions file. The
  only plugin-to-model free-text channel is the **`SessionStart` hook** (`additionalContext`).
- **Custom instructions** are discovered from the workspace/user locations only
  (`.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md` at the repo/cwd,
  `$HOME/.copilot/...`), never from inside a plugin directory.
- **Destructive commands need a human.** The guard confirms every destructive shell command via
  `permissionDecision: ask` (Copilot's PreToolUse payload carries no agent identifier, so there
  is no per-agent scoping). Run destructive-heavy workflows **interactively**. In headless
  `--allow-all-tools` a matched command is held fail-closed (denied-and-continued, not a
  deadlock), and orchestrators cannot run headless anyway (`ask_user` gates are unavailable
  in `-p`).

## Documentation

Copilot CLI has a built-in `fetch_copilot_cli_documentation` tool the model uses to consult
its own docs -- the plugin does not need to embed documentation URLs. For humans:

- GitHub Copilot CLI docs: <https://docs.github.com/en/copilot/how-tos/copilot-cli>
- CLI plugin reference: <https://docs.github.com/en/copilot/reference/cli-plugin-reference>
- Adding custom instructions: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions>

The workflow reference and the command reference ship with the source repository at
`SkillPanel/maister`.
