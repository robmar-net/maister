// Credit-free, fixture-driven unit tests for `readCost` (l2/cost.mjs) — the capability-gated
// cost reader over a Copilot `session-store.db`. Reads the committed fixture
// `test/fixtures/cost/session-store.db` (produced by `test/fixtures/cost/gen-fixture-db.mjs`).
// No seat, no live SDK, no credits.
//
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/cost.test.mjs
//
// node:sqlite emits an ExperimentalWarning on Node 22.5–23 (harmless); tests still pass. The
// Node-24 CI pin avoids the warning. The `node:sqlite`-ABSENT capability-gate branch cannot be
// exercised on a runner that HAS sqlite; it is covered by inspection + Test 3's degrade shape
// (which is exactly what the absent-sqlite branch also returns) — and the real-read tests are
// skip-guarded so a runner WITHOUT sqlite still passes this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCost } from '../cost.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'cost', 'session-store.db');

// The fixture's known window (see gen-fixture-db.mjs).
const W_START = '2026-08-29T10:00:00.000Z';
const W_END = '2026-08-29T10:30:00.000Z';

let hasSqlite;
try {
  await import('node:sqlite');
  hasSqlite = true;
} catch {
  hasSqlite = false;
}

test('readCost: both-ends window sums the 3 in-window rows and EXCLUDES the 2 out-of-window rows', { skip: !hasSqlite }, async () => {
  const res = await readCost({ dbPath: FIXTURE, startIso: W_START, endIso: W_END });
  // In-window: 1e9 + 2.5e9 + 0.5e9 = 4e9 nano → 4.0 AIU; req 1 + 2.5 + 1 = 4.5.
  // If either out-of-window row (9e9 nano / 99 req, at 09:59 and 10:31) leaked in, these would be
  // 13.0 AIU / 103.5 req — so the exact match is a strict both-ends exclusion proof.
  assert.deepEqual(res, { aiu: 4, weightedRequests: 4.5, source: 'session-store.db' });
});

test('readCost: empty window (no rows) -> readable-but-empty (nulls), NOT unavailable', { skip: !hasSqlite }, async () => {
  const res = await readCost({
    dbPath: FIXTURE,
    startIso: '2000-01-01T00:00:00.000Z',
    endIso: '2000-01-01T00:00:01.000Z',
  });
  assert.deepEqual(res, { aiu: null, weightedRequests: null, source: 'session-store.db' });
  assert.ok(!('unavailable' in res), 'an empty window is a valid read, not an unavailable sentinel');
});

test('readCost: nonexistent DB -> unavailable sentinel, NEVER throws (always runs, no sqlite needed to prove the degrade shape)', async () => {
  let res;
  await assert.doesNotReject(async () => {
    res = await readCost({
      dbPath: '/nonexistent/definitely/not/here/session-store.db',
      startIso: W_START,
      endIso: W_END,
    });
  });
  assert.equal(res.unavailable, true, 'bad path degrades to the unavailable sentinel');
  assert.equal(res.aiu, null);
  assert.equal(res.weightedRequests, null);
  assert.equal(typeof res.reason, 'string');
});

test('readCost: existing DB but missing table -> unavailable sentinel, never throws', { skip: !hasSqlite }, async () => {
  // The fixture generator itself is a real file but is NOT a DB with the queried table when read
  // as one via a mismatched query is out of scope; instead point at THIS test file (a real file,
  // not a valid SQLite DB) to exercise the malformed-DB degrade path.
  const res = await readCost({
    dbPath: fileURLToPath(import.meta.url),
    startIso: W_START,
    endIso: W_END,
  });
  assert.equal(res.unavailable, true, 'a non-SQLite / missing-table file degrades to unavailable');
  assert.equal(res.aiu, null);
});
