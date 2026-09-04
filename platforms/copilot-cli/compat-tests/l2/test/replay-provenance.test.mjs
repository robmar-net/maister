// Credit-free `--replay` PROVENANCE test (issue #122, ADR 0007 — TDD red gate).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/replay-provenance.test.mjs
//
// THE DEFECT (gap-analysis, run.mjs:1203): `runReplay` builds its report ctx with
//   pluginDir: PLUGIN_DIR, pluginName: PLUGIN_NAME
// — the module-level constants resolved from the REPLAYING process's `COMPAT_PLUGIN_DIR` / repo default —
// instead of anything the bundle recorded. So replaying an upstream-control or mutant bundle prints the
// fork's plugin path under "Plugin under test", attributing a foreign drive to the wrong tree (it already
// happened: reports/l2-trace-equivalence-20260831T022952Z.md). Stage-5 moved model/modelActual/cost to the
// persisted meta with an explicit comment; the plugin identity was simply missed.
//
// THE CONTRACT this file pins (ADR-002 in the #110 decision log, refined by the operator 2026-09-03):
//   1. A schema-v2 bundle (`metaSchema: 2`, `pluginDir` recorded) renders the RECORDED plugin dir in the
//      report header — never the live env value.
//   2. A pre-provenance bundle (no `metaSchema`) whose ts is NOT in l2/variants/legacy-arms.json renders
//      `UNATTRIBUTED (pre-provenance bundle` — and STILL never the live env value.
//   3. (T-PROV-3, in-process) A pre-provenance bundle whose ts IS in a legacy map renders the map's arm
//      as `Variant: <arm> (legacy map — pre-provenance bundle)` and its recovered dir under
//      "Plugin under test" — through the exported pure `provenanceForReplay(meta, ts, legacyMap)` and
//      `buildReport`, with a FAKE map keyed by a 2099-series ts. A real six-bundle ts is NEVER staged or
//      replayed here (it would overwrite the operator's report under reports/).
// Cases 1-2 set `COMPAT_PLUGIN_DIR` to a distinctive marker path so a leak of the live value is
// unambiguous in the assertion message; case 3 is pure (no env), so it asserts the map's recovered dir
// and the legacy-map labels are what the header renders — nothing from the replaying process.
//
// CREDIT-FREE BY CONSTRUCTION: same bogus `sdkPath` proof as replay.test.mjs — `--replay` returns before
// any `import(sdkPath)`. FIXTURE: the committed research fixtures staged exactly as replay.test.mjs does
// (same rundir shape, same GOOD_REPORT so the RE-RUN oracle lands AS-EXPECTED and the report is written).
// Zero-dependency, self-cleaning (mkdtemp bundle + the side-effect report are removed in `finally`).
// Distinct ts stamps from replay.test.mjs so the two files never race on the same report filename.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { provenanceForReplay, buildReport } from '../run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const RUN_MJS = path.join(L2_DIR, 'run.mjs');
const REPORTS_DIR = path.resolve(L2_DIR, '..', 'reports');
const FIX = path.join(__dirname, 'fixtures', 'research');

// The replaying process's plugin dir — a marker that must NEVER reach a replayed report header.
const LIVE_MARKER = '/live-process-marker/plugins/maister-copilot';
// What the bundle recorded at drive time (schema v2 case).
const RECORDED_DIR = '/recorded-at-drive-time/upstream-variant-1isJtp/plugins/maister-copilot';

const GOOD_REPORT = [
  '# Research Report: L2 Replay Provenance',
  '',
  '## Findings',
  'The --replay path reconstructs extract()\'s inputs from a persisted bundle and re-executes the',
  'outcome oracle against the persisted rundir copy, then reuses finalizeSingleRun so the verdict,',
  'exit code, and report are byte-identical to a live N=1 run. It dispatches before any SDK import,',
  'so the whole round-trip spends no Copilot seat and no AI credit.',
  'The sample CLI also implements `frobnicate` but leaves it unreachable from the dispatcher (dead code).',
  '',
  '## Conclusion',
  'A persisted bundle reproduces its recorded verdict deterministically and credit-free.',
  '',
].join('\n');

function stageBundle(root, ts, metaExtra) {
  const bundleDir = path.join(root, ts);
  const taskDir = path.join(bundleDir, 'rundir', '.maister', 'tasks', 'research', '2026-08-29-l2-replay');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'events.sample.json'), path.join(bundleDir, 'events.json'));
  fs.cpSync(path.join(FIX, 'task-tree'), taskDir, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'orchestrator-state.sample.yml'), path.join(taskDir, 'orchestrator-state.yml'));
  fs.writeFileSync(path.join(taskDir, 'outputs', 'research-report.md'), GOOD_REPORT);
  fs.writeFileSync(
    path.join(bundleDir, 'replay-meta.json'),
    JSON.stringify({
      scenario: 'research',
      taskType: 'research',
      copilotVersion: '1.0.82',
      sdkPath: '/nonexistent/replay/sdk/must-never-be-imported.mjs', // credit-free proof: never loaded
      ts,
      originalMode: 'live',
      maisterVersion: '0.0.0',
      ...metaExtra,
    }, null, 2),
  );
  return bundleDir;
}

function runReplay(dir) {
  const res = spawnSync(process.execPath, [RUN_MJS, `--replay=${dir}`], {
    cwd: L2_DIR,
    encoding: 'utf8',
    env: { ...process.env, COMPAT_PLUGIN_DIR: LIVE_MARKER },
  });
  assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

function headerLine(report) {
  const m = report.match(/^- \*\*Plugin under test:\*\* .*$/m);
  assert.ok(m, 'report must carry a "Plugin under test" header line');
  return m[0];
}

test('T-PROV-1: --replay of a schema-v2 bundle renders the RECORDED pluginDir, never the live COMPAT_PLUGIN_DIR (#122, ADR-002)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-replay-prov-'));
  const ts = '20990102T000000Z';
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const bundleDir = stageBundle(root, ts, {
      metaSchema: 2,
      variant: 'plain',
      pluginDir: RECORDED_DIR,
      pluginName: 'maister-copilot',
    });
    const { status, out } = runReplay(bundleDir);
    assert.equal(status, 0, `expected exit 0 (AS-EXPECTED), got ${status}\n${out}`);
    assert.ok(fs.existsSync(reportPath), `expected a report at ${reportPath}\n${out}`);
    const line = headerLine(fs.readFileSync(reportPath, 'utf8'));
    assert.ok(!line.includes(LIVE_MARKER),
      `header leaked the REPLAYING process's plugin dir instead of the bundle's recorded one:\n${line}`);
    assert.ok(line.includes(RECORDED_DIR),
      `header must render the pluginDir recorded in replay-meta.json (${RECORDED_DIR}):\n${line}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

test('T-PROV-2: --replay of a PRE-PROVENANCE bundle (no metaSchema, ts not in legacy-arms.json) renders UNATTRIBUTED, never the live COMPAT_PLUGIN_DIR (#122, ADR-002)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-replay-prov-'));
  const ts = '20990103T000000Z';
  const reportPath = path.join(REPORTS_DIR, `l2-trace-equivalence-${ts}.md`);
  try {
    const bundleDir = stageBundle(root, ts, {}); // 13-key legacy shape: no metaSchema, no pluginDir
    const { status, out } = runReplay(bundleDir);
    assert.equal(status, 0, `expected exit 0 (AS-EXPECTED), got ${status}\n${out}`);
    assert.ok(fs.existsSync(reportPath), `expected a report at ${reportPath}\n${out}`);
    const line = headerLine(fs.readFileSync(reportPath, 'utf8'));
    assert.ok(!line.includes(LIVE_MARKER),
      `header leaked the REPLAYING process's plugin dir for a bundle that recorded none:\n${line}`);
    assert.match(line, /UNATTRIBUTED \(pre-provenance bundle/,
      `a pre-provenance bundle outside the legacy map must be labelled UNATTRIBUTED:\n${line}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(reportPath, { force: true });
  }
});

test('T-PROV-3: provenanceForReplay with a fake legacy map renders "Variant: upstream-control (legacy map — pre-provenance bundle)" and the recovered dir (#122, R3.2/R3.3)', () => {
  const ts = '20990104T000000Z'; // 2099-series: NOT one of the six real bundles, never touches reports/
  const RECOVERED = '/recovered-from-skill-invoked/upstream-variant-1isJtp/plugins/maister-copilot';
  const fakeMap = {
    schema: 1,
    bundles: {
      [ts]: { legacyArm: 'upstream-control', scenario: 'research', maisterVersion: '2.2.3', pluginDirRecovered: RECOVERED, comparable: false, note: 'fake' },
    },
  };
  const legacyMeta = { scenario: 'research', taskType: 'research', copilotVersion: '1.0.82', ts, originalMode: 'live', maisterVersion: '0.0.0' }; // 13-key shape: no metaSchema

  const prov = provenanceForReplay(legacyMeta, ts, fakeMap);
  assert.equal(prov.provenance, 'legacy-map', 'a pre-provenance ts found in the map is attributed from the map');
  assert.equal(prov.legacyArm, 'upstream-control', 'legacyArm comes from the map row');
  assert.equal(prov.pluginDirRecovered, RECOVERED, 'pluginDirRecovered comes from the map row');
  assert.equal(prov.pluginName, 'maister-copilot', 'pluginName is the fixed plugin name');
  assert.ok(!Object.values(prov).includes(undefined), `no ctx field may be undefined: ${JSON.stringify(prov)}`);

  const md = buildReport({
    scenarioId: 'research', mode: 'replayed', replaySource: `/bundles/${ts}`, overall: 'AS-EXPECTED',
    counts: { pass: 1, limitation: 0, skip: 0, fail: 0 }, observed: new Set(['reached_terminal(completion)']),
    reference: { required: [], optional: [] }, result: { diffs: [] }, incompleteReason: null,
    copilotVersion: '1.0.82', maisterVersion: '0.0.0', osStr: 'test-os', ts, isolationNote: 'unit-test',
    finalN: 1, sdkPath: '/sdk', parseWarnings: [],
    ...prov,
  });
  const plugin = headerLine(md);
  assert.ok(plugin.includes(RECOVERED), `Plugin under test must render the map's recovered dir:\n${plugin}`);
  assert.ok(plugin.includes('legacy map — pre-provenance bundle'), `Plugin under test must be labelled as a legacy-map attribution:\n${plugin}`);
  assert.ok(!plugin.includes(LIVE_MARKER) && !md.includes(LIVE_MARKER), 'the live process marker never reaches a legacy-map header');
  assert.match(md, /^- \*\*Variant:\*\* upstream-control \(legacy map — pre-provenance bundle\)$/m,
    `Variant line must render the legacy arm with the legacy-map label:\n${md.split('\n').slice(0, 12).join('\n')}`);
  assert.match(md, /^- \*\*Plugin source:\*\* unknown \(pre-provenance bundle\)$/m, 'Plugin source is unknown for a legacy bundle');
  assert.match(md, /^- \*\*Plugin digest:\*\* unknown \(pre-provenance bundle\)$/m, 'Plugin digest is unknown for a legacy bundle');
  assert.match(md, /^- \*\*Session options:\*\* unknown \(pre-provenance bundle\)$/m, 'Session options are unknown for a legacy bundle');
  assert.ok(!md.includes('undefined'), 'a legacy-map report never renders "undefined"');
});
