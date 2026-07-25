# AGENTS.md — agent working agreement (robmar-net/maister)

Instructions for AI agents (Claude Code, GitHub Copilot CLI, etc.) working in this repository.
See also `CLAUDE.md` (Claude-specific project docs).

## Contribution scope — BINDING

- **Never contribute anything to the UPSTREAM repository (`SkillPanel/maister`, the `origin` remote)
  without explicit, case-by-case discussion and confirmation from the maintainer.** This includes:
  pushing to upstream, opening or updating an upstream pull request, or merging into upstream.
  Do **not** infer the go-ahead from context — ask, and confirm it is not a misunderstanding, before
  any upstream action.
- **For now, development happens ONLY on the `robmar-net` fork** (`fork` remote). Treat
  `robmar-net/maister` as the working repository. Upstream is out of scope unless explicitly directed.
- Default every git contribution action (branch push, PR, merge) to `robmar-net/maister`. If a task
  seems to imply upstream (`SkillPanel/maister`), STOP and ask first.

### Remotes
- `origin` → `SkillPanel/maister` (upstream — hands off unless explicitly told).
- `fork` → `robmar-net/maister` (the working fork — default target).

### Note on existing upstream work
- Upstream PR #10 (generator remediation) is already open by prior explicit agreement. Do **not** add
  to it, or open new upstream PRs, without a fresh explicit go-ahead.
