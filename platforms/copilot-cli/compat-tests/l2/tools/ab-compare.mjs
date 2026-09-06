// ab-compare.mjs — MINIMAL attribution-only comparer over persisted L2 replay bundles (issue #122, spec R8).
// Zero-dependency (node: builtins + the L2 harness modules), STRICTLY READ-ONLY: it opens events.json +
// replay-meta.json of each bundle, never writes, never spawns a seat, never imports the SDK, prints to stdout.
//
// Usage:
//   node l2/tools/ab-compare.mjs <bundle-dir>... [--json] [--allow-mutants] [--allow-model-mix] [--normalize=shared] [--same-route]
//   node l2/tools/ab-compare.mjs platforms/copilot-cli/compat-tests/reports/2026*
//
//   --json             deterministic JSON `{ rows: [...], refused: [...] }` (fixed key order; both lists sorted
//                      by ts, then dir) instead of the markdown table. `--normalize=shared` adds a third
//                      top-level key, `normalize`, and two keys per row (`sharedAiu`, `droppedAiu`).
//   --allow-mutants    list a `mutation` != null bundle instead of refusing it: a VISIBLE row whose arm cell is
//                      `mutant <id>` (or `<variant> (mutant <id>)` when a variant was also recorded), source
//                      `meta`, comparable `no (mutant)`, commit from pluginSource — never hidden, never
//                      comparable. Real mutants are driven WITHOUT --variant (run.sh rejects the pair), so
//                      `variant: null` is their normal shape and is NOT the unattributed refusal here.
//   --allow-model-mix  list a served-model mismatch instead of refusing it: the offending rows stay, marked
//                      comparable `no (model mix)`, under a VISIBLE `WARNING: served-model mismatch …` line
//                      above the table. For inspecting a mixed set on purpose — never for a cost comparison.
//   --normalize=shared add a `sharedAiu` column: each listed row's AIU restricted to S, the INTERSECTION of
//                      every listed row's served-model set. An ADDITIVE PROJECTION — the raw `aiu` column
//                      stays, `comparable` is untouched, and the dropped model ids plus the AIU dropped per
//                      row are always printed, so a bare normalized number is never emitted. S empty ->
//                      refuse (exit 2); S = every row's full set -> `shared: (no models dropped)`.
//   --same-route       keep only the rows sharing the MAJORITY route class and REFUSE the rest, including
//                      every row whose class is unknown. A comparability filter, never a cost explanation.
//
// WHY NORMALIZATION KEYS ON THE SERVED-MODEL INTERSECTION AND NOT ON THE MODEL PIN (#138 D2). Measured
// across all seven surviving bundles: `modelMix.pin` is `null` for FIVE of them, both halves of the struck
// pair included — these pre-provenance metas carry neither `sessionOptions.model` nor `meta.model`. A
// pin-keyed flag would be inert on 71 % of the corpus and, by cost-report's own null discipline, would emit
// `null`. The intersection is available on every bundle that has any usage event at all, because the
// served-model set is already computed below from `metrics.modelMix.byModel`.
//
// ROUTE SHIPS WITHOUT A VERDICT (#138 D9), AND HERE IS THE MEASUREMENT THAT DECIDED IT. Tier 2's drive
// 20260904T205106Z was classified `skip` CORRECTLY and still cost 105.006005 AIU — 7.8x its 13.5 band —
// because `research-synthesizer` ran on `claude-sonnet-5` at ten times luna's rate. The cause was a MODEL,
// not a route. So route never explains or predicts cost here; it only decides whether two drives are
// comparable at all, and `cost-report` publishes route as raw covariates with no class attached.
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
// Output: markdown table `ts | scenario | arm | source | comparable | commit | AIU | models | origin` (AIU `unknown`
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
import { loadBundle, computeMetrics, round } from './cost-report.mjs';
import { EXIT } from '../compare.mjs';

const TS_RE = /^\d{8}T\d{6}Z$/;

// R8 refusal reasons — VERBATIM (tests + spec pin these strings).
export const REASON = Object.freeze({
  mutant: (id) => `mutant ${id} (pass --allow-mutants)`,
  unattributed: 'unattributed (driven without --variant)',
  unmapped: 'pre-provenance bundle not in legacy-arms.json',
  unreadable: (detail) => `unreadable bundle: ${detail}`,
  modelMix: (set, majority) => `served-model mismatch: ${set} vs ${majority}`,
  // #138 R11b — --same-route only. An unwitnessed route is refused, never silently kept.
  routeMismatch: (cls, majority) => `--same-route: route ${cls} vs majority ${majority}`,
  routeUnknown: '--same-route: route class unknown (no rundir witness)',
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
// -> { row, byModel } or { refusal }; never both, never throws on a well-formed loadBundle result.
// `byModel` is `metrics.modelMix.byModel` handed out BESIDE the row (never as a row key — the row key
// order is pinned): it is what `--normalize=shared` sums over, and computing it again would mean loading
// and re-metricising the bundle a second time.
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
  // R31 (#138): whose code the drive ran. Both branches derive it from what `prov` ALREADY carries —
  // live rows from the recorded `pluginSource.origin` (itself a declaration, see run.mjs R29), legacy
  // rows losslessly from the `legacyArm` token in the committed map. The meta is never re-read and
  // legacy-arms.json gains nothing (D6). Unknown is `null`, never a guess from the arm name.
  let origin = null;
  if (prov.provenance === 'meta') {
    const variant = prov.variant == null || prov.variant === '' ? null : String(prov.variant);
    source = 'meta';
    commit = typeof prov.pluginSource?.commit === 'string' && prov.pluginSource.commit ? prov.pluginSource.commit : null;
    // Absent on every bundle driven before #138 — those read `null`, never `undefined`.
    origin = prov.pluginSource?.origin === 'upstream' || prov.pluginSource?.origin === 'fork' ? prov.pluginSource.origin : null;
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
    // The map's two arm tokens already ARE the origin: `upstream-control` was a SkillPanel tree,
    // `fork-legacy` one of ours. Deriving is lossless, so no field is added to legacy-arms.json (D6)
    // — and run.test.mjs pins the exact row key set per row over all six rows, so adding one to the
    // three upstream rows would fail outright.
    if (prov.legacyArm === 'upstream-control') origin = 'upstream';
    else if (prov.legacyArm === 'fork-legacy') origin = 'fork';
  } else {
    return refuse(REASON.unmapped);
  }

  const legacyRow = ts != null ? legacyMap?.bundles?.[ts] : undefined;
  const scenario = typeof m.scenario === 'string' ? m.scenario : (typeof legacyRow?.scenario === 'string' ? legacyRow.scenario : 'unknown');
  const metrics = computeMetrics({ events, meta: m, dir, legacyMap });
  const aiu = isNum(metrics.aiu?.total) ? metrics.aiu.total : null;
  // The served-model set from the bundle's own assistant.usage events (already deduped + sorted by
  // computeMetrics) — the input to the #129 model-mix guard.
  const byModel = metrics.modelMix?.byModel ?? {};
  const models = Object.keys(byModel);

  return { row: { ts, scenario, arm, mutation, source, comparable, commit, aiu, models, origin, dir }, byModel };
}

// ---------------------------------------------------------------- route witness (#138 R11b, filesystem)
// Promoted VERBATIM from `sweeps/tier2/sweep-tier2.sh:31-36`, the only route predicate this project has
// ever validated: walk the bundle's own `rundir` and call the drive `deep` when it produced
// `solution-exploration.md` or `high-level-design.md`, else `skip`. It lives HERE and not in
// `computeMetrics`, which must stay filesystem-free (it reads `dir` only as a string), and it needs no
// `extractFromBundle` — so #127's mtime concern does not arise.
//
// One deliberate refinement of the shell original: an ABSENT or unreadable rundir is `null` (unknown), not
// `skip`. The script conflated "no artifacts" with "no rundir"; a missing witness is not evidence of a
// shallow route, and `--same-route` refuses a null rather than comparing on a guess.
export function routeClass(rundir) {
  try {
    if (!fs.existsSync(rundir)) return null;
    let deep = false;
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, f.name);
        if (f.isDirectory()) walk(q);
        else if (/solution-exploration\.md|high-level-design\.md/.test(f.name)) deep = true;
      }
    };
    walk(rundir);
    return deep ? 'deep' : 'skip';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- --same-route filter (#138 R11b, pure)
// Keeps the rows sharing the MAJORITY route class and refuses every other row — a differing class, and
// every row whose class is unknown. Ties resolve by the already-sorted row order, so the outcome never
// depends on argument order. It is a comparability filter and nothing else: it orders nothing, scores
// nothing and judges nothing (the deferral at the top of this file still holds), and `comparable` is
// untouched.
export function applySameRouteFilter(rows, refused, routeByDir = new Map()) {
  const classed = rows.map((r) => ({ r, cls: routeByDir.get(r.dir) ?? null }));
  const counts = new Map();
  for (const { cls } of classed) if (cls != null) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  let majority = null;
  let best = -1;
  for (const { cls } of classed) {
    if (cls != null && counts.get(cls) > best) { best = counts.get(cls); majority = cls; }
  }
  const keep = [];
  const extra = [];
  for (const { r, cls } of classed) {
    const at = { ts: r.ts ?? path.basename(r.dir), dir: r.dir };
    if (cls == null) extra.push({ ...at, reason: REASON.routeUnknown });
    else if (cls !== majority) extra.push({ ...at, reason: REASON.routeMismatch(cls, majority) });
    else keep.push(r);
  }
  const key = (x) => `${x.ts ?? ''}\0${x.dir}`;
  const out = [...refused, ...extra].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { rows: keep, refused: out };
}

// ---------------------------------------------------------------- --normalize=shared (#138 R11a, pure)
// S = the INTERSECTION of every listed row's served-model set. `sharedAiu(row) = Σ_{m ∈ S} byModel[m].aiu`,
// at cost-report's own 9-dp `round` (imported, never re-invented). Applies to EVERY listed row regardless
// of `comparable`, because "what do these two cost on the models they share?" is orthogonal to whether the
// tool will call them comparable — and `comparable` is left exactly as classification set it.
export function sharedModelSet(rows) {
  let S = null;
  for (const r of rows) {
    const models = new Set(r.models ?? []);
    S = S == null ? models : new Set([...S].filter((m) => models.has(m)));
  }
  return S == null ? [] : [...S].sort();
}

// AIU of `ids` for one row, from the per-model figures computeMetrics already produced. Unknown (null),
// never 0, as soon as one member's AIU is unknown; a real 0 when `ids` is empty — nothing was dropped.
function aiuOver(byModel, ids) {
  let sum = 0;
  for (const id of ids) {
    const v = byModel?.[id]?.aiu;
    if (!isNum(v)) return null;
    sum += v;
  }
  return round(sum, 9);
}

export function applySharedNormalization(rows, byModelByDir = new Map()) {
  const shared = sharedModelSet(rows);
  if (rows.length > 0 && shared.length === 0) {
    // No basis to normalize ON. Refuse rather than invent one.
    return { normalize: null, refusal: `--normalize=shared: no shared model across the listed bundles (${rows.map((r) => setLabel(r.models)).join(' | ')}) — there is nothing to normalize on` };
  }
  const dropped = [...new Set(rows.flatMap((r) => r.models ?? []))].filter((m) => !shared.includes(m)).sort();
  for (const r of rows) {
    const bm = byModelByDir.get(r.dir) ?? {};
    r.sharedAiu = aiuOver(bm, shared);
    r.droppedAiu = aiuOver(bm, (r.models ?? []).filter((m) => !shared.includes(m)));
  }
  return { normalize: { mode: 'shared', shared, dropped }, refusal: null };
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
  const byModelByDir = new Map();
  const routeByDir = new Map();
  for (const b of bundles) {
    if (b.error) {
      const ts = tsOf(b.dir, null) ?? path.basename(b.dir);
      refused.push({ ts, dir: b.dir, reason: REASON.unreadable(b.error) });
      continue;
    }
    const c = classifyBundle(b, opts);
    if (c.row) { rows.push(c.row); byModelByDir.set(c.row.dir, c.byModel); routeByDir.set(c.row.dir, b.route ?? null); }
    else refused.push(c.refusal);
  }
  const key = (x) => `${x.ts ?? ''}\0${x.dir}`;
  const cmp = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  rows.sort(cmp);
  refused.sort(cmp);
  // --same-route runs first of the cross-bundle passes: it SELECTS the comparison set, so a drive it drops
  // must not influence the model-mix majority either. Without the flag it is a no-op and the guard sees
  // exactly what it saw before.
  const routed = opts.sameRoute ? applySameRouteFilter(rows, refused, routeByDir) : { rows, refused };
  // The model-mix guard runs LAST, over the classified rows: it is a cross-bundle judgement, not a
  // per-bundle one, and it must see the final sorted order so ties are resolved deterministically.
  const guarded = applyModelMixGuard(routed.rows, routed.refused, opts);
  // Normalization is a PROJECTION over whatever survived, applied after every refusal — never a rescue for
  // a refused row, and never a change to any row's `comparable`.
  const norm = opts.normalize === 'shared' ? applySharedNormalization(guarded.rows, byModelByDir) : { normalize: null, refusal: null };
  return { rows: guarded.rows, refused: guarded.refused, warning: guarded.warning, normalize: norm.normalize, normalizeRefusal: norm.refusal };
}

// Load each dir; an unreadable bundle becomes { dir, error } instead of aborting the whole comparison.
// `route` is witnessed only when asked for (--same-route): it walks the bundle's rundir, which no other
// code path needs, so the default costs nothing.
export function loadBundles(dirs, { route = false } = {}) {
  return dirs.map((d) => {
    const dir = path.resolve(d);
    try {
      const { events, meta, rundir } = loadBundle(dir);
      return route ? { dir, events, meta, route: routeClass(rundir) } : { dir, events, meta };
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

// The `shared:` line that ALWAYS accompanies a normalized table: which models the figures are computed on
// and which were dropped, so a normalized number can never travel without its basis. The per-row AIU that
// was dropped rides in its own column beside it.
const sharedNote = (n) => (n.dropped.length === 0
  ? 'shared: (no models dropped)'
  : `shared: ${setLabel(n.shared)} — dropped ${n.dropped.join('+')} (the AIU dropped per row is the droppedAiu column). Normalization changes NO row's comparable: a row that reads "no (legacy)" is still not comparable.`);

export function renderMarkdown({ rows, refused, warning = null, normalize = null }) {
  const L = [];
  if (warning) { L.push(warning); L.push(''); }
  if (normalize) { L.push(sharedNote(normalize)); L.push(''); }
  const label = modelLabeller(rows);
  // The raw AIU column STAYS; sharedAiu/droppedAiu are added columns, present only under --normalize=shared.
  // #138 R31: `origin` is APPENDED as the last column, never inserted — every existing column keeps
  // its position, so nothing that reads this table by index has to move.
  L.push(normalize
    ? '| ts | scenario | arm | source | comparable | commit | AIU | sharedAiu | droppedAiu | models | origin |'
    : '| ts | scenario | arm | source | comparable | commit | AIU | models | origin |');
  L.push(normalize ? '|---|---|---|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const norm = normalize ? `${fmtAiu(r.sharedAiu)} | ${fmtAiu(r.droppedAiu)} | ` : '';
    L.push(`| ${r.ts ?? 'unknown'} | ${r.scenario} | ${fmtArm(r)} | ${r.source} | ${r.comparable} | ${fmtCommit(r.commit)} | ${fmtAiu(r.aiu)} | ${norm}${label(r.models)} | ${r.origin ?? 'unknown'} |`);
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
// --normalize=shared, and ONLY it, adds a third key: the shared and dropped model ids, so the machine
// reader gets the basis with the figures exactly as the markdown reader does.
export function renderJson({ rows, refused, normalize = null }) {
  return `${JSON.stringify(normalize ? { rows, refused, normalize } : { rows, refused }, null, 2)}\n`;
}

// ---------------------------------------------------------------- CLI
const modulePath = fileURLToPath(import.meta.url);

// H15: new flags APPEND at the end of this line, after --allow-model-mix. The pin in
// ab-compare.test.mjs is not end-anchored, so appending survives it; inserting or reordering anywhere
// earlier is a real edit to a pinned enumeration.
function usage() {
  process.stderr.write(`usage: node ${path.relative(process.cwd(), modulePath) || path.basename(modulePath)} <bundle-dir>... [--json] [--allow-mutants] [--allow-model-mix] [--normalize=shared] [--same-route]\n`);
  return EXIT.INCOMPLETE;
}

// The `run.mjs parseArgs :104-138` house idiom: `key=value` flags carry an explicit `*Error` field so a bad
// flag VALUE can be reported by name instead of being answered with a bare usage() line. Unknown flags and
// the no-arguments case still go to usage() — R12 scopes the named-error rule to values.
export function parseFlags(argv) {
  const opts = { json: false, allowMutants: false, allowModelMix: false, sameRoute: false, normalize: null, normalizeError: null, dirs: [], unknown: [] };
  for (const a of argv) {
    if (a === '--json') opts.json = true;
    else if (a === '--allow-mutants') opts.allowMutants = true;
    else if (a === '--allow-model-mix') opts.allowModelMix = true;
    else if (a === '--same-route') opts.sameRoute = true;
    else if (a.startsWith('--normalize=')) {
      const v = a.slice('--normalize='.length);
      if (v === 'shared') opts.normalize = 'shared';
      else opts.normalizeError = v;
    }
    else if (a.startsWith('-')) opts.unknown.push(a);
    else opts.dirs.push(a);
  }
  return opts;
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseFlags(argv);
  if (opts.normalizeError != null) {
    process.stderr.write(`ab-compare: invalid --normalize=${opts.normalizeError} — the only supported value is "shared" (normalize on the INTERSECTION of the listed bundles' served-model sets)\n`);
    return EXIT.INCOMPLETE;
  }
  if (opts.unknown.length) return usage();
  if (opts.dirs.length === 0) return usage();

  let legacyMap;
  try { legacyMap = loadLegacyArms(); }
  catch (err) { process.stderr.write(`ab-compare: ${err.message}\n`); return EXIT.INCOMPLETE; }

  const result = compareBundles(loadBundles(opts.dirs, { route: opts.sameRoute }), {
    allowMutants: opts.allowMutants,
    allowModelMix: opts.allowModelMix,
    sameRoute: opts.sameRoute,
    normalize: opts.normalize,
    legacyMap,
  });
  // An impossible normalization is a refusal, not a table with an invented basis: nothing is printed.
  if (result.normalizeRefusal) {
    process.stderr.write(`ab-compare: ${result.normalizeRefusal}\n`);
    return EXIT.INCOMPLETE;
  }
  process.stdout.write(opts.json ? renderJson(result) : renderMarkdown(result));
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
