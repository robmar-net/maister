/**
 * L2 scenario — `work` FRONT-DOOR routing (#85, #76 WP-E).
 *
 * The FIFTH L2 scenario. Where every other scenario names its workflow directly, this one exercises the
 * documented ENTRY POINT: `work` (plugins/maister/commands/work.md) auto-classifies the task via the
 * task-classifier subagent and ROUTES it to the appropriate workflow. This is the first thing a Copilot
 * user does after install, and it had never been driven (L2 scenarios bypass it by design) — currently
 * ⚪ end to end in the Parity-Map.
 *
 * What it verifies (the ROUTING, not a specific workflow): the entry skill is invoked, the classifier is
 * delegated to, and the routed workflow actually fixes the seeded bug. Per work.md the routed target is
 * TASK-DEPENDENT, so the reference models only the route-INVARIANT predicates as required —
 * `invoked_skill(work)`, `delegated(task-classifier)`, `outcome(bug-fixed)=pass`,
 * `reached_terminal(completion)` — and leaves the routed workflow's own markers (e.g.
 * `invoked_skill(quick-bugfix)`, any orchestrator tree) OPTIONAL / allowlisted, calibrated from the live
 * N=1 run (the quick-bugfix-genesis pattern, CALIBRATION note 4).
 *
 * Exports: { id, sandboxTemplate, prompt, expectedShape:'work', taskType:'work', timeoutMs, fallbackPrompt, outcome, gateMap }
 *
 * ── Sandbox ────────────────────────────────────────────────────────────────
 * Reuses `l2/sandbox/sample-cli-bug/` (the quick-bugfix sandbox): the sample-cli with ONE seeded defect —
 * `cmd_upper` lower-cases instead of upper-casing (`upper hello` prints `hello`, must print `HELLO`) — and
 * a committed `run-tests.sh` whose `upper` check fails until the bug is fixed. A small, scoped bug, so the
 * classifier should route to the QUICK path; the rundir is a throwaway copy so the fix never touches the
 * committed sandbox.
 *
 * ── Routing ─────────────────────────────────────────────────────────────────
 * The prompt names the maister `work` ENTRY POINT (not a workflow) so the model invokes `skill("work")`,
 * which classifies + routes. It states the bug as expected-vs-actual so the classifier routes to a
 * bug-fix path. `fallbackPrompt` re-states it via `work` for a hand re-drive if the first trace
 * mis-routes (a runbook step; run.mjs does not auto-retry).
 *
 * Zero-dependency ESM: pure data (no imports).
 */

const prompt =
  'Use the maister `work` entry point for this task (let it classify and route to the right workflow — ' +
  'do NOT pick a workflow yourself): in `cli.sh` the `upper` command is supposed to print its argument ' +
  'in UPPER case, but it prints it in lower case instead — `sh cli.sh upper hello` prints `hello` when ' +
  'it should print `HELLO`. Take it through `work` end to end and fix it.';

const fallbackPrompt =
  'Use the maister `work` skill (the unified entry point that auto-classifies and routes) on this bug: ' +
  '`cli.sh`\'s `upper` command lower-cases its argument instead of upper-casing it (`upper hello` prints ' +
  '`hello`, must print `HELLO`). Let `work` classify and route, then fix and verify.';

/**
 * gateMap (Stage 3) — EMPTY. `work` itself is a routing entry point; whatever phase-numbered exit gates
 * fire belong to the ROUTED workflow and are task-dependent, so none are pinned here as
 * `gate_fired_at(phase-N)`. The extractor still emits any un-phased `gate_fired(ask)` it observes.
 */
const gateMap = [];

export default {
  id: 'work',
  sandboxTemplate: 'sample-cli-bug',
  prompt,
  fallbackPrompt,
  expectedShape: 'work',
  taskType: 'work',
  timeoutMs: 900000,
  // Functional oracle (Stage 2, reused from quick-bugfix): restage the trusted `run-tests.sh` into the
  // post-run rundir and run `sh run-tests.sh`. Pass iff exit 0 — which requires the seeded `upper` bug to
  // actually be fixed by whatever workflow `work` routed to. The deliverable-correct check, not self-report.
  outcome: [{ id: 'bug-fixed', command: 'sh run-tests.sh', restage: ['run-tests.sh'] }],
  gateMap,
};
