// Credit-free unit tests for aggregateRuns — the N-run noise-calibration reducer (--runs=N,
// L2-DESIGN §4). PURE set algebra over inline Set<string> inputs: no SDK import, no seat, no file
// I/O, no credits (importing run.mjs is side-effect-free — main() runs only under the isMain guard,
// and the SDK is a dynamic import inside runLive).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/aggregate.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateRuns } from '../run.mjs';

test('aggregateRuns: stable = intersection, noise carries per-predicate counts, n = sets.length', () => {
  const sets = [
    new Set(['a', 'b', 'c']),
    new Set(['a', 'b', 'x']),
    new Set(['a', 'b', 'c']),
  ];
  const agg = aggregateRuns(sets);

  assert.equal(agg.n, 3, 'n is the number of input sets');
  // Present in ALL 3 runs -> stable (sorted).
  assert.deepEqual(agg.stable, ['a', 'b'], 'stable is the intersection across all sets');
  // c in 2/3, x in 1/3 -> noise with exact occurrence counts (sorted by predicate).
  assert.deepEqual(
    agg.noise,
    [{ predicate: 'c', count: 2 }, { predicate: 'x', count: 1 }],
    'noise lists predicates present in 1..n-1 sets with their occurrence count',
  );
  // union = every predicate seen in any run, sorted + de-duplicated.
  assert.deepEqual(agg.union, ['a', 'b', 'c', 'x']);
});

test('aggregateRuns: identical runs -> everything stable, zero noise', () => {
  const sets = [new Set(['p', 'q']), new Set(['q', 'p']), new Set(['p', 'q'])];
  const agg = aggregateRuns(sets);

  assert.equal(agg.n, 3);
  assert.deepEqual(agg.stable, ['p', 'q']);
  assert.deepEqual(agg.noise, [], 'no predicate flaps when all runs agree');
  assert.deepEqual(agg.union, ['p', 'q']);
});

test('aggregateRuns: n=1 -> the single run is entirely stable (present in all 1 sets), no noise', () => {
  const agg = aggregateRuns([new Set(['z', 'a', 'm'])]);

  assert.equal(agg.n, 1);
  assert.deepEqual(agg.stable, ['a', 'm', 'z'], 'stable is lexicographically sorted');
  assert.deepEqual(agg.noise, [], 'with n=1 there is no 1..n-1 band -> nothing is noise');
  assert.deepEqual(agg.union, ['a', 'm', 'z']);
});

test('aggregateRuns: exact counts across 4 runs, and all outputs are sorted', () => {
  const sets = [
    new Set(['keep', 'flap1', 'flap2']),
    new Set(['keep', 'flap1']),
    new Set(['keep', 'flap2', 'flap3']),
    new Set(['keep', 'flap1']),
  ];
  const agg = aggregateRuns(sets);

  assert.equal(agg.n, 4);
  assert.deepEqual(agg.stable, ['keep'], 'only "keep" is in all 4 runs');
  // flap1: runs 1,2,4 -> 3; flap2: runs 1,3 -> 2; flap3: run 3 -> 1.
  assert.deepEqual(agg.noise, [
    { predicate: 'flap1', count: 3 },
    { predicate: 'flap2', count: 2 },
    { predicate: 'flap3', count: 1 },
  ]);
  assert.deepEqual(agg.union, ['flap1', 'flap2', 'flap3', 'keep']);

  // Explicit sortedness invariants (defends against a Map-iteration-order regression).
  assert.deepEqual(agg.stable, [...agg.stable].sort(), 'stable sorted');
  assert.deepEqual(agg.union, [...agg.union].sort(), 'union sorted');
  const noisePreds = agg.noise.map((e) => e.predicate);
  assert.deepEqual(noisePreds, [...noisePreds].sort(), 'noise sorted by predicate');
});
