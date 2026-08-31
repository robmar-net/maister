/**
 * L2 scenario — development-shaped workflow (MVP; the single scenario).
 *
 * Exports the data the L2 harness needs to drive ONE development-shaped Copilot
 * run in an isolated sandbox and then check its normalized predicate skeleton
 * against the committed reference:
 *
 *     { id, sandboxTemplate, prompt, expectedShape: 'development', timeoutMs }
 *
 * plus a pre-registered `fallbackPrompt` (see "Routing", below).
 *
 * Zero-dependency ESM: this module is pure data (no imports; `node:` builtins only
 * if ever needed). `run.mjs` (Group 7) imports the scenario and drives it via a SINGLE
 * `session.sendAndWait(scenario.prompt, scenario.timeoutMs)` — it performs NO automatic
 * retry; `run.sh` (Group 8) copies `l2/sandbox/<sandboxTemplate>/` into the mktemp rundir
 * before exec. `fallbackPrompt` is exported for the OPERATOR to re-drive with by hand during
 * the seat-gated Group 10 run if the first trace mis-routes (a runbook step, not automation).
 *
 * ── Routing mechanism (MEDIUM-3, BINDING) ──────────────────────────────────────
 * The harness drives the run purely through a natural-language turn
 * (`session.sendAndWait(prompt)`) — there is NO slash-command path over the SDK,
 * and, unlike the maister (Claude) plugin, maister-copilot exposes **no
 * `development` command**: its `commands/` dir holds only `work` + `reviews-*`
 * (verified: `plugins/maister-copilot/commands/`). So the run reaches the
 * development orchestrator by the model choosing to invoke `skill("development")`
 * in response to the prompt — the root `development` skill is `user-invocable:
 * true` (`plugins/maister-copilot/skills/development/SKILL.md`), so a prompt that
 * names the maister development workflow auto-triggers it.
 *
 *   Primary mechanism : NL prompt  ->  skill("development") auto-trigger.
 *   Documented alt.   : the `work` entry point
 *                       (`plugins/maister-copilot/commands/work.md`), which
 *                       classifies the task and routes to the same development
 *                       orchestrator. Not used by default (it adds a
 *                       classification hop that could route to a quick path);
 *                       named here as the known alternative route.
 *
 * `prompt` is written to route DETERMINISTICALLY to development (not quick-dev /
 * quick-bugfix): it explicitly names the *development workflow*, frames a full
 * feature-addition (analyse -> spec -> plan -> implement -> verify with a test),
 * and avoids "quick" / "bug" / "fix" phrasing that would route elsewhere.
 *
 * `fallbackPrompt` is a stronger restatement that names the development *skill*
 * and explicitly rules out the quick paths. It is NOT consumed automatically by
 * run.mjs — the OPERATOR re-drives with it by hand (a Group 10 runbook step) if the
 * first live trace mis-routes (to quick-dev / quick-bugfix, or inlines the work with
 * no task dir / state), so a single mis-route becomes a manual retry rather than an
 * immediate INCOMPLETE. Dev-routing is validated live in Group 10 by the observed
 * skeleton containing `delegated(gap-analyzer)` +
 * `created_artifact(implementation/spec.md)` + `phase_completed(8)`.
 * ───────────────────────────────────────────────────────────────────────────────
 */

/**
 * Primary prompt — designed to route deterministically to the DEVELOPMENT
 * orchestrator via `skill("development")`. Names the workflow explicitly and
 * frames a full feature-addition with a test.
 */
const prompt =
  'Run the maister development workflow to add a small `--greet <name>` ' +
  'subcommand to the sample CLI in this project. The subcommand should print ' +
  '`Hello, <name>!`. Handle these edge cases exactly: a multi-word name ' +
  '(`--greet "Ada Lovelace"` must print `Hello, Ada Lovelace!`), and a missing ' +
  'name (bare `--greet` with no argument must exit non-zero AND print usage to ' +
  'stderr). Use the full development workflow end to end — analyse the codebase, ' +
  'write a specification, plan the work, implement it, and verify it — and include ' +
  'tests for the new subcommand covering those edge cases.';

/**
 * Fallback prompt (MEDIUM-3) — a stronger restatement the OPERATOR re-drives with by hand
 * (a Group 10 runbook step; run.mjs does not auto-retry) if the first live trace mis-routes.
 * Names the development *skill* directly and explicitly excludes the quick paths.
 */
const fallbackPrompt =
  'Use the maister `development` skill to run the full development workflow ' +
  '(codebase analysis, gap analysis, specification, planning, implementation, and ' +
  'verification) for adding a `--greet <name>` subcommand that prints ' +
  '`Hello, <name>!` to the sample CLI in this project — handling a multi-word name ' +
  '(`--greet "Ada Lovelace"` -> `Hello, Ada Lovelace!`) and a missing name (bare ' +
  '`--greet` -> non-zero exit + usage on stderr) — including tests. Do NOT use ' +
  'quick-dev or quick-bugfix — use the development workflow orchestrator.';

/**
 * gateMap (Stage 3) — first-match-wins, evaluated per `user_input.requested` `data.question`.
 * Each regex is anchored on that phase's most distinctive VERBATIM gate phrase from
 * plugins/maister/skills/development/SKILL.md (read-only): phases 2-13 are the phases with a
 * MANDATORY-GATE exit (phases 1 & 14 have none). On a match the extractor emits
 * `gate_fired_at(phase-N)` (in addition to the always-kept `gate_fired(ask)`), placing the gate
 * on its phase. ORDER: phase-6 (`implementation planning`) precedes phase-7 (`implementation?`)
 * so the longer phrase is never shadowed by the shorter `implementation?` regex.
 */
const gateMap = [
  { phase: 2, re: /continue to phase [345]:/i },
  { phase: 3, re: /tdd red gate complete/i },
  { phase: 4, re: /ui mockups complete/i },
  { phase: 5, re: /continue to specification audit/i },
  { phase: 6, re: /continue to implementation planning/i },
  { phase: 7, re: /continue to implementation\?/i },
  { phase: 8, re: /continue to verification/i },
  { phase: 9, re: /tdd gate passed/i },
  { phase: 10, re: /which standard verifications|enable e2e|generate user documentation/i },
  // Phase 11 (Verification & Issue Resolution) exit gate. SKILL.md:436 makes it "Continue to Phase 12?"
  // AND instructs the model to "Display executive summary: total issues found, issues fixed, issues
  // remaining" first. BUT phases 12 (E2E) + 13 (user-docs) are CONDITIONAL (SKILL.md:120-122 "When
  // e2e_enabled / user_docs_enabled"); when BOTH are skipped the orchestrator faithfully points the gate
  // at the next ACTIVE phase — 14 — so the question becomes "Continue to Phase 14 finalization?" (observed
  // live on 1.0.82, run 20260830T155522Z). Either phrasing IS the Phase-11 mandatory exit gate, so match
  // BOTH: the literal "phase 12", OR a verification/issues executive-summary that continues to phase 14 /
  // finalization. The verification anchor keeps this from stealing phase-13's own →14 gate, which is
  // "documentation complete" (its own regex below) and carries no verification-summary text.
  // "recheck" / "re-check" added (#88 follow-up): a Phase-11 fix→re-verify cycle can phrase the exit gate
  // "Verification recheck: … Continue to Phase 14 finalization?" (observed 1.0.82 `20260831T123617Z`),
  // which the passed|results|found|complete anchors miss.
  { phase: 11, re: /continue to phase 12|(re-?verification|verification (passed|results|found|complete|recheck|re-?checked?)|issues? (found|fixed|remaining)).{0,200}continue to (phase 14|finaliz)/is },
  { phase: 12, re: /e2e complete/i },
  { phase: 13, re: /documentation complete/i },
];

/**
 * answerMap (Stage 3) — deterministic gate choices for `chooseAnswer` (first-match-wins over
 * `data.question`). The phase-10 verification decisions pick the cheapest deterministic option
 * (skip E2E, skip docs, first standard-verification selection); every phase-exit `Continue to …`
 * gate proceeds with `yes` (or `choices[0]`). Unmatched -> `choices[0] ?? 'yes'` responder-fallback.
 */
const answerMap = [
  { re: /enable e2e/i, choice: 'No, skip', phase: 10 },
  { re: /generate user documentation/i, choice: 'No, skip', phase: 10 },
  { re: /which standard verifications/i, choice: null, phase: 10 }, // null -> choices[0] (cheapest)
  { re: /continue to/i, choice: 'yes' },
];

/**
 * The single MVP scenario. `scenarios/` is the extension point; do not add a
 * second scenario until the MVP conformance loop is proven (anti-over-engineering).
 */
export const scenario = {
  id: 'development',
  // Directory name under `l2/sandbox/`; copied into the mktemp rundir per run.
  sandboxTemplate: 'sample-cli',
  prompt,
  expectedShape: 'development',
  // Selects the extractor's development TREE_PROFILE + the findStateYaml `.maister/tasks/development/`
  // subtree. Explicit for symmetry with sibling scenarios; 'development' is also the harness default.
  taskType: 'development',
  // Generous by design. A full live development run (many phases + subagents +
  // gates) is long, and `sendAndWait` THROWS on timeout (it does not abort
  // in-flight work), so an under-sized value would false-INCOMPLETE a slow-but-
  // progressing run. The single seat-gated Group 10 run is operator-supervised.
  timeoutMs: 45 * 60 * 1000, // 45 minutes
  // requested model = account/SDK default; operator pins per live run via COMPAT_L2_MODEL
  model: null,
  // Functional oracle (Stage 2). Command-type outcome: after the drive, restage the
  // trusted `run-tests.sh` from the committed sample-cli template over the model-touched
  // rundir copy (MEDIUM-5, tamper-resistance), then run `sh run-tests.sh` in the rundir
  // root. Pass iff exit 0 — which now requires the `--greet` deliverable (HIGH-3), so a
  // pristine sandbox fails and only a completed dev workflow passes.
  // WP-D2 (issue #76): artifact STRUCTURE oracles. Assert the § 7 Artifact Summary Contract opener
  // (`## TL;DR` first) on the three core development deliverables — content/structure, beyond the
  // created_artifact existence records. `=pass` lands OPTIONAL; the matching `=fail` is allowlisted
  // as a tracked LIMITATION (promote `=pass` to required after >=2 runs confirm structure on Copilot).
  // `greet-edges` (issue #88 product-correctness) is a SEPARATE restaged command oracle over the SAME
  // deliverable: multi-word name preserved + bare `--greet` fails with usage on stderr. Kept separate
  // from `tests-pass` (which stays the required, backwards-comparable feature check) so a bundle
  // predating the hardened edges is a tracked LIMITATION, not a false REGRESSED: `=pass` lands OPTIONAL
  // (+ `=fail` allowlisted), promoted to required after >=2 clean runs (WP-D2 rule). This is the
  // ticket's explicitly-sanctioned "separate line" alternative to folding the edges into `tests-pass`.
  outcome: [
    { id: 'tests-pass', command: 'sh run-tests.sh', restage: ['run-tests.sh'] },
    { id: 'greet-edges', command: 'sh run-edge-tests.sh', restage: ['run-edge-tests.sh'] },
    { id: 'spec-structure', assert: 'artifact-headings', params: { file: 'implementation/spec.md', minBytes: 200 } },
    { id: 'plan-structure', assert: 'artifact-headings', params: { file: 'implementation/implementation-plan.md', minBytes: 200 } },
    { id: 'verification-structure', assert: 'artifact-headings', params: { file: 'verification/implementation-verification.md', minBytes: 200 } },
  ],
  // Stage 3: gate->phase placement (threaded into extract) + deterministic gate answers (chooseAnswer).
  gateMap,
  answerMap,
  // Stage 4 (order spine): expected delegated(...) agents in the order the development orchestrator
  // fans them out (analyse -> spec -> plan -> implement -> verify). Names match the delegated(...) tokens
  // the extractor emits verbatim. `minCounts` names the agent(s) that must appear >=1 time.
  precedesChain: ['gap-analyzer', 'specification-creator', 'implementation-planner', 'task-group-implementer', 'implementation-verifier'],
  minCounts: ['task-group-implementer'],
  // Pre-registered retry prompt (MEDIUM-3); also exported as `fallbackPrompt`.
  fallbackPrompt,
};

export { fallbackPrompt };
export default scenario;
