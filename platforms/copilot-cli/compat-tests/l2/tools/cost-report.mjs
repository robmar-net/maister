// cost-report.mjs — bundle-first AIU / context / covariate report for ONE persisted L2 replay bundle
// (issue #122, G4 / spec R7). Zero-dependency (node: builtins + the L2 harness modules), STRICTLY
// READ-ONLY: it opens events.json + replay-meta.json, never writes, never spawns a seat, prints to stdout.
//
// Usage:
//   node l2/tools/cost-report.mjs <bundle-dir> [--json] [--recover] [--verdict]
//   node l2/tools/cost-report.mjs platforms/copilot-cli/compat-tests/reports/20260903T000910Z
//
//   --json      deterministic JSON (fixed key order; map keys sorted) instead of markdown
//   --recover   add `recovered`: the plugin dir recovered from `skill.invoked.data.path` (prefix before
//               /skills/ or /commands/) — the after-the-fact attribution of a pre-provenance bundle
//   --verdict   re-derive the conformance verdict of the bundle via run.mjs's `extractFromBundle` +
//               `deriveVerdict` (the SAME single authority `--replay` uses; never bare normalize/compare),
//               print ONE line `verdict: <AS-EXPECTED|REGRESSED|INCOMPLETE> PASS n · LIMITATION n · SKIP n ·
//               FAIL n (scenario <id>, reference <hash8>[, reason])`, and exit with the verdict code
//               (0 / 1 / 2). Writes NO report file. Combinable with --json (a `verdict` object is added).
//
// Exit codes: 0 report printed (or the verdict code with --verdict); 2 usage / unreadable bundle.
//
// NULL DISCIPLINE (spec R7, `extractUsage` rule): every VALUE derived from an event payload is `null` when
// its source event is absent — never 0 (aiu.*, tokens.*, weightedRequests, systemTokensInitial,
// toolDefinitionTokens.initial, wallMinutes, crossCheck.*, servedModels.main, modelMix.offPin.*). Event
// COUNTS (usageEvents, subagents.count, reads.viewTotal, cacheBreaks.count, gates.total, ...) are true
// observations over the stream and may be 0.
//
// MODEL MIX (#129): Copilot picks the model PER DELEGATION at `subagent.configured` time and ignores both
// the session pin and the agent's `model: inherit` — one such delegation was worth ~24 AIU on a development
// drive and ~82 on research. `modelMix` reports the pin (`meta.sessionOptions.model` ?? `meta.model`, read
// from the bundle — never a catalog), the per-model split, and the AIU that entered the drive OUTSIDE the
// pin, with the agents and `subagent.configured` models that carried it. NO hardcoded model list exists in
// this file: `KNOWN_RATES` is a rate-drift detector only (see its comment) and money always comes from the
// per-event `tokenDetails`.
//
// AGENT JOIN (spec R7, audit I12): a usage/usage_info/skill/view event's top-level `agentId` joins
// `subagent.started.agentId` -> `data.agentName`; events without `agentId` belong to `main`.
// `subagent.configured` carries model/reasoningEffort but NO agentName, so it too joins on agentId only.
// `data.parentToolCallId` <-> `subagent.started.data.toolCallId` is the cross-check (`joins`).
//
// Exports (pure): computeMetrics({ events, meta, dir, recover }) and renderMarkdown(metrics); the CLI is
// guarded by the realpath import.meta.url idiom (run.mjs) so ab-compare.mjs can import this module.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCENARIOS, loadReference, servedModelsFromEvents, chooseAnswer, loadLegacyArms, provenanceForReplay,
  extractFromBundle, deriveVerdict,
} from '../run.mjs';
import { computeHash, EXIT } from '../compare.mjs';

// The scenario registry (`gates` answerMap lookup by meta.scenario) and the reference loader are run.mjs's
// SINGLE authority, imported — never duplicated here (fix pass: a 7th scenario added to run.mjs would
// otherwise silently null this report's gates). An unknown/absent scenario still yields mapped/fallback
// null (never a throw — the report stays useful for a foreign bundle).

// STALENESS DETECTOR, not an authority (#129). AIU per 1 M tokens per class. Money is ALWAYS derived
// per event from `tokenDetails[].costPerBatch / batchSize` — this table never enters a total and is NEVER
// a catalog of "the models we support": the provider's model list rotates faster than this file, so a
// model missing from it is `no cross-check row` (an absence of evidence), NEVER a defect. Its one job is
// to make a rate CHANGE on a model we did record visible as a drift warning. Add a row only after
// observing the rate in a real bundle; never delete a row to silence a drift.
export const KNOWN_RATES = Object.freeze({
  'gpt-5.6-luna': { input: 20, cache_read: 2, cache_write: 25, output: 120 },
  'gpt-5.4-mini': { input: 75, cache_read: 7.5, cache_write: 0, output: 450 },
  'claude-haiku-4.5': { input: 100, cache_read: 10, cache_write: 125, output: 500 },
  'claude-sonnet-4.6': { input: 300, cache_read: 30, cache_write: 375, output: 1500 },
});
const CLASSES = Object.freeze(['input', 'cache_read', 'cache_write', 'output']);
const DASHBOARD_OR_STYLE_RE = /dashboard\.html$|dashboard-data\.js$|html-report-style\.md$/;
const TS_RE = /^\d{8}T\d{6}Z$/;

// ---------------------------------------------------------------- bundle loading (parity-evidence.mjs shape)
export function loadBundle(dir) {
  const eventsPath = path.join(dir, 'events.json');
  const metaPath = path.join(dir, 'replay-meta.json');
  if (!fs.existsSync(eventsPath)) throw new Error(`no events.json in ${dir}`);
  let events;
  try { events = JSON.parse(fs.readFileSync(eventsPath, 'utf8')); }
  catch (err) { throw new Error(`unreadable events.json in ${dir}: ${err.message}`); }
  if (!Array.isArray(events)) throw new Error(`events.json in ${dir} is not a JSON array`);
  let meta = {};
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) ?? {}; }
    catch (err) { throw new Error(`unreadable replay-meta.json in ${dir}: ${err.message}`); }
  }
  return { events, meta, rundir: path.join(dir, 'rundir') };
}

const byType = (events, t) => events.filter((e) => e?.type === t);

// ---------------------------------------------------------------- small pure helpers
// Exported so ab-compare's `--normalize=shared` projection reuses THIS rounding rule rather than inventing
// a second one (#138 R11a): every AIU figure in either tool comes out of the same 9-dp convention.
export const round = (x, dp) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : null);
const nanoToAiu = (nano) => (nano == null ? null : round(nano / 1e9, 9));
const sortedKeys = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
const numSorted = (set) => [...set].sort((a, b) => a - b);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// { name: value } when a name is seen once, { name: [v1, v2, ...] } (event order) when the same agentName
// backs several sessions (e.g. four `explore` subagents) — never last-wins.
function collectByName(pairs) {
  const acc = new Map();
  for (const [name, value] of pairs) {
    if (!acc.has(name)) acc.set(name, []);
    acc.get(name).push(value);
  }
  const out = {};
  for (const k of [...acc.keys()].sort()) out[k] = acc.get(k).length === 1 ? acc.get(k)[0] : acc.get(k);
  return out;
}

function countBy(items, keyOf) {
  const out = {};
  for (const it of items) {
    const k = keyOf(it);
    if (k == null) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return sortedKeys(out);
}

// The plugin dir a pre-provenance bundle can be attributed to, from the first path-bearing skill.invoked.
function recoverPluginDir(events) {
  for (const e of byType(events, 'skill.invoked')) {
    const p = e?.data?.path;
    if (typeof p !== 'string') continue;
    const m = /^(.*?)\/(skills|commands)\//.exec(p);
    if (m) return { pluginDir: m[1], reason: 'skill.invoked.data.path' };
  }
  return { pluginDir: null, reason: 'no path-bearing event' };
}

// ---------------------------------------------------------------- metrics (pure)
export function computeMetrics({ events, meta = {}, dir = null, recover = false, legacyMap = null }) {
  const evs = Array.isArray(events) ? events : [];
  const m = meta ?? {};
  const dirName = dir ? path.basename(dir) : '';
  const ts = TS_RE.test(dirName) ? dirName : (typeof m.ts === 'string' ? m.ts : null);

  // -- agent join (subagent.started.agentId -> agentName; toolCallId set for the parentToolCallId cross-check)
  const started = byType(evs, 'subagent.started');
  const configured = byType(evs, 'subagent.configured');
  const agentById = new Map();
  const toolCallIds = new Set();
  for (const s of started) {
    if (s.agentId != null && !agentById.has(s.agentId)) agentById.set(s.agentId, String(s.data?.agentName ?? '?'));
    if (s.data?.toolCallId != null) toolCallIds.add(s.data.toolCallId);
  }
  // 'main' for no agentId; the joined agentName; 'unjoined' when the agentId matches no subagent.started.
  const agentOf = (e) => (e?.agentId == null ? 'main' : (agentById.get(e.agentId) ?? 'unjoined'));
  // subagent.configured carries the model the RUNTIME chose for that delegation (#129) — the evidence
  // line for an off-pin model. It has no agentName, so it joins on agentId only (audit I12).
  const configuredModelById = new Map();
  for (const c of configured) {
    const cm = c?.data?.model;
    if (c.agentId != null && typeof cm === 'string' && !configuredModelById.has(c.agentId)) configuredModelById.set(c.agentId, cm);
  }

  // -- the session model pin, read from the bundle alone: the exact object passed to createSession
  // (meta v2 `sessionOptions`), else the legacy `meta.model`. NO catalog lookup, NO default — an
  // unknown pin is null, and every offPin figure below is then null (unknown), never 0.
  const pin = typeof m.sessionOptions?.model === 'string' && m.sessionOptions.model ? m.sessionOptions.model
    : (typeof m.model === 'string' && m.model ? m.model : null);

  // -- assistant.usage: AIU / tokens / models / agents / prices / weighted requests
  const usage = byType(evs, 'assistant.usage');
  let nanoTotal = null;
  const nanoByClass = {};
  const tokensByClass = {};
  const byModel = {};
  const byAgent = {};
  const observedRates = {};
  let weighted = null;
  const unmatchedAgentIds = new Set();
  const unmatchedParents = new Set();
  const availableToolCounts = new Set();
  let subagentUsageEvents = 0;
  // #129 model mix: what the runtime actually served vs what the session was pinned to.
  const offPinModels = new Set();
  const offPinByAgent = {};
  let offPinCalls = 0;
  let offPinNano = null;
  for (const u of usage) {
    const d = u?.data ?? {};
    const model = String(d.model ?? 'unknown');
    const agent = agentOf(u);
    const cu = d.copilotUsage;
    const nano = isNum(cu?.totalNanoAiu) ? cu.totalNanoAiu : null;
    if (nano != null) nanoTotal = (nanoTotal ?? 0) + nano;
    const bm = (byModel[model] ??= { aiu: null, calls: 0, tokens: null });
    for (const td of Array.isArray(cu?.tokenDetails) ? cu.tokenDetails : []) {
      const cls = td?.tokenType;
      if (typeof cls !== 'string' || !isNum(td.tokenCount) || !isNum(td.costPerBatch) || !isNum(td.batchSize) || td.batchSize === 0) continue;
      nanoByClass[cls] = (nanoByClass[cls] ?? 0) + (td.tokenCount * td.costPerBatch) / td.batchSize;
      tokensByClass[cls] = (tokensByClass[cls] ?? 0) + td.tokenCount;
      bm.tokens = (bm.tokens ?? 0) + td.tokenCount;
      const ratePerM = round((td.costPerBatch / td.batchSize) * 1e6 / 1e9, 6); // AIU per 1 M tokens
      ((observedRates[model] ??= {})[cls] ??= new Set()).add(ratePerM);
    }
    bm.calls += 1;
    if (nano != null) bm.aiu = (bm.aiu ?? 0) + nano;
    if (pin != null && model !== pin) {
      offPinCalls += 1;
      offPinModels.add(model);
      if (nano != null) offPinNano = (offPinNano ?? 0) + nano;
      const oa = (offPinByAgent[agent] ??= { models: new Set(), configured: new Set(), calls: 0, aiu: null });
      oa.calls += 1;
      oa.models.add(model);
      const cfg = u.agentId == null ? null : configuredModelById.get(u.agentId);
      if (typeof cfg === 'string') oa.configured.add(cfg);
      if (nano != null) oa.aiu = (oa.aiu ?? 0) + nano;
    }
    const ba = (byAgent[agent] ??= { aiu: null, calls: 0, models: new Set() });
    ba.calls += 1;
    ba.models.add(model);
    if (nano != null) ba.aiu = (ba.aiu ?? 0) + nano;
    if (isNum(d.cost)) weighted = (weighted ?? 0) + d.cost;
    if (isNum(d.availableToolCount)) availableToolCounts.add(d.availableToolCount);
    if (u.agentId != null) {
      subagentUsageEvents += 1;
      if (!agentById.has(u.agentId)) unmatchedAgentIds.add(String(u.agentId));
    }
    if (d.parentToolCallId != null && !toolCallIds.has(d.parentToolCallId)) unmatchedParents.add(String(d.parentToolCallId));
  }
  const classObj = (src, conv) => {
    if (Object.keys(src).length === 0) return null;
    const out = {};
    for (const c of CLASSES) if (c in src) out[c] = conv(src[c]);
    for (const c of Object.keys(src).sort()) if (!(c in out)) out[c] = conv(src[c]);
    return out;
  };
  const aiuByModel = {};
  for (const k of Object.keys(byModel).sort()) aiuByModel[k] = { aiu: nanoToAiu(byModel[k].aiu), calls: byModel[k].calls };

  // -- #129 model mix. `pin` is what the SESSION asked for; Copilot re-decides per delegation at
  // `subagent.configured` time and ignores both the pin and the agent's `model: inherit`, so an off-pin
  // model can enter a drive silently and swing its AIU by an order of magnitude. Nothing here consults a
  // model catalog: every id comes from this bundle's own events, every price from its own tokenDetails.
  //   offPin.aiu  0        -> usage observed, all of it on the pin
  //               > 0      -> the runtime's own choice, priced from the bundle
  //               null     -> unknown (no pin recorded, no usage event, or off-pin usage carrying no
  //                           copilotUsage) — never 0.
  //   verdict     null when the pin is unknown OR no usage event was observed (nothing to judge).
  const mixByModel = {};
  for (const k of Object.keys(byModel).sort()) mixByModel[k] = { calls: byModel[k].calls, aiu: nanoToAiu(byModel[k].aiu), tokens: byModel[k].tokens };
  const oneOrList = (set) => { const a = [...set].sort(); return a.length === 0 ? null : a.length === 1 ? a[0] : a; };
  const mixKnown = pin != null && usage.length > 0;
  const offPinNanoEff = !mixKnown ? null : (offPinCalls === 0 ? 0 : offPinNano);
  const offPinAgentObj = {};
  for (const k of Object.keys(offPinByAgent).sort()) {
    const oa = offPinByAgent[k];
    offPinAgentObj[k] = { model: oneOrList(oa.models), configured: oneOrList(oa.configured), calls: oa.calls, aiu: nanoToAiu(oa.aiu) };
  }
  const modelMix = {
    pin,
    byModel: mixByModel,
    offPin: mixKnown
      ? {
        models: [...offPinModels].sort(),
        calls: offPinCalls,
        aiu: offPinNanoEff == null ? null : nanoToAiu(offPinNanoEff),
        share: offPinNanoEff == null || nanoTotal == null || nanoTotal === 0 ? null : round(offPinNanoEff / nanoTotal, 4),
        byAgent: offPinAgentObj,
      }
      : { models: null, calls: null, aiu: null, share: null, byAgent: null },
    verdict: !mixKnown ? null : (offPinCalls > 0 ? 'off-pin' : 'on-pin'),
  };
  // -- #138 R6/R7 `aiu.onPin`: the AIU that was served ON the session pin. It is the complement of the
  // off-pin figure modelMix just computed — `nanoTotal - offPinNanoEff`, from values already in scope
  // (:247-248). There is NO second pass over `usage`. Null discipline mirrors `modelMix.offPin.aiu`
  // exactly (:257-262): null whenever the pin is unknown (measured: five of the seven surviving bundles,
  // so this is the COMMON branch) or either side is unknown; a real 0 only when observed usage was
  // entirely off-pin. This is also why `ab-compare --normalize=shared` keys on the served-model
  // intersection and not on the pin — a pin-keyed normalization would be null on 71 % of the corpus.
  const onPinAiu = !mixKnown || nanoTotal == null || offPinNanoEff == null ? null : nanoToAiu(nanoTotal - offPinNanoEff);
  const aiuByAgent = {};
  for (const k of Object.keys(byAgent).sort()) aiuByAgent[k] = { aiu: nanoToAiu(byAgent[k].aiu), calls: byAgent[k].calls, models: [...byAgent[k].models].sort() };
  const pricesObserved = {};
  const pricesCheck = {};
  for (const model of Object.keys(observedRates).sort()) {
    pricesObserved[model] = {};
    for (const c of CLASSES) if (observedRates[model][c]) pricesObserved[model][c] = numSorted(observedRates[model][c]);
    for (const c of Object.keys(observedRates[model]).sort()) if (!(c in pricesObserved[model])) pricesObserved[model][c] = numSorted(observedRates[model][c]);
    const known = KNOWN_RATES[model];
    // Absent from the drift table is an ABSENCE OF EVIDENCE, not a defect (#129): the provider's model
    // list rotates, the totals never used this table, and the report must not read as broken.
    if (!known) { pricesCheck[model] = 'no cross-check row'; continue; }
    const drifts = [];
    for (const c of CLASSES) {
      const obs = pricesObserved[model][c];
      if (!obs) continue;
      if (obs.length !== 1 || obs[0] !== known[c]) drifts.push(`drift: ${c} observed ${obs.join('/')} expected ${known[c]}`);
    }
    pricesCheck[model] = drifts.length ? drifts.join('; ') : 'ok';
  }

  // -- session.usage_info: main-only initial values (audit W3 / #6) + per-agent maps + distinct tool-definition sizes
  const usageInfo = byType(evs, 'session.usage_info');
  const mainInitial = usageInfo.find((e) => e?.data?.isInitial === true && e.agentId == null) ?? null;
  const agentInitials = usageInfo.filter((e) => e?.data?.isInitial === true && e.agentId != null);
  const systemTokensInitial = isNum(mainInitial?.data?.systemTokens) ? mainInitial.data.systemTokens : null;
  const toolDefInitial = isNum(mainInitial?.data?.toolDefinitionsTokens) ? mainInitial.data.toolDefinitionsTokens : null;
  const toolDefDistinct = new Set();
  const toolDefByAgent = new Map();
  for (const e of usageInfo) {
    const v = e?.data?.toolDefinitionsTokens;
    if (!isNum(v)) continue;
    toolDefDistinct.add(v);
    const a = agentOf(e);
    if (!toolDefByAgent.has(a)) toolDefByAgent.set(a, new Set());
    toolDefByAgent.get(a).add(v);
  }
  const toolDefByAgentObj = {};
  for (const k of [...toolDefByAgent.keys()].sort()) toolDefByAgentObj[k] = numSorted(toolDefByAgent.get(k));

  // -- provenance (meta v2 null-filled; legacy-map row via the committed map) + optional recovery
  const prov = provenanceForReplay(m, ts, legacyMap ?? loadLegacyArms());
  const recovered = recover ? recoverPluginDir(evs) : null;
  const provenance = {
    metaSchema: isNum(m.metaSchema) ? m.metaSchema : null,
    source: prov.provenance,
    variant: prov.variant ?? null,
    mutation: prov.mutation ?? null,
    pluginDir: prov.pluginDir ?? prov.pluginDirRecovered ?? null,
    pluginDigest: prov.pluginDigest ?? null,
    pluginSource: prov.pluginSource ?? null,
    legacyArm: prov.legacyArm ?? null,
  };
  const pluginPrefix = [provenance.pluginDir, recovered?.pluginDir].find((p) => typeof p === 'string' && p.startsWith('/')) ?? null;

  // -- reads (view tool calls)
  const views = byType(evs, 'tool.execution_start').filter((e) => e?.data?.toolName === 'view');
  const viewPath = (e) => (typeof e?.data?.arguments?.path === 'string' ? e.data.arguments.path : null);
  const reads = {
    viewTotal: views.length,
    dashboardOrStyleGuide: views.filter((e) => DASHBOARD_OR_STYLE_RE.test(viewPath(e) ?? '')).length,
    pluginTree: pluginPrefix ? views.filter((e) => (viewPath(e) ?? '').startsWith(pluginPrefix)).length : null,
    byAgent: countBy(views, agentOf),
  };

  // -- skill.invoked bytes (contentBytes on the redacted fixture; content.length on a raw bundle)
  const skills = byType(evs, 'skill.invoked');
  const bySkill = {};
  const byInvoker = {};
  let skillBytes = 0;
  for (const e of skills) {
    const d = e?.data ?? {};
    const bytes = isNum(d.contentBytes) ? d.contentBytes : (typeof d.content === 'string' ? d.content.length : 0);
    skillBytes += bytes;
    const s = (bySkill[String(d.name ?? '?')] ??= { count: 0, bytes: 0 });
    s.count += 1; s.bytes += bytes;
    const i = (byInvoker[agentOf(e)] ??= { count: 0, bytes: 0 });
    i.count += 1; i.bytes += bytes;
  }

  // -- cache breaks, gates, subagents, hooks, wall clock, served models
  const breaks = byType(evs, 'prompt_cache_break');
  const gateReqs = byType(evs, 'user_input.requested');
  const sc = typeof m.scenario === 'string' ? (SCENARIOS[m.scenario] ?? null) : null;
  let mapped = null;
  let fallback = null;
  if (sc) {
    mapped = 0; fallback = 0;
    for (const g of gateReqs) {
      const c = chooseAnswer(g?.data ?? {}, sc.answerMap ?? []);
      if (c.matched) mapped += 1; else fallback += 1;
    }
  }
  // Single-pass min/max: `Math.max(...stamps)` spreads every timestamp onto the call stack and throws
  // RangeError at ~130 K events (a long N>1 sweep bundle) — a loop has no such ceiling.
  let firstStamp = Infinity;
  let lastStamp = -Infinity;
  let stampCount = 0;
  for (const e of evs) {
    const t = Date.parse(e?.timestamp ?? '');
    if (!Number.isFinite(t)) continue;
    stampCount += 1;
    if (t < firstStamp) firstStamp = t;
    if (t > lastStamp) lastStamp = t;
  }
  const wallMinutes = stampCount >= 2 ? round((lastStamp - firstStamp) / 60000, 2) : null;

  // -- cross-check vs the recorded meta.cost (session-store.db) and the session.usage_checkpoint
  const aiuTotal = nanoToAiu(nanoTotal);
  const weightedRequests = weighted == null ? null : round(weighted, 6);
  const checkpoints = byType(evs, 'session.usage_checkpoint');
  const cpNano = checkpoints.length ? checkpoints[checkpoints.length - 1]?.data?.totalNanoAiu : null;
  const checkpointAiu = isNum(cpNano) ? nanoToAiu(cpNano) : null;
  const metaAiu = isNum(m.cost?.aiu) ? m.cost.aiu : null;
  const metaWeighted = isNum(m.cost?.weightedRequests) ? m.cost.weightedRequests : null;
  const delta = (a, b) => (a == null || b == null ? null : round(a - b, 9));

  // -- #138 R8/R9 route covariates. These are exactly the two covariate objects the tier runners already
  // recorded (`gates` as `2m/2f`, `subagents` as count/byName) — hoisted so `route` publishes the SAME
  // objects the top level does and the two can never drift apart.
  const gatesCovariate = { total: gateReqs.length, mapped, fallback };
  const subagentsCovariate = {
    count: started.length,
    byName: countBy(started, (e) => e?.data?.agentName ?? null),
    byModel: countBy(started, (e) => e?.data?.model ?? null),
    reasoningEfforts: [...new Set(configured.map((e) => e?.data?.reasoningEffort).filter((v) => typeof v === 'string'))].sort(),
  };

  const metrics = {
    bundle: { dir: dir ?? null, ts, scenario: typeof m.scenario === 'string' ? m.scenario : null, events: evs.length },
    aiu: { total: aiuTotal, onPin: onPinAiu, byClass: classObj(nanoByClass, nanoToAiu), byModel: aiuByModel, byAgent: aiuByAgent },
    tokens: { byClass: classObj(tokensByClass, (v) => v) },
    usageEvents: usage.length,
    modelMix,
    joins: {
      subagents: started.length,
      subagentUsageEvents,
      unmatchedAgentIds: [...unmatchedAgentIds].sort(),
      unmatchedParentToolCallIds: [...unmatchedParents].sort(),
    },
    prices: { observed: pricesObserved, check: pricesCheck },
    // Σ assistant.usage.data.cost — the header/continuity figure. NOT session.usage_checkpoint.totalPremiumRequests
    // (which is 1 on every bundle and does not count weighted premium requests).
    weightedRequests,
    systemTokensInitial,
    systemTokensInitialByAgent: collectByName(agentInitials.filter((e) => isNum(e.data.systemTokens)).map((e) => [agentOf(e), e.data.systemTokens])),
    toolDefinitionTokens: {
      initial: toolDefInitial,
      initialByAgent: collectByName(agentInitials.filter((e) => isNum(e.data.toolDefinitionsTokens)).map((e) => [agentOf(e), e.data.toolDefinitionsTokens])),
      distinct: numSorted(toolDefDistinct),
      byAgent: toolDefByAgentObj,
      availableToolCountDistinct: numSorted(availableToolCounts),
    },
    reads,
    skillBytesInjected: { totalBytes: skillBytes, count: skills.length, bySkill: sortedKeys(bySkill), byInvoker: sortedKeys(byInvoker) },
    cacheBreaks: { count: breaks.length, reasons: breaks.map((e) => String(e?.data?.primaryReason ?? 'unknown')) },
    gates: gatesCovariate,
    // RAW route covariates — deliberately NO `verdict` and NO `phases` (#138 D9). The project's one
    // measured route classification falsifies the premise that route predicts cost: tier 2's drive
    // 20260904T205106Z was classified `skip` CORRECTLY and still cost 105.006005 AIU — 7.8x its 13.5
    // band — because a subagent ran on claude-sonnet-5, i.e. because of a MODEL, not a route. Printing a
    // route class beside an AIU figure would therefore assert a relationship the measurement denies.
    // Route is a COMPARABILITY filter (ab-compare --same-route owns the witness), never a cost
    // explanation. `basis` is the escape hatch: it says where these came from, and a future witness-based
    // basis can be added without a schema break.
    route: { gates: gatesCovariate, subagents: subagentsCovariate, basis: 'events' },
    subagents: subagentsCovariate,
    hookFires: countBy(byType(evs, 'hook.start'), (e) => e?.data?.hookType ?? null),
    wallMinutes,
    servedModels: servedModelsFromEvents(evs),
    crossCheck: {
      aiuVsMeta: delta(aiuTotal, metaAiu),
      aiuVsCheckpoint: delta(aiuTotal, checkpointAiu),
      weightedVsMeta: delta(weightedRequests, metaWeighted),
      recorded: { metaAiu, metaWeightedRequests: metaWeighted, checkpointAiu },
    },
    provenance,
  };
  if (recover) metrics.recovered = recovered;
  return metrics;
}

// ---------------------------------------------------------------- markdown
const fmt = (v) => {
  if (v == null) return 'null';
  if (Array.isArray(v)) return v.length ? v.map(fmt).join(', ') : '—';
  if (typeof v === 'object') return `\`${JSON.stringify(v)}\``;
  return String(v);
};
const deltaCell = (d) => (d == null ? 'null (one side unknown)' : Math.abs(d) < 5e-7 ? 'matches (Δ 0.000000)' : `Δ ${d.toFixed(6)}`);

// `## Model mix` (#129) — what the session PINNED vs what the runtime actually served, and the AIU that
// entered the drive outside the pin. `null` everywhere means unknown (no pin recorded / no usage), not 0.
function renderModelMix(mm) {
  const L = ['## Model mix', ''];
  L.push('| metric | value |'); L.push('|---|---|');
  L.push(`| pin (\`sessionOptions.model\` ?? \`meta.model\`) | ${fmt(mm.pin)} |`);
  L.push(`| verdict | ${fmt(mm.verdict)} |`);
  L.push(`| offPin.models | ${fmt(mm.offPin.models)} |`);
  L.push(`| offPin.calls | ${fmt(mm.offPin.calls)} |`);
  L.push(`| offPin.aiu | ${fmt(mm.offPin.aiu)} |`);
  L.push(`| offPin.share of aiu.total | ${fmt(mm.offPin.share)} |`);
  if (mm.verdict === 'off-pin') {
    L.push('');
    L.push(`- ⚠ **off-pin models served** — the runtime chose ${fmt(mm.offPin.models)} for ${mm.offPin.calls} usage event(s) although the session was pinned to \`${mm.pin}\`. Copilot decides the model per delegation at \`subagent.configured\` time and ignores both the session pin and the agent's \`model: inherit\`; this AIU is the runtime's choice, not the arm's. **Do not compare this drive with one whose served-model set differs** (\`ab-compare\` refuses it).`);
  }
  const agents = mm.offPin.byAgent;
  if (agents && Object.keys(agents).length) {
    L.push('');
    L.push('| off-pin agent | served model | subagent.configured model | calls | AIU |');
    L.push('|---|---|---|---|---|');
    for (const [name, v] of Object.entries(agents)) L.push(`| ${name} | ${fmt(v.model)} | ${fmt(v.configured)} | ${v.calls} | ${fmt(v.aiu)} |`);
  }
  L.push('');
  return L;
}

export function renderMarkdown(mx) {
  const L = [];
  const row = (k, v) => L.push(`| ${k} | ${fmt(v)} |`);
  L.push(`# Cost report — ${mx.bundle.ts ?? 'unknown ts'} (${mx.bundle.scenario ?? 'unknown scenario'})`);
  L.push('');
  L.push(`- **Bundle:** ${mx.bundle.dir ?? 'n/a'} · ${mx.bundle.events} events · wall ${fmt(mx.wallMinutes)} min`);
  L.push(`- **Served models:** ${Object.entries(mx.servedModels).map(([k, v]) => `${k}=${fmt(v)}`).join(', ')}`);
  L.push('');
  L.push('## AIU'); L.push(''); L.push('| metric | value |'); L.push('|---|---|');
  row('aiu.total', mx.aiu.total);
  row('aiu.onPin', mx.aiu.onPin);
  for (const c of Object.keys(mx.aiu.byClass ?? {})) row(`aiu.byClass.${c}`, mx.aiu.byClass[c]);
  for (const c of Object.keys(mx.tokens.byClass ?? {})) row(`tokens.byClass.${c}`, mx.tokens.byClass[c]);
  row('weightedRequests (Σ usage.cost; not totalPremiumRequests)', mx.weightedRequests);
  row('usageEvents', mx.usageEvents);
  L.push('');
  L.push('## Cross-check'); L.push(''); L.push('| computed vs recorded | result |'); L.push('|---|---|');
  row(`aiu.total vs meta.cost.aiu (${fmt(mx.crossCheck.recorded.metaAiu)})`, deltaCell(mx.crossCheck.aiuVsMeta));
  row(`aiu.total vs session.usage_checkpoint (${fmt(mx.crossCheck.recorded.checkpointAiu)})`, deltaCell(mx.crossCheck.aiuVsCheckpoint));
  row(`weightedRequests vs meta.cost.weightedRequests (${fmt(mx.crossCheck.recorded.metaWeightedRequests)})`, deltaCell(mx.crossCheck.weightedVsMeta));
  L.push('');
  L.push('## By model'); L.push(''); L.push('| model | calls | AIU | tokens | price check | observed AIU / 1M (in, cache_read, cache_write, out) |'); L.push('|---|---|---|---|---|---|');
  for (const [model, v] of Object.entries(mx.aiu.byModel)) {
    const obs = mx.prices.observed[model];
    const tokens = mx.modelMix.byModel[model]?.tokens ?? null;
    L.push(`| ${model} | ${v.calls} | ${fmt(v.aiu)} | ${fmt(tokens)} | ${mx.prices.check[model] ?? 'n/a'} | ${obs ? CLASSES.map((c) => fmt(obs[c])).join(' / ') : 'n/a'} |`);
  }
  // The drift table is informational: a missing row is `no cross-check row`, a moved rate is a WARNING —
  // never a failure, and never a source of money (totals are re-priced per event).
  for (const [model, check] of Object.entries(mx.prices.check)) {
    if (typeof check === 'string' && check.startsWith('drift:')) L.push(`- ⚠ **rate drift** — \`${model}\`: ${check.replace(/drift: /g, '')}. KNOWN_RATES is a staleness detector, not an authority (the catalog rotates); AIU totals used the observed per-event prices.`);
  }
  L.push('');
  L.push(...renderModelMix(mx.modelMix));
  L.push('## By agent'); L.push(''); L.push('| agent | calls | AIU | models |'); L.push('|---|---|---|---|');
  for (const [agent, v] of Object.entries(mx.aiu.byAgent)) L.push(`| ${agent} | ${v.calls} | ${fmt(v.aiu)} | ${fmt(v.models)} |`);
  L.push('');
  L.push(`- **Joins:** ${mx.joins.subagents} subagent.started · ${mx.joins.subagentUsageEvents} usage events with agentId · unmatched agentIds ${fmt(mx.joins.unmatchedAgentIds)} · unmatched parentToolCallIds ${fmt(mx.joins.unmatchedParentToolCallIds)}`);
  L.push('');
  L.push('## Context'); L.push(''); L.push('| metric | value |'); L.push('|---|---|');
  row('systemTokensInitial (main isInitial)', mx.systemTokensInitial);
  row('systemTokensInitialByAgent', mx.systemTokensInitialByAgent);
  row('toolDefinitionTokens.initial (main isInitial)', mx.toolDefinitionTokens.initial);
  row('toolDefinitionTokens.initialByAgent', mx.toolDefinitionTokens.initialByAgent);
  row('toolDefinitionTokens.distinct', mx.toolDefinitionTokens.distinct);
  row('toolDefinitionTokens.byAgent', mx.toolDefinitionTokens.byAgent);
  row('availableToolCountDistinct', mx.toolDefinitionTokens.availableToolCountDistinct);
  L.push('');
  L.push('## Covariates'); L.push(''); L.push('| metric | value |'); L.push('|---|---|');
  row('reads.viewTotal', mx.reads.viewTotal);
  row('reads.dashboardOrStyleGuide', mx.reads.dashboardOrStyleGuide);
  row('reads.pluginTree', mx.reads.pluginTree);
  row('reads.byAgent', mx.reads.byAgent);
  row('skillBytesInjected', `${mx.skillBytesInjected.totalBytes} bytes over ${mx.skillBytesInjected.count} skill.invoked`);
  row('skillBytesInjected.bySkill', mx.skillBytesInjected.bySkill);
  row('skillBytesInjected.byInvoker', mx.skillBytesInjected.byInvoker);
  row('cacheBreaks', `${mx.cacheBreaks.count} (${fmt(mx.cacheBreaks.reasons)})`);
  row('gates', `${mx.gates.total} total · mapped ${fmt(mx.gates.mapped)} · fallback ${fmt(mx.gates.fallback)}`);
  row('subagents', `${mx.subagents.count} · byName ${fmt(mx.subagents.byName)} · byModel ${fmt(mx.subagents.byModel)} · reasoningEfforts ${fmt(mx.subagents.reasoningEfforts)}`);
  // The basis is printed WITH the covariates, so no route figure can be cited without it visible beside it.
  // No class, no verdict: route does not predict cost (see the `route` comment in computeMetrics).
  row('route', `basis ${mx.route.basis} · gates ${mx.route.gates.total} · subagents ${mx.route.subagents.count} — raw covariates, not a route class`);
  row('hookFires', mx.hookFires);
  row('wallMinutes', mx.wallMinutes);
  L.push('');
  L.push('## Provenance'); L.push(''); L.push('| field | value |'); L.push('|---|---|');
  for (const [k, v] of Object.entries(mx.provenance)) row(k, v);
  if ('recovered' in mx) {
    L.push('');
    L.push('## Recovered (--recover)'); L.push('');
    L.push(`- **recovered plugin dir:** ${fmt(mx.recovered.pluginDir)} (${mx.recovered.reason})`);
  }
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- --verdict (shared authority with --replay)
function verdictFor(dir) {
  const { sc, res } = extractFromBundle(dir); // preconditions throw exit-2 errors; never imports the SDK
  const { reference } = loadReference(sc.id); // run.mjs's loader: missing / invalid -> precondition (exit 2)
  const v = deriveVerdict(res, reference);
  const exitCode = v.overall === 'INCOMPLETE' ? EXIT.INCOMPLETE : v.result.exitCode;
  return {
    overall: v.overall,
    counts: { pass: v.counts.pass, limitation: v.counts.limitation, skip: v.counts.skip, fail: v.counts.fail },
    scenario: sc.id,
    referenceHash: computeHash(reference),
    reason: v.reason ?? null,
    exitCode,
  };
}

export function formatVerdictLine(v) {
  const reason = v.reason ? `, ${String(v.reason).replace(/\s+/g, ' ').trim()}` : '';
  return `verdict: ${v.overall} PASS ${v.counts.pass} · LIMITATION ${v.counts.limitation} · SKIP ${v.counts.skip} · FAIL ${v.counts.fail} (scenario ${v.scenario}, reference ${v.referenceHash.slice(0, 8)}${reason})`;
}

// ---------------------------------------------------------------- CLI
const modulePath = fileURLToPath(import.meta.url);

function usage() {
  process.stderr.write(`usage: node ${path.relative(process.cwd(), modulePath) || path.basename(modulePath)} <bundle-dir> [--json] [--recover] [--verdict]\n`);
  return EXIT.INCOMPLETE;
}

export function main(argv = process.argv.slice(2)) {
  const flags = new Set();
  let dir = null;
  for (const a of argv) {
    if (a === '--json' || a === '--recover' || a === '--verdict') flags.add(a);
    else if (a.startsWith('-')) return usage();
    else if (dir == null) dir = a;
    else return usage();
  }
  if (!dir) return usage();
  dir = path.resolve(dir);

  let bundle;
  try { bundle = loadBundle(dir); }
  catch (err) { process.stderr.write(`cost-report: ${err.message}\n`); return EXIT.INCOMPLETE; }
  const metrics = computeMetrics({ events: bundle.events, meta: bundle.meta, dir, recover: flags.has('--recover') });

  let verdict = null;
  if (flags.has('--verdict')) {
    try { verdict = verdictFor(dir); }
    catch (err) { process.stderr.write(`cost-report --verdict: ${err.message}\n`); return typeof err.exitCode === 'number' ? err.exitCode : EXIT.INCOMPLETE; }
  }

  if (flags.has('--json')) {
    process.stdout.write(`${JSON.stringify(verdict ? { ...metrics, verdict } : metrics, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(metrics));
    if (verdict) process.stdout.write(`\n${formatVerdictLine(verdict)}\n`);
  }
  return verdict ? verdict.exitCode : 0;
}

// Run main() only when invoked directly; importing this module is side-effect-free (realpath-robust guard,
// same idiom as run.mjs).
const sameFile = (a, b) => {
  try { return fs.realpathSync(a) === fs.realpathSync(b); }
  catch { return path.resolve(a) === path.resolve(b); }
};
if (process.argv[1] && sameFile(process.argv[1], modulePath)) {
  process.exitCode = main();
}
