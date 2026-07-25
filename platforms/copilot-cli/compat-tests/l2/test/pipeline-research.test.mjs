// Credit-free PIPELINE INTEGRATION test for the RESEARCH scenario — mirrors pipeline.test.mjs.
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/pipeline-research.test.mjs
//
// Feeds the committed research fixtures
//   test/fixtures/research/{events.sample.json, orchestrator-state.sample.yml, task-tree/}
// through the FULL pure pipeline  extract(taskType:'research') -> normalize -> compare  and asserts:
//   (1) the normalized skeleton exactly equals the committed snapshot
//       test/fixtures/research/expected-skeleton.json  (catches ANY drift in the research tree
//       profile / extractor / normalize BEFORE a Copilot seat is spent), and
//   (2) that skeleton CONFORMS to the committed golden reference
//       reference/research.skeleton.json  ->  AS-EXPECTED / exit 0 / 0 diffs.
//
// This proves the research scenario's whole credit-free plumbing — the generalized tree profile,
// the shared state parser (research has no task_characteristics), and the model-derived reference.

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
const FIX = path.join(__dirname, 'fixtures', 'research');

const events = JSON.parse(fs.readFileSync(path.join(FIX, 'events.sample.json'), 'utf8'));
const stateYaml = fs.readFileSync(path.join(FIX, 'orchestrator-state.sample.yml'), 'utf8');
const taskDirRoot = path.join(FIX, 'task-tree');
const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'expected-skeleton.json'), 'utf8'));
const golden = JSON.parse(
  fs.readFileSync(path.join(L2_DIR, 'reference', 'research.skeleton.json'), 'utf8'),
);

test('pipeline (research): extract(taskType:research) -> normalize -> compare yields the expected skeleton + AS-EXPECTED', () => {
  // --- extract (events u tree u state -> raw records) ------------------------------------
  const ex = extract({ events, taskDirRoot, stateYaml, taskType: 'research' });

  // A COMPLETE research run: phases present alongside artifacts, so the sanity floor must NOT trip.
  assert.equal(ex.incomplete, false, `unexpected INCOMPLETE: ${ex.incompleteReason}`);
  // All three sources contributed (state u events u tree).
  assert.deepEqual(
    new Set(ex.records.map((r) => r.source)),
    new Set(['state', 'events', 'tree']),
    'expected records from all three sources',
  );
  // Research has no gap-analyzer: the ONLY expected state warning is the absent characteristics block.
  assert.deepEqual(
    ex.parseWarnings,
    ['task_characteristics block not found'],
    'research state should warn ONLY about the (legitimately) absent task_characteristics block',
  );

  // --- normalize (raw records -> sorted, de-duplicated Set<string>) ----------------------
  const observed = normalize(ex.records);
  const observedSorted = [...observed];

  // (1) Exact-skeleton snapshot — any change to the research tree profile / normalize surfaces HERE.
  assert.deepEqual(
    observedSorted,
    expected.skeleton,
    'normalized research skeleton drifted from the committed expected-skeleton.json snapshot',
  );
  assert.equal(observedSorted.length, new Set(observedSorted).size, 'skeleton contains duplicates');
  assert.deepEqual(observedSorted, [...observedSorted].sort(), 'skeleton is not lexicographically sorted');

  // The variable, category-prefixed findings file is deliberately NOT modelled -> must not surface.
  assert.ok(
    !observedSorted.some((t) => /findings/.test(t)),
    'analysis/findings/* must not be captured as a created_artifact',
  );

  // (2) Conformance — the observed skeleton vs the committed maister-derived research reference.
  const result = compare(observed, golden);
  assert.equal(result.overall, 'AS-EXPECTED', `expected AS-EXPECTED, got ${result.overall}`);
  assert.equal(result.exitCode, EXIT.AS_EXPECTED, 'AS-EXPECTED must map to exit 0');
  assert.equal(result.counts.fail, 0, 'no candidate regressions expected');
  assert.equal(result.diffs.length, 0, `expected 0 classified diffs, got ${JSON.stringify(result.diffs)}`);
  assert.equal(
    result.matched.length,
    golden.required.length,
    `expected all ${golden.required.length} required predicates matched, got ${result.matched.length}`,
  );

  // A deliberately broken skeleton (drop a required research delegation) MUST be caught as REGRESSED —
  // proving the research pipeline is a real regression detector, not a rubber stamp.
  const broken = new Set(observed);
  broken.delete('delegated(research-synthesizer)');
  const regressed = compare(broken, golden);
  assert.equal(regressed.overall, 'REGRESSED', 'removing a required research delegation must REGRESS');
  assert.equal(regressed.exitCode, EXIT.REGRESSED, 'REGRESSED must map to exit 1');
});
