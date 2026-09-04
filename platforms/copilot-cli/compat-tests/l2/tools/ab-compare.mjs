// ab-compare.mjs — MINIMAL attribution-only comparer over persisted L2 replay bundles (issue #122, spec R8).
// Zero-dependency (node: builtins + the L2 harness modules), STRICTLY READ-ONLY: it opens events.json +
// replay-meta.json of each bundle, never writes, never spawns a seat, never imports the SDK, prints to stdout.
//
// Usage:
//   node l2/tools/ab-compare.mjs <bundle-dir>... [--json] [--allow-mutants] [--allow-model-mix]
//   node l2/tools/ab-compare.mjs platforms/copilot-cli/compat-tests/reports/2026*
//
//   --json             deterministic JSON `{ rows: [...], refused: [...] }` (fixed key order; both lists sorted
//                      by ts, then dir) instead of the markdown table
//   --allow-mutants    list a `mutation` != null bundle instead of refusing it: a VISIBLE row whose arm cell is
//                      `mutant <id>` (or `<variant> (mutant <id>)` when a variant was also recorded), source
//                      `meta`, comparable `no (mutant)`, commit from pluginSource — never hidden, never
//                      comparable. Real mutants are driven WITHOUT --variant (run.sh rejects the pair), so
//                      `variant: null` is their normal shape and is NOT the unattributed refusal here.
//   --allow-model-mix  list a served-model mismatch instead of refusing it: the offending rows stay, marked
//                      comparable `no (model mix)`, under a VISIBLE `WARNING: served-model mismatch …` line
//                      above the table. For inspecting a mixed set on purpose — never for a cost comparison.
//
// MODEL-MIX REFUSAL (#129). Copilot re-decides the model PER DELEGATION at `subagent.configured` time and
// ignores both the session pin and the agent's `model: inherit`; one `claude-sonnet-5` subagent is worth
// ~24 AIU on a development drive and ~82 on research, ten times `gpt-5.6-luna`. Two drives whose SERVED-MODEL
// SETS differ therefore have incomparable AIU no matter what the arms did, so `ab-compare` REFUSES them:
// `served-model mismatch: <this set> vs <the majority set>`, exit 2, unless `--allow-model-mix`. The set is
// each bundle's own `assistant.usage.data.model` values, deduped and sorted — read from the bundle, never
// from a model catalog (the catalog rotates; see cost-report.mjs's KNOWN_RATES comment). The guard applies
// only to rows that are `comparable: yes`; a legacy-map or an allowed-mutant row is already labelled
// non-comparable and neither triggers nor suffers the refusal.
//
// Per bundle (R8, + the fix-pass amendment for allowed mutants):
//   metaSchema >= 2   mutation non-null -> REFUSE `mutant <id> (pass --allow-mutants)` unless --allow-mutants,
//                     in which case -> row arm `mutant <id>` / `<variant> (mutant <id>)`, source `meta`,
//                     comparable `no (mutant)`, commit = pluginSource.commit;
//                     else variant null -> REFUSE `unattributed (driven without --variant)`;
//                     else arm = variant, source `meta`, comparable `yes`, commit = pluginSource.commit
//   pre-provenance    ts in l2/variants/legacy-arms.json -> arm = legacyArm, source `legacy-map`,
//                     comparable `no (legacy)` (listed with the note, NOT refused);
//                     else REFUSE `pre-provenance bundle not in legacy-arms.json`
//   unreadable        (no/invalid events.json or replay-meta.json) -> REFUSE `unreadable bundle: <detail>`
//                     — an R8 amendment (not in the spec's three reasons): the per-bundle refusal keeps the
//                     rest of a glob listed instead of aborting the whole comparison.
//   model mix         (#129, across bundles, after classification) a `comparable: yes` row whose served-model
//                     set differs from the majority one -> REFUSE `served-model mismatch: <set> vs <majority>`
//                     unless --allow-model-mix.
//
// Output: markdown table `ts | scenario | arm | source | comparable | commit | AIU | models` (AIU `unknown`
// when null, 6 dp otherwise; commit = the 8-hex short oid, `unknown` when not recorded — the JSON keeps the
// full oid; models = the served-model set, `+`-joined, shortened to the last dash-separated segment only
// when that is unambiguous across the whole table — otherwise the full ids, and `unknown` for a bundle with
// no usage event; there is no nickname map) then one `REFUSED: <ts> — <reason>` line per refusal. Exit 2 if
// any refusal (or usage error), else 0.
//
// DELIBERATELY ABSENT (deferred to #123): ranking, Δ between arms, tiers, any verdict logic. This tool only
// answers "which arm is each bundle, on what evidence, and is it comparable at all?".
//
// Exports (pure): classifyBundle, compareBundles, renderMarkdown, renderJson; the CLI is guarded by the
// realpath import.meta.url idiom (run.mjs / cost-report.mjs) so this module can be imported by tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLegacyArms, provenanceForReplay } from '../run.mjs';
import { loadBundle, computeMetrics } from './cost-report.mjs';
import { EXIT } from '../compare.mjs';

const TS_RE = /^\d{8}T\d{6}Z$/;

// R8 refusal reasons — VERBATIM (tests + spec pin these strings).
export const REASON = Object.freeze({
  mutant: (id) => `mutant ${id} (pass --allow-mutants)`,
  unattributed: 'unattributed (driven without --variant)',
  unmapped: 'pre-provenance bundle not in legacy-arms.json',
  unreadable: (detail) => `unreadable bundle: ${detail}`,
  modelMix: (set, majority) => `served-model mismatch: ${set} vs ${majority}`,
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// A served-model set as one cell / one refusal token. `unknown` (never `none`, never an empty cell) when the
// bundle carries no assistant.usage event: we did not observe the models, we did not observe their absence.
export const setLabel = (models) => (Array.isArray(models) && models.length ? models.join('+') : 'unknown');

// The bundle ts: the directory basename when it is a ts stamp (reports/<ts>), else meta.ts, else null.
function tsOf(dir, meta) {
  const base = path.basename(dir);
  if (TS_RE.test(base)) return base;
  return typeof meta?.ts === 'string' ? meta.ts : null;
}

// ---------------------------------------------------------------- classification (pure)
// -> { row } or { refusal }; never both, never throws on a well-formed loadBundle result.
export function classifyBundle({ dir, events, meta }, { allowMutants = false, legacyMap = { bundles: {} } } = {}) {
  const m = meta ?? {};
  const ts = tsOf(dir, m);
  const refuse = (reason) => ({ refusal: { ts: ts ?? path.basename(dir), dir, reason } });
  const prov = provenanceForReplay(m, ts, legacyMap);

  let arm;
  let mutation = null;
  let source;
  let comparable;
  let commit = null;
  if (prov.provenance === 'meta') {
    const variant = prov.variant == null || prov.variant === '' ? null : String(prov.variant);
    source = 'meta';
    commit = typeof prov.pluginSource?.commit === 'string' && prov.pluginSource.commit ? prov.pluginSource.commit : null;
    if (prov.mutation != null) {
      // A mutant is a negative control, never an arm: listed only on --allow-mutants, always visibly
      // labelled and never comparable. variant is null on every real mutant (run.sh forbids the pair).
      if (!allowMutants) return refuse(REASON.mutant(prov.mutation));
      mutation = String(prov.mutation);
      arm = variant != null ? `${variant} (mutant ${mutation})` : `mutant ${mutation}`;
      comparable = 'no (mutant)';
    } else {
      if (variant == null) return refuse(REASON.unattributed);
      arm = variant;
      comparable = 'yes';
    }
  } else if (prov.provenance === 'legacy-map') {
    arm = prov.legacyArm ?? 'unknown';
    source = 'legacy-map';
    comparable = 'no (legacy)';
  } else {
    return refuse(REASON.unmapped);
  }

  const legacyRow = ts != null ? legacyMap?.bundles?.[ts] : undefined;
  const scenario = typeof m.scenario === 'string' ? m.scenario : (typeof legacyRow?.scenario === 'string' ? legacyRow.scenario : 'unknown');
  const metrics = computeMetrics({ events, meta: m, dir, legacyMap });
  const aiu = isNum(metrics.aiu?.total) ? metrics.aiu.total : null;
  // The served-model set from the bundle's own assistant.usage events (already deduped + sorted by
  // computeMetrics) — the input to the #129 model-mix guard.
  const models = Object.keys(metrics.modelMix?.byModel ?? {});

  return { row: { ts, scenario, arm, mutation, source, comparable, commit, aiu, models, dir } };
}

// ---------------------------------------------------------------- model-mix guard (#129, pure)
// Over the `comparable: yes` rows only. Same set everywhere -> nothing happens. Otherwise the MAJORITY set
// (ties resolved by the already-sorted row order, so the outcome never depends on argument order) is the
// reference and every other comparable row is refused — or, with --allow-model-mix, kept and downgraded to
// `no (model mix)` under a warning line. Returns the (possibly rewritten) lists plus the warning to print.
export function applyModelMixGuard(rows, refused, { allowModelMix = false } = {}) {
  const comparable = rows.filter((r) => r.comparable === 'yes');
  if (comparable.length < 2) return { rows, refused, warning: null };
  const counts = new Map();
  for (const r of comparable) {
    const k = setLabel(r.models);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 1) return { rows, refused, warning: null };
  let majority = null;
  let best = -1;
  for (const r of comparable) {
    const k = setLabel(r.models);
    if (counts.get(k) > best) { best = counts.get(k); majority = k; }
  }
  const offending = comparable.filter((r) => setLabel(r.models) !== majority);
  if (allowModelMix) {
    const sets = [...counts.keys()].sort();
    for (const r of offending) r.comparable = 'no (model mix)';
    return {
      rows,
      refused,
      warning: `WARNING: served-model mismatch across ${comparable.length} comparable bundles (${sets.join(' | ')}) — AIU is NOT comparable across these rows; ${offending.length} marked "no (model mix)" and listed only because --allow-model-mix was passed.`,
    };
  }
  const keep = rows.filter((r) => !offending.includes(r));
  const extra = offending.map((r) => ({ ts: r.ts ?? path.basename(r.dir), dir: r.dir, reason: REASON.modelMix(setLabel(r.models), majority) }));
  const key = (x) => `${x.ts ?? ''}\0${x.dir}`;
  const out = [...refused, ...extra].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { rows: keep, refused: out, warning: null };
}

// ---------------------------------------------------------------- comparison (pure over loaded bundles)
// bundles: [{ dir, events, meta }] or [{ dir, error }] (an unreadable one, see loadBundles).
// -> { rows, refused }, both sorted by (ts, dir) so the output is independent of argument order.
export function compareBundles(bundles, opts = {}) {
  const rows = [];
  const refused = [];
  for (const b of bundles) {
    if (b.error) {
      const ts = tsOf(b.dir, null) ?? path.basename(b.dir);
      refused.push({ ts, dir: b.dir, reason: REASON.unreadable(b.error) });
      continue;
    }
    const c = classifyBundle(b, opts);
    if (c.row) rows.push(c.row); else refused.push(c.refusal);
  }
  const key = (x) => `${x.ts ?? ''}\0${x.dir}`;
  const cmp = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  rows.sort(cmp);
  refused.sort(cmp);
  // The model-mix guard runs LAST, over the classified rows: it is a cross-bundle judgement, not a
  // per-bundle one, and it must see the final sorted order so ties are resolved deterministically.
  const guarded = applyModelMixGuard(rows, refused, opts);
  return { rows: guarded.rows, refused: guarded.refused, warning: guarded.warning };
}

// Load each dir; an unreadable bundle becomes { dir, error } instead of aborting the whole comparison.
export function loadBundles(dirs) {
  return dirs.map((d) => {
    const dir = path.resolve(d);
    try {
      const { events, meta } = loadBundle(dir);
      return { dir, events, meta };
    } catch (err) {
      return { dir, error: err.message };
    }
  });
}

// ---------------------------------------------------------------- rendering
const fmtAiu = (v) => (isNum(v) ? v.toFixed(6) : 'unknown');
const fmtCommit = (c) => (typeof c === 'string' && c ? c.slice(0, 8) : 'unknown'); // short oid; JSON keeps the full one
// The arm cell is rendered verbatim: classifyBundle already labels an allowed mutant (`mutant <id>`).
const fmtArm = (r) => r.arm;

// Short model names WITHOUT a nickname map: the last dash-separated segment, used only when that is
// unambiguous over the whole table — every short name distinct AND actually a name (a bare version number
// such as the `5` of `claude-sonnet-5` is not one). Otherwise every cell keeps the full ids. One decision
// per table, so the column reads consistently across rows.
const lastSegment = (id) => {
  const i = id.lastIndexOf('-');
  return i > 0 && i < id.length - 1 ? id.slice(i + 1) : id;
};
export function modelLabeller(rows) {
  const union = [...new Set(rows.flatMap((r) => r.models ?? []))].sort();
  const shorts = union.map(lastSegment);
  const unambiguous = union.length > 0 && new Set(shorts).size === shorts.length && shorts.every((s) => /[a-z]/i.test(s));
  const short = new Map(union.map((id, i) => [id, unambiguous ? shorts[i] : id]));
  return (models) => setLabel((models ?? []).map((id) => short.get(id) ?? id));
}

export function renderMarkdown({ rows, refused, warning = null }) {
  const L = [];
  if (warning) { L.push(warning); L.push(''); }
  const label = modelLabeller(rows);
  L.push('| ts | scenario | arm | source | comparable | commit | AIU | models |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    L.push(`| ${r.ts ?? 'unknown'} | ${r.scenario} | ${fmtArm(r)} | ${r.source} | ${r.comparable} | ${fmtCommit(r.commit)} | ${fmtAiu(r.aiu)} | ${label(r.models)} |`);
  }
  if (refused.length) {
    L.push('');
    for (const x of refused) L.push(`REFUSED: ${x.ts} — ${x.reason}`);
  }
  L.push('');
  return L.join('\n');
}

// The JSON shape stays exactly `{ rows, refused }` (pinned by R9): a --allow-model-mix mismatch is visible
// there as the row's own `comparable: "no (model mix)"` plus its `models` array, not as a prose warning.
export function renderJson({ rows, refused }) {
  return `${JSON.stringify({ rows, refused }, null, 2)}\n`;
}

// ---------------------------------------------------------------- CLI
const modulePath = fileURLToPath(import.meta.url);

function usage() {
  process.stderr.write(`usage: node ${path.relative(process.cwd(), modulePath) || path.basename(modulePath)} <bundle-dir>... [--json] [--allow-mutants] [--allow-model-mix]\n`);
  return EXIT.INCOMPLETE;
}

export function main(argv = process.argv.slice(2)) {
  const flags = new Set();
  const dirs = [];
  for (const a of argv) {
    if (a === '--json' || a === '--allow-mutants' || a === '--allow-model-mix') flags.add(a);
    else if (a.startsWith('-')) return usage();
    else dirs.push(a);
  }
  if (dirs.length === 0) return usage();

  let legacyMap;
  try { legacyMap = loadLegacyArms(); }
  catch (err) { process.stderr.write(`ab-compare: ${err.message}\n`); return EXIT.INCOMPLETE; }

  const result = compareBundles(loadBundles(dirs), {
    allowMutants: flags.has('--allow-mutants'),
    allowModelMix: flags.has('--allow-model-mix'),
    legacyMap,
  });
  process.stdout.write(flags.has('--json') ? renderJson(result) : renderMarkdown(result));
  return result.refused.length ? EXIT.INCOMPLETE : EXIT.AS_EXPECTED;
}

// Run main() only when invoked directly; importing this module is side-effect-free (realpath-robust guard,
// same idiom as run.mjs / cost-report.mjs).
const sameFile = (a, b) => {
  try { return fs.realpathSync(a) === fs.realpathSync(b); }
  catch { return path.resolve(a) === path.resolve(b); }
};
if (process.argv[1] && sameFile(process.argv[1], modulePath)) {
  process.exitCode = main();
}
