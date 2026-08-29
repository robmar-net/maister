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

/**
 * gateMap (Stage 3) — EMPTY. quick-bugfix is a Step-numbered lightweight workflow with an
 * EnterPlanMode/ExitPlanMode plan gate (plugins/maister/skills/quick-bugfix/SKILL.md, read-only),
 * NOT phase-numbered exit gates — so no `gate_fired_at(phase-N)` is invented. It keeps its required
 * un-phased `gate_fired(ask)` (always emitted by the extractor regardless of gateMap).
 */
const gateMap = [];

/**
 * answerMap (Stage 3) — deterministic gate choices for `chooseAnswer`. The plan-mode "is the bug
 * description accurate?" confirmation takes the first option; unmatched -> `choices[0] ?? 'yes'`
 * responder-fallback.
 */
const answerMap = [
  { re: /is the bug description accurate/i, choice: null }, // null -> choices[0]
];

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
  // Functional oracle (Stage 2). Command-type outcome: restage the trusted `run-tests.sh`
  // from the committed sample-cli-bug template over the rundir copy (MEDIUM-5), then run
  // `sh run-tests.sh` in the rundir root. Pass iff exit 0 — which requires the seeded
  // `cmd_upper` `tr` defect to have been fixed (`upper sample` -> `SAMPLE`).
  outcome: [{ id: 'bug-fixed', command: 'sh run-tests.sh', restage: ['run-tests.sh'] }],
  // Stage 3: no phase-numbered gates (gateMap empty) + deterministic gate answers (chooseAnswer).
  gateMap,
  answerMap,
  // Stage 4 (order spine): EMPTY. quick-bugfix has "no subagents" (plugins/maister/skills/quick-bugfix/
  // SKILL.md:9), so its skeleton carries no delegated(...) tokens — no order chain and no minimum counts
  // to enforce.
  precedesChain: [],
  minCounts: [],
  fallbackPrompt,
};

export { fallbackPrompt };
export default scenario;
