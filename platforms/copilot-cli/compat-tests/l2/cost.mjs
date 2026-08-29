// l2/cost.mjs — capability-gated, best-effort cost reader over a Copilot `session-store.db`.
//
// Zero-dep ESM, node: builtins only (node:sqlite, node:os, node:path). Reads the real AI-credit
// cost (AIU / weighted requests) of an L2 run from the CLI's local SQLite usage store, bounded on
// BOTH ends by an ISO time window, because the `session.shutdown` event's usage is empty on the
// 1.0.8x CLI. Strictly READ-ONLY and best-effort: every failure/absence (missing `node:sqlite`,
// missing/locked/absent DB, missing table, unsupported open option, malformed file) returns an
// `unavailable` sentinel — it NEVER throws and NEVER breaks the verdict, and NEVER calls a write API.
//
// node:sqlite emits an ExperimentalWarning on Node 22.5–23 (harmless); the Node-24 CI pin avoids
// it. On Node 24+ DatabaseSync is stable.
//
// CostResult:
//   success: { aiu: number|null, weightedRequests: number|null, source: 'session-store.db' }
//            (an empty window → SUM yields null → { aiu:null, weightedRequests:null, source:… } —
//             a readable-but-empty result, NOT `unavailable`)
//   degrade: { aiu: null, weightedRequests: null, unavailable: true, reason: string }

import os from 'node:os';
import path from 'node:path';

const SQL =
  'SELECT SUM(total_nano_aiu) AS nano, SUM(request_multiplier) AS req ' +
  'FROM assistant_usage_events WHERE created_at >= ? AND created_at <= ?';

/**
 * Read the real AIU / weighted-request cost of a run from `session-store.db` over a both-ends
 * ISO window. Best-effort: degrades to the `unavailable` sentinel on any failure, never throws.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath]  Path to session-store.db (defaults to ~/.copilot/session-store.db).
 * @param {string} opts.startIso  Inclusive window start (ISO 8601).
 * @param {string} opts.endIso    Inclusive window end (ISO 8601).
 * @returns {Promise<{aiu:number|null, weightedRequests:number|null, source:'session-store.db'}
 *                   | {aiu:null, weightedRequests:null, unavailable:true, reason:string}>}
 */
export async function readCost({
  dbPath = path.join(os.homedir(), '.copilot', 'session-store.db'),
  startIso,
  endIso,
} = {}) {
  // Capability gate — node:sqlite is not present on every runner.
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return { aiu: null, weightedRequests: null, unavailable: true, reason: 'node:sqlite unavailable' };
  }

  let db;
  try {
    // Open read-only if the option is supported; if it is unrecognised the constructor throws and
    // is caught below → unavailable. Fall back to a plain open but NEVER call a write API.
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
    } catch (optErr) {
      // Distinguish an unsupported-option throw from a genuinely bad DB: only retry a plain open
      // when the readOnly option itself was the problem; a missing/locked DB should degrade.
      if (/readOnly|option|unknown|unexpected/i.test(String(optErr?.message))) {
        db = new DatabaseSync(dbPath);
      } else {
        throw optErr;
      }
    }

    const row = db.prepare(SQL).get(startIso, endIso);
    const nano = row?.nano;
    const req = row?.req;
    return {
      aiu: nano != null ? nano / 1e9 : null,
      weightedRequests: req ?? null,
      source: 'session-store.db',
    };
  } catch (err) {
    return {
      aiu: null,
      weightedRequests: null,
      unavailable: true,
      reason: err?.message || 'session-store.db unavailable',
    };
  } finally {
    try {
      db?.close?.();
    } catch {}
  }
}
