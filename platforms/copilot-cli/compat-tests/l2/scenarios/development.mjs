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
  '`Hello, <name>!`. Use the full development workflow end to end — analyse the ' +
  'codebase, write a specification, plan the work, implement it, and verify it — ' +
  'and include a test for the new subcommand.';

/**
 * Fallback prompt (MEDIUM-3) — a stronger restatement the OPERATOR re-drives with by hand
 * (a Group 10 runbook step; run.mjs does not auto-retry) if the first live trace mis-routes.
 * Names the development *skill* directly and explicitly excludes the quick paths.
 */
const fallbackPrompt =
  'Use the maister `development` skill to run the full development workflow ' +
  '(codebase analysis, gap analysis, specification, planning, implementation, and ' +
  'verification) for adding a `--greet <name>` subcommand that prints ' +
  '`Hello, <name>!` to the sample CLI in this project, including a test. Do NOT use ' +
  'quick-dev or quick-bugfix — use the development workflow orchestrator.';

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
  // Generous by design. A full live development run (many phases + subagents +
  // gates) is long, and `sendAndWait` THROWS on timeout (it does not abort
  // in-flight work), so an under-sized value would false-INCOMPLETE a slow-but-
  // progressing run. The single seat-gated Group 10 run is operator-supervised.
  timeoutMs: 45 * 60 * 1000, // 45 minutes
  // Pre-registered retry prompt (MEDIUM-3); also exported as `fallbackPrompt`.
  fallbackPrompt,
};

export { fallbackPrompt };
export default scenario;
