// Credit-free checks for `l2/tools/ab-compare.mjs` (issue #122, spec R8 + R9 `ab-compare` row; #129
// served-model mismatch).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/ab-compare.test.mjs
//
// What it proves: the MINIMAL attribution-only comparer classifies every bundle exactly as R8 says —
// v2 meta with a `variant` -> a `meta` row (comparable `yes`, commit from `pluginSource.commit`); a
// pre-provenance bundle whose ts IS in the committed `l2/variants/legacy-arms.json` -> a `legacy-map` row
// (comparable `no (legacy)`); an unmapped pre-provenance bundle, a mutant (unless `--allow-mutants`, which
// lists it as a VISIBLE `mutant <id>` row, comparable `no (mutant)`), a v2 bundle driven without `--variant`
// and an unreadable bundle -> a verbatim `REFUSED: <ts> — <reason>` line and exit 2 —
// and honours the process contract (no args -> exit 2, deterministic `--json` = `{ rows, refused }`,
// the fixed table header, nothing written under `reports/` or into any bundle dir).
//
// #129 (last three cases): a cross-bundle guard on top of the per-bundle classification — `comparable: yes`
// rows whose SERVED-MODEL SET (their own `assistant.usage.data.model` values, deduped + sorted; no model
// catalog anywhere) differs from the majority one are REFUSED with `served-model mismatch: <set> vs
// <majority>` (exit 2), or, with `--allow-model-mix`, listed as `no (model mix)` under a visible `WARNING:`
// line above the table. The tie-break is the sorted row order, so the outcome never depends on argv order;
// legacy-map and allowed-mutant rows are already non-comparable and are outside the guard.
//
// CREDIT-FREE: the tool only reads events.json / replay-meta.json; it never spawns a seat, never imports
// the SDK, and `--replay` is NEVER invoked by this file. No seat, no session.
//
// FIXTURE PROVENANCE: every bundle is SYNTHESIZED in a mkdtemp tree from the committed research fixture
// `test/fixtures/research/events.sample.json` (real 1.0.81 events, ADR 0003) plus a hand-written
// replay-meta.json in the v2 (`buildReplayMeta`) or pre-provenance shape. The research events carry no
// `copilotUsage`, so the AIU column renders `unknown` (null discipline, spec R7). The legacy-map case
// stages the meta SHAPE only under a directory named `20260831T022952Z` — a ts that IS in the committed
// map — inside the mkdtemp root; the real bundle under `reports/` is never read, replayed or written.
// Unmapped cases use 2099-series stamps so nothing can collide with an operator bundle/report.
//
// Zero-dependency: node: builtins only. Self-cleaning: mkdtemp trees are removed in `finally`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const TOOL = path.join(L2_DIR, 'tools', 'ab-compare.mjs');
const REPORTS_DIR = path.resolve(L2_DIR, '..', 'reports');
const RESEARCH_EVENTS = path.join(__dirname, 'fixtures', 'research', 'events.sample.json');
const LEGACY_MAP = JSON.parse(fs.readFileSync(path.join(L2_DIR, 'variants', 'legacy-arms.json'), 'utf8'));

const MAPPED_TS = '20260831T022952Z'; // IS in the committed legacy map (upstream-control / quick-bugfix)
const TABLE_HEADER = 'ts | scenario | arm | source | comparable | commit | AIU | models';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

function runTool(args, opts = {}) {
  const res = spawnSync(process.execPath, [TOOL, ...args], { cwd: L2_DIR, encoding: 'utf8', env: { ...process.env }, ...opts });
  assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// Stage <root>/<ts>/{events.json, replay-meta.json} from the research events + the given meta object.
function stageBundle(root, ts, meta) {
  const dir = path.join(root, ts);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(RESEARCH_EVENTS, path.join(dir, 'events.json'));
  fs.writeFileSync(path.join(dir, 'replay-meta.json'), JSON.stringify(meta, null, 2));
  return dir;
}

// A v2 meta in the exact `buildReplayMeta` shape (legacy keys first, then the schema-2 block).
function v2Meta(ts, { variant = 'plain', mutation = null, commit = COMMIT } = {}) {
  return {
    scenario: 'research', taskType: 'research', copilotVersion: '1.0.81',
    sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs',
    ts, runIndex: 1, runs: 1, originalMode: 'live', maisterVersion: '2.2.3+fork.3',
    model: null, modelActual: 'unknown', cost: null,
    metaSchema: 2, variant, mutation,
    pluginDir: '/nonexistent/l2-variant-xxxx/plugins/maister-copilot', pluginName: 'maister-copilot',
    pluginDigest: 'deadbeef', pluginSource: { commit, commitRef: null, treeOid: 'cafebabe', forkVersion: '2.2.3+fork.3', method: 'git-archive' },
    sessionOptions: { skipCustomInstructions: true }, sandboxSeeds: null, referenceHash: null,
    cliVersion: '1.0.81', servedModels: {}, armManifest: null,
  };
}

// A pre-provenance meta (no metaSchema key at all — the six real bundles' shape).
function legacyMeta(ts, scenario = 'research') {
  return {
    scenario, taskType: scenario, copilotVersion: '1.0.81',
    sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs',
    ts, originalMode: 'live', maisterVersion: '2.2.3',
  };
}

const tableRows = (stdout) => stdout.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith(`| ${TABLE_HEADER}`) && !/^\|\s*-+/.test(l));
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const refusedLines = (stdout) => stdout.split('\n').filter((l) => l.startsWith('REFUSED: '));

// Sorted recursive listing (names only) — the "never writes" witness for reports/ and bundle dirs.
function listing(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, ent.name);
      out.push(path.relative(dir, p));
      if (ent.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

test('no args -> exit 2 + usage on stderr, nothing on stdout; unknown flag -> exit 2', () => {
  const none = runTool([]);
  assert.equal(none.status, 2, 'no args -> exit 2');
  assert.match(none.stderr, /usage: .*ab-compare\.mjs <bundle-dir>\.\.\. \[--json\] \[--allow-mutants\] \[--allow-model-mix\]/, 'usage on stderr');
  assert.equal(none.stdout, '', 'nothing on stdout');
  const bad = runTool(['--bogus']);
  assert.equal(bad.status, 2, 'unknown flag -> exit 2');
});

test('v2 bundle with variant plain -> row source meta, comparable yes, commit from pluginSource.commit, AIU unknown, exit 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-v2-'));
  try {
    const ts = '20990701T000000Z';
    const dir = stageBundle(root, ts, v2Meta(ts, { variant: 'plain' }));
    const r = runTool([dir]);
    assert.equal(r.status, 0, `a fully attributed v2 bundle exits 0\n${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, '', 'nothing on stderr on the happy path');
    assert.ok(r.stdout.includes(`| ${TABLE_HEADER} |`), `table header is "${TABLE_HEADER}"\n${r.stdout}`);
    const rows = tableRows(r.stdout);
    assert.equal(rows.length, 1, `exactly one data row\n${r.stdout}`);
    assert.deepEqual(cells(rows[0]), [ts, 'research', 'plain', 'meta', 'yes', COMMIT.slice(0, 8), 'unknown', 'unknown'], 'row cells: ts, scenario, arm=variant, source meta, comparable yes, commit (8-hex short oid in the table), AIU unknown and models unknown (research events carry no assistant.usage at all)');
    assert.equal(refusedLines(r.stdout).length, 0, 'no REFUSED line');
    const j = JSON.parse(runTool([dir, '--json']).stdout);
    assert.equal(j.rows[0].commit, COMMIT, 'JSON row commit = pluginSource.commit (the FULL oid; only the table shortens it)');
    assert.equal(j.rows[0].aiu, null, 'JSON AIU is null (never 0, never "unknown")');
    assert.deepEqual(j.refused, [], 'JSON refused empty');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pre-provenance meta staged under a mapped ts (20260831T022952Z) -> arm upstream-control, source legacy-map, comparable "no (legacy)", exit 0', () => {
  assert.equal(LEGACY_MAP.bundles[MAPPED_TS]?.legacyArm, 'upstream-control', `guard: ${MAPPED_TS} is in the committed legacy map as upstream-control`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-legacy-'));
  try {
    const dir = stageBundle(root, MAPPED_TS, legacyMeta(MAPPED_TS, 'quick-bugfix'));
    const r = runTool([dir]);
    assert.equal(r.status, 0, `a mapped legacy bundle is listed (with a note), not refused -> exit 0\n${r.stdout}${r.stderr}`);
    const rows = tableRows(r.stdout);
    assert.equal(rows.length, 1, 'exactly one data row');
    const c = cells(rows[0]);
    assert.equal(c[0], MAPPED_TS, 'ts from the directory basename');
    assert.equal(c[1], 'quick-bugfix', 'scenario from the meta');
    assert.equal(c[2], 'upstream-control', 'arm = legacyArm from the map');
    assert.equal(c[3], 'legacy-map', 'source legacy-map');
    assert.equal(c[4], 'no (legacy)', 'comparable "no (legacy)"');
    assert.equal(c[6], 'unknown', 'AIU unknown');
    assert.equal(c[7], 'unknown', 'models unknown (no assistant.usage in the fixture events)');
    assert.equal(refusedLines(r.stdout).length, 0, 'not refused');
    const j = JSON.parse(runTool([dir, '--json']).stdout);
    assert.equal(j.rows[0].source, 'legacy-map', 'JSON source legacy-map');
    assert.equal(j.rows[0].comparable, 'no (legacy)', 'JSON comparable "no (legacy)"');
    assert.equal(j.rows[0].commit, null, 'legacy rows record no commit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unmapped pre-provenance (2099 ts) -> REFUSED "pre-provenance bundle not in legacy-arms.json", exit 2 (other rows still listed)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-unmapped-'));
  try {
    const tsBad = '20990702T000000Z';
    const tsOk = '20990702T000001Z';
    assert.ok(!(tsBad in LEGACY_MAP.bundles), 'guard: the 2099 ts is not in the legacy map');
    const bad = stageBundle(root, tsBad, legacyMeta(tsBad));
    const ok = stageBundle(root, tsOk, v2Meta(tsOk));
    const r = runTool([bad, ok]);
    assert.equal(r.status, 2, `any refusal -> exit 2\n${r.stdout}${r.stderr}`);
    const refused = refusedLines(r.stdout);
    assert.deepEqual(refused, [`REFUSED: ${tsBad} — pre-provenance bundle not in legacy-arms.json`], 'verbatim R8 refusal line');
    assert.equal(tableRows(r.stdout).length, 1, 'the attributed v2 bundle is still listed as a row');
    const j = JSON.parse(runTool([bad, ok, '--json']).stdout);
    assert.deepEqual(j.refused, [{ ts: tsBad, dir: bad, reason: 'pre-provenance bundle not in legacy-arms.json' }], 'JSON refused entry');
    assert.equal(j.rows.length, 1, 'JSON rows carry only the attributed bundle');
    const solo = runTool([bad]);
    assert.equal(solo.status, 2, 'a lone refusal exits 2');
    assert.equal(tableRows(solo.stdout).length, 0, 'no data row for a lone refusal');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v2 mutant M1 (variant null, the shape the harness produces) -> REFUSED "mutant M1 (pass --allow-mutants)" exit 2; with --allow-mutants -> VISIBLE row "mutant M1", comparable "no (mutant)", exit 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-mutant-'));
  try {
    // run.sh rejects --variant with --mutation, so a REAL mutant bundle always carries variant: null.
    const ts = '20990703T000000Z';
    const dir = stageBundle(root, ts, v2Meta(ts, { variant: null, mutation: 'M1' }));
    const r = runTool([dir]);
    assert.equal(r.status, 2, `a mutant is refused by default -> exit 2\n${r.stdout}${r.stderr}`);
    assert.deepEqual(refusedLines(r.stdout), [`REFUSED: ${ts} — mutant M1 (pass --allow-mutants)`], 'verbatim R8 refusal line');
    assert.equal(tableRows(r.stdout).length, 0, 'no row for the refused mutant');

    const a = runTool([dir, '--allow-mutants']);
    assert.equal(a.status, 0, `--allow-mutants -> listed, exit 0 (the flag is reachable on the real mutant shape)\n${a.stdout}${a.stderr}`);
    assert.equal(refusedLines(a.stdout).length, 0, 'no REFUSED line with --allow-mutants (variant null is NOT "unattributed" on a mutant)');
    const rows = tableRows(a.stdout);
    assert.equal(rows.length, 1, 'one row with --allow-mutants');
    assert.deepEqual(cells(rows[0]), [ts, 'research', 'mutant M1', 'meta', 'no (mutant)', COMMIT.slice(0, 8), 'unknown', 'unknown'], 'row: arm "mutant <id>" (visible), source meta, comparable "no (mutant)", commit (short oid) from pluginSource, models unknown');
    const j = JSON.parse(runTool([dir, '--allow-mutants', '--json']).stdout);
    assert.equal(j.rows[0].arm, 'mutant M1', 'JSON arm = "mutant <id>"');
    assert.equal(j.rows[0].mutation, 'M1', 'JSON row carries the mutation id');
    assert.equal(j.rows[0].comparable, 'no (mutant)', 'an allowed mutant is listed but never comparable');
    assert.equal(j.rows[0].commit, COMMIT, 'JSON commit from pluginSource.commit');

    // A (synthetic) mutant that ALSO recorded a variant keeps both visible: "<variant> (mutant <id>)".
    const ts2 = '20990703T000001Z';
    const dir2 = stageBundle(root, ts2, v2Meta(ts2, { variant: 'plain', mutation: 'M2' }));
    assert.deepEqual(refusedLines(runTool([dir2]).stdout), [`REFUSED: ${ts2} — mutant M2 (pass --allow-mutants)`], 'still refused without the flag');
    const b = JSON.parse(runTool([dir2, '--allow-mutants', '--json']).stdout);
    assert.equal(b.rows[0].arm, 'plain (mutant M2)', 'variant + mutation -> "<variant> (mutant <id>)"');
    assert.equal(b.rows[0].comparable, 'no (mutant)', 'never comparable, variant or not');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v2 with variant null and NO mutation -> REFUSED "unattributed (driven without --variant)", exit 2 (also with --allow-mutants)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-null-'));
  try {
    const ts = '20990704T000000Z';
    const dir = stageBundle(root, ts, v2Meta(ts, { variant: null }));
    const r = runTool([dir]);
    assert.equal(r.status, 2, `variant null -> exit 2\n${r.stdout}${r.stderr}`);
    assert.deepEqual(refusedLines(r.stdout), [`REFUSED: ${ts} — unattributed (driven without --variant)`], 'verbatim R8 refusal line');
    assert.equal(tableRows(r.stdout).length, 0, 'no row');
    const a = runTool([dir, '--allow-mutants']);
    assert.equal(a.status, 2, '--allow-mutants does not rescue an unattributed NON-mutant bundle');
    assert.deepEqual(refusedLines(a.stdout), [`REFUSED: ${ts} — unattributed (driven without --variant)`], 'the unattributed refusal is unchanged by the flag');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unreadable bundle (unparsable events.json) -> REFUSED "unreadable bundle: <detail>", exit 2; other bundles still listed (R8 amendment)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-unreadable-'));
  try {
    const tsBad = '20990706T000000Z';
    const tsOk = '20990706T000001Z';
    const bad = path.join(root, tsBad);
    fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, 'events.json'), '{ not json');
    fs.writeFileSync(path.join(bad, 'replay-meta.json'), JSON.stringify(v2Meta(tsBad)));
    const ok = stageBundle(root, tsOk, v2Meta(tsOk, { variant: 'lean' }));
    const r = runTool([bad, ok]);
    assert.equal(r.status, 2, `an unreadable bundle is a refusal -> exit 2\n${r.stdout}${r.stderr}`);
    const refused = refusedLines(r.stdout);
    assert.equal(refused.length, 1, 'exactly one REFUSED line');
    assert.match(refused[0], new RegExp(`^REFUSED: ${tsBad} — unreadable bundle: .*events\\.json`), 'verbatim prefix "unreadable bundle: <detail>", detail names events.json');
    assert.equal(tableRows(r.stdout).length, 1, 'the readable bundle is still listed (per-bundle refusal, no abort)');
    assert.equal(cells(tableRows(r.stdout)[0])[2], 'lean', 'the listed row is the readable lean bundle');
    const j = JSON.parse(runTool([bad, ok, '--json']).stdout);
    assert.equal(j.refused.length, 1, 'JSON: one refusal');
    assert.equal(j.refused[0].ts, tsBad, 'JSON refusal ts from the directory basename');
    assert.match(j.refused[0].reason, /^unreadable bundle: /, 'JSON refusal reason prefix');
    assert.equal(j.rows.length, 1, 'JSON: one row');
    // A missing events.json is unreadable too.
    const none = path.join(root, '20990706T000002Z');
    fs.mkdirSync(none);
    assert.match(refusedLines(runTool([none]).stdout)[0], /unreadable bundle: no events\.json/, 'missing events.json -> unreadable bundle');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--json -> { rows, refused } deterministic (byte-identical, pinned keys, sorted by ts regardless of arg order); table header pinned; nothing written under reports/ or into a bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-json-'));
  const reportsBefore = listing(REPORTS_DIR);
  try {
    const tsA = '20990705T000000Z';
    const tsB = '20990705T000001Z';
    const tsC = '20990705T000002Z';
    const a = stageBundle(root, tsA, v2Meta(tsA, { variant: 'lean' }));
    const b = stageBundle(root, MAPPED_TS, legacyMeta(MAPPED_TS, 'quick-bugfix'));
    const c = stageBundle(root, tsB, legacyMeta(tsB));
    const d = stageBundle(root, tsC, v2Meta(tsC, { variant: 'plain', mutation: 'M1' }));
    const rootBefore = listing(root);

    const r1 = runTool([d, c, b, a, '--json']);
    const r2 = runTool([a, b, c, d, '--json']);
    assert.equal(r1.status, 2, 'refusals present -> exit 2 even with --json');
    assert.equal(r1.stdout, r2.stdout, 'byte-identical regardless of argument order');
    const j = JSON.parse(r1.stdout);
    assert.deepEqual(Object.keys(j), ['rows', 'refused'], 'top-level shape { rows, refused }');
    assert.deepEqual(j.rows.map((x) => x.ts), [MAPPED_TS, tsA], 'rows sorted by ts');
    assert.deepEqual(j.refused.map((x) => x.ts), [tsB, tsC], 'refused sorted by ts');
    assert.deepEqual(Object.keys(j.rows[0]), ['ts', 'scenario', 'arm', 'mutation', 'source', 'comparable', 'commit', 'aiu', 'models', 'dir'], 'row key order pinned (models added by #129)');
    assert.deepEqual(Object.keys(j.refused[0]), ['ts', 'dir', 'reason'], 'refused key order pinned');
    assert.equal(j.rows[1].arm, 'lean', 'v2 lean row');
    assert.equal(j.refused[1].reason, 'mutant M1 (pass --allow-mutants)', 'mutant refusal reason verbatim');

    const md = runTool([a, b, c, d]);
    const lines = md.stdout.split('\n');
    const hi = lines.findIndex((l) => l === `| ${TABLE_HEADER} |`);
    assert.ok(hi >= 0, `table header line is exactly "| ${TABLE_HEADER} |"\n${md.stdout}`);
    assert.match(lines[hi + 1], /^\|(---\|){8}$/, 'separator row has eight columns (models added by #129)');
    assert.equal(tableRows(md.stdout).length, 2, 'two rows in markdown');
    assert.equal(refusedLines(md.stdout).length, 2, 'two REFUSED lines in markdown');
    assert.ok(lines.indexOf(refusedLines(md.stdout)[0]) > hi, 'REFUSED lines follow the table');
    assert.ok(!md.stdout.includes('undefined'), 'never renders undefined');

    assert.deepEqual(listing(root), rootBefore, 'no file created in or next to any bundle');
    assert.deepEqual(listing(REPORTS_DIR), reportsBefore, 'nothing written under reports/');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- #129 served-model mismatch
// The research fixture carries NO `assistant.usage`, so a bundle's served-model set is synthesized here by
// appending one tiny usage event per model — the same shape a real event has, priced from its own
// `tokenDetails`. No model catalog is involved on either side: the tool reads these ids back out of the
// events it was handed.
const RESEARCH_EVENT_LIST = JSON.parse(fs.readFileSync(RESEARCH_EVENTS, 'utf8'));
const usageEvent = (model, nanoAiu) => ({
  type: 'assistant.usage',
  timestamp: '2099-07-07T00:00:00.000Z',
  data: {
    model,
    cost: 1,
    copilotUsage: {
      totalNanoAiu: nanoAiu,
      tokenDetails: [{ batchSize: 1e6, costPerBatch: 20e9, tokenCount: 1000, tokenType: 'input' }],
    },
  },
});

// Stage a bundle whose served-model set is exactly `models` (one usage event each, 1 AIU per model).
function stageBundleServing(root, ts, meta, models) {
  const dir = stageBundle(root, ts, meta);
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify([...RESEARCH_EVENT_LIST, ...models.map((m) => usageEvent(m, 1e9))]));
  return dir;
}

test('#129 identical served-model sets -> both listed, exit 0, models column short-named (mini+luna) when the last dash segment is unambiguous', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-mix-same-'));
  try {
    const tsA = '20990707T000000Z';
    const tsB = '20990707T000001Z';
    const a = stageBundleServing(root, tsA, v2Meta(tsA, { variant: 'plain' }), ['gpt-5.6-luna', 'gpt-5.4-mini']);
    const b = stageBundleServing(root, tsB, v2Meta(tsB, { variant: 'lean' }), ['gpt-5.4-mini', 'gpt-5.6-luna']);
    const r = runTool([a, b]);
    assert.equal(r.status, 0, `matching served-model sets are comparable -> exit 0\n${r.stdout}${r.stderr}`);
    assert.equal(refusedLines(r.stdout).length, 0, 'no REFUSED line when the sets match');
    const rows = tableRows(r.stdout);
    assert.equal(rows.length, 2, 'both bundles listed');
    assert.equal(cells(rows[0])[7], 'mini+luna', 'models cell: the last dash segment of each id, ordered by the sorted FULL ids (gpt-5.4-mini < gpt-5.6-luna), joined with +');
    assert.equal(cells(rows[1])[7], 'mini+luna', 'the set is order-independent (deduped and sorted)');
    assert.equal(cells(rows[0])[4], 'yes', 'still comparable');
    assert.ok(!r.stdout.includes('WARNING'), 'no warning line when the sets match');
    const j = JSON.parse(runTool([a, b, '--json']).stdout);
    assert.deepEqual(j.rows[0].models, ['gpt-5.4-mini', 'gpt-5.6-luna'], 'JSON keeps the FULL sorted ids (only the table shortens them)');
    assert.deepEqual(Object.keys(j), ['rows', 'refused'], 'top-level JSON shape unchanged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#129 differing served-model sets -> REFUSED "served-model mismatch: <set> vs <majority>" exit 2; --allow-model-mix lists the row as "no (model mix)" under a WARNING, exit 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-mix-diff-'));
  try {
    // Two `plain` drives, one of which the runtime also served on claude-sonnet-5 (the #129 shape).
    const tsMaj = '20990708T000000Z';
    const tsMaj2 = '20990708T000001Z';
    const tsOdd = '20990708T000002Z';
    const maj = stageBundleServing(root, tsMaj, v2Meta(tsMaj, { variant: 'plain' }), ['gpt-5.6-luna', 'gpt-5.4-mini']);
    const maj2 = stageBundleServing(root, tsMaj2, v2Meta(tsMaj2, { variant: 'lean' }), ['gpt-5.6-luna', 'gpt-5.4-mini']);
    const odd = stageBundleServing(root, tsOdd, v2Meta(tsOdd, { variant: 'plain' }), ['gpt-5.6-luna', 'gpt-5.4-mini', 'claude-sonnet-5']);

    const r = runTool([maj, maj2, odd]);
    assert.equal(r.status, 2, `a served-model mismatch is a refusal -> exit 2\n${r.stdout}${r.stderr}`);
    assert.deepEqual(refusedLines(r.stdout), [
      `REFUSED: ${tsOdd} — served-model mismatch: claude-sonnet-5+gpt-5.4-mini+gpt-5.6-luna vs gpt-5.4-mini+gpt-5.6-luna`,
    ], 'verbatim refusal line: the offending set vs the majority set, both as full sorted ids');
    assert.equal(tableRows(r.stdout).length, 2, 'the two matching bundles are still listed');

    const a = runTool([maj, maj2, odd, '--allow-model-mix']);
    assert.equal(a.status, 0, `--allow-model-mix lists the mismatch instead of refusing it\n${a.stdout}${a.stderr}`);
    assert.equal(refusedLines(a.stdout).length, 0, 'no REFUSED line with the flag');
    const warn = a.stdout.split('\n').filter((l) => l.startsWith('WARNING: '));
    assert.equal(warn.length, 1, `exactly one visible warning line\n${a.stdout}`);
    assert.match(warn[0], /^WARNING: served-model mismatch across 3 comparable bundles \(.*\) — AIU is NOT comparable/, 'the warning names the mismatch and says AIU is not comparable');
    assert.ok(a.stdout.indexOf(warn[0]) < a.stdout.indexOf(`| ${TABLE_HEADER} |`), 'the warning sits ABOVE the table');
    const rows = tableRows(a.stdout);
    assert.equal(rows.length, 3, 'all three rows listed with the flag');
    const oddRow = rows.find((l) => cells(l)[0] === tsOdd);
    assert.equal(cells(oddRow)[4], 'no (model mix)', 'the offending row is listed but downgraded to non-comparable');
    assert.equal(cells(oddRow)[7], 'claude-sonnet-5+gpt-5.4-mini+gpt-5.6-luna', 'full ids in the models column: "5" (from claude-sonnet-5) is a version number, not an unambiguous name');
    assert.equal(cells(rows.find((l) => cells(l)[0] === tsMaj))[4], 'yes', 'the majority rows stay comparable');
    const j = JSON.parse(runTool([maj, maj2, odd, '--allow-model-mix', '--json']).stdout);
    assert.deepEqual(Object.keys(j), ['rows', 'refused'], 'JSON shape is still { rows, refused } (the mismatch shows as the row comparable + models)');
    assert.equal(j.rows.find((x) => x.ts === tsOdd).comparable, 'no (model mix)', 'the JSON row carries the downgrade — the gap is machine-visible, not warning-only');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#129 the mismatch guard is deterministic (byte-identical --json regardless of argument order), spares non-comparable rows, and never fires on a single bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-mix-det-'));
  try {
    const tsA = '20990709T000000Z';
    const tsB = '20990709T000001Z';
    const a = stageBundleServing(root, tsA, v2Meta(tsA, { variant: 'plain' }), ['gpt-5.6-luna']);
    const b = stageBundleServing(root, tsB, v2Meta(tsB, { variant: 'lean' }), ['gpt-5.4-mini']);
    const r1 = runTool([a, b, '--json']);
    const r2 = runTool([b, a, '--json']);
    assert.equal(r1.status, 2, 'a 1-vs-1 mismatch still refuses');
    assert.equal(r1.stdout, r2.stdout, 'byte-identical regardless of argument order (the majority tie is broken by the sorted row order, not by argv)');
    const j = JSON.parse(r1.stdout);
    assert.deepEqual(j.rows.map((x) => x.ts), [tsA], 'the first sorted set wins the tie and stays listed');
    assert.deepEqual(j.refused.map((x) => x.reason), ['served-model mismatch: gpt-5.4-mini vs gpt-5.6-luna'], 'the other is refused with both sets named');

    // A single bundle has nothing to mismatch against.
    assert.equal(runTool([b]).status, 0, 'one bundle alone is never a mismatch');

    // A legacy-map row is already `no (legacy)`: it neither triggers nor suffers the guard.
    const legacy = stageBundleServing(root, MAPPED_TS, legacyMeta(MAPPED_TS, 'quick-bugfix'), ['claude-haiku-4.5']);
    const withLegacy = runTool([a, legacy]);
    assert.equal(withLegacy.status, 0, `a non-comparable row with a different served-model set is not a refusal\n${withLegacy.stdout}`);
    assert.equal(tableRows(withLegacy.stdout).length, 2, 'both rows listed');
    assert.equal(cells(tableRows(withLegacy.stdout).find((l) => cells(l)[0] === MAPPED_TS))[4], 'no (legacy)', 'the legacy row keeps its own non-comparable label');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- #138 WP3: --normalize=shared, --same-route
// R11a normalizes on the INTERSECTION of the served-model sets — NOT on the model pin, which is `null` for
// five of the seven surviving bundles (spec DIV-4), both halves of the struck pair included.
//
// FIXTURE PROVENANCE for the struck pair below: the two bundle directories are SYNTHESIZED in a mkdtemp
// tree under the two real ts stamps (both ARE in the committed legacy map), carrying the MEASURED per-model
// AIU of the real bundles — 20260831T024753Z: claude-sonnet-4.6 43.991535 · gpt-5.4-mini 6.189270 ·
// gpt-5.6-luna 22.398884 (raw 72.579689); 20260903T000910Z: gpt-5.4-mini 8.407545 · gpt-5.6-luna 28.587435
// (raw 36.994980, the whole total — it served only those two). The real bundles under `reports/` are never
// read, replayed or written (audit #9): they live only in the shared checkout and are absent from CI.
const nanoOf = (aiu) => Math.round(aiu * 1e9);
function stageBundleServingAiu(root, ts, meta, byModelAiu) {
  const dir = stageBundle(root, ts, meta);
  const usage = Object.entries(byModelAiu).map(([m, aiu]) => usageEvent(m, nanoOf(aiu)));
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify([...RESEARCH_EVENT_LIST, ...usage]));
  return dir;
}
const STRUCK_A = '20260831T024753Z'; // upstream-control / development — served claude-sonnet-4.6 too
const STRUCK_B = '20260903T000910Z'; // fork-legacy / development — served ONLY mini + luna
const sharedLine = (stdout) => stdout.split('\n').find((l) => l.startsWith('shared:')) ?? '';
// `--normalize=shared` widens the header (sharedAiu + droppedAiu are ADDED columns), so the module-level
// `tableRows` — which keys on the 8-column TABLE_HEADER pinned at :51 — cannot recognise it. Keying on the
// leading `| ts |` instead reads data rows under either width without touching that pin.
const dataRows = (stdout) => stdout.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ts |') && !/^\|\s*-+/.test(l));

test('#138 --normalize=shared on the struck pair: sharedAiu 28.588154 vs 36.994980, the raw AIU column UNCHANGED, claude-sonnet-4.6 named as dropped (43.991535 / 0), and both rows still "no (legacy)"', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-norm-'));
  try {
    assert.equal(LEGACY_MAP.bundles[STRUCK_A]?.legacyArm, 'upstream-control', `guard: ${STRUCK_A} is in the committed legacy map`);
    assert.equal(LEGACY_MAP.bundles[STRUCK_B]?.legacyArm, 'fork-legacy', `guard: ${STRUCK_B} is in the committed legacy map`);
    const a = stageBundleServingAiu(root, STRUCK_A, legacyMeta(STRUCK_A, 'development'), {
      'claude-sonnet-4.6': 43.991535, 'gpt-5.4-mini': 6.189270, 'gpt-5.6-luna': 22.398884,
    });
    const b = stageBundleServingAiu(root, STRUCK_B, legacyMeta(STRUCK_B, 'development'), {
      'gpt-5.4-mini': 8.407545, 'gpt-5.6-luna': 28.587435,
    });

    // Baseline: no normalization. Both rows are legacy-map, so the #129 guard cannot fire on them at all
    // (`applyModelMixGuard` filters to comparable === 'yes'); their non-comparability is already reported,
    // by a STRONGER rule than the model-mix guard.
    const raw = runTool([a, b]);
    assert.equal(raw.status, 0, `two mapped legacy bundles are listed, not refused\n${raw.stdout}${raw.stderr}`);
    assert.equal(refusedLines(raw.stdout).length, 0, 'the model-mix guard does not and cannot fire on legacy rows');
    assert.deepEqual(dataRows(raw.stdout).map((l) => cells(l)[6]), ['72.579689', '36.994980'], 'raw AIU totals');

    const r = runTool([a, b, '--normalize=shared']);
    assert.equal(r.status, 0, `normalization is an additive projection, not a refusal\n${r.stdout}${r.stderr}`);
    const rows = dataRows(r.stdout);
    assert.equal(rows.length, 2, 'both rows still listed');
    const A = cells(rows[0]);
    const B = cells(rows[1]);
    assert.equal(A[0], STRUCK_A, 'rows sorted by ts');
    assert.equal(A[6], '72.579689', 'the RAW aiu column STAYS on row 1 — sharedAiu is an ADDED column, never a replacement');
    assert.equal(B[6], '36.994980', 'the raw aiu column stays on row 2');
    assert.equal(A[7], '28.588154', 'sharedAiu row 1 = 6.189270 (mini) + 22.398884 (luna)');
    assert.equal(B[7], '36.994980', 'sharedAiu row 2 = its WHOLE total: it served only the two shared models');
    assert.equal(A[8], '43.991535', 'the AIU dropped from row 1 — 61 % of its total, on a model its counterpart never served');
    assert.equal(B[8], '0.000000', 'nothing dropped from row 2');
    assert.equal(A[4], 'no (legacy)', 'A3.2b: normalization does NOT change comparable');
    assert.equal(B[4], 'no (legacy)', 'A3.2b: the caveat travels with the number');

    // A bare normalized number is never emitted: the dropped model ids are printed with the table.
    assert.match(sharedLine(r.stdout), /^shared: /, 'a visible `shared:` line accompanies every normalized table');
    assert.match(sharedLine(r.stdout), /gpt-5\.4-mini\+gpt-5\.6-luna/, 'the shared set is named');
    assert.match(sharedLine(r.stdout), /claude-sonnet-4\.6/, 'the dropped model id is named');

    const j = JSON.parse(runTool([a, b, '--normalize=shared', '--json']).stdout);
    assert.equal(j.rows[0].aiu, 72.579689, 'JSON keeps the raw total');
    assert.equal(j.rows[0].sharedAiu, 28.588154, 'JSON sharedAiu row 1');
    assert.equal(j.rows[1].sharedAiu, 36.994980, 'JSON sharedAiu row 2');
    assert.equal(j.rows[0].droppedAiu, 43.991535, 'JSON droppedAiu row 1');
    assert.equal(j.rows[1].droppedAiu, 0, 'JSON droppedAiu row 2 is a real 0 — usage was observed and nothing was dropped');
    assert.equal(j.rows[0].comparable, 'no (legacy)', 'the JSON row carries the caveat too');
    assert.deepEqual(j.normalize.shared, ['gpt-5.4-mini', 'gpt-5.6-luna'], 'the shared set is machine-visible');
    assert.deepEqual(j.normalize.dropped, ['claude-sonnet-4.6'], 'so is the dropped set');

    // The 0.0007 trap: 28.587435 is 20260903T000910Z's LUNA-ALONE figure and belongs to the OTHER bundle.
    assert.notEqual(j.rows[0].sharedAiu, 28.587435, 'row 1 shared subset (28.588154) is NOT row 2 luna-alone (28.587435)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#138 --normalize=shared degenerate branches (R11a): empty intersection -> named refusal, exit 2; full intersection -> no-op "shared: (no models dropped)" with the raw totals unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-norm-deg-'));
  try {
    // (a) S empty. Two legacy rows with disjoint served-model sets: nothing to normalize ON, so the tool
    // refuses rather than inventing a basis. (Legacy rows, so the #129 guard is not what is being tested.)
    const dis1 = stageBundleServingAiu(root, MAPPED_TS, legacyMeta(MAPPED_TS, 'quick-bugfix'), { 'gpt-5.6-luna': 1 });
    const dis2 = stageBundleServingAiu(root, '20260903T003148Z', legacyMeta('20260903T003148Z', 'work'), { 'gpt-5.4-mini': 2 });
    const empty = runTool([dis1, dis2, '--normalize=shared']);
    assert.equal(empty.status, 2, 'an empty intersection is a refusal -> exit 2');
    assert.match(empty.stderr, /no shared model/, 'the refusal NAMES its reason');
    assert.match(empty.stderr, /gpt-5\.4-mini/, 'and names the sets it could not intersect');
    assert.ok(!/^\| ts \|/m.test(empty.stdout), 'no normalized table is printed when normalization is impossible');

    // (b) S = every row's full set -> a no-op. The raw totals are printed unchanged, under the verbatim line.
    const same1 = stageBundleServingAiu(root, '20260903T004846Z', legacyMeta('20260903T004846Z', 'init'), { 'gpt-5.6-luna': 3, 'gpt-5.4-mini': 1 });
    const same2 = stageBundleServingAiu(root, '20260831T022944Z', legacyMeta('20260831T022944Z', 'destructive-guard'), { 'gpt-5.4-mini': 2, 'gpt-5.6-luna': 5 });
    const noop = runTool([same1, same2, '--normalize=shared']);
    assert.equal(noop.status, 0, `a no-op normalization is not a refusal\n${noop.stdout}${noop.stderr}`);
    assert.equal(sharedLine(noop.stdout), 'shared: (no models dropped)', 'the verbatim R11a no-op line');
    const rows = dataRows(noop.stdout); // sorted by ts: 20260831T022944Z (7 AIU) then 20260903T004846Z (4 AIU)
    assert.deepEqual(rows.map((l) => cells(l)[6]), ['7.000000', '4.000000'], 'the raw totals are unchanged');
    assert.deepEqual(rows.map((l) => cells(l)[7]), ['7.000000', '4.000000'], 'sharedAiu equals the raw total when nothing is dropped');
    assert.deepEqual(rows.map((l) => cells(l)[8]), ['0.000000', '0.000000'], 'nothing dropped from either row');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#138 --same-route is a FILTER: the majority route class is kept, a differing class and an UNKNOWN class are both REFUSED (never silently kept), and rows shrink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-route-'));
  try {
    // The route class is the artifact witness promoted from sweeps/tier2/sweep-tier2.sh:31-36 — `deep` when
    // the rundir contains solution-exploration.md or high-level-design.md, else `skip`. It is the only
    // validated route predicate in the project, and it is a COMPARABILITY filter, never a cost explanation.
    const withRundir = (dir, files) => {
      const rd = path.join(dir, 'rundir', 'outputs');
      fs.mkdirSync(rd, { recursive: true });
      for (const f of files) fs.writeFileSync(path.join(rd, f), 'x');
      return dir;
    };
    const tsSkipA = '20990710T000000Z';
    const tsSkipB = '20990710T000001Z';
    const tsDeep = '20990710T000002Z';
    const tsNull = '20990710T000003Z';
    const skipA = withRundir(stageBundle(root, tsSkipA, v2Meta(tsSkipA, { variant: 'plain' })), ['spec.md']);
    const skipB = withRundir(stageBundle(root, tsSkipB, v2Meta(tsSkipB, { variant: 'lean' })), ['work-log.md']);
    const deep = withRundir(stageBundle(root, tsDeep, v2Meta(tsDeep, { variant: 'plain' })), ['solution-exploration.md']);
    const noRundir = stageBundle(root, tsNull, v2Meta(tsNull, { variant: 'lean' })); // no rundir at all -> class null

    const before = JSON.parse(runTool([skipA, skipB, deep, '--json']).stdout);
    assert.equal(before.rows.length, 3, 'without the flag all three are listed');
    const after = JSON.parse(runTool([skipA, skipB, deep, '--same-route', '--json']).stdout);
    assert.ok(after.rows.length < before.rows.length, `--same-route lists FEWER rows (${after.rows.length} < ${before.rows.length})`);
    assert.deepEqual(after.rows.map((r) => r.ts), [tsSkipA, tsSkipB], 'the majority (skip) class is kept');
    assert.deepEqual(after.refused.map((r) => r.ts), [tsDeep], 'the deep-route bundle is REFUSED, not dropped in silence');
    assert.match(after.refused[0].reason, /--same-route: route deep vs majority skip/, 'the refusal names both classes');
    assert.equal(runTool([skipA, skipB, deep, '--same-route']).status, 2, 'a refusal -> exit 2');

    // An unknown class is never silently kept: no rundir witness -> refused (A3.6a).
    const withNull = JSON.parse(runTool([skipA, skipB, noRundir, '--same-route', '--json']).stdout);
    assert.deepEqual(withNull.rows.map((r) => r.ts), [tsSkipA, tsSkipB], 'only the witnessed rows survive');
    assert.deepEqual(withNull.refused.map((r) => r.ts), [tsNull], 'the null-class bundle appears in refused');
    assert.match(withNull.refused[0].reason, /route class unknown/, 'the refusal names WHY: there is no witness');
    assert.deepEqual(Object.keys(withNull.refused[0]), ['ts', 'dir', 'reason'], 'refused key order unchanged');

    // high-level-design.md is the second `deep` marker, and the witness walks the rundir recursively.
    const tsDeep2 = '20990710T000004Z';
    const deep2 = withRundir(stageBundle(root, tsDeep2, v2Meta(tsDeep2, { variant: 'plain' })), ['high-level-design.md']);
    const bothDeep = JSON.parse(runTool([deep, deep2, '--same-route', '--json']).stdout);
    assert.deepEqual(bothDeep.rows.map((r) => r.ts), [tsDeep, tsDeep2], 'two deep drives share a route and both survive');
    assert.deepEqual(bothDeep.refused, [], 'no refusal when the classes agree');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#138 R11 is untouched: the #129 served-model refusal still fires on two comparable v2 rows (A3.1b) and --normalize=shared does not disarm it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-ab-compare-guard-intact-'));
  try {
    const tsA = '20990711T000000Z';
    const tsB = '20990711T000001Z';
    const a = stageBundleServing(root, tsA, v2Meta(tsA, { variant: 'plain' }), ['gpt-5.6-luna', 'gpt-5.4-mini']);
    const b = stageBundleServing(root, tsB, v2Meta(tsB, { variant: 'lean' }), ['gpt-5.6-luna', 'gpt-5.4-mini', 'claude-sonnet-5']);
    const r = runTool([a, b]);
    assert.equal(r.status, 2, `two comparable rows with differing served-model sets -> exit 2\n${r.stdout}${r.stderr}`);
    assert.deepEqual(refusedLines(r.stdout), [
      `REFUSED: ${tsB} — served-model mismatch: claude-sonnet-5+gpt-5.4-mini+gpt-5.6-luna vs gpt-5.4-mini+gpt-5.6-luna`,
    ], 'the raw-total refusal is byte-for-byte the one #129 shipped');
    // --normalize=shared is an addition BESIDE the guard, never a replacement: the offending row is still
    // refused, and only the surviving row is normalized.
    const n = runTool([a, b, '--normalize=shared']);
    assert.equal(n.status, 2, 'normalizing does not rescue a refused row');
    assert.equal(refusedLines(n.stdout).length, 1, 'the guard still refused exactly one row');
    assert.equal(dataRows(n.stdout).length, 1, 'only the surviving row is listed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#138 flag parser (R12): --normalize=bogus -> exit 2 with a NAMED error, not a bare usage(); the no-arguments path still prints usage: (A3.7 + A3.8)', () => {
  const bad = runTool(['--normalize=bogus']);
  assert.equal(bad.status, 2, 'an unknown flag VALUE exits 2');
  assert.match(bad.stderr, /invalid --normalize=bogus/, 'the error NAMES the offending value');
  assert.match(bad.stderr, /shared/, 'and names the value that is supported');
  assert.ok(!/^usage: /m.test(bad.stderr), 'a bad flag value is NOT answered with a bare usage() line');
  assert.equal(bad.stdout, '', 'nothing on stdout');

  // A3.8: no-args is a different case and keeps calling usage() — R12 scopes to bad flag VALUES.
  const none = runTool([]);
  assert.equal(none.status, 2, 'no args -> exit 2');
  assert.match(none.stderr, /^usage: /m, 'the no-arguments path still prints usage: on stderr');
  assert.match(none.stderr, /--normalize=shared/, 'usage() documents the new flag');
  assert.match(none.stderr, /--same-route/, 'usage() documents --same-route');
});
