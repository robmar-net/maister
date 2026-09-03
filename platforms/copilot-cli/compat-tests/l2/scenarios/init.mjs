/**
 * L2 scenario — `init` FIRST-TOUCH bootstrap (#85, #76 WP-E).
 *
 * The SIXTH L2 scenario. Where `work` verifies the routing entry point, this verifies the OTHER first
 * move a Copilot user makes: initialising the maister framework in a fresh project. Per
 * `plugins/maister/skills/init/SKILL.md`, `init` analyses the codebase (`project-analyzer`), then builds
 * the `.maister/docs/**` reference tree (INDEX.md + project docs + standards) via the `docs-operator`
 * subagent, and integrates the instruction file (`.github/copilot-instructions.md` on Copilot, rewritten
 * from `CLAUDE.md` by build.sh). Until now `init`, `project-analyzer` and `docs-manager` were ⚪ —
 * never observed on Copilot.
 *
 * What it verifies: the entry skill is invoked, the analyzer + docs subagents are delegated to, the
 * INDEX.md artifact is created, and the produced docs structure is materially non-trivial (the Stage-2
 * functional oracle `init-structure`). Exports:
 *   { id, sandboxTemplate, prompt, fallbackPrompt, expectedShape:'init', taskType:'init', timeoutMs, outcome, gateMap, answerMap }
 *
 * ── Sandbox ────────────────────────────────────────────────────────────────
 * NEW template `l2/sandbox/sample-cli-bare/` — the sample CLI (cli.sh + README + run-tests.sh) with NO
 * `.maister/` and no `.github/copilot-instructions.md`, so `init` bootstraps them from scratch. taskType
 * `init` uses the docs-rooted TREE_PROFILE (rootRel `.maister/docs`) so `created_artifact(INDEX.md)` is
 * read from the tree init actually writes.
 *
 * ── Routing ─────────────────────────────────────────────────────────────────
 * The prompt names the maister `init` framework bootstrap so the model invokes `skill("init")`. `init`
 * asks a few interactive questions (standards selection etc.); `answerMap` answers them deterministically
 * (accept the defaults / proceed) so the drive does not stall. `fallbackPrompt` re-states it for a hand
 * re-drive if the first trace mis-routes.
 *
 * Zero-dependency ESM: pure data (no imports).
 */

const prompt =
  'Initialize the maister framework in this project. Run the maister `init` bootstrap end to end: analyze ' +
  'the codebase, set up the `.maister/docs/` documentation structure (INDEX.md plus project docs and a ' +
  'baseline set of standards), and integrate the project instruction file. Accept sensible defaults for ' +
  'any setup questions.';

const fallbackPrompt =
  'Use the maister `init` skill to initialize the framework in this project: analyze the codebase, create ' +
  'the `.maister/docs/` structure (INDEX.md + project docs + standards), and integrate the instruction ' +
  'file. Accept the default choices for any questions and proceed to completion.';

/**
 * answerMap — deterministic answers for `init`'s interactive setup questions (standards selection,
 * confirmations). Permissive by design: `init`'s exact prompts are calibrated from the live N=1 run, so
 * these cover the common shapes (accept all / proceed / yes) and the responder falls back otherwise.
 */
const answerMap = [
  { re: /which standard|standards? (to|categories|selection|would)/i, choice: 'All (recommended)' },
  { re: /proceed|continue|generate|create|confirm|ready|looks good|approve/i, choice: 'Yes' },
  { re: /overwrite|already exists|replace/i, choice: 'Yes' },
];

/**
 * gateMap (Stage 3) — EMPTY. `init` is a Phase/Step-organised setup skill whose questions are setup
 * choices, not phase-numbered exit gates, so no `gate_fired_at(phase-N)` is invented. The extractor
 * still emits any un-phased `gate_fired(ask)` it observes.
 */
const gateMap = [];

export default {
  id: 'init',
  sandboxTemplate: 'sample-cli-bare',
  prompt,
  fallbackPrompt,
  expectedShape: 'init',
  taskType: 'init',
  timeoutMs: 900000,
  // Functional oracle (Stage 2): the bootstrap must produce a materially non-trivial docs index, not a
  // stub. Runs in the post-run rundir (no restage — init CREATES the tree, there is nothing trusted to
  // restage). Pass iff `.maister/docs/INDEX.md` exists and has >=5 non-blank lines.
  outcome: [{
    id: 'init-structure',
    command: 'test -s .maister/docs/INDEX.md && [ "$(grep -c . .maister/docs/INDEX.md)" -ge 5 ]',
    restage: [],
  }],
  gateMap,
  answerMap,
};
