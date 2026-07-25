// run.mjs — L2 SDK session driver + report generator (Task Group 7).
//
// THIN SDK glue over the pure, credit-free-tested modules (sdk-path / extractor / normalize /
// compare). All asserted logic lives in those modules; this entrypoint only (a) parses args,
// (b) serves the credit-free `--check-reference` staleness guard, and (c) on the live path,
// drives ONE development-shaped Copilot workflow via the bundled SDK, reduces the typed event
// stream + task-dir tree + orchestrator-state.yml to a normalized predicate skeleton, set-compares
// it to the committed maister-model-derived reference, and writes the L0/L1-style report.
//
// House conventions (per plugins/maister/skills/mockup-studio/server/index.mjs): zero external
// dependencies; `.mjs`; `node:` builtins only; `__dirname` via fileURLToPath(import.meta.url);
// manual process.argv parsing; no bundler / tsconfig / package.json. The bundled @github/copilot-sdk
// is the SOLE non-builtin, loaded by RESOLVED ABSOLUTE PATH (it ships no package.json, so a
// bare-specifier import is impossible; the version is never hardcoded — it self-updates).
//
// CREDIT-FREE GUARANTEE (LOW-4, node side): `--check-reference` and `-h/--help` RETURN BEFORE any
// SDK import or session is constructed. The SDK is a DYNAMIC import inside runLive() only, so
// importing this module or running `--check-reference` never spends a credit.
//
// EXIT CODES (spec § Preflight + verdict -> exit code, via compare.EXIT):
//   0 AS-EXPECTED / current / help    1 REGRESSED / stale    2 INCOMPLETE / precondition / bad args
//
// LIVE-DRIVE STRUCTURE (proven in L2-SPIKE-FINDINGS.md; exercised by Group 10 with a seat):
//   * onEvent is a SessionConfig FIELD (registered BEFORE the create RPC) — LOAD-BEARING; a
//     post-create session.on() would miss session.start and break trace completeness.
//   * RuntimeConnection.forStdio({ path }) points at the SDK's co-located runtime (<pkg>/app.js) so
//     the SDK and runtime share a wire protocol. Omitting `path` (absent npm platform package) or
//     pointing at the native /usr/local/bin/copilot (older --stdio protocol) both fail on 1.0.74
//     (verified live). * Gates FIRE and are ANSWERED via handlers — never `--no-ask-user` (AC8).
//   * sendAndWait THROWS on timeout (does not abort) -> catch -> abort() -> INCOMPLETE (exit 2).
//   * MEDIUM-2 sanity floor: empty phases while artifacts exist -> INCOMPLETE, never a silent
//     all-missing REGRESSED.
//
// NOISE CALIBRATION (--runs=N, L2-DESIGN §4): N=1 (default) is the single-drive path above, byte-for-
// byte unchanged. N>1 drives N live traces (each on its OWN fresh client + fresh per-run rundir — a
// shared client could not cleanly serve a 2nd session, and the dev workflow mutates the rundir, so runs
// share neither), then `aggregateRuns` keeps predicates present in ALL N runs
// as the STABLE skeleton (set-compared to the reference) and reports the flapping predicates as the
// measured noise band + reference-tuning insights. <2 successful runs -> INCOMPLETE. NO silent caps:
// any shortfall (fewer than N completed) is stated in the report and on stdout.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { resolveSdkPath } from './sdk-path.mjs';
import { extract } from './extractor.mjs';
import { normalize } from './normalize.mjs';
import { compare, checkReference, EXIT } from './compare.mjs';
import scenario from './scenarios/development.mjs';

// --------------------------------------------------------------------------- paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = __dirname;
// l2 -> compat-tests -> copilot-cli -> platforms -> <repo root>
const REPO_ROOT = path.resolve(L2_DIR, '..', '..', '..', '..');
const REPORTS_DIR = path.resolve(L2_DIR, '..', 'reports');
const PLUGIN_JSON = path.join(REPO_ROOT, 'plugins', 'maister', '.claude-plugin', 'plugin.json');
const PLUGIN_DIR = process.env.COMPAT_PLUGIN_DIR || path.join(REPO_ROOT, 'plugins', 'maister-copilot');
const PLUGIN_NAME = 'maister-copilot';

// --------------------------------------------------------------------------- tiny fs helpers
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function preconditionError(message) {
  return Object.assign(new Error(message), { exitCode: EXIT.INCOMPLETE, code: 'L2_PRECONDITION' });
}

// --------------------------------------------------------------------------- arg parsing (house style)
export function parseArgs(argv) {
  const opts = { checkReference: false, keepRundir: false, help: false, runs: 1, runsError: null, unknown: [] };
  for (const a of argv) {
    if (a === '--check-reference') opts.checkReference = true;
    else if (a === '--keep-rundir') opts.keepRundir = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--runs=')) {
      // Noise-calibration sample size (L2-DESIGN §4). Valid domain is a positive integer >=1;
      // a non-integer, a decimal, or <1 (e.g. 0 / -2) is a bad arg -> exit 2 "invalid --runs".
      const raw = a.slice('--runs='.length);
      if (/^\d+$/.test(raw) && parseInt(raw, 10) >= 1) opts.runs = parseInt(raw, 10);
      else opts.runsError = raw;
    }
    else opts.unknown.push(a);
  }
  return opts;
}

function printUsage(stream = process.stdout) {
  stream.write([
    'L2 — Trace-Equivalence Testing Harness (run.mjs)',
    '',
    'Usage: node run.mjs [--check-reference] [--runs=N] [--keep-rundir] [-h|--help]',
    '',
    'Flags:',
    '  --check-reference   Credit-free, offline: recompute the reference hash + check its version',
    '                      stamp (workflow-model, or maister package as fallback). No SDK session,',
    '                      no credits. Exits 0 (current) / 1 (stale — re-derive) / 2 (corrupt).',
    '  --runs=N            Noise-calibration sample size (L2-DESIGN §4). Default 1 (single live drive,',
    '                      unchanged behavior). N>1 drives N live traces in fresh per-run rundirs,',
    '                      keeps predicates present in ALL runs as the STABLE skeleton (compared to',
    '                      the reference), and reports the measured noise band. N must be an integer',
    '                      >=1 (0 / non-integer -> exit 2). Each extra run consumes a seat/credits.',
    '  --keep-rundir       Retain a self-created mktemp rundir for debugging (direct invocation).',
    '  -h, --help          Print this usage and exit 0.',
    '',
    'Env overrides:',
    '  COMPAT_PLUGIN_DIR        Plugin under test (default <repo>/plugins/maister-copilot).',
    '  COMPAT_RUNDIR            Rundir with the sandbox already copied in (set by run.sh).',
    '  COMPAT_KEEP_RUNDIR=1     Retain a self-created rundir (same as --keep-rundir).',
    '  COMPAT_MAISTER_VERSION   Override the repo maister version --check-reference compares against',
    '                           (test/operator seam; default read from',
    '                           plugins/maister/.claude-plugin/plugin.json).',
    '',
    'Normally invoked via `make test-l2` -> run.sh (seat preflight + plugin de-shadow + isolation).',
    '',
  ].join('\n'));
}

// --------------------------------------------------------------------------- reference + version
function loadReference(scenarioId) {
  const refPath = path.join(L2_DIR, 'reference', `${scenarioId}.skeleton.json`);
  if (!isFile(refPath)) {
    throw preconditionError(`reference not found: ${refPath} (author the golden / run make build first)`);
  }
  try {
    return { reference: JSON.parse(fs.readFileSync(refPath, 'utf8')), refPath };
  } catch (err) {
    throw preconditionError(`reference is not valid JSON: ${refPath} — ${err.message}`);
  }
}

// The repo maister version --check-reference compares against. COMPAT_MAISTER_VERSION is a documented
// test/operator seam (simulate a bumped version without editing plugin.json — zero-touch); default is
// the committed plugins/maister/.claude-plugin/plugin.json.
function readRepoMaisterVersion() {
  if (process.env.COMPAT_MAISTER_VERSION) return process.env.COMPAT_MAISTER_VERSION;
  try {
    const pj = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
    if (typeof pj.version === 'string' && pj.version) return pj.version;
    throw new Error('missing "version" field');
  } catch (err) {
    throw preconditionError(`cannot read maister version from ${PLUGIN_JSON}: ${err.message}`);
  }
}

// Credit-free staleness/tamper guard. No SDK import on this path. The scenario is hardcoded
// internally (single MVP value) — there is no user-facing --scenario flag (L3).
export function runCheckReference() {
  let reference;
  let version;
  try {
    reference = loadReference(scenario.id).reference;
    version = readRepoMaisterVersion();
  } catch (err) {
    process.stdout.write(`--check-reference: INCOMPLETE — ${err.message}\n`);
    return typeof err.exitCode === 'number' ? err.exitCode : EXIT.INCOMPLETE;
  }
  const result = checkReference(reference, version);
  process.stdout.write(`--check-reference: ${result.status.toUpperCase()} — ${result.message}\n`);
  return result.exitCode; // 0 current / 1 stale (re-derive) / 2 corrupt
}

// --------------------------------------------------------------------------- scenario + rundir + state
function getScenario(id) {
  if (id === scenario.id) return scenario;
  throw preconditionError(`unknown scenario "${id}" (MVP implements only "${scenario.id}")`);
}

// Create a FRESH isolated rundir for ONE trace: resolve l2/sandbox/<template>/ (relative to this
// file) and cpSync it recursively into a new os.tmpdir mktemp dir. Every run gets its OWN rundir —
// the development workflow MUTATES the rundir (writes .maister/tasks/**, edits the sandbox), so N>1
// runs must never share one. We deliberately do NOT reuse COMPAT_RUNDIR (run.sh's single copy) for
// the same reason; run.sh's isolation (plugin de-shadow) is orthogonal and still applies.
function makeFreshRundir(sc) {
  const templateDir = path.join(L2_DIR, 'sandbox', sc.sandboxTemplate);
  if (!isDir(templateDir)) {
    throw preconditionError(`sandbox template not found: ${templateDir}`);
  }
  const rundir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-rundir-'));
  fs.cpSync(templateDir, rundir, { recursive: true });
  return rundir;
}

// Read the run's orchestrator-state.yml from the rundir task tree (first development task dir).
function findStateYaml(rundir) {
  const devDir = path.join(rundir, '.maister', 'tasks', 'development');
  if (!isDir(devDir)) return null;
  for (const e of fs.readdirSync(devDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const sp = path.join(devDir, e.name, 'orchestrator-state.yml');
    if (isFile(sp)) return fs.readFileSync(sp, 'utf8');
  }
  return null;
}

// Merge the onEvent recorder stream with the authoritative getEvents() history, de-duplicating by
// event id (the extractor is order-independent, so ordering is irrelevant to correctness).
function mergeEvents(recorded, history) {
  const seen = new Set();
  const out = [];
  for (const e of [...(history || []), ...(recorded || [])]) {
    if (!e) continue;
    if (e.id != null) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
    }
    out.push(e);
  }
  return out;
}

// --------------------------------------------------------------------------- report
function utcStamp(d = new Date()) {
  // -> YYYYMMDDTHHMMSSZ  (matches L0/L1 `date -u +%Y%m%dT%H%M%SZ`)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function detectCopilotVersion() {
  try {
    return execFileSync('copilot', ['--version'], { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    return 'unknown (copilot not on PATH)';
  }
}

function osString() {
  return `${os.platform()} ${os.release()} (${os.arch()})`;
}

// Escape a cell value for a markdown table (pipes + newlines). Mirrors L0/L1 `sed 's/|/\|/g'`.
function esc(s) {
  return String(s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function fencedList(items) {
  const arr = [...(items || [])];
  return arr.length ? '```\n' + arr.join('\n') + '\n```' : '```\n(none)\n```';
}

// Render a markdown bullet list of predicate tokens (or a single `_(none)_` bullet when empty).
function bulletList(items) {
  const arr = [...(items || [])];
  return arr.length ? arr.map((i) => `- \`${esc(i)}\``) : ['- _(none)_'];
}

// Render the MEASURED noise band (N>1 calibration, L2-DESIGN §4) into the report line buffer:
// stable count, a frequency table for flapping predicates, and the 3 reference-tuning insight lists.
function renderNoiseBand(L, nb) {
  const {
    n, stableCount, noise = [],
    underModeledOptional = [], promoteToRequired = [], flappingRequired = [], shortfall = null,
  } = nb;

  L.push(`## Noise band (N=${n})`);
  L.push('');
  if (shortfall) {
    L.push(`> ${esc(shortfall)}`);
    L.push('');
  }
  L.push(
    `**Stable skeleton:** ${stableCount} predicate(s) present in ALL ${n} runs — this is the calibrated ` +
    'skeleton set-compared to the reference above.',
  );
  L.push('');
  L.push('**Noise (flapping) predicates** — present in some but not all runs, discarded from the skeleton:');
  L.push('');
  if (noise.length) {
    L.push('| Predicate | Frequency |');
    L.push('|-----------|-----------|');
    for (const e of noise) L.push(`| \`${esc(e.predicate)}\` | ${e.count}/${n} |`);
  } else {
    L.push('_(none — every observed predicate was stable across all runs)_');
  }
  L.push('');
  L.push('**Calibration insights** (informational reference-tuning candidates — NOT verdict inputs):');
  L.push('');
  L.push('_Under-modeled optional candidates_ — noise predicates absent from `reference.optional`:');
  for (const b of bulletList(underModeledOptional)) L.push(b);
  L.push('');
  L.push('_Promote-to-required candidates_ — `reference.optional` predicates present in ALL runs:');
  for (const b of bulletList(promoteToRequired)) L.push(b);
  L.push('');
  L.push('_Flapping required (should-be-optional)_ — `reference.required` predicates present in only some runs:');
  for (const b of bulletList(flappingRequired)) L.push(b);
  L.push('');
  L.push(
    '**No silent caps** — any run that did not complete is counted and stated above, never rendered as a pass.',
  );
  L.push('');
}

// Build the L0/L1-style markdown report (spec § Report Format).
export function buildReport(ctx) {
  const {
    scenarioId, mode, overall, counts, observed, reference, result,
    incompleteReason, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, finalN, parseWarnings = [], sdkPath, noiseBand = null, perRun = null,
  } = ctx;

  const L = [];
  L.push('# Copilot CLI — L2 Trace-Equivalence Report');
  L.push('');
  L.push(`- **Generated (UTC):** ${ts}`);
  L.push(`- **Copilot CLI:** \`${esc(copilotVersion)}\``);
  L.push(`- **maister version (reference stamp):** \`${esc(maisterVersion)}\``);
  L.push(`- **Plugin under test:** \`${esc(pluginDir)}\` (name: \`${pluginName}\`)`);
  L.push(`- **Copilot SDK (resolved):** \`${esc(sdkPath || 'n/a (not resolved)')}\``);
  L.push(`- **Mode:** ${mode}`);
  L.push(`- **Isolation:** ${isolationNote}`);
  L.push(`- **Scenario:** ${scenarioId}`);
  L.push(`- **Final N:** ${finalN}`);
  L.push(`- **OS:** ${osStr}`);
  L.push('');
  L.push(
    `**Result:** **${overall}** — ${counts.pass} PASS · ${counts.limitation} LIMITATION · ` +
    `${counts.skip} SKIP · ${counts.fail} FAIL`,
  );
  L.push('');

  if (incompleteReason) {
    L.push('## INCOMPLETE — no verdict');
    L.push('');
    L.push(`> ${esc(incompleteReason)}`);
    L.push('');
    L.push(
      '_Per the L2 verdict model an incomplete run (timeout / session error / sanity-floor trip) is ' +
      '**INCOMPLETE (exit 2)**, never a false REGRESSED or a misleading pass. **No silent caps.**_',
    );
    L.push('');
  }

  // Per-run outcomes (N>1 only) — the diagnosis surface: MUST appear even when the noise band cannot
  // be measured (<2 successful runs). One row per drive with its status and any incomplete reason.
  if (perRun && perRun.length) {
    L.push('## Per-run outcomes');
    L.push('');
    L.push('| Run | Status | Reason |');
    L.push('|-----|--------|--------|');
    for (const r of perRun) {
      L.push(`| ${esc(r.run)} | ${esc(r.status)} | ${r.reason ? esc(r.reason) : '—'} |`);
    }
    L.push('');
  }

  L.push('## Observed Copilot skeleton');
  L.push('');
  L.push(observed ? fencedList([...observed]) : '```\n(no skeleton — run did not complete)\n```');
  L.push('');

  L.push('## Reference skeleton (maister-model-derived)');
  L.push('');
  L.push('**Required** — stable across any correct development run:');
  L.push('');
  L.push(fencedList(reference?.required));
  L.push('');
  L.push('**Optional** — legitimately variable, excluded from the diff:');
  L.push('');
  L.push(fencedList(reference?.optional));
  L.push('');

  L.push('## Classified diff');
  L.push('');
  L.push('| Predicate | Side (missing / extra) | Classification | Evidence / Reason |');
  L.push('|-----------|------------------------|----------------|-------------------|');
  const diffs = result?.diffs || [];
  if (diffs.length === 0) {
    L.push('| _(none)_ | — | — | observed skeleton conforms to the reference partition |');
  } else {
    for (const d of diffs) {
      const cls = d.classification === 'CANDIDATE_REGRESSION' ? 'candidate-regression' : d.classification;
      L.push(`| \`${esc(d.predicate)}\` | ${d.side} | ${cls} | ${esc(d.reason)} |`);
    }
  }
  L.push('');

  if (parseWarnings && parseWarnings.length) {
    L.push('## State parse warnings');
    L.push('');
    L.push(
      '_Diagnostics from the targeted orchestrator-state parser (`extractor.parseState`). Present ' +
      'warnings mean some state-sourced predicates may be under-derived — weigh them against any ' +
      'missing `phase_completed` / `task_characteristic` / `task_status` predicate above._',
    );
    L.push('');
    L.push(fencedList(parseWarnings));
    L.push('');
  }

  if (noiseBand) {
    // N>1: render the MEASURED band (stable count + flapping-frequency table + tuning insights).
    renderNoiseBand(L, noiseBand);
  } else {
    // N=1: no band measured — the conservative-structural schema compensates by construction.
    L.push('## Noise band & final N');
    L.push('');
    L.push(
      '**N=1:** no noise band measured; the conservative-structural schema compensates by construction ' +
      '(every legitimately-variable predicate is modelled `optional`). Full **N=3** calibration is a ' +
      'named follow-up.',
    );
    L.push('');
    L.push(
      '**No silent caps** — any truncation, timeout, or incomplete run is stated above, never rendered ' +
      'as a pass.',
    );
    L.push('');
  }

  L.push('## Version stamps');
  L.push('');
  L.push(`- maister: \`${maisterVersion}\``);
  L.push(`- Copilot CLI: \`${copilotVersion}\``);
  L.push(`- OS: ${osStr}`);
  L.push('');

  L.push('## What each predicate kind asserts');
  L.push('');
  L.push('- **`phase_completed(N)`** — the orchestrator recorded phase `N` in `completed_phases` (state).');
  L.push('- **`task_characteristic(k)=v`** — the gap-analyzer classified characteristic `k` as `v` (state).');
  L.push('- **`task_status(s)`** — the task reached status `s` (state).');
  L.push('- **`created_artifact(p)`** — artifact `p` exists under the run\'s task dir (tree); any `verification/<report>` collapses to `verification/*`.');
  L.push('- **`delegated(a)`** — a `subagent.started` event delegated to bare agent `a` (typed events; plugin prefix stripped).');
  L.push('- **`invoked_skill(s)`** — a `skill.invoked` event ran skill `s` (typed events; `session.skills_loaded` is ignored — HIGH-1).');
  L.push('- **`gate_fired(k)`** — an interactive gate of kind `k` (`ask` / `permission` / `exit_plan_mode`) fired **and was answered** (never `--no-ask-user`).');
  L.push('- **`reached_terminal(completion)`** — the session reached idle/shutdown with no `session.error`.');
  L.push('');
  L.push(
    '_Set-equality over these tokens is the trace-equivalence check; tool-arg values, event ordering, ' +
    'counts, and narration are EXCLUDED as noise._',
  );
  L.push('');

  return L.join('\n');
}

function writeReport(md, ts) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  fs.writeFileSync(reportPath, md);
  return reportPath;
}

// --------------------------------------------------------------------------- noise aggregation (pure)
/**
 * Reduce N per-run normalized skeletons to a stable/noise partition (L2-DESIGN §4). PURE — no I/O,
 * no SDK; fully credit-free unit-testable over inline Sets.
 *
 *   stable = predicates present in ALL n sets (the invariant skeleton we trust)
 *   noise  = predicates present in 1..n-1 sets (they flap -> discarded), each with its occurrence count
 *   union  = every predicate observed in any run
 *
 * All three outputs are lexicographically sorted; `n` is the number of input sets.
 *
 * @param {Array<Set<string>|Iterable<string>>} sets per-run normalized skeletons
 * @returns {{ n:number, stable:string[], noise:Array<{predicate:string,count:number}>, union:string[] }}
 */
export function aggregateRuns(sets) {
  const list = (Array.isArray(sets) ? sets : []).map((s) => (s instanceof Set ? s : new Set(s ?? [])));
  const n = list.length;

  // occurrence count = number of runs whose set contains the predicate (Sets are per-run unique).
  const counts = new Map();
  for (const s of list) {
    for (const p of s) counts.set(p, (counts.get(p) || 0) + 1);
  }

  const stable = [];
  const noise = [];
  const union = [];
  for (const [p, count] of counts) {
    union.push(p);
    if (n > 0 && count === n) stable.push(p);
    else if (count >= 1 && count < n) noise.push({ predicate: p, count });
  }

  const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  stable.sort(byStr);
  union.sort(byStr);
  noise.sort((a, b) => byStr(a.predicate, b.predicate));

  return { n, stable, noise, union };
}

// --------------------------------------------------------------------------- live drive (seat-gated)

// Drive ONE trace on its OWN fresh client (fresh runtime): create+start a CopilotClient -> fresh
// per-run rundir -> createSession (recorder + gate handlers) -> sendAndWait -> merge events -> extract.
// A shared client could not cleanly serve a 2nd session after the 1st completed (runs 2..N failed fast
// at N=3), so each run spawns AND fully tears down its own runtime. Returns a plain result the caller
// finalizes (every shape below also carries `run` = the 1-based run index, for per-run diagnosis):
//   { status:'incomplete', reason }            timeout / session error (session.abort()'d)
//   { status:'incomplete', reason, ex }         MEDIUM-2 sanity floor tripped (empty phases + artifacts)
//   { status:'ok', observed:Set, ex, rundir }   a verdict-eligible normalized skeleton
// The session is disconnected, THEN this run's client stopped + force-stopped, THEN the fresh rundir
// cleaned — all bounded/best-effort.
async function driveOnce(sdk, runtimePath, sc, opts, runIndex) {
  const { CopilotClient, RuntimeConnection, approveAll } = sdk;
  const rundir = makeFreshRundir(sc); // throws a precondition (exit 2) if the template is missing
  const recorded = [];
  let client = null;
  let session = null;
  try {
    // Fresh client (fresh runtime) for THIS run — spawns the co-located app.js over a stdio
    // RuntimeConnection. Per-run isolation: a client reused across runs could not cleanly serve a 2nd
    // session after the 1st completed (runs 2..N failed fast), so each run owns + tears down its own.
    client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: runtimePath }),
    });
    await client.start();

    session = await client.createSession({
      workingDirectory: rundir,
      pluginDirectories: [PLUGIN_DIR],
      // LOAD-BEARING: onEvent is a SessionConfig FIELD so it registers BEFORE the create RPC.
      onEvent: (e) => { recorded.push(e); },
      // Gates FIRE and are ANSWERED (never suppressed via --no-ask-user; AC8).
      onUserInputRequest: (req) => ({
        answer: req.choices?.[0] ?? 'yes',
        wasFreeform: !req.choices,
      }),
      onPermissionRequest: approveAll,
      onExitPlanModeRequest: (req) => ({ approved: true, selectedAction: req.recommendedAction }),
    });

    // Drive the scenario. sendAndWait THROWS on timeout (does not abort in-flight work) -> catch ->
    // abort() -> INCOMPLETE (exit 2, "no verdict"), never a false REGRESSED.
    try {
      await session.sendAndWait(sc.prompt, sc.timeoutMs);
    } catch (timeoutErr) {
      try { await session.abort(); } catch { /* best-effort */ }
      return {
        status: 'incomplete',
        reason: `sendAndWait did not complete (timeout or session error): ${timeoutErr?.message ?? timeoutErr}`,
        run: runIndex,
      };
    }

    // Collect the full typed event stream (onEvent recorder + authoritative getEvents()).
    let history = [];
    try { history = await session.getEvents(); } catch { history = []; }
    const events = mergeEvents(recorded, history);

    // Assemble the pipeline. taskDirRoot = rundir (contains .maister/tasks/development/*).
    const stateYaml = findStateYaml(rundir);
    const ex = extract({ events, taskDirRoot: rundir, stateYaml });

    // MEDIUM-2 sanity floor: empty phases while artifacts exist -> INCOMPLETE, never a silent
    // all-phases-missing REGRESSED.
    if (ex.incomplete) return { status: 'incomplete', reason: ex.incompleteReason, ex, run: runIndex };

    return { status: 'ok', observed: normalize(ex.records), ex, rundir, run: runIndex };
  } finally {
    // Bounded per-run teardown: disconnect the session, THEN stop + forceStop THIS run's OWN client
    // (the SDK client spawned an app.js runtime subprocess whose IPC handles keep the event loop alive —
    // an unbounded stop could wedge the process). Then clean the fresh rundir unless the operator asked
    // to keep it. rmSync(force) is idempotent across paths.
    const bounded = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
    if (session) { await bounded(session.disconnect?.(), 5000); }
    if (client) { await bounded(client.stop?.(), 5000); try { client.forceStop?.(); } catch { /* ignore */ } }
    if (!opts.keepRundir && process.env.COMPAT_KEEP_RUNDIR !== '1') {
      try { fs.rmSync(rundir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

async function runLive(opts) {
  const sc = getScenario(scenario.id); // hardcoded single MVP scenario (L3)
  const N = opts.runs;
  const ts = utcStamp();
  const maisterVersion = readRepoMaisterVersion();
  const copilotVersion = detectCopilotVersion();
  const osStr = osString();
  const isolationNote = N > 1
    ? `${N} fresh per-run mktemp rundirs (each a copy of l2/sandbox/${sc.sandboxTemplate}; the dev ` +
      'workflow mutates the rundir, so runs never share one)'
    : (process.env.COMPAT_RUNDIR
        ? `mktemp rundir (provided by run.sh): ${process.env.COMPAT_RUNDIR}`
        : 'mktemp rundir (created by run.mjs direct-invocation fallback)');

  // Reference must exist + be valid JSON before we spend a credit (precondition -> exit 2).
  const reference = loadReference(scenario.id).reference;

  // NO shared client — each run owns its OWN client (fresh runtime) inside driveOnce (a shared client
  // could not cleanly serve a 2nd session after the 1st completed; runs 2..N failed fast at N=3).
  // Resolve the SDK + runtime path ONCE: resolveSdkPath throws a precondition (exit 2) when unresolved,
  // and the SOLE dynamic import stays off the credit-free paths (help / --check-reference / bad --runs
  // already returned in main before we get here).
  const sdkPath = resolveSdkPath();
  const sdk = await import(sdkPath);

  // Spawn the runtime CO-LOCATED with the SDK (<pkg>/app.js) so SDK and runtime share a wire protocol.
  // Omitting `path` makes the SDK resolve an absent npm platform package; pointing at the native
  // /usr/local/bin/copilot spawns a --stdio server reporting an OLDER protocol (2) than the pkg SDK (3)
  // -> mismatch. app.js (sibling of copilot-sdk/index.js) is the protocol-matched runtime (verified
  // live, 1.0.74). COMPAT_COPILOT_RUNTIME overrides. Computed ONCE, reused by every per-run client.
  const runtimePath = process.env.COMPAT_COPILOT_RUNTIME
    || path.resolve(path.dirname(sdkPath), '..', 'app.js');

  // Drive N traces, each on its own fresh client + fresh rundir (run index is 1-based for reporting).
  const results = [];
  for (let i = 0; i < N; i++) {
    results.push(await driveOnce(sdk, runtimePath, sc, opts, i + 1));
  }

  // Verdict + report are produced AFTER every run tore down its own client (no live handles held
  // during fs writes).
  const ctx = {
    reference, N, scenarioId: sc.id, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir: PLUGIN_DIR, pluginName: PLUGIN_NAME, sdkPath,
  };
  return N === 1 ? finalizeSingleRun(results[0], ctx) : finalizeMultiRun(results, ctx);
}

// N=1 finalizer — CURRENT behavior, preserved exactly: timeout / MEDIUM-2 sanity floor / widened-F3
// floor / normal compare, each writing the same report + stdout line + exit code as before, now over
// the single collected driveOnce result. finalN is always 1.
function finalizeSingleRun(res, ctx) {
  const {
    reference, scenarioId, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, sdkPath,
  } = ctx;
  const base = {
    scenarioId, mode: 'live', reference, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, finalN: 1, sdkPath,
  };
  const INCOMPLETE_COUNTS = { pass: 0, limitation: 0, skip: 0, fail: 0 };

  // Timeout / session error (driveOnce already abort()'d; no ex) — "no verdict".
  if (res.status === 'incomplete' && !res.ex) {
    const rp = writeReport(buildReport({
      ...base, overall: 'INCOMPLETE', counts: INCOMPLETE_COUNTS,
      observed: null, result: null, incompleteReason: res.reason, parseWarnings: [],
    }), ts);
    process.stdout.write(`\nL2: INCOMPLETE (no verdict) — ${res.reason}\nReport: ${rp}\n`);
    return EXIT.INCOMPLETE;
  }

  // MEDIUM-2 sanity floor (ex.incomplete): empty phases while artifacts exist.
  if (res.status === 'incomplete' && res.ex) {
    const rp = writeReport(buildReport({
      ...base, overall: 'INCOMPLETE', counts: INCOMPLETE_COUNTS,
      observed: normalize(res.ex.records), result: null,
      incompleteReason: res.reason, parseWarnings: res.ex.parseWarnings,
    }), ts);
    process.stdout.write(`\nL2: INCOMPLETE (sanity floor) — ${res.reason}\nReport: ${rp}\n`);
    return EXIT.INCOMPLETE;
  }

  // status 'ok' — normalize -> compare vs the committed reference.
  const { observed, ex } = res;
  const result = compare(observed, reference);

  // WIDENED SANITY FLOOR (F3): refuse a REGRESSED that is SOLELY missing state-sourced predicates
  // (phase_completed / task_characteristic / task_status) WHILE the state parser emitted warnings
  // AND artifacts exist — that pattern is a partial state-parse miss, not a real regression, so it
  // becomes INCOMPLETE (no verdict), never a false REGRESSED.
  const STATE_SOURCED = /^(phase_completed|task_characteristic|task_status)\(/;
  const candidateRegressions = result.diffs.filter((d) => d.classification === 'CANDIDATE_REGRESSION');
  const allMissingStateSourced =
    candidateRegressions.length > 0 &&
    candidateRegressions.every((d) => d.side === 'missing' && STATE_SOURCED.test(d.predicate));
  const artifactsExist = [...observed].some((t) => t.startsWith('created_artifact('));
  if (result.overall === 'REGRESSED' && allMissingStateSourced && ex.parseWarnings.length > 0 && artifactsExist) {
    const reason =
      'Verdict would be REGRESSED but every candidate regression is a MISSING state-sourced predicate ' +
      '(phase_completed / task_characteristic / task_status) while the state parser emitted warnings and ' +
      'task-tree artifacts exist — treat as a partial state-parse miss (INCOMPLETE), never a false REGRESSED.';
    const rp = writeReport(buildReport({
      ...base, overall: 'INCOMPLETE', counts: INCOMPLETE_COUNTS,
      observed, result, incompleteReason: reason, parseWarnings: ex.parseWarnings,
    }), ts);
    process.stdout.write(`\nL2: INCOMPLETE (widened sanity floor) — ${reason}\nReport: ${rp}\n`);
    return EXIT.INCOMPLETE;
  }

  const counts = {
    pass: result.counts.pass, limitation: result.counts.limitation, skip: 0, fail: result.counts.fail,
  };
  const rp = writeReport(buildReport({
    ...base, overall: result.overall,
    counts, observed, result, incompleteReason: null, parseWarnings: ex.parseWarnings,
  }), ts);
  process.stdout.write(
    `\nL2: ${result.overall} — ${counts.pass} PASS · ${counts.limitation} LIMITATION · ` +
    `${counts.fail} FAIL\nReport: ${rp}\n`,
  );
  return result.exitCode; // 0 AS-EXPECTED / 1 REGRESSED
}

// N>1 finalizer — noise calibration (L2-DESIGN §4). Aggregate the SUCCESSFUL runs' skeletons into a
// stable/noise partition, set-compare the STABLE skeleton to the reference for the verdict, and
// attach the measured noise band + reference-tuning insights. NO silent caps: any shortfall is
// stated in the report and on stdout; <2 successful runs -> INCOMPLETE. finalN is N.
function finalizeMultiRun(results, ctx) {
  const {
    reference, N, scenarioId, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, sdkPath,
  } = ctx;
  const base = {
    scenarioId, mode: 'live', reference, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, finalN: N, sdkPath,
  };

  // PER-RUN OUTCOMES — the diagnosis surface (no silent caps). One entry per drive, in run order,
  // carrying its status and any incomplete reason. Rendered into the report ("## Per-run outcomes")
  // AND printed to stdout in BOTH paths below, so a shortfall is visible even when the band cannot be
  // measured (<2 successful runs).
  const perRun = results.map((r) => ({ run: r.run, status: r.status, reason: r.reason ?? null }));
  const perRunStdout = perRun
    .map((r) => `  run ${r.run}: ${r.status}${r.reason ? ` — ${String(r.reason).replace(/\r?\n/g, ' ')}` : ''}`)
    .join('\n');

  const ok = results.filter((r) => r.status === 'ok');
  const successCount = ok.length;
  const shortfall = successCount < N
    ? `Only ${successCount}/${N} live runs produced a verdict-eligible skeleton; ${N - successCount} ` +
      'run(s) were INCOMPLETE (timeout / sanity floor). No silent caps — the band is measured over the ' +
      `${successCount} successful run(s).`
    : null;

  // <2 successful runs -> a noise band cannot be measured -> INCOMPLETE (no verdict).
  if (successCount < 2) {
    const reason =
      `Noise calibration needs >=2 successful runs but only ${successCount}/${N} completed; a noise band ` +
      'cannot be measured. Treat as INCOMPLETE (no verdict), never a false pass or regression.';
    const rp = writeReport(buildReport({
      ...base, overall: 'INCOMPLETE', counts: { pass: 0, limitation: 0, skip: 0, fail: 0 },
      observed: null, result: null, incompleteReason: reason, parseWarnings: [], perRun,
    }), ts);
    process.stdout.write(`\nL2: INCOMPLETE (N=${N}) — ${reason}\n${perRunStdout}\nReport: ${rp}\n`);
    return EXIT.INCOMPLETE;
  }

  // Aggregate the successful skeletons; the STABLE set is the verdict skeleton.
  const agg = aggregateRuns(ok.map((r) => r.observed));
  const stableSet = new Set(agg.stable);
  const result = compare(stableSet, reference);

  // Calibration insights (informational reference-tuning candidates — NOT verdict inputs).
  const optionalSet = new Set(Array.isArray(reference.optional) ? reference.optional : []);
  const requiredSet = new Set(Array.isArray(reference.required) ? reference.required : []);
  const noisePredicates = new Set(agg.noise.map((e) => e.predicate));
  // (a) noise predicates absent from reference.optional -> under-modeled optional candidates.
  const underModeledOptional = agg.noise
    .filter((e) => !optionalSet.has(e.predicate))
    .map((e) => e.predicate); // agg.noise is already sorted -> stays sorted
  // (b) optional predicates present in ALL runs (== stable) -> promote-to-required candidates.
  const promoteToRequired = [...optionalSet].filter((p) => stableSet.has(p)).sort();
  // (c) required predicates that flapped (present in some but not all runs) -> should-be-optional.
  const flappingRequired = [...requiredSet].filter((p) => noisePredicates.has(p)).sort();

  const noiseBand = {
    n: N, stableCount: agg.stable.length, noise: agg.noise,
    underModeledOptional, promoteToRequired, flappingRequired, shortfall,
  };

  // Surface the union of state-parse warnings across successful runs (informational).
  const parseWarnings = [...new Set(ok.flatMap((r) => r.ex?.parseWarnings ?? []))].sort();

  const counts = {
    pass: result.counts.pass, limitation: result.counts.limitation, skip: 0, fail: result.counts.fail,
  };
  const rp = writeReport(buildReport({
    ...base, overall: result.overall,
    counts, observed: stableSet, result, incompleteReason: null, parseWarnings, noiseBand, perRun,
  }), ts);
  process.stdout.write(
    `\nL2: ${result.overall} (N=${N}) — stable ${agg.stable.length}, noise ${agg.noise.length}` +
    (shortfall ? `\n${shortfall}` : '') +
    `\n${perRunStdout}` +
    `\nReport: ${rp}\n`,
  );
  return result.exitCode; // 0 AS-EXPECTED / 1 REGRESSED (from the stable-skeleton compare)
}

// --------------------------------------------------------------------------- main
export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);

  if (opts.help) { printUsage(); return EXIT.AS_EXPECTED; }

  if (opts.runsError != null) {
    process.stderr.write(`invalid --runs: ${opts.runsError} (expected an integer >= 1)\n`);
    printUsage(process.stderr);
    return EXIT.INCOMPLETE; // bad args -> exit 2
  }

  if (opts.unknown.length) {
    process.stderr.write(`Unknown argument(s): ${opts.unknown.join(', ')}\n`);
    printUsage(process.stderr);
    return EXIT.INCOMPLETE; // bad args -> exit 2
  }

  // --check-reference RETURNS BEFORE ANY SDK IMPORT OR SESSION (credit-free; LOW-4 node side).
  if (opts.checkReference) return runCheckReference();

  // Live conformance drive (the seat-consuming path; Group 10 exercises it).
  return runLive(opts);
}

// Run main() only when invoked directly (`node run.mjs …`); importing this module is side-effect-free.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      process.stderr.write(`L2 run.mjs error: ${err?.message ?? err}\n`);
      process.exitCode = typeof err?.exitCode === 'number' ? err.exitCode : EXIT.INCOMPLETE;
    })
    // Force a clean exit: the SDK client keeps the spawned runtime subprocess + IPC handles open,
    // which would otherwise hang the process after a clean verdict (observed live: SIGTERM). The
    // report is a synchronous fs.writeFileSync and the verdict line is already flushed by now.
    .finally(() => process.exit(process.exitCode ?? EXIT.INCOMPLETE));
}

export default main;
