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
// Schema mirrors the #63 item-5 columns: session_id + model ride ALONGSIDE the Stage-5 window columns
// so cost.test.mjs can prove (a) window-only backward compatibility, (b) session_id double-count
// avoidance, and (c) GROUP BY model. (⚠ these column NAMES are unverified against a real
// session-store.db — see cost.mjs's UNVERIFIED-LIVE-SCHEMA note, tracked to item 9.)
//
// Rows (created_at ISO, session_id, model, total_nano_aiu, request_multiplier, in-window?):
//   09:59  sessA  claude-opus-4-8    9e9   99   NO  (before W_START — EXCLUDED)
//   10:05  sessA  claude-opus-4-8    1e9    1   YES
//   10:15  sessA  claude-sonnet-5    2.5e9  2.5 YES
//   10:29  sessB  claude-opus-4-8    0.5e9  1   YES  (DIFFERENT session — the double-count trap)
//   10:31  sessA  claude-opus-4-8    9e9   99   NO  (after W_END — EXCLUDED)
//
// Expected sums:
//   window-only (no session filter): id2+id3+id4 = 4.0 AIU / 4.5 req  (unchanged from Stage 5 —
//     backward-compatible; note sessB's id4 leaks in without a session filter — the double-count).
//   session=sessA:  id2+id3 = 3.5 AIU / 3.5 req  (sessB's id4 EXCLUDED — the avoidance proof: 3.5≠4.0).
//   session=sessB:  id4     = 0.5 AIU / 1 req.
//   GROUP BY model (window-only): claude-opus-4-8 = 1.5 AIU (id2+id4), claude-sonnet-5 = 2.5 AIU (id3).

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
      session_id TEXT,
      model TEXT,
      total_nano_aiu INTEGER,
      request_multiplier REAL
    );
  `);

  const rows = [
    // [id, created_at, session_id, model, total_nano_aiu, request_multiplier]
    [1, '2026-08-29T09:59:00.000Z', 'sessA', 'claude-opus-4-8', 9_000_000_000, 99],  // before window — excluded
    [2, '2026-08-29T10:05:00.000Z', 'sessA', 'claude-opus-4-8', 1_000_000_000, 1],   // in window
    [3, '2026-08-29T10:15:00.000Z', 'sessA', 'claude-sonnet-5', 2_500_000_000, 2.5], // in window
    [4, '2026-08-29T10:29:00.000Z', 'sessB', 'claude-opus-4-8', 500_000_000, 1],     // in window — OTHER session
    [5, '2026-08-29T10:31:00.000Z', 'sessA', 'claude-opus-4-8', 9_000_000_000, 99],  // after window — excluded
  ];

  const ins = db.prepare(
    'INSERT INTO assistant_usage_events (id, created_at, session_id, model, total_nano_aiu, request_multiplier) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const r of rows) ins.run(...r);

  // Self-check the fixture is what the tests expect before we commit it.
  const W_START = '2026-08-29T10:00:00.000Z';
  const W_END = '2026-08-29T10:30:00.000Z';
  const win = db
    .prepare('SELECT SUM(total_nano_aiu) AS nano, SUM(request_multiplier) AS req FROM assistant_usage_events WHERE created_at >= ? AND created_at <= ?')
    .get(W_START, W_END);
  const sessA = db
    .prepare('SELECT SUM(total_nano_aiu) AS nano, SUM(request_multiplier) AS req FROM assistant_usage_events WHERE created_at >= ? AND created_at <= ? AND session_id = ?')
    .get(W_START, W_END, 'sessA');

  console.log('wrote', DB_PATH);
  console.log('window-only nano =', win.nano, '→ aiu =', win.nano / 1e9, '/ req', win.req);
  console.log('session=sessA nano =', sessA.nano, '→ aiu =', sessA.nano / 1e9, '/ req', sessA.req);
  if (win.nano !== 4_000_000_000 || win.req !== 4.5) {
    throw new Error(`window-only self-check FAILED: nano=${win.nano} req=${win.req} (expected 4e9 / 4.5)`);
  }
  if (sessA.nano !== 3_500_000_000 || sessA.req !== 3.5) {
    throw new Error(`session=sessA self-check FAILED: nano=${sessA.nano} req=${sessA.req} (expected 3.5e9 / 3.5)`);
  }
  console.log('fixture self-check OK (window 4.0/4.5; sessA 3.5/3.5 — sessB excluded = double-count avoided)');
} finally {
  try { db.close(); } catch {}
}
