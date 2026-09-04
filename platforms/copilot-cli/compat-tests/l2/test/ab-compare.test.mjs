// Credit-free checks for `l2/tools/ab-compare.mjs` (issue #122, spec R8 + R9 `ab-compare` row).
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
const TABLE_HEADER = 'ts | scenario | arm | source | comparable | commit | AIU';
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
  assert.match(none.stderr, /usage: .*ab-compare\.mjs <bundle-dir>\.\.\. \[--json\] \[--allow-mutants\]/, 'usage on stderr');
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
    assert.deepEqual(cells(rows[0]), [ts, 'research', 'plain', 'meta', 'yes', COMMIT.slice(0, 8), 'unknown'], 'row cells: ts, scenario, arm=variant, source meta, comparable yes, commit (8-hex short oid in the table), AIU unknown (research events carry no copilotUsage)');
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
    assert.deepEqual(cells(rows[0]), [ts, 'research', 'mutant M1', 'meta', 'no (mutant)', COMMIT.slice(0, 8), 'unknown'], 'row: arm "mutant <id>" (visible), source meta, comparable "no (mutant)", commit (short oid) from pluginSource');
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
    assert.deepEqual(Object.keys(j.rows[0]), ['ts', 'scenario', 'arm', 'mutation', 'source', 'comparable', 'commit', 'aiu', 'dir'], 'row key order pinned');
    assert.deepEqual(Object.keys(j.refused[0]), ['ts', 'dir', 'reason'], 'refused key order pinned');
    assert.equal(j.rows[1].arm, 'lean', 'v2 lean row');
    assert.equal(j.refused[1].reason, 'mutant M1 (pass --allow-mutants)', 'mutant refusal reason verbatim');

    const md = runTool([a, b, c, d]);
    const lines = md.stdout.split('\n');
    const hi = lines.findIndex((l) => l === `| ${TABLE_HEADER} |`);
    assert.ok(hi >= 0, `table header line is exactly "| ${TABLE_HEADER} |"\n${md.stdout}`);
    assert.match(lines[hi + 1], /^\|(---\|){7}$/, 'separator row has seven columns');
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
