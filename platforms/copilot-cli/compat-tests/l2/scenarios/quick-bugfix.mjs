/**
 * L2 scenario — quick-bugfix-shaped workflow.
 *
 * The THIRD L2 scenario (after `development` and `research`). It exercises a deliberately DIFFERENT
 * mechanism: the LIGHTWEIGHT quick path. Per plugins/maister/skills/quick-bugfix/SKILL.md, quick-bugfix
 * is "TDD-driven bug fix workflow with planning mode. … No orchestrator state, no task directory, no
 * subagents." So — unlike development/research — its normalized skeleton is EVENTS-ONLY: there is no
 * `orchestrator-state.yml` (⇒ no `phase_completed`/`task_status`), no `.maister/tasks/` tree
 * (⇒ no `created_artifact`), and no subagents (⇒ no `delegated`). What remains is the skill invocation,
 * the plan-mode gate (it "presents a fix plan for approval"), and the terminal — a thin trace that
 * exercises the plan gate + skill routing rather than the orchestrator machinery.
 *
 * Exports the data the L2 harness needs to drive ONE quick-bugfix Copilot run in an isolated sandbox
 * and check its normalized predicate skeleton against the committed reference:
 *
 *   { id, sandboxTemplate, prompt, expectedShape:'quick-bugfix', taskType:'quick-bugfix', timeoutMs, fallbackPrompt }
 *
 * `taskType:'quick-bugfix'` selects the extractor's quick-bugfix TREE_PROFILE — which models NO artifacts
 * and NO task-dir — so the pipeline correctly yields an events-only skeleton (and the sanity floor does
 * not trip: zero phases with zero tree artifacts is consistent, not a parse failure).
 *
 * ── Sandbox ────────────────────────────────────────────────────────────────
 * Uses `l2/sandbox/sample-cli-bug/` — a copy of the sample-cli with ONE seeded, reproducible defect:
 * `cmd_upper` lower-cases instead of upper-casing (`upper hello` prints `hello`, must print `HELLO`);
 * the committed `run-tests.sh` already has the failing `upper` check. quick-bugfix reproduces (the test
 * fails), fixes (swap the `tr` arguments), and verifies (the test passes). The rundir is a throwaway
 * copy, so the fix never touches the committed sandbox.
 *
 * ── Routing ─────────────────────────────────────────────────────────────────
 * The prompt names the maister quick-bugfix workflow so the model invokes `skill("quick-bugfix")` (the
 * root skill is user-invocable). It states the bug as expected-vs-actual and asks for the TDD loop
 * (reproduce with a failing test → fix → verify), avoiding "add"/"feature"/"research" phrasing that
 * would route elsewhere. `fallbackPrompt` names the `quick-bugfix` skill directly for a hand re-drive
 * if the first live trace mis-routes (a runbook step; run.mjs does not auto-retry).
 *
 * Zero-dependency ESM: pure data (no imports).
 */

const prompt =
  'Use the maister quick-bugfix workflow to fix a bug in this project. The bug: in `cli.sh`, the ' +
  '`upper` command is supposed to print its argument in UPPER case, but it prints it in lower case ' +
  'instead — `sh cli.sh upper hello` prints `hello` when it should print `HELLO`. Run the full ' +
  'quick-bugfix loop end to end: analyze the bug and present a fix plan for approval, reproduce it ' +
  'with a failing test, apply the minimal fix, and verify the test passes. This is a small, scoped ' +
  'bug fix — do not escalate to the full development workflow.';

const fallbackPrompt =
  'Use the maister `quick-bugfix` skill to fix the bug where `cli.sh`\'s `upper` command lower-cases ' +
  'its argument instead of upper-casing it (`upper hello` prints `hello`, must print `HELLO`). Follow ' +
  'the quick-bugfix TDD loop: present a fix plan, reproduce with a failing test, fix, and verify. Do ' +
  'NOT use the development workflow — this is a quick bug fix only.';

export const scenario = {
  id: 'quick-bugfix',
  // A copy of sample-cli with one seeded, test-reproducible defect (cmd_upper lower-cases).
  sandboxTemplate: 'sample-cli-bug',
  prompt,
  expectedShape: 'quick-bugfix',
  // Selects the extractor's quick-bugfix TREE_PROFILE (no artifacts, no task-dir) and the
  // findStateYaml `.maister/tasks/quick-bugfix/` subtree (which quick-bugfix never creates).
  taskType: 'quick-bugfix',
  // Short by design: quick-bugfix is a lightweight single-file TDD loop (no implement/verify chain,
  // no subagent fan-out). sendAndWait THROWS on timeout (does not abort in-flight work), so this is
  // generous for the shape while far under development's budget. The seat-gated live run is supervised.
  timeoutMs: 15 * 60 * 1000, // 15 minutes
  fallbackPrompt,
};

export { fallbackPrompt };
export default scenario;
