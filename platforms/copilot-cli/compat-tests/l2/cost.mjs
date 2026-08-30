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
//   success: { aiu, weightedRequests, source:'session-store.db', sessionFiltered, models, modelActual }
//            (an empty window → SUM yields null → aiu/weightedRequests null — a readable-but-empty
//             result, NOT `unavailable`. models is [] when the `model` column exists but no rows match,
//             or null when the column is absent; modelActual is the sorted '+'-join of models present.)
//   degrade: { aiu: null, weightedRequests: null, unavailable: true, reason: string }
//
// SCHEMA-GATED, BACKWARD-COMPATIBLE (#63 item 5): the base window SUM is unchanged. Two refinements ride
// ON TOP, each activated ONLY when the live schema supports it (probed via pragma_table_info):
//   • session_id filter — when a sessionId is supplied AND the column exists, the SUM is scoped to that
//     one session, so an overlapping cost window (concurrent CLI activity, or N>1 runs sharing a window)
//     cannot double-count. Absent column / no sessionId → window-only (the Stage-5 behavior).
//   • GROUP BY model — when a `model` column exists, a per-model breakdown fills `modelActual` from the
//     BILLING record (more reliable than the session.shutdown usage, which is often empty on 1.0.8x).
// ⚠ UNVERIFIED-LIVE-SCHEMA GAP (tracked to issue #63 item 9): the exact column names (`session_id`,
// `model`) and whether the SDK's ctx.sessionId equals `assistant_usage_events.session_id` are asserted
// against the FIXTURE db only — they have NOT been confirmed against a real Copilot session-store.db.
// The schema-probe makes a name mismatch DEGRADE SAFELY (falls back to window-only / models:null), never
// a crash — but a silent fallback is still a gap, so the item-9 live sweep must confirm the real names.

import os from 'node:os';
import path from 'node:path';

/**
 * Read the real AIU / weighted-request cost of a run from `session-store.db` over a both-ends
 * ISO window. Best-effort: degrades to the `unavailable` sentinel on any failure, never throws.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath]     Path to session-store.db (defaults to ~/.copilot/session-store.db).
 * @param {string} opts.startIso     Inclusive window start (ISO 8601).
 * @param {string} opts.endIso       Inclusive window end (ISO 8601).
 * @param {string} [opts.sessionId]  When set AND the DB has a `session_id` column, scope the SUM to this
 *                                   session (avoids double-counting an overlapping window). Else ignored.
 * @returns {Promise<{aiu:number|null, weightedRequests:number|null, source:'session-store.db',
 *                    sessionFiltered:boolean, models:Array<{model:string,aiu:number|null,weightedRequests:number|null}>|null,
 *                    modelActual:string|null}
 *                   | {aiu:null, weightedRequests:null, unavailable:true, reason:string}>}
 */
export async function readCost({
  dbPath = path.join(os.homedir(), '.copilot', 'session-store.db'),
  startIso,
  endIso,
  sessionId = null,
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

    // Probe the schema so the session_id filter + GROUP BY model activate ONLY when the live DB supports
    // them (a missing table yields [] here → the base SUM below throws → the `unavailable` degrade, same
    // as before). pragma_table_info takes the table name as a LITERAL (never interpolated user input).
    const cols = new Set(
      db.prepare("SELECT name FROM pragma_table_info('assistant_usage_events')").all().map((r) => r.name),
    );
    const useSession = sessionId != null && cols.has('session_id');
    const hasModel = cols.has('model');

    // WHERE = both-ends window, plus the session scope when supported. Params track the clause order.
    const where = ['created_at >= ?', 'created_at <= ?'];
    const params = [startIso, endIso];
    if (useSession) { where.push('session_id = ?'); params.push(sessionId); }
    const whereSql = where.join(' AND ');

    const row = db
      .prepare(`SELECT SUM(total_nano_aiu) AS nano, SUM(request_multiplier) AS req FROM assistant_usage_events WHERE ${whereSql}`)
      .get(...params);
    const nano = row?.nano;
    const req = row?.req;

    // Per-model breakdown → modelActual, filled from the billing record when the column exists.
    let models = null;
    let modelActual = null;
    if (hasModel) {
      const mrows = db
        .prepare(`SELECT model AS model, SUM(total_nano_aiu) AS nano, SUM(request_multiplier) AS req FROM assistant_usage_events WHERE ${whereSql} GROUP BY model`)
        .all(...params);
      models = mrows
        .filter((r) => r.model != null)
        .map((r) => ({ model: r.model, aiu: r.nano != null ? r.nano / 1e9 : null, weightedRequests: r.req ?? null }))
        .sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
      modelActual = models.length ? models.map((m) => m.model).join('+') : null;
    }

    return {
      aiu: nano != null ? nano / 1e9 : null,
      weightedRequests: req ?? null,
      source: 'session-store.db',
      sessionFiltered: useSession,
      models,
      modelActual,
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
