# AGENTS.md — agent working agreement (robmar-net/maister)

Instructions for AI agents (Claude Code, GitHub Copilot CLI, etc.) working in this repository.
See also `CLAUDE.md` (Claude-specific project docs).

## Direction — BINDING, not negotiable

**We are a DOWNSTREAM fork. The direction of contribution is one-way: upstream → us. It is
NEVER us → upstream.**

- **Never push anything to `SkillPanel/maister` (upstream). Full stop.** No pushes, no new pull
  requests, no updates to existing upstream PRs, no merges into upstream — under any circumstances.
  This is not a case-by-case "ask first" rule; the answer is already **no**. Do not propose it, do not
  set it up "in case", do not infer an exception from any instruction. If a task appears to require an
  upstream contribution, that is a misread — STOP and re-scope to the fork.
- **All work happens on our fork, `robmar-net/maister`.** It is the working repository and the only
  valid write target for branches, pushes, PRs, and merges.

## Our job (this is the goal)

We maintain the **GitHub Copilot CLI adaptation** of maister as a downstream of `SkillPanel/maister`:

1. **React to upstream.** When `SkillPanel/maister` changes, fetch and **merge** those changes into
   our fork.
2. **Regenerate & adapt.** The Claude source (`plugins/maister/**`) stays **zero-touch**; our
   adaptation lives in `platforms/copilot-cli/build.sh` (transforms) and the generated
   `plugins/maister-copilot/**`. After a merge, rebuild (`make build`) and **intervene only where the
   Copilot version-adaptation needs it** — fix transforms, resolve generated-file drift by
   regenerating (never hand-merge generated files), keep `make validate` + `make check-deterministic`
   green.
3. **Keep the fork current and correct** so it can be installed/updated as the Copilot variant.

That reaction-and-adaptation loop — merge upstream, regenerate, fix our Copilot layer — **is the
entire purpose of this fork.** Improving upstream is not our concern.

## Remotes — identify by repo SLUG, not by remote name

Remote *names* differ between clones (`origin`/`upstream`/`fork` are used inconsistently across
checkouts), so **never trust the remote name — key every decision on the repository slug**:

- `SkillPanel/maister` → **upstream. Read-only. Never a push/PR target.** (Fetch & merge only.)
- `robmar-net/maister` → **our fork. The only write target.**

Before any push/PR/merge, resolve the target's slug (e.g. `git remote -v`) and confirm it is
`robmar-net/maister`. If it resolves to `SkillPanel/maister`, do not proceed.

## Note on existing upstream work

- Upstream PR #10 (generator remediation) exists from earlier. Per the rule above, do **not** add to
  it or open new upstream PRs — it is legacy; leave it untouched.
