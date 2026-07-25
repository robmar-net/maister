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
  const opts = { checkReference: false, keepRundir: false, help: false, unknown: [] };
  for (const a of argv) {
    if (a === '--check-reference') opts.checkReference = true;
    else if (a === '--keep-rundir') opts.keepRundir = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.unknown.push(a);
  }
  return opts;
}

function printUsage(stream = process.stdout) {
  stream.write([
    'L2 — Trace-Equivalence Testing Harness (run.mjs)',
    '',
    'Usage: node run.mjs [--check-reference] [--keep-rundir] [-h|--help]',
    '',
    'Flags:',
    '  --check-reference   Credit-free, offline: recompute the reference hash + check its version',
    '                      stamp (workflow-model, or maister package as fallback). No SDK session,',
    '                      no credits. Exits 0 (current) / 1 (stale — re-derive) / 2 (corrupt).',
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

// run.sh normally creates the mktemp rundir and copies the sandbox template in, passing COMPAT_RUNDIR.
// Direct invocation falls back to creating our own rundir + copying l2/sandbox/<template>/ in.
function prepareRundir(sc, opts) {
  const provided = process.env.COMPAT_RUNDIR;
  if (provided) return { rundir: provided, ownedByUs: false };

  const rundir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-rundir-'));
  const templateDir = path.join(L2_DIR, 'sandbox', sc.sandboxTemplate);
  if (!isDir(templateDir)) {
    throw preconditionError(`sandbox template not found: ${templateDir}`);
  }
  fs.cpSync(templateDir, rundir, { recursive: true });
  return { rundir, ownedByUs: true };
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

// Build the L0/L1-style markdown report (spec § Report Format).
export function buildReport(ctx) {
  const {
    scenarioId, mode, overall, counts, observed, reference, result,
    incompleteReason, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, finalN, parseWarnings = [], sdkPath,
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

// --------------------------------------------------------------------------- live drive (seat-gated)
async function runLive(opts) {
  const sc = getScenario(scenario.id); // hardcoded single MVP scenario (L3)
  const ts = utcStamp();
  const maisterVersion = readRepoMaisterVersion();
  const copilotVersion = detectCopilotVersion();
  const osStr = osString();
  const isolationNote = process.env.COMPAT_RUNDIR
    ? `mktemp rundir (provided by run.sh): ${process.env.COMPAT_RUNDIR}`
    : 'mktemp rundir (created by run.mjs direct-invocation fallback)';

  // Reference must exist + be valid JSON before we spend a credit (precondition -> exit 2).
  const reference = loadReference(scenario.id).reference;

  // Rundir + sandbox (run.sh usually provides COMPAT_RUNDIR with the template already copied in).
  const { rundir, ownedByUs } = prepareRundir(sc, opts);

  // SDK resolution + client lifecycle live INSIDE the try (R1) so a failure to resolve / import /
  // start still runs the finally (rundir teardown). resolveSdkPath throws a precondition (exit 2)
  // when unresolved; the SOLE dynamic import stays off the credit-free paths (help/--check-reference
  // already returned in main before we get here).
  let session = null;
  let client = null;
  let sdkPath = null;
  let exitCode = EXIT.INCOMPLETE;
  try {
    sdkPath = resolveSdkPath();
    const { CopilotClient, RuntimeConnection, approveAll } = await import(sdkPath);

    const recorded = [];
    // Spawn the runtime CO-LOCATED with the SDK (<pkg>/app.js) so SDK and runtime share a wire
    // protocol. Omitting `path` makes the SDK resolve an absent npm platform package; pointing at the
    // native /usr/local/bin/copilot spawns a --stdio server reporting an OLDER protocol (2) than the
    // pkg SDK (3) -> mismatch. app.js (sibling of copilot-sdk/index.js) is the protocol-matched
    // runtime (verified live, 1.0.74). COMPAT_COPILOT_RUNTIME overrides.
    const runtimePath = process.env.COMPAT_COPILOT_RUNTIME
      || path.resolve(path.dirname(sdkPath), '..', 'app.js');
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
      const reason =
        `sendAndWait did not complete (timeout or session error): ${timeoutErr?.message ?? timeoutErr}`;
      const rp = writeReport(buildReport({
        scenarioId: sc.id, mode: 'live', overall: 'INCOMPLETE',
        counts: { pass: 0, limitation: 0, skip: 0, fail: 0 },
        observed: null, reference, result: null, incompleteReason: reason, parseWarnings: [],
        copilotVersion, maisterVersion, osStr, ts, isolationNote,
        pluginDir: PLUGIN_DIR, pluginName: PLUGIN_NAME, finalN: 1, sdkPath,
      }), ts);
      process.stdout.write(`\nL2: INCOMPLETE (no verdict) — ${reason}\nReport: ${rp}\n`);
      return EXIT.INCOMPLETE;
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
    if (ex.incomplete) {
      const rp = writeReport(buildReport({
        scenarioId: sc.id, mode: 'live', overall: 'INCOMPLETE',
        counts: { pass: 0, limitation: 0, skip: 0, fail: 0 },
        observed: normalize(ex.records), reference, result: null,
        incompleteReason: ex.incompleteReason, parseWarnings: ex.parseWarnings,
        copilotVersion, maisterVersion, osStr, ts, isolationNote,
        pluginDir: PLUGIN_DIR, pluginName: PLUGIN_NAME, finalN: 1, sdkPath,
      }), ts);
      process.stdout.write(`\nL2: INCOMPLETE (sanity floor) — ${ex.incompleteReason}\nReport: ${rp}\n`);
      return EXIT.INCOMPLETE;
    }

    // normalize -> compare vs the committed reference.
    const observed = normalize(ex.records);
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
        scenarioId: sc.id, mode: 'live', overall: 'INCOMPLETE',
        counts: { pass: 0, limitation: 0, skip: 0, fail: 0 },
        observed, reference, result, incompleteReason: reason, parseWarnings: ex.parseWarnings,
        copilotVersion, maisterVersion, osStr, ts, isolationNote,
        pluginDir: PLUGIN_DIR, pluginName: PLUGIN_NAME, finalN: 1, sdkPath,
      }), ts);
      process.stdout.write(`\nL2: INCOMPLETE (widened sanity floor) — ${reason}\nReport: ${rp}\n`);
      return EXIT.INCOMPLETE;
    }

    const counts = {
      pass: result.counts.pass, limitation: result.counts.limitation, skip: 0, fail: result.counts.fail,
    };
    const rp = writeReport(buildReport({
      scenarioId: sc.id, mode: 'live', overall: result.overall,
      counts, observed, reference, result, incompleteReason: null, parseWarnings: ex.parseWarnings,
      copilotVersion, maisterVersion, osStr, ts, isolationNote,
      pluginDir: PLUGIN_DIR, pluginName: PLUGIN_NAME, finalN: 1, sdkPath,
    }), ts);
    process.stdout.write(
      `\nL2: ${result.overall} — ${counts.pass} PASS · ${counts.limitation} LIMITATION · ` +
      `${counts.fail} FAIL\nReport: ${rp}\n`,
    );
    exitCode = result.exitCode; // 0 AS-EXPECTED / 1 REGRESSED
  } finally {
    // Bounded teardown: the SDK client spawned the app.js runtime subprocess whose IPC handles keep
    // the event loop alive; a hung disconnect/stop would wedge the process AFTER a clean verdict
    // (observed: verdict+report written, then a cleanup hang -> SIGTERM). Cap each step, then the
    // entrypoint force-exits so no lingering handle can hang the run.
    const bounded = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
    if (session) { await bounded(session.disconnect?.(), 5000); }
    if (client) { await bounded(client.stop?.(), 5000); try { client.forceStop?.(); } catch { /* ignore */ } }
    if (ownedByUs && !opts.keepRundir && process.env.COMPAT_KEEP_RUNDIR !== '1') {
      try { fs.rmSync(rundir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  return exitCode;
}

// --------------------------------------------------------------------------- main
export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);

  if (opts.help) { printUsage(); return EXIT.AS_EXPECTED; }

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
