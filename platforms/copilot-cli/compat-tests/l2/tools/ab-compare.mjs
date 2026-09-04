// ab-compare.mjs — MINIMAL attribution-only comparer over persisted L2 replay bundles (issue #122, spec R8).
// Zero-dependency (node: builtins + the L2 harness modules), STRICTLY READ-ONLY: it opens events.json +
// replay-meta.json of each bundle, never writes, never spawns a seat, never imports the SDK, prints to stdout.
//
// Usage:
//   node l2/tools/ab-compare.mjs <bundle-dir>... [--json] [--allow-mutants]
//   node l2/tools/ab-compare.mjs platforms/copilot-cli/compat-tests/reports/2026*
//
//   --json           deterministic JSON `{ rows: [...], refused: [...] }` (fixed key order; both lists sorted
//                    by ts, then dir) instead of the markdown table
//   --allow-mutants  list a `mutation` != null bundle instead of refusing it: a VISIBLE row whose arm cell is
//                    `mutant <id>` (or `<variant> (mutant <id>)` when a variant was also recorded), source
//                    `meta`, comparable `no (mutant)`, commit from pluginSource — never hidden, never
//                    comparable. Real mutants are driven WITHOUT --variant (run.sh rejects the pair), so
//                    `variant: null` is their normal shape and is NOT the unattributed refusal here.
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
//
// Output: markdown table `ts | scenario | arm | source | comparable | commit | AIU` (AIU `unknown` when
// null, 6 dp otherwise; commit = the 8-hex short oid, `unknown` when not recorded — the JSON keeps the
// full oid) then one `REFUSED: <ts> — <reason>` line per refusal. Exit 2 if any refusal (or usage
// error), else 0.
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
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

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

  return { row: { ts, scenario, arm, mutation, source, comparable, commit, aiu, dir } };
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
  return { rows, refused };
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

export function renderMarkdown({ rows, refused }) {
  const L = [];
  L.push('| ts | scenario | arm | source | comparable | commit | AIU |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    L.push(`| ${r.ts ?? 'unknown'} | ${r.scenario} | ${fmtArm(r)} | ${r.source} | ${r.comparable} | ${fmtCommit(r.commit)} | ${fmtAiu(r.aiu)} |`);
  }
  if (refused.length) {
    L.push('');
    for (const x of refused) L.push(`REFUSED: ${x.ts} — ${x.reason}`);
  }
  L.push('');
  return L.join('\n');
}

export function renderJson({ rows, refused }) {
  return `${JSON.stringify({ rows, refused }, null, 2)}\n`;
}

// ---------------------------------------------------------------- CLI
const modulePath = fileURLToPath(import.meta.url);

function usage() {
  process.stderr.write(`usage: node ${path.relative(process.cwd(), modulePath) || path.basename(modulePath)} <bundle-dir>... [--json] [--allow-mutants]\n`);
  return EXIT.INCOMPLETE;
}

export function main(argv = process.argv.slice(2)) {
  const flags = new Set();
  const dirs = [];
  for (const a of argv) {
    if (a === '--json' || a === '--allow-mutants') flags.add(a);
    else if (a.startsWith('-')) return usage();
    else dirs.push(a);
  }
  if (dirs.length === 0) return usage();

  let legacyMap;
  try { legacyMap = loadLegacyArms(); }
  catch (err) { process.stderr.write(`ab-compare: ${err.message}\n`); return EXIT.INCOMPLETE; }

  const result = compareBundles(loadBundles(dirs), { allowMutants: flags.has('--allow-mutants'), legacyMap });
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
