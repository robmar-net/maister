// Deterministic generator for the committed cost-report fixture (issue #122, G4 / spec R9).
//
// Zero-dep, node: builtins only. Reproduces `events.sample.json` + `replay-meta.sample.json` from the
// REAL Copilot CLI 1.0.82 replay bundle `reports/20260903T000910Z` (scenario `development`, model
// gpt-5.6-luna + gpt-5.4-mini subagents) so the committed artefacts are never hand-crafted — regenerate
// with:
//   node platforms/copilot-cli/compat-tests/l2/test/fixtures/cost-report/gen-fixture.mjs [<bundle-dir>]
//
// PROVENANCE RULE (audit #9): this generator is the ONLY thing that reads `reports/`, and only at
// generation time. `test/cost-report.test.mjs` reads the two committed artefacts next to this file and
// NEVER `reports/` (the bundles are git-ignored per-run traces; CI has none).
//
// ── Filter (spec R9 `cost-report` row) ───────────────────────────────────────
// Keep ONLY the event types cost-report.mjs consumes (26 655 raw events -> the few hundred it needs):
//   assistant.usage            minus data.{quotaSnapshots, apiCallId, providerCallId, serviceRequestId}
//   subagent.started / subagent.configured
//   skill.invoked              data.content -> its first 80 chars; data.contentBytes = original length
//   session.usage_info / session.usage_checkpoint / session.model_change
//   tool.execution_start       ONLY data.toolName === 'view'; data.arguments reduced to { path }
//   hook.start                 data reduced to { hookType } (hookFires counts by hookType and reads nothing else)
//   prompt_cache_break / user_input.requested
// SPEC R9 AMENDMENT (fix pass, verification W5; tightened in fix pass 2): three trims beyond the R9 recipe,
// each one a field NO metric reads — `hook.start.data` beyond `hookType` (the full prompt / tool input,
// 137 KB of the 604 KB fixture, plus hookInvocationId / parentToolCallId: computeMetrics reads
// `parentToolCallId` from assistant.usage only, never from hook.start), `tool.execution_start.data.arguments`
// beyond `path` (`reads.*` reads only the path), and the `subagent.completed` type (computeMetrics joins on
// subagent.started / .configured only). hookFires, reads.*, the agent joins and every R7 identity are
// unchanged by construction (self-checked below). What remains is the event TYPES the metrics consume —
// not every field of them is read (assistant.usage keeps its full token/cost record as the R7 source).
// PLUS the bundle's very first and very last event verbatim (session.start / the closing
// session.background_tasks_changed, ~640 bytes together) as WALL-CLOCK ANCHORS: R7 `wallMinutes` is
// (last − first event timestamp) over the whole bundle, and the type filter alone drops both ends
// (8.43 instead of the verified 8.46 min). Nothing else outside the type list is kept.
// Event ORDER and every other field (agentId, timestamp, parentId, ...) are preserved verbatim, so the
// R7 joins (agentId <-> subagent.started, parentToolCallId <-> toolCallId) and wallMinutes reproduce.
// `replay-meta.sample.json` = the bundle's replay-meta.json verbatim (the 12 legacy keys; metaSchema < 2).
//
// ── Verified identities the fixture must carry (spec R7) ─────────────────────
//   aiu.total 36.99498 = meta.cost.aiu = session.usage_checkpoint.totalNanoAiu / 1e9
//   164 assistant.usage (luna 146, mini 18); 19 subagents; main isInitial systemTokens 23186 /
//   toolDefinitionsTokens 8403; 14 skill.invoked = 229382 content bytes; 134 view; 1 prompt_cache_break;
//   hook.start sessionStart 1 / preToolUse 144; 16 user_input.requested.
// The generator self-checks these before writing so a regeneration from a different bundle fails loudly.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(HERE, '..', '..', '..');
const DEFAULT_BUNDLE = path.resolve(L2_DIR, '..', 'reports', '20260903T000910Z');
const EVENTS_OUT = path.join(HERE, 'events.sample.json');
const META_OUT = path.join(HERE, 'replay-meta.sample.json');

const KEEP = new Set([
  'assistant.usage',
  'subagent.started', 'subagent.configured',
  'skill.invoked',
  'session.usage_info', 'session.usage_checkpoint', 'session.model_change',
  'tool.execution_start',
  'prompt_cache_break', 'hook.start', 'user_input.requested',
]);
const USAGE_STRIP = ['quotaSnapshots', 'apiCallId', 'providerCallId', 'serviceRequestId'];
const CONTENT_HEAD = 80;

// Pure: one raw event -> the redacted fixture event, or null when filtered out.
export function redactEvent(e) {
  if (!e || !KEEP.has(e.type)) return null;
  if (e.type === 'tool.execution_start' && e.data?.toolName !== 'view') return null;
  if (e.type === 'assistant.usage') {
    const data = { ...(e.data ?? {}) };
    for (const k of USAGE_STRIP) delete data[k];
    return { ...e, data };
  }
  if (e.type === 'skill.invoked') {
    const content = typeof e.data?.content === 'string' ? e.data.content : '';
    return { ...e, data: { ...(e.data ?? {}), content: content.slice(0, CONTENT_HEAD), contentBytes: content.length } };
  }
  if (e.type === 'hook.start') {
    return { ...e, data: { hookType: e.data?.hookType } };
  }
  if (e.type === 'tool.execution_start') {
    const d = e.data ?? {};
    const args = d.arguments && typeof d.arguments === 'object' ? d.arguments : {};
    const { arguments: _drop, ...rest } = d;
    return { ...e, data: { ...rest, arguments: 'path' in args ? { path: args.path } : {} } };
  }
  return e;
}

function main(argv) {
  const bundle = path.resolve(argv[0] ?? DEFAULT_BUNDLE);
  const raw = JSON.parse(fs.readFileSync(path.join(bundle, 'events.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(bundle, 'replay-meta.json'), 'utf8'));
  const events = raw.map((e, i) => (i === 0 || i === raw.length - 1 ? e : redactEvent(e))).filter(Boolean);

  // Self-check against the R7 identities so a regeneration from the wrong bundle cannot land silently.
  const count = (t, pred = () => true) => events.filter((e) => e.type === t && pred(e)).length;
  const usage = events.filter((e) => e.type === 'assistant.usage');
  const nano = usage.reduce((s, e) => s + (e.data?.copilotUsage?.totalNanoAiu ?? 0), 0);
  const checks = [
    ['assistant.usage', usage.length, 164],
    ['aiu.total', nano / 1e9, 36.99498],
    ['subagent.started', count('subagent.started'), 19],
    ['main isInitial systemTokens', events.find((e) => e.type === 'session.usage_info' && e.data?.isInitial && !e.agentId)?.data?.systemTokens, 23186],
    ['skill.invoked', count('skill.invoked'), 14],
    ['skill bytes', events.filter((e) => e.type === 'skill.invoked').reduce((s, e) => s + e.data.contentBytes, 0), 229382],
    ['view', count('tool.execution_start'), 134],
    ['prompt_cache_break', count('prompt_cache_break'), 1],
    ['hook.start preToolUse', count('hook.start', (e) => e.data?.hookType === 'preToolUse'), 144],
    ['user_input.requested', count('user_input.requested'), 16],
    ['wallMinutes', Math.round((Date.parse(events[events.length - 1].timestamp) - Date.parse(events[0].timestamp)) / 600) / 100, 8.46],
    ['meta keys', Object.keys(meta).length, 12],
  ];
  for (const [name, got, want] of checks) {
    if (got !== want) throw new Error(`self-check FAILED: ${name} = ${got} (expected ${want}) — bundle ${bundle}`);
  }

  // One event per line: byte-deterministic, diff-friendly, and still a single valid JSON array.
  fs.writeFileSync(EVENTS_OUT, `[\n${events.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`);
  fs.writeFileSync(META_OUT, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`wrote ${EVENTS_OUT} (${events.length} events, ${fs.statSync(EVENTS_OUT).size} bytes)`);
  console.log(`wrote ${META_OUT} (${fs.statSync(META_OUT).size} bytes)`);
  console.log('fixture self-check OK (164 usage / 36.99498 AIU / 19 subagents / 23186 / 229382 skill bytes / 134 views / 8.46 min)');
}

const sameFile = (a, b) => {
  try { return fs.realpathSync(a) === fs.realpathSync(b); }
  catch { return path.resolve(a) === path.resolve(b); }
};
if (process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url))) main(process.argv.slice(2));
