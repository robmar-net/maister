// Credit-free unit tests for extractUsage / sumUsage — AI-credit accounting derived from the live
// session's typed event stream (`session.shutdown` -> `totalNanoAiu` + `modelMetrics`). PURE over an
// inline events array: no SDK import, no seat, no file I/O, no credits (importing run.mjs is
// side-effect-free — main() runs only under the isMain guard, and the SDK is a dynamic import inside
// runLive).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/usage.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractUsage, sumUsage } from '../run.mjs';

test('extractUsage: reads session.shutdown totalNanoAiu -> AIU and sums modelMetrics request counts', () => {
  const events = [
    { type: 'session.start', data: {} },
    { type: 'skill.invoked', data: { skill: 'development' } },
    {
      type: 'session.shutdown',
      data: {
        totalNanoAiu: 2_500_000_000, // -> 2.5 AIU (AIU = totalNanoAiu / 1e9)
        modelMetrics: {
          'gpt-5': { requests: { count: 30, cost: 12 }, totalNanoAiu: 2_000_000_000, usage: {} },
          'gpt-5-mini': { requests: { count: 12 }, totalNanoAiu: 500_000_000, usage: {} },
        },
      },
    },
  ];
  const u = extractUsage(events);
  assert.equal(u.aiu, 2.5, 'AIU = totalNanoAiu / 1e9');
  assert.equal(u.nanoAiu, 2_500_000_000, 'raw nano value preserved');
  assert.equal(u.apiRequests, 42, 'apiRequests = sum of per-model requests.count (30 + 12)');
  assert.deepEqual(u.models['gpt-5'], { requests: 30, aiu: 2 }, 'per-model AIU derived from its totalNanoAiu');
  assert.equal(u.models['gpt-5-mini'].requests, 12);
});

test('extractUsage: no session.shutdown event -> all fields null (never fabricates a cost)', () => {
  const events = [
    { type: 'session.start', data: {} },
    { type: 'skill.invoked', data: { skill: 'development' } },
    { type: 'subagent.started', data: { agent: 'gap-analyzer' } },
  ];
  const u = extractUsage(events);
  assert.deepEqual(u, { aiu: null, nanoAiu: null, apiRequests: null, models: null });
});

test('extractUsage: shutdown with totalNanoAiu but no modelMetrics -> AIU known, apiRequests null (unknown, not 0)', () => {
  const u = extractUsage([{ type: 'session.shutdown', data: { totalNanoAiu: 1_000_000_000 } }]);
  assert.equal(u.aiu, 1, 'AIU still derived from totalNanoAiu');
  assert.equal(u.apiRequests, null, 'missing modelMetrics -> request count is unknown, not fabricated as 0');
  assert.equal(u.models, null);
});

test('extractUsage: non-array / empty input -> all null (defensive)', () => {
  const NONE = { aiu: null, nanoAiu: null, apiRequests: null, models: null };
  assert.deepEqual(extractUsage(undefined), NONE);
  assert.deepEqual(extractUsage([]), NONE);
});

test('sumUsage: totals AIU + apiRequests across attempted runs (incl. incompletes that spent credits)', () => {
  const total = sumUsage([
    { aiu: 2.5, nanoAiu: 2_500_000_000, apiRequests: 42 }, // a completed run
    { aiu: 0.5, nanoAiu: 500_000_000, apiRequests: 8 },    // an INCOMPLETE run that was still billed
    null,                                                  // a run with no result object
  ]);
  assert.equal(total.nanoAiu, 3_000_000_000);
  assert.equal(total.aiu, 3, 'summed AIU = 2.5 + 0.5');
  assert.equal(total.apiRequests, 50, 'summed API requests = 42 + 8');
});

test('sumUsage: all-unknown inputs -> null fields (unknown never becomes 0)', () => {
  const total = sumUsage([
    { aiu: null, nanoAiu: null, apiRequests: null },
    null,
    undefined,
  ]);
  assert.deepEqual(total, { aiu: null, nanoAiu: null, apiRequests: null });
});
