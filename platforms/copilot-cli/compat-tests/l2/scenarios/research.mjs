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
  'command-line arguments and dispatches its subcommands. As part of the investigation, determine ' +
  'whether any command that is implemented in the code is unreachable from the dispatcher — if so, ' +
  'name it in the report. Use the full research workflow end to end — plan the research, gather ' +
  'information from the codebase and its documentation, and synthesize a research report with ' +
  'evidence-based findings and citations. This is an investigation to document how the existing code ' +
  'works, not a change to it.';

/**
 * Fallback prompt — a stronger restatement the OPERATOR re-drives with by hand (a runbook step;
 * run.mjs does not auto-retry) if the first live trace mis-routes. Names the `research` skill directly
 * and explicitly rules out development / code changes.
 */
const fallbackPrompt =
  'Use the maister `research` skill to run the full research workflow (plan, gather from the codebase ' +
  'and docs, synthesize) investigating how the sample CLI parses arguments and dispatches subcommands, ' +
  'including whether any implemented command is unreachable from the dispatcher (name it in the report), ' +
  'and produce a research report with findings and citations. Do NOT modify any code and do NOT use ' +
  'the development workflow — this is research only.';

/**
 * gateMap (Stage 3) — first-match-wins over `user_input.requested` `data.question`. Research has a
 * MANDATORY-GATE exit on phases 1, 4, and 5 (verbatim phrases from
 * plugins/maister/skills/research/SKILL.md, read-only); a match emits `gate_fired_at(phase-N)` on
 * top of the always-kept `gate_fired(ask)`.
 */
/**
 * phaseWitnesses (issue #71) — see the development scenario for the rationale: `phase_completed(N)`
 * is emitted from the phase's DOCUMENTED footprint in the events/tree, never from the off-schema
 * `orchestrator-state.yml` (ADR 0001/0004). Citations: plugins/maister/skills/research/SKILL.md.
 *
 * Phase 2 ("Optional Phases Decision", :204) is deliberately ABSENT: its documented Output is
 * "Updated orchestrator-state.yml" and its Execute is Direct — it has no event/tree footprint at
 * all, so under witness derivation it is unobservable. It is `optional` in the reference, so the
 * effect is a documented coverage loss, never a failing verdict (ADR 0004).
 * Phase 6 (:357, "No new files") is corroborative-only, like development's phase 14.
 */
const phaseWitnesses = [
  { phase: 1, all: ['delegated(research-planner)', 'created_artifact(outputs/research-report.md)'] }, // :124 Execute + Output
  { phase: 3, all: ['delegated(solution-brainstormer)', 'created_artifact(outputs/solution-exploration.md)'] }, // :239
  { phase: 4, all: ['gate_fired_at(phase-4)'] },                                                      // :267 Execute = Direct (interactive)
  { phase: 5, all: ['delegated(solution-designer)', 'created_artifact(outputs/high-level-design.md)'] }, // :308
  { phase: 6, all: ['reached_terminal(completion)'] },                                                // :357 corroborative
];

const gateMap = [
  { phase: 1, re: /research foundation complete|continue to brainstorming evaluation/i },
  { phase: 4, re: /brainstorming complete|continue to high-level design/i },
  { phase: 5, re: /design complete|continue to output generation/i },
];

/**
 * answerMap (Stage 3; extended #63 item 1) — deterministic gate choices for `chooseAnswer`. Every
 * phase-exit gate proceeds with `yes`. The brainstorming/design SKIP-DECISION gates ("Explore solution
 * alternatives anyway?" / "Generate a high-level design anyway?") are answered EXPLICITLY so the routing
 * is a HARNESS decision, not `choices[0]` order chosen by the model (both were `responder-fallback` in
 * reports/20260830T002503Z, and the N=3 run split 1 deep / 2 skip = 275 AIU precisely because the path
 * was model-decided). DEFAULT = SKIP (the cheap ~13 AIU foundation path, which also exercises the #59
 * skip-path where gate_fired_at(phase-4/5) must NOT be required); `COMPAT_L2_DEEP=1` answers "Yes" to
 * exercise phases 4/5 (brainstorming + design; the expensive path). A design constraints/preferences
 * prompt takes the first option. Unmatched -> `choices[0] ?? 'yes'` responder-fallback.
 */
const DEEP = process.env.COMPAT_L2_DEEP === '1';
const answerMap = [
  { re: /continue to/i, choice: 'yes' },
  { re: /explore solution alternatives|solution alternatives anyway|brainstorm[a-z]*\s+anyway/i, choice: DEEP ? 'Yes' : 'No', phase: 4 },
  { re: /generate a high-level design|high-level design anyway|\bdesign\b[^?]*anyway/i, choice: DEEP ? 'Yes' : 'No', phase: 5 },
  { re: /architectural constraints|preferences/i, choice: null }, // null -> choices[0]
];

export const scenario = {
  id: 'research',
  // Dedicated research sandbox (issue #88): a small codebase + docs to investigate (read-only), with
  // EXACTLY ONE planted discrepancy — `cmd_frobnicate` implemented + documented but absent from the
  // dispatcher `case` (unreachable). Split from the development `sample-cli` so the frobnicate plant
  // never pollutes the development drive (on the shared sandbox the dev verifier flagged it as a
  // warning and ran an extra fix/re-verify cycle — 20260831T123617Z). Directory under `l2/sandbox/`;
  // copied into the mktemp rundir per run.
  sandboxTemplate: 'sample-cli-research',
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
  // requested model = account/SDK default; operator pins per live run via COMPAT_L2_MODEL
  model: null,
  // Functional oracle (Stage 2). Assertion-type outcome (no runnable CLI): the produced
  // research report must be a non-trivial deliverable — `outputs/research-report.md`
  // >= 200 bytes AND >= 5 non-blank lines (plus >=1 markdown heading and a present
  // `analysis/synthesis.md`, enforced by the extractor) — so an empty/one-line stub fails.
  // `report-produced` (Stage 2) checks the deliverable EXISTS + is non-trivial. `research-answer`
  // (issue #88 product-correctness) checks it ANSWERED the planted question: the sandbox plants
  // ONE unreachable-but-implemented command (`cmd_frobnicate` — defined + documented in README/header,
  // absent from the dispatcher `case`), so the report must name `frobnicate` AND draw the
  // unreachable/dead-code conclusion. Deterministic offline grep floor (no network, no LLM judge);
  // authored from the task spec before the first live run. `=pass` lands OPTIONAL (+ `=fail` allowlist
  // LIMITATION); promote to required after >=2 clean runs.
  outcome: [
    { id: 'report-produced', assert: 'research-deliverables', params: { minBytes: 200, minNonBlankLines: 5 } },
    {
      id: 'research-answer',
      assert: 'report-contains',
      params: {
        file: 'outputs/research-report.md',
        tokens: ['frobnicate'],
        anyOf: ['unreachable', 'dead code', 'never (dispatched|called|reached)', 'not (wired|reachable|dispatched)'],
      },
    },
  ],
  // Stage 3: gate->phase placement (threaded into extract) + deterministic gate answers (chooseAnswer).
  gateMap,
  phaseWitnesses,
  answerMap,
  // Stage 4 (order spine): expected delegated(...) agents in the order the research orchestrator fans
  // them out (plan -> gather -> synthesize). Names match the delegated(...) tokens the extractor emits
  // verbatim. `minCounts` names the agent(s) that must appear >=1 time.
  precedesChain: ['research-planner', 'information-gatherer', 'research-synthesizer'],
  minCounts: ['information-gatherer'],
  // Pre-registered retry prompt; also exported as `fallbackPrompt`.
  fallbackPrompt,
};

export { fallbackPrompt };
export default scenario;
