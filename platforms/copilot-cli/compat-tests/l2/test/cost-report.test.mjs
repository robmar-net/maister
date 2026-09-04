// Credit-free checks for `l2/tools/cost-report.mjs` (issue #122, G4 / spec R7 + R9).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/cost-report.test.mjs
//
// What it proves: the bundle-first cost report reproduces the R7 verified identities on a REAL event
// stream, joins subagents to their usage, applies the null-never-0 discipline, recovers a plugin dir
// from `skill.invoked.data.path`, prints the SAME verdict `--replay` lands (via the shared
// `extractFromBundle` + `deriveVerdict` exports of run.mjs) WITHOUT writing a report, emits deterministic
// `--json`, and honours the process contract (no args -> exit 2, unreadable events.json -> exit 2, never
// writes into the bundle dir).
//
// CREDIT-FREE: the tool only reads events.json / replay-meta.json; `--verdict` re-runs the outcome oracle
// on the persisted rundir copy and never imports the SDK (the staged research bundle carries a bogus
// sdkPath, exactly as replay.test.mjs does). No seat, no session.
//
// FIXTURE PROVENANCE: `test/fixtures/cost-report/{events.sample.json, replay-meta.sample.json}` are the
// REAL Copilot CLI 1.0.82 events of bundle `reports/20260903T000910Z` (scenario development,
// gpt-5.6-luna + gpt-5.4-mini) filtered to the 11 event types cost-report consumes and redacted (usage
// ids/quota stripped; skill content -> first 80 chars + contentBytes; R9 AMENDMENT (fix pass): hook.start
// data reduced to { hookType } (fix pass 2; hookFires reads nothing else), tool.execution_start arguments reduced
// to { path }, subagent.completed dropped — none of them is read by any metric) by the committed generator
// `test/fixtures/cost-report/gen-fixture.mjs`. Only the generator ever reads `reports/`; this file never
// does (audit #9). The `--verdict` case stages the committed research fixture (test/fixtures/research)
// under a 2099-series ts in a mkdtemp dir so no operator report is ever overwritten.
//
// Zero-dependency: node: builtins only. Self-cleaning: mkdtemp trees + the `--replay` side-effect report
// are removed in `finally`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { computeMetrics, renderMarkdown } from '../tools/cost-report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const TOOL = path.join(L2_DIR, 'tools', 'cost-report.mjs');
const RUN_MJS = path.join(L2_DIR, 'run.mjs');
const REPORTS_DIR = path.resolve(L2_DIR, '..', 'reports');
const FIX = path.join(__dirname, 'fixtures', 'cost-report');
const RESEARCH_FIX = path.join(__dirname, 'fixtures', 'research');

const EVENTS = JSON.parse(fs.readFileSync(path.join(FIX, 'events.sample.json'), 'utf8'));
const META = JSON.parse(fs.readFileSync(path.join(FIX, 'replay-meta.sample.json'), 'utf8'));
const FIXTURE_TS = '20260903T000910Z';
const PLUGIN_DIR_IN_FIXTURE = '/Users/robmar/Projects/Maister/maister/plugins/maister-copilot';

const near = (a, b, eps, msg) => assert.ok(typeof a === 'number' && Math.abs(a - b) <= eps, `${msg}: got ${a}, expected ${b} ± ${eps}`);

function runTool(args, opts = {}) {
  const res = spawnSync(process.execPath, [TOOL, ...args], { cwd: L2_DIR, encoding: 'utf8', env: { ...process.env }, ...opts });
  assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// Stage the committed cost-report fixture as a live-shaped bundle <root>/<ts>/{events.json, replay-meta.json}.
// `ts` is a 2099-series stamp by default so nothing can collide with an operator bundle/report.
function stageFixtureBundle(root, ts = '20990601T000000Z') {
  const dir = path.join(root, ts);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'events.sample.json'), path.join(dir, 'events.json'));
  fs.copyFileSync(path.join(FIX, 'replay-meta.sample.json'), path.join(dir, 'replay-meta.json'));
  return dir;
}

// Stage the research fixture exactly as replay.test.mjs does (real report so the RE-RUN oracle passes;
// bogus sdkPath so an SDK import would throw — the credit-free proof).
function stageResearchBundle(root, ts) {
  const GOOD_REPORT = [
    '# Research Report: cost-report --verdict / --replay agreement',
    '',
    '## Findings',
    'cost-report --verdict imports extractFromBundle + deriveVerdict from run.mjs, so the verdict it',
    'prints is derived by the same single authority finalizeSingleRun uses for --replay; it differs only',
    'in that it writes no report file and prints a one-line summary with the reference hash.',
    'The sample CLI implements `frobnicate` but leaves it unreachable from the dispatcher (dead code).',
    '',
    '## Conclusion',
    'One verdict function, two surfaces, identical counts; --verdict is side-effect free.',
    '',
  ].join('\n');
  const bundleDir = path.join(root, ts);
  const taskDir = path.join(bundleDir, 'rundir', '.maister', 'tasks', 'research', '2026-09-03-l2-cost-report-verdict');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.copyFileSync(path.join(RESEARCH_FIX, 'events.sample.json'), path.join(bundleDir, 'events.json'));
  fs.cpSync(path.join(RESEARCH_FIX, 'task-tree'), taskDir, { recursive: true });
  fs.copyFileSync(path.join(RESEARCH_FIX, 'orchestrator-state.sample.yml'), path.join(taskDir, 'orchestrator-state.yml'));
  fs.writeFileSync(path.join(taskDir, 'outputs', 'research-report.md'), GOOD_REPORT);
  fs.writeFileSync(path.join(bundleDir, 'replay-meta.json'), JSON.stringify({
    scenario: 'research', taskType: 'research', copilotVersion: '1.0.81',
    sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs',
    ts, originalMode: 'live', maisterVersion: '0.0.0',
  }, null, 2));
  return bundleDir;
}

// Recursive { relpath: mtimeMs } snapshot — the "never writes into the bundle" witness.
function snapshotTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, ent.name);
      out[path.relative(dir, p)] = fs.statSync(p).mtimeMs;
      if (ent.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

const metricsOfFixture = (extra = {}) => computeMetrics({ events: EVENTS, meta: META, dir: path.join(os.tmpdir(), FIXTURE_TS), ...extra });

test('identities: aiu.total 36.99498 = meta.cost.aiu = checkpoint; class split; weightedRequests 151.94; 164 usage events (luna 146, mini 18)', () => {
  const m = metricsOfFixture();
  near(m.aiu.total, 36.99498, 1e-9, 'aiu.total from Σ copilotUsage.totalNanoAiu / 1e9');
  assert.equal(m.aiu.total, META.cost.aiu, 'aiu.total equals the recorded meta.cost.aiu (session-store.db)');
  near(m.crossCheck.aiuVsMeta, 0, 1e-9, 'crossCheck aiu vs meta.cost.aiu is Δ 0');
  near(m.crossCheck.aiuVsCheckpoint, 0, 1e-9, 'crossCheck aiu vs session.usage_checkpoint is Δ 0');
  near(m.aiu.byClass.input, 4.066585, 1e-6, 'byClass input');
  near(m.aiu.byClass.cache_read, 11.82771, 1e-6, 'byClass cache_read');
  near(m.aiu.byClass.cache_write, 10.562225, 1e-6, 'byClass cache_write');
  near(m.aiu.byClass.output, 10.53846, 1e-6, 'byClass output');
  const sum = m.aiu.byClass.input + m.aiu.byClass.cache_read + m.aiu.byClass.cache_write + m.aiu.byClass.output;
  near(sum, m.aiu.total, 1e-6, 'Σ byClass = total ± 1e-6 (tokenDetails price the whole totalNanoAiu)');
  assert.deepEqual(Object.keys(m.aiu.byClass), ['input', 'cache_read', 'cache_write', 'output'], 'class order pinned');
  for (const c of Object.keys(m.tokens.byClass)) assert.ok(Number.isInteger(m.tokens.byClass[c]) && m.tokens.byClass[c] > 0, `tokens.byClass.${c} is a positive integer`);
  near(m.weightedRequests, 151.94, 1e-9, 'weightedRequests = Σ assistant.usage.data.cost');
  assert.equal(m.weightedRequests, META.cost.weightedRequests, 'weightedRequests equals meta.cost.weightedRequests');
  near(m.crossCheck.weightedVsMeta, 0, 1e-9, 'crossCheck weighted vs meta is Δ 0');
  assert.equal(m.usageEvents, 164, '164 assistant.usage events');
  assert.equal(m.aiu.byModel['gpt-5.6-luna'].calls, 146, 'luna served 146 usage events');
  assert.equal(m.aiu.byModel['gpt-5.4-mini'].calls, 18, 'mini served 18 usage events');
  near(m.aiu.byModel['gpt-5.6-luna'].aiu + m.aiu.byModel['gpt-5.4-mini'].aiu, m.aiu.total, 1e-9, 'Σ byModel = total');
  near(m.aiu.byModel['gpt-5.6-luna'].aiu, 28.587435, 1e-6, 'luna AIU equals the recorded per-model figure');
});

test('joins + main-only initials: 19 subagents, both joins fully matched; systemTokensInitial 23186; toolDefinitionTokens 8403 / distinct / availableToolCount', () => {
  const m = metricsOfFixture();
  assert.equal(m.subagents.count, 19, '19 subagent.started');
  assert.deepEqual(m.joins.unmatchedAgentIds, [], 'every usage agentId joins a subagent.started');
  assert.deepEqual(m.joins.unmatchedParentToolCallIds, [], 'every usage parentToolCallId joins a subagent.started toolCallId');
  assert.equal(m.joins.subagentUsageEvents, 115, '115 usage events carry an agentId (the rest are main)');
  assert.equal(m.aiu.byAgent.main.calls, 49, 'main = usage events without agentId');
  const agentSum = Object.values(m.aiu.byAgent).reduce((s, a) => s + a.aiu, 0);
  near(agentSum, m.aiu.total, 1e-9, 'Σ byAgent = total');
  assert.deepEqual(m.aiu.byAgent.explore.models, ['gpt-5.4-mini'], 'explore agents ran on mini');
  // audit W3 / #6: the isInitial event WITHOUT agentId (main) — 19 more isInitial events belong to subagents.
  assert.equal(m.systemTokensInitial, 23186, 'systemTokensInitial from the main isInitial usage_info');
  assert.equal(m.toolDefinitionTokens.initial, 8403, 'toolDefinitionTokens.initial from the same event');
  // 19 subagent sessions share 12 agent names (four `explore`s, ...): a repeated name holds an ARRAY in event order.
  const flat = (obj) => Object.values(obj).flatMap((v) => (Array.isArray(v) ? v : [v]));
  assert.equal(flat(m.systemTokensInitialByAgent).length, 19, 'one initial systemTokens per joined subagent session (19 over 12 names)');
  assert.equal(flat(m.toolDefinitionTokens.initialByAgent).length, 19, 'one initial toolDefinitionsTokens per joined subagent session');
  assert.deepEqual(m.systemTokensInitialByAgent.explore, [1859, 1859, 1859], 'three explore sessions -> a 3-entry array, never last-wins');
  assert.ok(!('main' in m.systemTokensInitialByAgent), 'main is not in the per-agent map (it is systemTokensInitial)');
  assert.deepEqual(m.toolDefinitionTokens.distinct, [2847, 8403, 8506, 8723], 'distinct toolDefinitionsTokens, sorted');
  assert.deepEqual(m.toolDefinitionTokens.availableToolCountDistinct, [11, 46, 47], 'distinct availableToolCount, sorted');
  assert.deepEqual(m.toolDefinitionTokens.byAgent.explore, [2847], 'explore agents saw the 11-tool definition set');
  assert.deepEqual(m.subagents.reasoningEfforts, ['low'], 'subagent.configured reasoningEffort distinct (joined on agentId only, audit I12)');
  assert.deepEqual(m.subagents.byModel, { 'gpt-5.4-mini': 3, 'gpt-5.6-luna': 16 }, 'three mini (explore) + sixteen luna subagents');
  assert.equal(m.subagents.byName.explore, 3, 'three explore subagents');
});

test('covariates: skill bytes 14/229382 (9 subagent / 5 main); reads 134/6; cacheBreaks; hookFires; gates 16; wallMinutes 8.46; servedModels; prices ok', () => {
  const m = metricsOfFixture();
  assert.equal(m.skillBytesInjected.count, 14, '14 skill.invoked');
  assert.equal(m.skillBytesInjected.totalBytes, 229382, 'Σ contentBytes (redacted fixture) = 229382');
  const byInvoker = m.skillBytesInjected.byInvoker;
  assert.equal(byInvoker.main.count, 5, '5 invoked by main');
  assert.equal(Object.entries(byInvoker).filter(([k]) => k !== 'main').reduce((s, [, v]) => s + v.count, 0), 9, '9 invoked by subagents');
  assert.equal(m.skillBytesInjected.bySkill.development.count, 3, 'development invoked three times');
  assert.equal(m.skillBytesInjected.bySkill.development.bytes, 3 * 52698, 'development bytes = 3 × 52698');
  assert.equal(m.reads.viewTotal, 134, '134 view tool.execution_start');
  assert.equal(m.reads.dashboardOrStyleGuide, 6, '6 reads of dashboard.html / dashboard-data.js / html-report-style.md');
  assert.equal(m.reads.pluginTree, 8, '8 views under the legacy-map plugin dir (prefix from provenance)');
  assert.deepEqual(m.cacheBreaks, { count: 1, reasons: ['unknown'] }, 'one prompt_cache_break, reason unknown');
  assert.deepEqual(m.hookFires, { preToolUse: 144, sessionStart: 1 }, 'hookFires by hookType (sorted keys)');
  assert.equal(m.gates.total, 16, '16 user_input.requested');
  assert.deepEqual(m.gates, { total: 16, mapped: 1, fallback: 15 }, 'development answerMap via chooseAnswer: 1 mapped, 15 responder-fallback');
  assert.equal(m.wallMinutes, 8.46, 'wallMinutes = (last − first timestamp) / 60000, 2 dp');
  assert.equal(m.servedModels.main, 'gpt-5.6-luna', 'servedModels.main from the startup model_change (shared run.mjs export)');
  assert.equal(m.servedModels.explore, 'gpt-5.4-mini', 'servedModels.explore');
  assert.equal(m.prices.check['gpt-5.6-luna'], 'ok', 'luna observed rates match KNOWN_RATES');
  assert.equal(m.prices.check['gpt-5.4-mini'], 'ok', 'mini observed rates match KNOWN_RATES');
  assert.deepEqual(m.prices.observed['gpt-5.6-luna'], { input: [20], cache_read: [2], cache_write: [25], output: [120] }, 'luna AIU per 1M tokens per class');
  assert.equal(m.provenance.legacyArm, 'fork-legacy', 'legacy-map row for the fixture ts');
  assert.equal(m.provenance.metaSchema, null, 'pre-provenance meta -> metaSchema null');
  assert.equal(m.provenance.pluginDir, PLUGIN_DIR_IN_FIXTURE, 'pluginDir recovered from the legacy map');
  const md = renderMarkdown(m);
  assert.match(md, /aiu\.total.*36\.99498/, 'markdown carries the total');
  assert.match(md, /matches \(Δ 0\.000000\)/, 'crossCheck renders matches (Δ 0.000000)');
  assert.ok(!md.includes('undefined'), 'markdown never renders undefined');
});

test('--recover: synthetic no-skill bundle -> { pluginDir:null, reason:"no path-bearing event" }; fixture -> dir from skill.invoked.data.path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-cost-report-recover-'));
  try {
    // Synthetic bundle: one usage event, no skill.invoked (a destructive-guard-shaped drive).
    const noSkill = path.join(root, '20990602T000000Z');
    fs.mkdirSync(noSkill);
    fs.writeFileSync(path.join(noSkill, 'events.json'), JSON.stringify([
      { type: 'session.model_change', data: { source: 'startup', newModel: 'gpt-5.6-luna' }, timestamp: '2099-06-02T00:00:00.000Z' },
      EVENTS.find((e) => e.type === 'assistant.usage'),
    ]));
    fs.writeFileSync(path.join(noSkill, 'replay-meta.json'), JSON.stringify({ scenario: 'destructive-guard', ts: '20990602T000000Z' }));
    const r = runTool([noSkill, '--recover', '--json']);
    assert.equal(r.status, 0, `--recover --json exits 0\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.recovered, { pluginDir: null, reason: 'no path-bearing event' }, 'no skill.invoked -> null + reason');
    assert.equal(j.provenance.legacyArm, null, 'a 2099 ts is not in the legacy map');
    // Without --recover the key is absent entirely (never a null placeholder).
    const plain = JSON.parse(runTool([noSkill, '--json']).stdout);
    assert.ok(!('recovered' in plain), 'recovered only present with --recover');

    // The fixture: prefix before /skills/ of the first path-bearing skill.invoked.
    const m = metricsOfFixture({ recover: true });
    assert.deepEqual(m.recovered, { pluginDir: PLUGIN_DIR_IN_FIXTURE, reason: 'skill.invoked.data.path' }, 'recovered from skill.invoked.data.path');
    const md = renderMarkdown(m);
    assert.match(md, /recovered plugin dir.*maister-copilot/, 'markdown renders the recovered dir');
    // A /commands/ path recovers the same tree (both trees live under the plugin dir).
    const cmdOnly = EVENTS.filter((e) => e.type !== 'skill.invoked' || /\/commands\//.test(e.data.path));
    assert.ok(cmdOnly.some((e) => e.type === 'skill.invoked'), 'guard: the fixture has a /commands/ skill.invoked');
    assert.equal(computeMetrics({ events: cmdOnly, meta: META, dir: noSkill, recover: true }).recovered.pluginDir, PLUGIN_DIR_IN_FIXTURE, 'commands/ prefix recovers the plugin dir too');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--verdict on the research fixture: exit 0, one "verdict: AS-EXPECTED" line, counts equal to --replay, and no report file written', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-cost-report-verdict-'));
  const ts = '20990603T000000Z';
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const bundleDir = stageResearchBundle(root, ts);
    assert.ok(!fs.existsSync(reportPath), 'guard: no stale report for the 2099 ts');
    const before = snapshotTree(bundleDir);

    const v = runTool([bundleDir, '--verdict']);
    assert.equal(v.status, 0, `--verdict exits with the verdict code (AS-EXPECTED = 0)\n${v.stdout}${v.stderr}`);
    const lines = v.stdout.split('\n').filter((l) => l.startsWith('verdict: '));
    assert.equal(lines.length, 1, `exactly one verdict line\n${v.stdout}`);
    const m = /^verdict: (AS-EXPECTED|REGRESSED|INCOMPLETE) PASS (\d+) · LIMITATION (\d+) · SKIP (\d+) · FAIL (\d+) \(scenario ([a-z-]+), reference ([0-9a-f]{8})\)$/.exec(lines[0]);
    assert.ok(m, `verdict line matches the R7 format: ${lines[0]}`);
    assert.equal(m[1], 'AS-EXPECTED', 'the research fixture is the conformant oracle');
    assert.equal(m[6], 'research', 'scenario id from meta.scenario');
    assert.ok(!fs.existsSync(reportPath), '--verdict writes no reports/l2-trace-equivalence-<ts>.md');
    // --verdict re-runs the outcome oracle in the persisted rundir (restage of trusted files, as --replay
    // does) but must not create anything: same listing.
    assert.deepEqual(Object.keys(snapshotTree(bundleDir)), Object.keys(before), '--verdict adds no file to the bundle');

    // The oracle: a --replay of the SAME bundle (writes the report; removed in finally).
    const r = spawnSync(process.execPath, [RUN_MJS, `--replay=${bundleDir}`], { cwd: L2_DIR, encoding: 'utf8', env: { ...process.env } });
    const line = /L2: (AS-EXPECTED|REGRESSED) — (\d+) PASS · (\d+) LIMITATION · (\d+) FAIL/.exec(r.stdout ?? '');
    assert.ok(line, `--replay prints a counted verdict line\n${r.stdout}${r.stderr}`);
    assert.equal(m[1], line[1], 'same overall as --replay');
    assert.equal(Number(m[2]), Number(line[2]), 'same PASS count as --replay');
    assert.equal(Number(m[3]), Number(line[3]), 'same LIMITATION count as --replay');
    assert.equal(Number(m[4]), 0, 'SKIP is 0 on the N=1 vocabulary');
    assert.equal(Number(m[5]), Number(line[4]), 'same FAIL count as --replay');
    assert.equal(v.status, r.status, 'same exit code as --replay');
    assert.ok(fs.existsSync(reportPath), 'guard: --replay DID write its report (so the absence above is --verdict\'s doing)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

test('--json is deterministic (two runs byte-identical, stable key order) and combinable with --verdict', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-cost-report-json-'));
  const ts = '20990604T000000Z';
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const dir = stageFixtureBundle(root);
    const a = runTool([dir, '--json']);
    const b = runTool([dir, '--json']);
    assert.equal(a.status, 0, `--json exits 0\n${a.stderr}`);
    assert.equal(a.stdout, b.stdout, 'two runs are byte-identical');
    const j = JSON.parse(a.stdout);
    assert.deepEqual(Object.keys(j).slice(0, 4), ['bundle', 'aiu', 'tokens', 'usageEvents'], 'top-level key order is pinned');
    assert.equal(j.aiu.total, 36.99498, 'JSON carries the identities');
    assert.deepEqual(Object.keys(j.hookFires), ['preToolUse', 'sessionStart'], 'map keys sorted');
    assert.ok(!('verdict' in j), 'no verdict object without --verdict');

    const research = stageResearchBundle(root, ts);
    const v = runTool([research, '--json', '--verdict']);
    assert.equal(v.status, 0, `--json --verdict exits with the verdict code\n${v.stderr}`);
    const jv = JSON.parse(v.stdout);
    assert.equal(jv.verdict.overall, 'AS-EXPECTED', 'verdict object present');
    assert.deepEqual(Object.keys(jv.verdict.counts), ['pass', 'limitation', 'skip', 'fail'], 'count vocabulary');
    assert.equal(jv.verdict.scenario, 'research', 'scenario in the verdict object');
    assert.match(jv.verdict.referenceHash, /^[0-9a-f]{64}$/, 'full reference hash in JSON');
    assert.equal(jv.aiu.total, null, 'the research fixture carries no copilotUsage -> null, never 0');
    assert.ok(!fs.existsSync(reportPath), '--json --verdict writes no report either');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

test('process contract: no args -> exit 2 + usage on stderr; unreadable events.json -> exit 2; never writes into the bundle dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-cost-report-proc-'));
  try {
    const none = runTool([]);
    assert.equal(none.status, 2, 'no args -> exit 2');
    assert.match(none.stderr, /usage: .*cost-report\.mjs <bundle-dir> \[--json\] \[--recover\] \[--verdict\]/, 'usage on stderr');
    assert.equal(none.stdout, '', 'nothing on stdout');

    const bad = path.join(root, 'bad');
    fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, 'events.json'), '{ not json');
    const b = runTool([bad]);
    assert.equal(b.status, 2, 'unreadable events.json -> exit 2');
    assert.match(b.stderr, /events\.json/, 'error names events.json');
    const missing = runTool([path.join(root, 'nope')]);
    assert.equal(missing.status, 2, 'missing bundle dir -> exit 2');

    const dir = stageFixtureBundle(root);
    const before = snapshotTree(dir);
    for (const args of [[dir], [dir, '--json'], [dir, '--recover'], [dir, '--json', '--recover']]) {
      const r = runTool(args);
      assert.equal(r.status, 0, `${args.slice(1).join(' ') || 'markdown'} exits 0\n${r.stderr}`);
      assert.ok(r.stdout.length > 0, 'output goes to stdout');
      assert.equal(r.stderr, '', 'nothing on stderr on the happy path');
    }
    assert.deepEqual(snapshotTree(dir), before, 'bundle listing + mtimes unchanged after every mode');
    assert.deepEqual(fs.readdirSync(root).sort(), ['20990601T000000Z', 'bad'].sort(), 'nothing created next to the bundle');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('null discipline: zero assistant.usage -> aiu.total null (never 0); wallMinutes null with < 2 timestamps; absent sources null', () => {
  const dir = path.join(os.tmpdir(), '20990605T000000Z');
  const empty = computeMetrics({ events: [], meta: {}, dir });
  assert.equal(empty.aiu.total, null, 'no usage -> aiu.total null');
  assert.equal(empty.aiu.byClass, null, 'no usage -> byClass null');
  assert.equal(empty.tokens.byClass, null, 'no usage -> tokens.byClass null');
  assert.equal(empty.weightedRequests, null, 'no usage -> weightedRequests null');
  assert.equal(empty.wallMinutes, null, 'no timestamps -> wallMinutes null');
  assert.equal(empty.systemTokensInitial, null, 'no usage_info -> null');
  assert.equal(empty.toolDefinitionTokens.initial, null, 'no usage_info -> null');
  assert.equal(empty.crossCheck.aiuVsMeta, null, 'no meta.cost and no total -> null');
  assert.equal(empty.crossCheck.aiuVsCheckpoint, null, 'no checkpoint -> null');
  assert.deepEqual(empty.gates, { total: 0, mapped: null, fallback: null }, 'unknown scenario -> mapped/fallback null');
  assert.equal(empty.servedModels.main, null, 'no startup model_change -> main null');
  assert.equal(empty.provenance.legacyArm, null, '2099 ts unmapped');
  assert.ok(!('recovered' in empty), 'recovered absent without recover');

  // Usage events WITHOUT copilotUsage (the research fixture shape) -> null, not 0.
  const noCu = [{ type: 'assistant.usage', data: { model: 'x', cost: 1 }, timestamp: '2099-06-05T00:00:00.000Z' }];
  const m1 = computeMetrics({ events: noCu, meta: {}, dir });
  assert.equal(m1.aiu.total, null, 'usage without copilotUsage -> aiu.total null');
  assert.equal(m1.weightedRequests, 1, 'but data.cost still sums');
  assert.equal(m1.wallMinutes, null, 'a single timestamp -> wallMinutes null');

  // A recorded meta.cost with no computable total -> crossCheck null (either side null).
  const m2 = computeMetrics({ events: [], meta: { cost: { aiu: 1.5, weightedRequests: 2 } }, dir });
  assert.equal(m2.crossCheck.aiuVsMeta, null, 'computed side null -> delta null');
  assert.equal(m2.crossCheck.weightedVsMeta, null, 'computed side null -> delta null');
  const md = renderMarkdown(empty);
  assert.match(md, /aiu\.total.*\bnull\b/, 'markdown renders null, not 0');
  assert.ok(!md.includes('undefined'), 'markdown never renders undefined');
});

test('wallMinutes on a 200 000-event bundle: no RangeError (single-pass min/max, never Math.max(...spread)) and the correct span', () => {
  // Cheap synthetic events carrying only a timestamp: 200 000 of them is well past the ~130 K argument
  // ceiling at which `Math.max(...stamps)` throws "Maximum call stack size exceeded".
  const N = 200000;
  const t0 = Date.parse('2099-06-07T00:00:00.000Z');
  const events = new Array(N);
  for (let i = 0; i < N; i++) events[i] = { type: 'x', timestamp: new Date(t0 + i * 10).toISOString() }; // 10 ms apart
  // Put the extremes OUT of order so the loop, not the event order, has to find them.
  events[12345] = { type: 'x', timestamp: new Date(t0 - 60000).toISOString() }; // 1 min before
  events[54321] = { type: 'x', timestamp: new Date(t0 + 60 * 60000).toISOString() }; // 60 min after (the 10 ms ramp ends at ~33.3 min)
  events[777] = { type: 'x', timestamp: 'not-a-date' }; // skipped, never NaN-poisons the span
  let m;
  assert.doesNotThrow(() => { m = computeMetrics({ events, meta: {}, dir: path.join(os.tmpdir(), '20990607T000000Z') }); }, '200 000 events must not throw (RangeError from a spread)');
  assert.equal(m.bundle.events, N, 'event count observed');
  assert.equal(m.wallMinutes, 61, 'wallMinutes = (max − min) / 60000 = 61.00 over the out-of-order extremes');
});
