// Credit-free PIPELINE INTEGRATION test (Task Group 7 / AC3) — the shared-contract validator.
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/pipeline.test.mjs
//
// Feeds the committed extractor fixtures
//   test/fixtures/extractor/{events.sample.json, orchestrator-state.sample.yml, task-tree/}
// through the FULL pure pipeline  extract -> normalize -> compare  and asserts:
//   (1) the normalized skeleton exactly equals the committed snapshot
//       test/fixtures/pipeline/expected-skeleton.json  (catches ANY Wave-1 drift in
//       extractor/normalize BEFORE a Copilot seat is spent), and
//   (2) that skeleton CONFORMS to the committed golden reference
//       reference/development.skeleton.json  ->  AS-EXPECTED / exit 0 / 0 diffs.
//
// This is the end-to-end contract check the plan calls out: run.mjs is only thin SDK glue,
// so all asserted logic lives here in the pure modules (already unit-tested per module).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../extractor.mjs';
import { normalize } from '../normalize.mjs';
import { compare, EXIT } from '../compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const EXTRACTOR_FIX = path.join(__dirname, 'fixtures', 'extractor');
const PIPELINE_FIX = path.join(__dirname, 'fixtures', 'pipeline');

const events = JSON.parse(fs.readFileSync(path.join(EXTRACTOR_FIX, 'events.sample.json'), 'utf8'));
const stateYaml = fs.readFileSync(path.join(EXTRACTOR_FIX, 'orchestrator-state.sample.yml'), 'utf8');
const taskDirRoot = path.join(EXTRACTOR_FIX, 'task-tree');

const expected = JSON.parse(fs.readFileSync(path.join(PIPELINE_FIX, 'expected-skeleton.json'), 'utf8'));
const golden = JSON.parse(
  fs.readFileSync(path.join(L2_DIR, 'reference', 'development.skeleton.json'), 'utf8'),
);

test('pipeline: extract -> normalize -> compare over committed fixtures yields the expected skeleton + AS-EXPECTED (AC3)', () => {
  // --- extract (events u tree u state -> raw records) ------------------------------------
  const ex = extract({ events, taskDirRoot, stateYaml });

  // The fixtures represent a COMPLETE run: the MEDIUM-2 sanity floor must NOT trip
  // (phases present alongside artifacts), so the pipeline yields a real verdict.
  assert.equal(ex.incomplete, false, `unexpected INCOMPLETE: ${ex.incompleteReason}`);
  // All three sources contributed (proves the merge wiring end to end).
  assert.deepEqual(
    new Set(ex.records.map((r) => r.source)),
    new Set(['state', 'events', 'tree']),
    'expected records from all three sources (state u events u tree)',
  );

  // FUNCTIONAL ORACLE (issue #48, Stage 2): inject the passing development outcome so the
  // normalized skeleton carries `outcome(tests-pass)=pass` — the required functional predicate the
  // committed reference now models. Real runs source this from the sandbox oracle; the fixture
  // pipeline injects it directly.
  ex.records.push({ kind: 'outcome', name: 'tests-pass', value: 'pass', source: 'outcome', evidence: 'fixture' });

  // --- normalize (raw records -> sorted, de-duplicated Set<string>) ----------------------
  const observed = normalize(ex.records);
  assert.ok(observed instanceof Set, 'normalize must return a Set');
  const observedSorted = [...observed];

  // (1) Exact-skeleton assertion — the shared-contract snapshot. Any change to the
  //     extractor's records or normalize's canonicalization surfaces HERE.
  assert.deepEqual(
    observedSorted,
    expected.skeleton,
    'normalized skeleton drifted from the committed expected-skeleton.json snapshot',
  );
  // Set semantics: sorted + de-duplicated (no accidental duplicate tokens).
  assert.equal(observedSorted.length, new Set(observedSorted).size, 'skeleton contains duplicates');
  assert.deepEqual(observedSorted, [...observedSorted].sort(), 'skeleton is not lexicographically sorted');

  // (2) Conformance — the observed skeleton vs the committed maister-derived reference.
  const result = compare(observed, golden);
  assert.equal(result.overall, 'AS-EXPECTED', `expected AS-EXPECTED, got ${result.overall}`);
  assert.equal(result.exitCode, EXIT.AS_EXPECTED, 'AS-EXPECTED must map to exit 0');
  assert.equal(result.counts.fail, 0, 'no candidate regressions expected');
  assert.equal(result.diffs.length, 0, `expected 0 classified diffs, got ${result.diffs.length}`);
  // Every required predicate matched (nothing missing).
  assert.equal(
    result.matched.length,
    golden.required.length,
    `expected all ${golden.required.length} required predicates matched, got ${result.matched.length}`,
  );

  // A deliberately broken skeleton (drop a required delegation) MUST be caught as REGRESSED —
  // proving the pipeline is a real regression detector, not a rubber stamp.
  const broken = new Set(observed);
  broken.delete('delegated(gap-analyzer)');
  const regressed = compare(broken, golden);
  assert.equal(regressed.overall, 'REGRESSED', 'removing a required delegation must REGRESS');
  assert.equal(regressed.exitCode, EXIT.REGRESSED, 'REGRESSED must map to exit 1');
});
