// Deterministic generator for the committed cost fixture `session-store.db`.
//
// Zero-dep, node: builtins only (node:sqlite, node:path, node:url, node:fs). Reproduces the
// exact SQLite database that `test/cost.test.mjs` reads against, so the committed binary is
// never hand-crafted — regenerate with:
//   node platforms/copilot-cli/compat-tests/l2/test/fixtures/cost/gen-fixture-db.mjs
//
// node:sqlite emits an ExperimentalWarning on Node 22.5–23 (harmless); the Node-24 CI pin
// avoids it. On Node 24+ the DatabaseSync API is stable.
//
// ── Cost window under test ────────────────────────────────────────────────────
//   W_START = '2026-08-29T10:00:00.000Z'
//   W_END   = '2026-08-29T10:30:00.000Z'  (both ends INCLUSIVE — created_at >= ? AND <= ?)
//
// Rows (created_at ISO, total_nano_aiu, request_multiplier, in-window?):
//   2026-08-29T09:59:00.000Z   9_000_000_000   99    NO  (before W_START — must be EXCLUDED)
//   2026-08-29T10:05:00.000Z   1_000_000_000    1    YES
//   2026-08-29T10:15:00.000Z   2_500_000_000    2.5  YES
//   2026-08-29T10:29:00.000Z     500_000_000    1    YES
//   2026-08-29T10:31:00.000Z   9_000_000_000   99    NO  (after W_END — must be EXCLUDED)
//
// Expected in-window sums (the both-ends proof):
//   SUM(total_nano_aiu) = 4_000_000_000  → aiu = 4.0
//   SUM(request_multiplier) = 4.5        → weightedRequests = 4.5
// If either out-of-window row leaked in, nano would be 13e9 (aiu 13.0) and req 103.5 — so the
// exact 4.0 / 4.5 assertion is a strict both-ends exclusion proof.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(HERE, 'session-store.db');

// Start from a clean slate so the artifact is byte-deterministic across regenerations.
try { fs.rmSync(DB_PATH, { force: true }); } catch {}

const db = new DatabaseSync(DB_PATH);
try {
  db.exec(`
    CREATE TABLE assistant_usage_events (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      total_nano_aiu INTEGER,
      request_multiplier REAL
    );
  `);

  const rows = [
    // [id, created_at, total_nano_aiu, request_multiplier]
    [1, '2026-08-29T09:59:00.000Z', 9_000_000_000, 99],  // before window — excluded
    [2, '2026-08-29T10:05:00.000Z', 1_000_000_000, 1],   // in window
    [3, '2026-08-29T10:15:00.000Z', 2_500_000_000, 2.5], // in window
    [4, '2026-08-29T10:29:00.000Z', 500_000_000, 1],     // in window
    [5, '2026-08-29T10:31:00.000Z', 9_000_000_000, 99],  // after window — excluded
  ];

  const ins = db.prepare(
    'INSERT INTO assistant_usage_events (id, created_at, total_nano_aiu, request_multiplier) VALUES (?, ?, ?, ?)'
  );
  for (const r of rows) ins.run(...r);

  // Self-check the fixture is what the test expects before we commit it.
  const W_START = '2026-08-29T10:00:00.000Z';
  const W_END = '2026-08-29T10:30:00.000Z';
  const got = db
    .prepare(
      'SELECT SUM(total_nano_aiu) AS nano, SUM(request_multiplier) AS req FROM assistant_usage_events WHERE created_at >= ? AND created_at <= ?'
    )
    .get(W_START, W_END);

  console.log('wrote', DB_PATH);
  console.log('window', W_START, '..', W_END);
  console.log('in-window nano =', got.nano, '→ aiu =', got.nano / 1e9);
  console.log('in-window req  =', got.req);
  if (got.nano !== 4_000_000_000 || got.req !== 4.5) {
    throw new Error(`fixture self-check FAILED: nano=${got.nano} req=${got.req} (expected 4e9 / 4.5)`);
  }
  console.log('fixture self-check OK (4.0 AIU / 4.5 req, both out-of-window rows excluded)');
} finally {
  try { db.close(); } catch {}
}
