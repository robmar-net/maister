/**
 * L2 scenario — research-shaped workflow.
 *
 * The SECOND L2 scenario (after `development`), added once the MVP conformance loop was proven live
 * (development AS-EXPECTED, Copilot 1.0.74). Where `development` exercises the
 * analyse -> spec -> plan -> implement -> verify orchestrator, this exercises a DIFFERENT one: the
 * research foundation (plan -> parallel gather -> synthesize) plus the optional brainstorming/design
 * phases — a parallel gatherer fan-out + a synthesizer, with NO implementation phase.
 *
 * Exports the data the L2 harness needs to drive ONE research-shaped Copilot run in an isolated
 * sandbox and check its normalized predicate skeleton against the committed reference:
 *
 *   { id, sandboxTemplate, prompt, expectedShape:'research', taskType:'research', timeoutMs, fallbackPrompt }
 *
 * `taskType:'research'` selects the extractor's research TREE_PROFILE (the `.maister/tasks/research/`
 * layout + research deliverables) and the run's `findStateYaml` subtree. Everything else in the
 * pipeline (typed-event reduction, the SHARED `orchestrator: completed_phases` + `task: status` state,
 * normalize, compare) is workflow-agnostic and unchanged — research simply omits `task_characteristics`
 * (there is no gap-analyzer), which the reference models by absence, not by a parser change.
 *
 * Zero-dependency ESM: pure data (no imports). `run.mjs` selects this scenario via `--scenario=research`
 * and drives it with a SINGLE `session.sendAndWait(scenario.prompt, scenario.timeoutMs)` (no auto-retry);
 * `run.sh` copies `l2/sandbox/<sandboxTemplate>/` into the mktemp rundir before exec.
 *
 * ── Routing mechanism (mirrors development.mjs) ────────────────────────────────
 * There is no slash-command path over the SDK, and maister-copilot exposes no `research` command
 * (its `commands/` holds only `work` + `reviews-*`). The run reaches the research orchestrator by the
 * model invoking `skill("research")` in response to the prompt — the root `research` skill is
 * `user-invocable: true` (verified in plugins/maister/skills/research/SKILL.md), so a prompt that
 * names the maister research workflow auto-triggers it.
 *
 *   Primary mechanism : NL prompt  ->  skill("research") auto-trigger.
 *   Documented alt.   : the `work` entry point classifies the task; the task-classifier routes
 *                       "research" / "investigate" / "explore options" to the same research
 *                       orchestrator. Not used by default (the classification hop could mis-route).
 *
 * `prompt` names the *research workflow* and frames a codebase INVESTIGATION (analyse + document
 * findings), avoiding "add" / "fix" / "implement" / "quick" phrasing that would route to development or
 * a quick path. `fallbackPrompt` is a stronger restatement naming the `research` *skill* directly and
 * excluding development — the OPERATOR re-drives with it by hand if the first live trace mis-routes (a
 * runbook step; run.mjs does not auto-retry). Research routing is validated live by the observed
 * skeleton containing delegated(research-planner) + delegated(information-gatherer) +
 * delegated(research-synthesizer) + created_artifact(outputs/research-report.md).
 * ───────────────────────────────────────────────────────────────────────────────
 */

/**
 * Primary prompt — designed to route deterministically to the RESEARCH orchestrator via
 * `skill("research")`. Names the workflow explicitly and frames a read-only codebase investigation.
 */
const prompt =
  'Run the maister research workflow to investigate how the sample CLI in this project parses ' +
  'command-line arguments and dispatches its subcommands. Use the full research workflow end to end ' +
  '— plan the research, gather information from the codebase and its documentation, and synthesize a ' +
  'research report with evidence-based findings and citations. This is an investigation to document ' +
  'how the existing code works, not a change to it.';

/**
 * Fallback prompt — a stronger restatement the OPERATOR re-drives with by hand (a runbook step;
 * run.mjs does not auto-retry) if the first live trace mis-routes. Names the `research` skill directly
 * and explicitly rules out development / code changes.
 */
const fallbackPrompt =
  'Use the maister `research` skill to run the full research workflow (plan, gather from the codebase ' +
  'and docs, synthesize) investigating how the sample CLI parses arguments and dispatches subcommands, ' +
  'and produce a research report with findings and citations. Do NOT modify any code and do NOT use ' +
  'the development workflow — this is research only.';

/**
 * gateMap (Stage 3) — first-match-wins over `user_input.requested` `data.question`. Research has a
 * MANDATORY-GATE exit on phases 1, 4, and 5 (verbatim phrases from
 * plugins/maister/skills/research/SKILL.md, read-only); a match emits `gate_fired_at(phase-N)` on
 * top of the always-kept `gate_fired(ask)`.
 */
const gateMap = [
  { phase: 1, re: /research foundation complete|continue to brainstorming evaluation/i },
  { phase: 4, re: /brainstorming complete|continue to high-level design/i },
  { phase: 5, re: /design complete|continue to output generation/i },
];

/**
 * answerMap (Stage 3) — deterministic gate choices for `chooseAnswer`. Every phase-exit gate
 * proceeds with `yes`; a design constraints/preferences prompt takes the first option. Unmatched ->
 * `choices[0] ?? 'yes'` responder-fallback.
 */
const answerMap = [
  { re: /continue to/i, choice: 'yes' },
  { re: /architectural constraints|preferences/i, choice: null }, // null -> choices[0]
];

export const scenario = {
  id: 'research',
  // Reuses the development sandbox: research only needs a small codebase + docs to investigate
  // (read-only), so no seeded state is required. Directory under `l2/sandbox/`; copied into the
  // mktemp rundir per run.
  sandboxTemplate: 'sample-cli',
  prompt,
  expectedShape: 'research',
  // Selects the extractor's research TREE_PROFILE + the findStateYaml `.maister/tasks/research/` subtree.
  taskType: 'research',
  // Generous by design. A research run has no implementation phase but still fans out a planner +
  // parallel gatherers + a synthesizer (and, under the deterministic gate auto-responder, the
  // brainstorming + design phases). sendAndWait THROWS on timeout (does not abort in-flight work), so
  // an under-sized value would false-INCOMPLETE a slow-but-progressing run. Smaller than development's
  // 45 min (no implement/verify chain). The seat-gated live run is operator-supervised.
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  // Functional oracle (Stage 2). Assertion-type outcome (no runnable CLI): the produced
  // research report must be a non-trivial deliverable — `outputs/research-report.md`
  // >= 200 bytes AND >= 5 non-blank lines (plus >=1 markdown heading and a present
  // `analysis/synthesis.md`, enforced by the extractor) — so an empty/one-line stub fails.
  outcome: [{ id: 'report-produced', assert: 'research-deliverables', params: { minBytes: 200, minNonBlankLines: 5 } }],
  // Stage 3: gate->phase placement (threaded into extract) + deterministic gate answers (chooseAnswer).
  gateMap,
  answerMap,
  // Pre-registered retry prompt; also exported as `fallbackPrompt`.
  fallbackPrompt,
};

export { fallbackPrompt };
export default scenario;
