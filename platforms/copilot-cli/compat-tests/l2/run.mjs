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
// CREDIT-SPEND CONFIRMATION (fail-closed, node side): a LIVE drive spends AI credits, so runLive()
// requires explicit consent BEFORE the SDK import / any session — `--yes` (or COMPAT_L2_YES=1), or an
// interactive y/N prompt on a TTY. A non-interactive run without consent REFUSES (exit 2) and spends
// nothing. Every finished drive also SELF-REPORTS its AI-credit cost (AIU + API requests), read from
// the session.shutdown event's totalNanoAiu / modelMetrics.
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
import { readCost } from './cost.mjs';
import { extract } from './extractor.mjs';
import { normalize } from './normalize.mjs';
import { compare, checkReference, EXIT, witnessTokensForPhase } from './compare.mjs';
import developmentScenario from './scenarios/development.mjs';
import researchScenario from './scenarios/research.mjs';
import quickBugfixScenario from './scenarios/quick-bugfix.mjs';
import destructiveGuardScenario from './scenarios/destructive-guard.mjs';
import workScenario from './scenarios/work.mjs';
import initScenario from './scenarios/init.mjs';

// --------------------------------------------------------------------------- scenario registry
// Keyed by id. `development` is the MVP-proven default; `research` is the second workflow shape, added
// once the MVP conformance loop was first verified live. `--scenario=<id>` selects; `getScenario()` resolves
// from here. Adding a scenario = import it + list it here (+ commit its reference/<id>.skeleton.json).
const SCENARIOS = Object.freeze({
  [developmentScenario.id]: developmentScenario,
  [researchScenario.id]: researchScenario,
  [quickBugfixScenario.id]: quickBugfixScenario,
  [destructiveGuardScenario.id]: destructiveGuardScenario,
  [workScenario.id]: workScenario,
  [initScenario.id]: initScenario,
});
const DEFAULT_SCENARIO_ID = developmentScenario.id;

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
  const opts = { checkReference: false, keepRundir: false, help: false, yes: false, runs: 1, runsError: null, scenario: DEFAULT_SCENARIO_ID, scenarioError: null, replay: null, unknown: [] };
  for (const a of argv) {
    if (a === '--check-reference') opts.checkReference = true;
    else if (a === '--keep-rundir') opts.keepRundir = true;
    else if (a === '--yes') opts.yes = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--scenario=')) {
      // Select the workflow shape to drive / check. Unknown id -> bad arg (exit 2), listing choices.
      const id = a.slice('--scenario='.length);
      if (Object.prototype.hasOwnProperty.call(SCENARIOS, id)) opts.scenario = id;
      else opts.scenarioError = id;
    }
    else if (a.startsWith('--runs=')) {
      // Noise-calibration sample size (L2-DESIGN §4). Valid domain is a positive integer >=1;
      // a non-integer, a decimal, or <1 (e.g. 0 / -2) is a bad arg -> exit 2 "invalid --runs".
      const raw = a.slice('--runs='.length);
      if (/^\d+$/.test(raw) && parseInt(raw, 10) >= 1) opts.runs = parseInt(raw, 10);
      else opts.runsError = raw;
    }
    // Credit-free replay of a persisted reports/<ts>/ trace bundle (Stage 4). Reproduces a verdict
    // from a snapshot without importing the SDK. Parsed BEFORE the catch-all so it is never "unknown".
    else if (a.startsWith('--replay=')) opts.replay = a.slice('--replay='.length);
    else opts.unknown.push(a);
  }
  return opts;
}

// --------------------------------------------------------------------------- deterministic responder
// DETERMINISTIC gate answerer (extracted from the inline onUserInputRequest arrow so it is
// unit-testable without a Copilot seat). Scans the scenario's `answerMap` ([{re, choice, phase?}],
// first-match-wins) against `req.question`:
//   * first `re` that matches -> pick `choice`, resolved against `req.choices` when present (else
//     answered freeform) -> { matched:true, fallback:false, mappedPhase: entry.phase ?? null }.
//   * no match -> the deterministic floor `req.choices?.[0] ?? 'yes'` -> { matched:false,
//     fallback:true } (a visibly-flagged responder_fallback).
// Return shape mirrors the SDK's UserInputResponse ({ answer, wasFreeform }) plus the reporting
// fields ({ matched, mappedPhase, fallback }) consumed by the driveOnce gateLog + `## Gates` section.
export function chooseAnswer(req, answerMap = []) {
  const question = String(req?.question ?? '');
  const choices = Array.isArray(req?.choices) ? req.choices : null;
  const map = Array.isArray(answerMap) ? answerMap : [];

  for (const entry of map) {
    if (!entry || !(entry.re instanceof RegExp) || !entry.re.test(question)) continue;
    const { answer, wasFreeform, resolved } = resolveChoice(entry.choice, choices);
    // #63 item 4: a regex hit whose mapped choice is NOT among the offered labels is NOT a deliberate
    // match — it fell back to choices[0]. Report it honestly (matched:false, fallback:true) so the
    // `## Gates` table shows `responder-fallback`, not `mapped`. mappedPhase stays (the gate's phase is
    // still identified). A resolved choice (or a null-choice / freeform) is a genuine match.
    return {
      answer, wasFreeform,
      matched: resolved,
      mappedPhase: entry.phase ?? null,
      fallback: !resolved,
    };
  }

  // Unmatched -> deterministic floor (responder_fallback, visibly flagged in the report).
  return {
    answer: choices?.[0] ?? 'yes',
    wasFreeform: !choices,
    matched: false,
    mappedPhase: null,
    fallback: true,
  };
}

// Resolve a mapped `choice` against the offered `choices`. With no choices the answer is freeform
// (the mapped string, or 'yes'); with choices it matches BIDIRECTIONALLY and layered: exact
// (case-insensitive) -> either-side substring -> first-token. `resolved` reports whether a real match
// was found: a `choice` of null/undefined means "the first/cheapest option" (resolved), but a non-null
// choice that matches NOTHING among the offered labels resolves to choices[0] as a usable floor with
// `resolved:false` — so the caller can flag it as a responder-fallback instead of a silent mismatch.
//
// #63 item 4: the old match was one-directional (`label.includes(choice)`), so a terse map value like
// "No, skip" against offered ["Yes","No"] found nothing -> silently took choices[0] ("Yes"), ENABLING a
// phase the map meant to SKIP, while the caller still reported it as a deliberate match. Either-side
// substring makes "No, skip" -> "No" (the intended skip), and `resolved` keeps `matched` honest.
function resolveChoice(choice, choices) {
  if (!choices || !choices.length) return { answer: choice ?? 'yes', wasFreeform: true, resolved: true };
  if (choice == null) return { answer: choices[0], wasFreeform: false, resolved: true };
  const norm = (s) => String(s).toLowerCase().trim();
  const firstTok = (s) => norm(s).split(/[\s,]+/).filter(Boolean)[0] ?? '';
  const lc = norm(choice);
  const ct = firstTok(choice);
  const hit = choices.find((c) => norm(c) === lc)                                    // exact (ci)
    ?? choices.find((c) => norm(c).includes(lc) || lc.includes(norm(c)))             // either-side substring
    ?? choices.find((c) => ct && firstTok(c) === ct);                               // first-token
  if (hit != null) return { answer: hit, wasFreeform: false, resolved: true };
  return { answer: choices[0], wasFreeform: false, resolved: false };
}

function printUsage(stream = process.stdout) {
  stream.write([
    'L2 — Workflow-Model Conformance Testing Harness (run.mjs)',
    '',
    'Usage: node run.mjs [--scenario=ID] [--check-reference] [--replay=DIR] [--runs=N] [--yes] [--keep-rundir] [-h|--help]',
    '',
    'Flags:',
    '  --scenario=ID       Workflow shape to drive / check: development (default) | research | quick-bugfix |',
    '                      destructive-guard. Selects the',
    '                      live drive AND which reference/<ID>.skeleton.json --check-reference reads.',
    '  --check-reference   Credit-free, offline: recompute the reference hash + check its version',
    '                      stamp (workflow-model, or maister package as fallback). No SDK session,',
    '                      no credits. Exits 0 (current) / 1 (stale — re-derive) / 2 (corrupt).',
    '  --replay=DIR        Credit-free: reproduce a verdict from a persisted trace bundle WITHOUT a live',
    '                      drive (no SDK, no credits). DIR is a reports/<ts>/ bundle (N=1) or a per-run',
    '                      reports/<ts>/run-<i>/ bundle (N>1). Reconstructs extract()\'s inputs + re-runs',
    '                      the outcome oracle, then reuses the same verdict/report/exit code path.',
    '  --runs=N            Noise-calibration sample size (L2-DESIGN §4). Default 1 (single live drive,',
    '                      unchanged behavior). N>1 drives N live traces in fresh per-run rundirs,',
    '                      keeps predicates present in ALL runs as the STABLE skeleton (compared to',
    '                      the reference), and reports the measured noise band. N must be an integer',
    '                      >=1 (0 / non-integer -> exit 2). Each extra run consumes a seat/credits.',
    '  --yes               Confirm you understand a live run CONSUMES AI CREDITS and proceed without the',
    '                      interactive y/N prompt. REQUIRED for non-interactive/CI live runs — without it',
    '                      a non-TTY live run fails closed (exit 2) and spends nothing. Same as',
    '                      COMPAT_L2_YES=1. Does not affect --check-reference / --help (already credit-free).',
    '  --keep-rundir       Retain a self-created mktemp rundir for debugging (direct invocation).',
    '  -h, --help          Print this usage and exit 0.',
    '',
    'Env overrides:',
    '  COMPAT_PLUGIN_DIR        Plugin under test (default <repo>/plugins/maister-copilot).',
    '  COMPAT_RUNDIR            Rundir with the sandbox already copied in (set by run.sh).',
    '  COMPAT_KEEP_RUNDIR=1     Retain a self-created rundir (same as --keep-rundir).',
    '  COMPAT_L2_YES=1          Confirm AI-credit spend for a live run (same as --yes). Required to proceed',
    '                           non-interactively; unset -> a non-TTY live run fails closed (exit 2).',
    '  COMPAT_MAISTER_VERSION   Override the repo maister version --check-reference compares against',
    '                           (test/operator seam; default read from',
    '                           plugins/maister/.claude-plugin/plugin.json).',
    '  COMPAT_L2_MODEL          Requested model for a live run (metadata; resolution opts ?? env ??',
    '                           scenario default). A --model= flag may be added later.',
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

// Credit-free staleness/tamper guard for the selected scenario's reference. No SDK import on this path.
export function runCheckReference(scenarioId = DEFAULT_SCENARIO_ID) {
  let reference;
  let version;
  try {
    reference = loadReference(scenarioId).reference;
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
  const sc = SCENARIOS[id];
  if (sc) return sc;
  throw preconditionError(`unknown scenario "${id}" (available: ${Object.keys(SCENARIOS).join(', ')})`);
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

// Read the run's orchestrator-state.yml from the rundir task tree (first task dir of the scenario's
// workflow type — `.maister/tasks/<taskType>/*/`).
function findStateYaml(rundir, taskType) {
  const typeDir = path.join(rundir, '.maister', 'tasks', taskType);
  if (!isDir(typeDir)) return null;
  for (const e of fs.readdirSync(typeDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const sp = path.join(typeDir, e.name, 'orchestrator-state.yml');
    if (isFile(sp)) return fs.readFileSync(sp, 'utf8');
  }
  return null;
}

// Merge the onEvent recorder stream with the authoritative getEvents() history, de-duplicating by
// event id. ORDER IS LOAD-BEARING since Stage 4: the extractor derives the precedes(a,b) order spine
// from each agent's FIRST-occurrence index over the event stream, so the merge preserves true arrival
// order by concatenating the real-time recorder stream (already in arrival order) AHEAD of the
// authoritative history and keeping the FIRST occurrence per id. (Pre-Stage-4 the extractor was
// order-independent; that is no longer true — do not reorder here.)
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

// Round an AIU value for human display (the raw nano/1e9 value is retained in the data object).
const round4 = (n) => Math.round(n * 1e4) / 1e4;

// Terse one-line AI-credit suffix for the stdout verdict line:
//   ' — ~1.23 AIU, 45 API req'  (known)   |   ' — AIU: unknown'  (no session.shutdown usage captured)
function usageSuffix(u) {
  if (!u || u.aiu == null) return ' — AIU: unknown';
  const req = u.apiRequests != null ? `${u.apiRequests} API req` : 'API req unknown';
  return ` — ~${round4(u.aiu)} AIU, ${req}`;
}

// --------------------------------------------------------------------------- Stage-5 model + cost (pure)
// Resolve the REQUESTED model for a live run: explicit opts.model (no --model flag this stage, so
// normally undefined) ?? the COMPAT_L2_MODEL env override ?? the scenario default (sc.model) ?? null.
// null = "account/SDK default" (the header renders `default`). PURE — unit-tested credit-free.
export function resolveModel(opts, sc, env = process.env) {
  return opts?.model ?? env.COMPAT_L2_MODEL ?? sc?.model ?? null;
}

// The ACTUAL model(s) that served the run, from extractUsage().models (the session.shutdown
// modelMetrics keys, sorted + `+`-joined). Degrades to 'unknown' on the modelMetrics-absent 1.0.8x
// shutdown shape (usage.models === null) — the same path that yields "AIU unknown". PURE.
export function modelActualFromUsage(u) {
  return u && u.models ? (Object.keys(u.models).sort().join('+') || 'unknown') : 'unknown';
}

// Whole-run cost window for an N>1 aggregate readCost: the FIRST run's startIso .. the LAST run's
// endIso. PURE, SDK-free — so the N>1 window assembly is unit-testable without a live drive (M-2).
// Empty results -> {null,null}; a singleton -> that single run's own window.
export function runWindow(results) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return { startIso: null, endIso: null };
  return { startIso: list[0]?.startIso ?? null, endIso: list.at(-1)?.endIso ?? null };
}

// Terse model + real-cost segment APPENDED after usageSuffix on the stdout verdict line. The cost is
// EXPLICITLY `session-store.db:`-labelled (M-4) so it never collides with usageSuffix's
// session.shutdown-sourced `AIU:` token (the two AIU sources coexist and stay distinct).
function costModelSuffix({ model, modelActual, cost } = {}) {
  const db = cost?.unavailable
    ? 'session-store.db: unavailable'
    : (cost?.aiu != null
        ? `session-store.db: ${round4(cost.aiu)} AIU / ${cost.weightedRequests ?? '?'} req`
        : 'session-store.db: unknown');
  return ` · model ${model ?? 'default'}/${modelActual ?? 'unknown'} · ${db}`;
}

// Render the "## AI-credit cost" report section. N=1 -> a single "This run" line from `usage`; N>1 ->
// a per-run AIU/API-request table from `usageTotal.perRun` plus the summed TOTAL across ALL attempted
// runs (an incomplete drive still spends credits, so it is billed too).
function renderCreditCost(L, usage, usageTotal) {
  L.push('## AI-credit cost');
  L.push('');
  L.push(
    '_A live L2 run drives a full maister development workflow via the Copilot SDK and spends AI ' +
    'credits (premium API requests) whether or not it reaches a verdict. Figures are read from the ' +
    '`session.shutdown` event (`totalNanoAiu` / `modelMetrics`); AIU = totalNanoAiu / 1e9._',
  );
  L.push('');
  if (usageTotal) {
    L.push('| Run | Status | AIU | API requests |');
    L.push('|-----|--------|-----|--------------|');
    for (const r of usageTotal.perRun || []) {
      const u = r.usage;
      const aiu = u && u.aiu != null ? `~${round4(u.aiu)}` : 'unknown';
      const req = u && u.apiRequests != null ? String(u.apiRequests) : 'unknown';
      L.push(`| ${esc(r.run)} | ${esc(r.status)} | ${aiu} | ${req} |`);
    }
    L.push('');
    const totAiu = usageTotal.aiu != null ? `~${round4(usageTotal.aiu)} AIU` : 'AIU unknown';
    const totReq = usageTotal.apiRequests != null ? `${usageTotal.apiRequests} API req` : 'API req unknown';
    L.push(
      `**Total across all ${usageTotal.n} attempted run(s)** — including any INCOMPLETE drive, which ` +
      `still spends credits: **${totAiu}, ${totReq}**.`,
    );
    L.push('');
  } else if (usage && usage.aiu != null) {
    const req = usage.apiRequests != null
      ? `${usage.apiRequests} API request(s)`
      : 'an unknown number of API requests';
    L.push(`- **This run:** ~${round4(usage.aiu)} AIU across ${req}.`);
    L.push('');
  } else {
    L.push('- **This run:** AIU unknown — no `session.shutdown` usage data was captured.');
    L.push('');
  }
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
    usage = null, usageTotal = null, gateLog = [], replaySource = null,
    model = null, modelActual = null, cost = null,
  } = ctx;

  const L = [];
  L.push('# Copilot CLI — L2 Workflow-Model Conformance Report');
  L.push('');
  L.push(`- **Generated (UTC):** ${ts}`);
  L.push(`- **Copilot CLI:** \`${esc(copilotVersion)}\``);
  L.push(`- **maister version (reference stamp):** \`${esc(maisterVersion)}\``);
  L.push(`- **Plugin under test:** \`${esc(pluginDir)}\` (name: \`${pluginName}\`)`);
  L.push(`- **Copilot SDK (resolved):** \`${esc(sdkPath || 'n/a (not resolved)')}\``);
  // Stage-4 mode marker: a credit-free `--replay` run renders its source bundle; live stays plain.
  if (mode === 'replayed') L.push(`- **Mode:** replayed (from ${esc(replaySource ?? 'unknown')})`);
  else L.push(`- **Mode:** ${mode}`);
  L.push(`- **Isolation:** ${isolationNote}`);
  L.push(`- **Scenario:** ${scenarioId}`);
  L.push(`- **Final N:** ${finalN}`);
  L.push(`- **OS:** ${osStr}`);
  // Stage-5 (M-4): requested/actual model + the REAL AIU cost read from session-store.db. The AIU row
  // is source-labelled IN ITS KEY on EVERY branch (success / unavailable / unknown) so it never
  // collides with the session.shutdown-sourced `## AI-credit cost` section below. Additive only; renders
  // identically for live + replayed (replay sources model/cost from meta via ctx).
  L.push(`- **Model (requested / actual):** \`${esc(model ?? 'default')}\` / \`${esc(modelActual ?? 'unknown')}\``);
  L.push(
    `- **AIU / weighted requests (session-store.db):** ` +
    (cost?.unavailable
      ? 'unavailable'
      : (cost?.aiu != null ? `${round4(cost.aiu)} AIU / ${cost.weightedRequests ?? '?'} req` : 'unknown')),
  );
  // Stage-4 / #63 item 3: a LIVE drive persists replayable bundle(s) — surface the path(s) so an
  // operator can find the `--replay` source. N=1 -> one flat bundle; N>1 -> one per-run bundle each.
  // Additive line only; no verdict impact.
  if (mode === 'live' && finalN === 1) L.push(`- **Persisted trace:** reports/${ts}/`);
  else if (mode === 'live' && finalN > 1) {
    const paths = Array.from({ length: finalN }, (_, i) => `\`reports/${ts}/run-${i + 1}/\``);
    L.push(`- **Persisted traces (per run):** ${paths.join(', ')}`);
  }
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

  // ## Gates — the deterministic responder's per-gate answer log (in call order). Each interactive
  // gate that fired and was answered is listed with the phase its answerMap entry mapped to; a
  // `fallback:true` row (an unmapped question answered by the choices[0] ?? 'yes' floor) is flagged
  // `responder-fallback` so a drifted / unmodeled gate prompt is visible, not silently absorbed.
  L.push('## Gates');
  L.push('');
  L.push('| Question | Answer given | Mapped phase | Source |');
  L.push('|----------|--------------|--------------|--------|');
  if (gateLog && gateLog.length) {
    for (const g of gateLog) {
      const phase = g.mappedPhase != null ? esc(g.mappedPhase) : '—';
      const source = g.fallback ? 'responder-fallback' : 'mapped';
      L.push(`| ${esc(g.question)} | ${esc(g.answer)} | ${phase} | ${source} |`);
    }
  } else {
    L.push('| _(none)_ | — | — | no interactive gate fired / answered this run |');
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

  renderCreditCost(L, usage, usageTotal);

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
  L.push('- **`gate_fired_at(phase-N)`** — an interactive `ask` gate fired on phase `N` — the extractor placed the `user_input.requested` question on its phase via the scenario `gateMap`. Promoted to *required* when `phase_completed(N)` is observed (a completed phase that dropped its mandatory exit gate is REGRESSED).');
  L.push('- **`gate_count(ask)=K`** — `K` interactive `ask` gates fired this run. REPORT-ONLY: a normalized head surfaced here and in the `## Gates` section, but never placed in any reference `required`/`optional` and never diffed (a variable `K` is not a regression).');
  L.push('- **`reached_terminal(completion)`** — the session reached idle/shutdown with no `session.error`.');
  L.push('');
  L.push(
    '_Set-equality over these tokens is the workflow-model conformance check; tool-arg values, event ordering, ' +
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

// --------------------------------------------------------------------------- AI-credit usage (pure)
/**
 * Extract AI-credit usage from a live session's typed event stream. PURE — no I/O, no SDK; fully
 * credit-free unit-testable over an inline events array. Reads the SDK's `session.shutdown` event,
 * whose `data.totalNanoAiu` is the session-wide accumulated NANO-AI-units (AIU = totalNanoAiu / 1e9)
 * and whose `data.modelMetrics` maps model -> { requests: { count?, cost? }, totalNanoAiu?, usage }.
 *
 * @param {Array<{type?:string,data?:object}>} events merged typed stream (onEvent recorder + getEvents)
 * @returns {{ aiu:number|null, nanoAiu:number|null, apiRequests:number|null, models:Object|null }}
 *   All-null when there is no `session.shutdown` event. `apiRequests` is null (unknown) when the
 *   shutdown carries no `modelMetrics` — never fabricated as 0.
 */
export function extractUsage(events) {
  const NONE = { aiu: null, nanoAiu: null, apiRequests: null, models: null };
  const list = Array.isArray(events) ? events : [];
  const shutdown = list.find((e) => e && e.type === 'session.shutdown');
  if (!shutdown) return NONE;

  const data = shutdown.data || {};
  const nanoAiu = data.totalNanoAiu != null ? data.totalNanoAiu : null;
  const metrics = data.modelMetrics && typeof data.modelMetrics === 'object' ? data.modelMetrics : null;

  // Total API requests = sum of per-model requests.count across every modelMetrics entry.
  let apiRequests = null;
  let models = null;
  if (metrics) {
    apiRequests = Object.values(metrics).reduce((s, m) => s + (m?.requests?.count || 0), 0);
    models = {};
    for (const [model, m] of Object.entries(metrics)) {
      const mNano = m?.totalNanoAiu != null ? m.totalNanoAiu : null;
      models[model] = { requests: m?.requests?.count || 0, aiu: mNano != null ? mNano / 1e9 : null };
    }
  }

  return {
    aiu: nanoAiu != null ? nanoAiu / 1e9 : null,
    nanoAiu,
    apiRequests,
    models,
  };
}

/**
 * Sum AI-credit usage across runs (the aggregate bill of a --runs=N session). PURE. A field stays
 * null iff NO input reported it, so "unknown" is never silently rendered as 0. Credit-free.
 *
 * @param {Array<{nanoAiu?:number|null, apiRequests?:number|null}|null|undefined>} usages
 * @returns {{ aiu:number|null, nanoAiu:number|null, apiRequests:number|null }}
 */
export function sumUsage(usages) {
  let anyAiu = false;
  let anyReq = false;
  let nanoAiu = 0;
  let apiRequests = 0;
  for (const u of Array.isArray(usages) ? usages : []) {
    if (!u) continue;
    if (u.nanoAiu != null) { nanoAiu += u.nanoAiu; anyAiu = true; }
    if (u.apiRequests != null) { apiRequests += u.apiRequests; anyReq = true; }
  }
  return {
    aiu: anyAiu ? nanoAiu / 1e9 : null,
    nanoAiu: anyAiu ? nanoAiu : null,
    apiRequests: anyReq ? apiRequests : null,
  };
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
// Per-run persist destination. N=1 keeps the flat reports/<ts>/ bundle (Stage-4 behavior, unchanged);
// N>1 nests each drive under reports/<ts>/run-<i>/ so the N drives never collide on one ts (#63 item 3
// extends persistence — Stage 4 was N=1-only). PURE (path math only) -> unit-testable.
export function persistDirFor(reportsDir, ts, runIndex, n) {
  return n === 1 ? path.join(reportsDir, ts) : path.join(reportsDir, ts, `run-${runIndex}`);
}

// Write a replayable trace bundle {events.json, rundir/, replay-meta.json} at `dest`. PURE fs side-effect
// (no SDK, no globals) so a synthetic N=2 persist is unit-testable without a live drive (#63 item 3).
// The caller owns best-effort framing (try/catch) — a persist failure must never break a live verdict.
export function persistTraceBundle(dest, { events, rundir, meta }) {
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'events.json'), JSON.stringify(events));
  fs.cpSync(rundir, path.join(dest, 'rundir'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'replay-meta.json'), JSON.stringify(meta, null, 2));
  return dest;
}

// persistDir: absolute destination for this run's replay bundle (null = do not persist). Decoupled from
// readCostHere so N>1 can persist every drive (#63 item 3) while STILL leaving per-run cost null (the
// aggregate is read once in runLive). readCostHere: read the per-run AIU cost here (N=1 only — the window
// is known; N>1 reads the whole-run window once in runLive).
export async function driveOnce(sdk, runtimePath, sc, opts, runIndex, persistDir = null, persistMeta = null, model = null, readCostHere = false) {
  const { CopilotClient, RuntimeConnection, approveAll } = sdk;
  const rundir = makeFreshRundir(sc); // throws a precondition (exit 2) if the template is missing
  const recorded = [];
  const gateLog = []; // per-run deterministic-responder log -> report `## Gates` section
  let sessionId = null; // #63 item 5: SDK session id (captured from the input-handler ctx, best-effort)
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
      // Stage-5 (M-1): thread the requested model DEFENSIVELY via a CONDITIONAL SPREAD so the key is
      // ABSENT (never `model: null`) when no model is requested. driveOnce's outer try (below) is
      // catch-less (only a `finally`), so a strict runtime-resolved SDK that rejects a null/unknown
      // `model` key would throw and turn EVERY live run INCOMPLETE — the default (null) MUST omit the
      // key entirely. Passed best-effort; NEVER asserted to take effect this stage (deferred paid confirm).
      ...(model != null ? { model } : {}),
      // LOAD-BEARING: onEvent is a SessionConfig FIELD so it registers BEFORE the create RPC.
      onEvent: (e) => { recorded.push(e); },
      // Gates FIRE and are ANSWERED (never suppressed via --no-ask-user; AC8) by the DETERMINISTIC
      // responder (scenario answerMap); each answered gate is logged for the report `## Gates` section.
      onUserInputRequest: (req, ctx) => {
        // #63 item 5: capture the SDK session id (best-effort, first non-null wins) so the N=1 readCost
        // can scope its SUM to THIS session (double-count avoidance). Absent (a run that fires no gate) →
        // sessionId stays null → readCost falls back to the window-only SUM (Stage-5 behavior).
        if (ctx?.sessionId != null && sessionId == null) sessionId = ctx.sessionId;
        const res = chooseAnswer(req, sc.answerMap);
        gateLog.push({
          question: req.question,
          answer: res.answer,
          mappedPhase: res.mappedPhase,
          matched: res.matched,
          fallback: res.fallback,
        });
        return { answer: res.answer, wasFreeform: res.wasFreeform };
      },
      // Permissions are approved uniformly across all scenarios. The destructive-guard's
      // hook_effect(destructive_guard=ask) is emitted by the extractor DIRECTLY from the live
      // permission.requested event (permissionRequest.kind==="hook" + the "Maister guard" hookMessage),
      // so no custom observing responder is needed.
      onPermissionRequest: approveAll,
      onExitPlanModeRequest: (req) => ({ approved: true, selectedAction: req.recommendedAction }),
    });

    // ADR-001 seam: COMPAT_PROMPT_FILE (set by run.sh ONLY for --mutation=M1) overrides sc.prompt so
    // the negative control measures the plugin contract, not prompt-following. Set-but-unreadable is
    // a HARD precondition (INCOMPLETE), never a silent fallback; env unset -> byte-identical default.
    let prompt = sc.prompt;
    if (process.env.COMPAT_PROMPT_FILE) {
      try { prompt = fs.readFileSync(process.env.COMPAT_PROMPT_FILE, 'utf8'); }
      catch (err) { throw preconditionError(`COMPAT_PROMPT_FILE is set but unreadable: ${process.env.COMPAT_PROMPT_FILE} — ${err.message}`); }
    }

    // Drive the scenario. sendAndWait THROWS on timeout (does not abort in-flight work) -> catch ->
    // abort() -> INCOMPLETE (exit 2, "no verdict"), never a false REGRESSED.
    // Stage-5: bracket the drive with an ISO cost window (new Date() is fine here — run.mjs, not a
    // Workflow-tool script). startIso is captured IMMEDIATELY before the drive; endIso immediately after
    // (or inside the timeout catch), so even a timed-out run bounds its own cost window.
    const startIso = new Date().toISOString();
    try {
      await session.sendAndWait(prompt, sc.timeoutMs);
    } catch (timeoutErr) {
      const endIso = new Date().toISOString();
      try { await session.abort(); } catch { /* best-effort */ }
      // A timed-out / aborted drive may STILL have spent credits — best-effort collect whatever events
      // we have (onEvent recorder + a post-abort getEvents attempt) and self-report any usage.
      let history = [];
      try { history = await session.getEvents(); } catch { history = []; }
      const usage = extractUsage(mergeEvents(recorded, history));
      const modelActual = modelActualFromUsage(usage);
      // M-3: a timed-out N=1 drive STILL spent a seat and its window is known, so its real cost is read
      // here too (NOT gated on a successful verdict). N>1 (readCostHere false) skips — runLive reads once.
      // #63 item 5: scope to this run's session (best-effort; null → window-only).
      const cost = readCostHere ? await readCost({ startIso, endIso, sessionId }) : null;
      return {
        status: 'incomplete',
        reason: `sendAndWait did not complete (timeout or session error): ${timeoutErr?.message ?? timeoutErr}`,
        run: runIndex,
        usage,
        gateLog,
        modelActual,
        startIso,
        endIso,
        cost,
      };
    }
    const endIso = new Date().toISOString();

    // Collect the full typed event stream (onEvent recorder + authoritative getEvents()).
    let history = [];
    try { history = await session.getEvents(); } catch { history = []; }
    const events = mergeEvents(recorded, history);
    const usage = extractUsage(events); // AI-credit cost from the session.shutdown event (may be all-null)
    const modelActual = modelActualFromUsage(usage); // Stage-5: actual model(s), 'unknown' when absent
    // Stage-5 (M-3): read the REAL cost over [startIso..endIso] for the N=1 case (window known here);
    // N>1 (readCostHere false) leaves cost null and runLive reads the whole-run window once. The read
    // is best-effort — a failure yields the `unavailable` sentinel, never throws.
    // #63 item 5: scope to this run's session (best-effort; null → window-only).
    const cost = readCostHere ? await readCost({ startIso, endIso, sessionId }) : null;
    // #63 item 5: prefer the session.shutdown-derived actual model; when it is 'unknown' (common on
    // 1.0.8x), fall back to the BILLING-record model(s) from GROUP BY model — a more reliable source.
    const modelActualResolved =
      modelActual && modelActual !== 'unknown' ? modelActual : (cost?.modelActual || modelActual);

    // Assemble the pipeline. taskDirRoot = rundir (contains .maister/tasks/<taskType>/*); the scenario's
    // taskType selects both the state subtree and the extractor's tree profile.
    const stateYaml = findStateYaml(rundir, sc.taskType);
    // Functional oracle (issue #48): run the scenario's `outcome` spec in the LIVE rundir (session shut
    // down, pre-`finally` rmSync). `sandboxTemplateDir` lets extractFromOutcome RESTAGE the trusted oracle
    // script over the model-touched rundir copy (MEDIUM-5) before running it.
    const ex = extract({
      events,
      taskDirRoot: rundir,
      stateYaml,
      taskType: sc.taskType,
      outcome: sc.outcome,
      sandboxTemplateDir: path.join(L2_DIR, 'sandbox', sc.sandboxTemplate),
      gateMap: sc.gateMap, // per-scenario gate->phase placement (gate_fired_at(phase-N)); default [] no-op
      precedesChain: sc.precedesChain, // Stage-4 ordering spine (adjacent precedes edges); default [] no-op
      minCounts: sc.minCounts, // Stage-4 fan-out counts (min_count expansions); default [] no-op
    });

    // Persist a replayable trace bundle (Stage 4; #63 item 3) — best-effort, NEVER breaks the live
    // verdict. Placed BEFORE the ex.incomplete early return below so INCOMPLETE runs (the ones a
    // maintainer most wants to diagnose/replay) also get a bundle. persistDir is the caller-chosen
    // destination: N=1 -> reports/<ts>/ (flat), N>1 -> reports/<ts>/run-<i>/ (per-run, collision-free).
    // Wrapped in try/catch; a persist failure logs to stderr and continues to the verdict.
    if (persistDir != null) {
      try {
        const meta = {
          scenario: sc.id,
          taskType: sc.taskType,
          copilotVersion: persistMeta?.copilotVersion ?? null,
          sdkPath: persistMeta?.sdkPath ?? null,
          ts: persistMeta?.ts ?? null,
          // #63 item 3: 1-based run index + N so an N>1 bundle self-identifies which drive it captured.
          runIndex: persistMeta?.runIndex ?? runIndex,
          runs: persistMeta?.runs ?? 1,
          originalMode: 'live',
          maisterVersion: persistMeta?.maisterVersion ?? null,
          // Stage-5: persist the requested + actual model and the run's real cost so a --replay renders
          // the SAME model/cost the live run showed (replay's res.usage is null — cost comes from meta).
          model: persistMeta?.model ?? null,
          modelActual: modelActualResolved ?? 'unknown',
          cost: cost ?? null,
          // hook_effect(destructive_guard=ask) is NOT persisted as a sink — it replays directly from
          // events.json (the persisted permission.requested carries kind:"hook" + the guard hookMessage),
          // so the extractor re-derives it on replay with no separate observed-decision channel.
        };
        const dest = persistTraceBundle(persistDir, { events, rundir, meta });
        process.stderr.write(`L2: persisted replay trace: ${dest}\n`);
      } catch (persistErr) {
        process.stderr.write(`L2: replay-trace persist failed (non-fatal): ${persistErr?.message ?? persistErr}\n`);
      }
    }

    // MEDIUM-2 sanity floor: empty phases while artifacts exist -> INCOMPLETE, never a silent
    // all-phases-missing REGRESSED.
    if (ex.incomplete) return { status: 'incomplete', reason: ex.incompleteReason, ex, run: runIndex, usage, gateLog, modelActual: modelActualResolved, startIso, endIso, cost };

    return { status: 'ok', observed: normalize(ex.records), ex, rundir, run: runIndex, usage, gateLog, modelActual: modelActualResolved, startIso, endIso, cost };
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
    } else {
      // Kept for diagnosis — surface the path (this fresh rundir is NOT run.sh's COMPAT_RUNDIR, so it
      // is otherwise unlogged and hard to find under os.tmpdir()).
      process.stderr.write(`L2: kept rundir (run ${runIndex}): ${rundir}\n`);
    }
  }
}

// FAIL-CLOSED credit-spend confirmation (B). A live L2 run drives a FULL maister development workflow
// on Copilot via the SDK and CONSUMES AI CREDITS. Returns true to PROCEED, false to ABORT (the caller
// returns EXIT.INCOMPLETE — exit 2, nothing spent). Three paths: explicit consent (--yes /
// COMPAT_L2_YES=1) -> proceed; interactive TTY -> y/N prompt (proceed only on 'y'/'yes'); non-TTY
// without consent -> REFUSE (protects background / CI runs from silently burning a quota).
async function confirmCreditSpend(opts, n, sc) {
  const shape = sc?.expectedShape || sc?.id || 'development';
  const warning =
    `⚠️  L2 live run: drives a FULL maister ${shape} workflow on Copilot via the SDK and ` +
    'CONSUMES AI CREDITS (many premium API requests — enough that ~1-2 runs can exhaust a monthly ' +
    `Copilot quota). N=${n} multiplies the cost by ${n}.`;

  // Explicit consent via flag or env -> proceed (non-interactive-safe).
  if (opts.yes || process.env.COMPAT_L2_YES === '1') {
    process.stdout.write(`${warning}\n(confirmed via --yes/COMPAT_L2_YES)\n`);
    return true;
  }

  // Interactive terminal -> prompt; proceed ONLY on an explicit y / yes.
  if (process.stdin.isTTY) {
    process.stdout.write(`${warning}\n`);
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => rl.question('Proceed and spend AI credits? [y/N] ', resolve));
    rl.close();
    const a = String(answer).trim().toLowerCase();
    if (a === 'y' || a === 'yes') return true;
    process.stdout.write('Aborted (no credits spent).\n');
    return false;
  }

  // Non-interactive with no consent -> FAIL CLOSED.
  process.stdout.write(
    `${warning}\n` +
    'Refusing to spend AI credits without confirmation in a non-interactive run. ' +
    'Pass --yes (or COMPAT_L2_YES=1) to proceed.\n',
  );
  return false;
}

async function runLive(opts) {
  const sc = getScenario(opts.scenario); // selected via --scenario (default development)
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
  const reference = loadReference(sc.id).reference;

  // FAIL-CLOSED credit-spend confirmation (B) — AFTER the reference precondition, BEFORE any SDK import
  // or driveOnce, so a refusal spends NOTHING. Credit-free paths (--check-reference, -h/--help) already
  // returned in main() and never reach here.
  if (!(await confirmCreditSpend(opts, N, sc))) return EXIT.INCOMPLETE;

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
  // #63 item 3: EVERY drive persists a replay bundle now — N=1 -> reports/<ts>/, N>1 -> reports/<ts>/
  // run-<i>/ (INCOMPLETE drives included; the persist is BEFORE the sanity-floor early return in
  // driveOnce). Per-run cost stays N=1-only (readCostHere): the N>1 aggregate is read once below, so an
  // N>1 bundle records cost:null (honest — per-run cost is not separately measured).
  // Stage-5: resolve the REQUESTED model ONCE (opts ?? COMPAT_L2_MODEL ?? scenario default), pass it
  // into every driveOnce, and persist it in each bundle's replay-meta.
  const model = resolveModel(opts, sc);
  const results = [];
  for (let i = 0; i < N; i++) {
    const runIndex = i + 1;
    const persistDir = persistDirFor(REPORTS_DIR, ts, runIndex, N);
    const persistMeta = { copilotVersion, sdkPath, maisterVersion, model, ts, runIndex, runs: N };
    results.push(await driveOnce(sdk, runtimePath, sc, opts, runIndex, persistDir, persistMeta, model, /* readCostHere */ N === 1));
  }

  // Stage-5 model/cost aggregate. N=1: the per-run readCost was done inside driveOnce (window known
  // there, incl. the timeout path). N>1: read ONCE over the whole-run window [first start .. last end]
  // (runWindow, SDK-free) and union the per-run actual models.
  let modelActual;
  let cost;
  if (N === 1) {
    cost = results[0].cost ?? null;
    modelActual = results[0].modelActual ?? 'unknown';
  } else {
    const { startIso, endIso } = runWindow(results);
    cost = await readCost({ startIso, endIso });
    modelActual = [...new Set(results.map((r) => r.modelActual).filter(Boolean))].sort().join('+') || 'unknown';
  }

  // Verdict + report are produced AFTER every run tore down its own client (no live handles held
  // during fs writes).
  const ctx = {
    reference, N, scenarioId: sc.id, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir: PLUGIN_DIR, pluginName: PLUGIN_NAME, sdkPath,
    model, modelActual, cost,
  };
  return N === 1 ? finalizeSingleRun(results[0], ctx) : finalizeMultiRun(results, ctx);
}

// --------------------------------------------------------------------------- replay (credit-free)
// Reproduce a verdict from a persisted reports/<ts>/ bundle WITHOUT importing the SDK (spends no
// credit — dispatched in main() before any import(sdkPath), exactly like --check-reference).
// Reconstructs the three extract() rundir inputs from the bundle and RE-RUNS the outcome oracle
// against the persisted rundir copy (restaging from the committed sandbox template), then reuses
// finalizeSingleRun (compare/report/exit-code) unchanged.
function runReplay(opts) {
  const dir = opts.replay;
  if (!isDir(dir)) throw preconditionError(`--replay directory not found: ${dir}`);
  const metaPath = path.join(dir, 'replay-meta.json');
  const eventsPath = path.join(dir, 'events.json');
  if (!isFile(metaPath)) throw preconditionError(`--replay bundle missing replay-meta.json: ${metaPath}`);
  if (!isFile(eventsPath)) throw preconditionError(`--replay bundle missing events.json: ${eventsPath}`);

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const sc = getScenario(meta.scenario); // resolves gateMap, precedesChain, minCounts, outcome, sandboxTemplate, taskType
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  const taskDirRoot = path.join(dir, 'rundir');
  const stateYaml = findStateYaml(taskDirRoot, sc.taskType);

  // IDENTICAL to driveOnce's extract() — same inputs, so the same normalized skeleton + verdict.
  // hook_effect(destructive_guard=ask) replays directly from events.json (the persisted kind:"hook"
  // permission.requested), so there is no separate observed-decision channel to thread here.
  const ex = extract({
    events,
    taskDirRoot,
    stateYaml,
    taskType: sc.taskType,
    outcome: sc.outcome,
    sandboxTemplateDir: path.join(L2_DIR, 'sandbox', sc.sandboxTemplate),
    gateMap: sc.gateMap,
    precedesChain: sc.precedesChain,
    minCounts: sc.minCounts,
  });

  // Build a driveOnce-shaped result so finalizeSingleRun consumes it unchanged.
  const res = ex.incomplete
    ? { status: 'incomplete', reason: ex.incompleteReason, ex, run: 1, usage: null, gateLog: [] }
    : { status: 'ok', observed: normalize(ex.records), ex, rundir: taskDirRoot, run: 1, usage: null, gateLog: [] };

  // Credit-free ctx (loadReference / readRepoMaisterVersion / osString only — NO SDK).
  const reference = loadReference(sc.id).reference;
  // ts for the replay report: a flat reports/<ts>/ bundle carries the ts in its basename; a per-run
  // reports/<ts>/run-<i>/ bundle (#63 item 3) does not, so fall back to the persisted meta.ts, then a
  // fresh stamp.
  const dirName = path.basename(dir);
  const ts = /^\d{8}T\d{6}Z$/.test(dirName) ? dirName : (meta.ts ?? utcStamp());
  const ctx = {
    reference, N: 1, scenarioId: sc.id,
    copilotVersion: meta.copilotVersion ?? 'replayed',
    maisterVersion: meta.maisterVersion ?? readRepoMaisterVersion(),
    osStr: osString(), ts,
    isolationNote: `replayed from ${dir}`,
    pluginDir: PLUGIN_DIR, pluginName: PLUGIN_NAME,
    sdkPath: meta.sdkPath ?? 'replayed',
    mode: 'replayed', replaySource: dir,
    // Stage-5: replay sources model/cost from the PERSISTED meta (res.usage is null on replay — a live
    // readCost is never issued on this credit-free path), so the report shows the recorded figures.
    model: meta.model ?? 'replayed',
    modelActual: meta.modelActual ?? 'unknown',
    cost: meta.cost ?? null,
  };
  return finalizeSingleRun(res, ctx);
}

// N=1 finalizer — CURRENT behavior, preserved exactly: timeout / MEDIUM-2 sanity floor / widened-F3
// floor / normal compare, each writing the same report + stdout line + exit code as before, now over
// the single collected driveOnce result. finalN is always 1.
export function finalizeSingleRun(res, ctx) {
  const {
    reference, scenarioId, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, sdkPath,
  } = ctx;
  const base = {
    scenarioId, mode: ctx.mode ?? 'live', reference, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, finalN: 1, sdkPath, replaySource: ctx.replaySource ?? null,
    usage: res.usage ?? null, gateLog: res.gateLog ?? [],
    // Stage-5: model/actual/cost threaded from ctx into EVERY branch's report + stdout via the shared
    // base — so an INCOMPLETE (timeout / sanity-floor) run renders its real cost too (M-3), no per-branch change.
    model: ctx.model ?? null, modelActual: ctx.modelActual ?? 'unknown', cost: ctx.cost ?? null,
  };
  // Stage-5: the model + session-store.db cost segment appended after usageSuffix on every stdout line.
  const costSuffix = costModelSuffix({ model: base.model, modelActual: base.modelActual, cost: base.cost });
  const INCOMPLETE_COUNTS = { pass: 0, limitation: 0, skip: 0, fail: 0 };

  // Timeout / session error (driveOnce already abort()'d; no ex) — "no verdict".
  if (res.status === 'incomplete' && !res.ex) {
    const rp = writeReport(buildReport({
      ...base, overall: 'INCOMPLETE', counts: INCOMPLETE_COUNTS,
      observed: null, result: null, incompleteReason: res.reason, parseWarnings: [],
    }), ts);
    process.stdout.write(`\nL2: INCOMPLETE (no verdict) — ${res.reason}${usageSuffix(res.usage)}${costSuffix}\nReport: ${rp}\n`);
    return EXIT.INCOMPLETE;
  }

  // MEDIUM-2 sanity floor (ex.incomplete): empty phases while artifacts exist.
  if (res.status === 'incomplete' && res.ex) {
    const rp = writeReport(buildReport({
      ...base, overall: 'INCOMPLETE', counts: INCOMPLETE_COUNTS,
      observed: normalize(res.ex.records), result: null,
      incompleteReason: res.reason, parseWarnings: res.ex.parseWarnings,
    }), ts);
    process.stdout.write(`\nL2: INCOMPLETE (sanity floor) — ${res.reason}${usageSuffix(res.usage)}${costSuffix}\nReport: ${rp}\n`);
    return EXIT.INCOMPLETE;
  }

  // status 'ok' — normalize -> compare vs the committed reference.
  const { observed, ex } = res;
  const result = compare(observed, reference);

  // WIDENED + WITNESS-AWARE SANITY FLOOR (F3, Stage 4): refuse a REGRESSED that is SOLELY missing
  // state-sourced predicates (phase_completed / task_characteristic / task_status) WHILE the state
  // parser emitted warnings AND artifacts exist — that pattern is a partial state-parse miss, not a
  // real regression, so it becomes INCOMPLETE (no verdict), never a false REGRESSED.
  //
  // Stage-4 narrowing: a missing `phase_completed(N)` that carries a WITNESS relation in the reference
  // rules (a `delegated(…)`/`created_artifact(…)`/`invoked_skill(…)` require) is downgrade-eligible
  // ONLY when >=1 of those witnesses is actually present in `observed` (the phase demonstrably ran; the
  // state parser just failed to record it). If ALL witnesses are also absent, the phase is genuinely
  // un-witnessed and STAYS REGRESSED. A phase with no witness relation, and task_characteristic /
  // task_status, remain state-only and eligible as before. Non-state-sourced misses and any `extra`
  // are never eligible (Stage-1 M1 + Stage-2 failing-outcome negative controls stay REGRESSED).
  const STATE_SOURCED = /^(phase_completed|task_characteristic|task_status)\(/;
  const rules = Array.isArray(reference?.rules) ? reference.rules : [];
  const candidateRegressions = result.diffs.filter((d) => d.classification === 'CANDIDATE_REGRESSION');
  const isDowngradeEligible = (d) => {
    if (d.side !== 'missing') return false;              // extras never downgrade (Stage-1 M1 stays REGRESSED)
    if (!STATE_SOURCED.test(d.predicate)) return false; // non-state-sourced miss stays REGRESSED (M1; Stage-2 outcome)
    const m = /^phase_completed\((\d+)\)$/.exec(d.predicate);
    if (m) {
      const witnesses = witnessTokensForPhase(rules, m[1]);
      if (witnesses.length > 0) {
        // WITNESSED phase: eligible (state-parse noise) ONLY if >=1 witness is present in observed.
        // All witnesses absent => phase genuinely un-witnessed => NOT eligible => stays REGRESSED.
        return witnesses.some((w) => observed.has(w));
      }
      return true; // phase with NO witness relation => state-only, eligible as before
    }
    return true;   // task_characteristic / task_status => state-only, eligible
  };
  const allDowngradeEligible =
    candidateRegressions.length > 0 && candidateRegressions.every(isDowngradeEligible);
  const artifactsExist = [...observed].some((t) => t.startsWith('created_artifact('));
  if (result.overall === 'REGRESSED' && allDowngradeEligible && ex.parseWarnings.length > 0 && artifactsExist) {
    const reason =
      'Verdict would be REGRESSED but every candidate regression is a MISSING state-sourced predicate ' +
      '(phase_completed / task_characteristic / task_status) while the state parser emitted warnings and ' +
      'task-tree artifacts exist — treat as a partial state-parse miss (INCOMPLETE), never a false REGRESSED.';
    const rp = writeReport(buildReport({
      ...base, overall: 'INCOMPLETE', counts: INCOMPLETE_COUNTS,
      observed, result, incompleteReason: reason, parseWarnings: ex.parseWarnings,
    }), ts);
    process.stdout.write(`\nL2: INCOMPLETE (widened sanity floor) — ${reason}${usageSuffix(res.usage)}${costSuffix}\nReport: ${rp}\n`);
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
    `${counts.fail} FAIL${usageSuffix(res.usage)}${costSuffix}\nReport: ${rp}\n`,
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

  // AI-credit cost across ALL attempted runs — an INCOMPLETE drive still spends credits, so every
  // attempted run (not just the verdict-eligible ones) is billed here. No silent omission.
  const usageTotal = {
    ...sumUsage(results.map((r) => r.usage)),
    n: N,
    perRun: results.map((r) => ({ run: r.run, status: r.status, usage: r.usage ?? null })),
  };

  const base = {
    scenarioId, mode: 'live', reference, copilotVersion, maisterVersion, osStr, ts, isolationNote,
    pluginDir, pluginName, finalN: N, sdkPath, usageTotal,
    // Stage-5: the whole-run model/cost aggregate (from runLive's ctx) threaded into the N>1 report + stdout.
    model: ctx.model ?? null, modelActual: ctx.modelActual ?? 'unknown', cost: ctx.cost ?? null,
  };
  const costSuffix = costModelSuffix({ model: base.model, modelActual: base.modelActual, cost: base.cost });

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
    process.stdout.write(`\nL2: INCOMPLETE (N=${N}) — ${reason}${usageSuffix(usageTotal)}${costSuffix}\n${perRunStdout}\nReport: ${rp}\n`);
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
    usageSuffix(usageTotal) + costSuffix +
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

  if (opts.scenarioError != null) {
    process.stderr.write(`invalid --scenario: ${opts.scenarioError} (available: ${Object.keys(SCENARIOS).join(', ')})\n`);
    printUsage(process.stderr);
    return EXIT.INCOMPLETE; // bad args -> exit 2
  }

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
  if (opts.checkReference) return runCheckReference(opts.scenario);

  // --replay RETURNS BEFORE ANY SDK IMPORT (credit-free, Stage 4) — reproduces a verdict from a
  // persisted reports/<ts>/ bundle. MUST stay above runLive so no import(sdkPath) is reached.
  if (opts.replay) return runReplay(opts);

  // Live conformance drive (the seat-consuming path; Group 10 exercises it).
  return runLive(opts);
}

// Run main() only when invoked directly (`node run.mjs …`); importing this module is side-effect-free.
// Symlink-robust: `path.resolve()` does NOT resolve symlinks, but Node derives import.meta.url from
// the file's REALPATH, so on a symlinked invocation path (macOS `/tmp` -> `/private/tmp`, or any
// symlinked checkout) a naive `===` is a FALSE negative — main() silently never runs and the process
// exits 0 with no verdict (a fail-open false-green; observed when run.sh passes an absolute /tmp path
// to node). Compare realpaths on both sides, falling back to the naive compare only if realpath fails.
const modulePath = fileURLToPath(import.meta.url);
const sameFile = (a, b) => {
  try { return fs.realpathSync(a) === fs.realpathSync(b); }
  catch { return path.resolve(a) === path.resolve(b); }
};
const isMain = !!process.argv[1] && sameFile(process.argv[1], modulePath);
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
