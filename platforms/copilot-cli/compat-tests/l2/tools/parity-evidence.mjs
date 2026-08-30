// parity-evidence.mjs — read-only evidence extractor for the Parity-Map (issue #76 WP-B).
//
// Given a persisted L2 replay bundle (reports/<ts>/ or reports/<ts>/run-<i>/), prints — as markdown —
// the behavioral evidence the Parity-Map rows need, so re-filling the map after each run is ONE command
// instead of hand-grepping. Zero-dependency (node: builtins only), STRICTLY READ-ONLY: it opens
// events.json + walks the persisted rundir, never writes, never spawns, never touches a seat.
//
// Usage:
//   node l2/tools/parity-evidence.mjs <bundle-dir> [<bundle-dir> ...]
//   node l2/tools/parity-evidence.mjs platforms/copilot-cli/compat-tests/reports/20260830T155522Z
//
// What it reports per bundle (each line is an evidence datum for a specific Parity-Map row):
//   • Delegations + per-agent MODEL (from subagent.started/completed .data.model — credit-free WP-G).
//   • Parallel waves (siblings under one parentId whose [start, start+durationMs] windows overlap).
//   • Verification fan-out (review AGENTS delegated vs invoked_skill(reviews-*) — the 🟡 delta).
//   • Compaction (session.compaction_*/truncation; if any, the gates that fired AFTER it).
//   • Task items (session.todos_changed + update_todo/sql tool calls — the TaskCreate→todos transform).
//   • Standards lazy-load (tool.execution_start reads touching .maister/docs / INDEX.md).
//   • Dashboard + HTML companions (walk rundir/.maister/tasks/** for dashboard.html / *.html).
//   • Gates (user_input.requested questions, in order).
//
// A datum that cannot be observed prints "not observed" WITH the reason — never a silent omission (the
// Parity-Map keeps such a row ⚪ with that exact reason).

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- bundle loading
function loadBundle(dir) {
  const eventsPath = path.join(dir, 'events.json');
  const metaPath = path.join(dir, 'replay-meta.json');
  if (!fs.existsSync(eventsPath)) throw new Error(`no events.json in ${dir}`);
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  return { events, meta, rundir: path.join(dir, 'rundir') };
}

const byType = (events, t) => events.filter((e) => e.type === t);
const ts = (e) => Date.parse(e.timestamp || e?.data?.timestamp || '') || null;

// ---------------------------------------------------------------- extractors
function delegations(events) {
  const started = byType(events, 'subagent.started');
  const completed = byType(events, 'subagent.completed');
  const doneByCall = new Map();
  for (const c of completed) doneByCall.set(c?.data?.toolCallId, c.data);
  return started.map((s) => {
    const d = s.data || {};
    const done = doneByCall.get(d.toolCallId) || {};
    return {
      agent: d.agentName ?? '?',
      model: d.model ?? done.model ?? '?',
      executionMode: d.executionMode ?? '?',
      parentId: s.parentId ?? null,
      start: ts(s),
      durationMs: done.durationMs ?? null,
      tokens: done.totalTokens ?? null,
    };
  });
}

// Max concurrency among siblings sharing a parentId: count overlapping [start, start+durationMs] windows.
function parallelWaves(dels) {
  const groups = new Map();
  for (const d of dels) {
    if (d.start == null) continue;
    const k = d.parentId ?? 'root';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  const waves = [];
  for (const [parent, sibs] of groups) {
    if (sibs.length < 2) continue;
    // sweep line over start/end points
    const pts = [];
    for (const s of sibs) {
      const end = s.durationMs != null ? s.start + s.durationMs : s.start; // no-duration -> point event
      pts.push([s.start, +1], [end, -1]);
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0, peak = 0;
    for (const [, delta] of pts) { cur += delta; if (cur > peak) peak = cur; }
    waves.push({ parent, count: sibs.length, peakConcurrency: peak, agents: sibs.map((s) => s.agent) });
  }
  return waves;
}

function verificationFanout(events, dels) {
  const REVIEW_AGENTS = /(code-reviewer|code-quality-pragmatist|production-readiness-checker|reality-assessor|spec-auditor)/;
  const reviewDelegated = [...new Set(dels.filter((d) => REVIEW_AGENTS.test(d.agent)).map((d) => d.agent))].sort();
  const reviewSkills = [...new Set(
    byType(events, 'skill.invoked').map((e) => e?.data?.name).filter((n) => /^reviews-/.test(n || '')),
  )].sort();
  return { reviewDelegated, reviewSkills };
}

function compaction(events) {
  const marks = events.filter((e) => /session\.(compaction_|truncation)/.test(e.type || ''));
  if (!marks.length) return { occurred: false };
  const firstAt = Math.min(...marks.map(ts).filter(Boolean));
  const gatesAfter = byType(events, 'user_input.requested')
    .filter((e) => (ts(e) ?? 0) >= firstAt)
    .map((e) => e?.data?.question)
    .filter(Boolean);
  return { occurred: true, count: marks.length, types: [...new Set(marks.map((m) => m.type))], gatesAfter };
}

function taskItems(events) {
  const todosChanged = byType(events, 'session.todos_changed').length;
  const toolCalls = byType(events, 'tool.execution_start').map((e) => e?.data?.toolName);
  const updateTodo = toolCalls.filter((t) => t === 'update_todo').length;
  const sql = toolCalls.filter((t) => t === 'sql').length;
  return { todosChanged, updateTodo, sql };
}

// A standards READ = a read-like tool (view/read/rg/glob/bash cat) whose TARGET path is under
// .maister/docs (or INDEX.md). apply_patch writes that merely MENTION the path (e.g. the state file
// listing project_doc_paths) are excluded, so the count reflects genuine reads, not references.
function standardsReads(events) {
  const READ_TOOLS = new Set(['view', 'read', 'rg', 'glob', 'cat', 'grep']);
  const PATH_RE = /([^\s"'\\]*\.maister\/docs\/[^\s"'\\]*|[^\s"'\\]*INDEX\.md)/;
  const hits = new Set();
  let reads = 0;
  for (const e of byType(events, 'tool.execution_start')) {
    const tool = e?.data?.toolName;
    if (!READ_TOOLS.has(tool)) continue;
    const args = JSON.stringify(e?.data?.arguments ?? {});
    if (!/\.maister\/docs|INDEX\.md/.test(args)) continue;
    reads += 1;
    const m = args.match(PATH_RE);
    if (m) hits.add(m[1].replace(/^.*\/(\.maister\/docs\/)/, '$1').replace(/^.*\/(INDEX\.md)$/, '$1'));
  }
  return { count: reads, files: [...hits].slice(0, 8) };
}

function htmlArtifacts(rundir) {
  const found = { dashboardHtml: false, dashboardData: false, htmlCompanions: [] };
  if (!fs.existsSync(rundir)) return { ...found, note: 'rundir not persisted' };
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (name === 'dashboard.html') found.dashboardHtml = true;
      else if (name === 'dashboard-data.js') found.dashboardData = true;
      else if (name.endsWith('.html')) found.htmlCompanions.push(path.relative(rundir, p));
    }
  };
  try { walk(rundir); } catch { /* best-effort */ }
  return found;
}

function gates(events) {
  return byType(events, 'user_input.requested').map((e) => e?.data?.question).filter(Boolean);
}

// ---------------------------------------------------------------- report
function reportBundle(dir) {
  const { events, meta, rundir } = loadBundle(dir);
  const dels = delegations(events);
  const perAgentModel = new Map();
  for (const d of dels) {
    if (!perAgentModel.has(d.agent)) perAgentModel.set(d.agent, new Set());
    perAgentModel.get(d.agent).add(d.model);
  }
  const waves = parallelWaves(dels);
  const fan = verificationFanout(events, dels);
  const comp = compaction(events);
  const todos = taskItems(events);
  const std = standardsReads(events);
  const html = htmlArtifacts(rundir);

  const L = [];
  L.push(`## ${path.basename(dir)} — ${meta.scenario ?? '?'} (${(meta.copilotVersion ?? '?').replace(/\n.*/s, '')})`);
  L.push(`- **events:** ${events.length}  ·  **delegations:** ${dels.length}  ·  **model(s):** ${meta.modelActual ?? '?'}`);

  L.push(`- **Task items (TaskCreate→todos transform):** ${todos.todosChanged ? '✅' : '⚪'} ` +
    `${todos.todosChanged} session.todos_changed · ${todos.updateTodo} update_todo · ${todos.sql} sql tool calls`);

  L.push(`- **Standards lazy-load (.maister/docs/INDEX.md reads):** ${std.count ? '✅' : '⚪'} ` +
    `${std.count} read(s)` + (std.files.length ? ` — e.g. ${std.files.slice(0, 3).join(', ')}` : ''));

  L.push(`- **Verification fan-out:** review agents delegated = [${fan.reviewDelegated.join(', ') || 'none'}]; ` +
    `invoked_skill(reviews-*) = [${fan.reviewSkills.join(', ') || 'none'}] ` +
    `→ ${fan.reviewDelegated.length && fan.reviewSkills.length ? '🟡 agents run (isolation kept) VIA the skill hop' : (fan.reviewDelegated.length ? '✅ direct agent delegation' : '⚪ neither observed')}`);

  L.push(`- **Parallel waves (peak concurrency per parent):** ` +
    (waves.length ? waves.map((w) => `${w.peakConcurrency}× of ${w.count} (${[...new Set(w.agents)].join('/')})`).join('; ')
      : '⚪ no multi-child wave observed (all delegations sequential/singleton)'));

  L.push(`- **Compaction resume:** ` +
    (comp.occurred
      ? `✅ ${comp.count} event(s) [${comp.types.join(', ')}]; ${comp.gatesAfter.length} gate(s) fired AFTER it`
      : '⚪ not observed — no session.compaction_*/truncation events in this run (cannot measure resume here)'));

  L.push(`- **Dashboard + HTML companions:** ` +
    (html.note ? `⚪ ${html.note}`
      : `dashboard.html ${html.dashboardHtml ? '✅' : '⚪'} · dashboard-data.js ${html.dashboardData ? '✅' : '⚪'} · ` +
        `*.html companions: ${html.htmlCompanions.length ? html.htmlCompanions.join(', ') : '⚪ none'}`));

  L.push(`- **Per-agent model actually used:**`);
  for (const [agent, models] of [...perAgentModel].sort()) {
    L.push(`    - ${agent}: ${[...models].join(', ')}`);
  }

  L.push(`- **Gates fired (in order, ${gates(events).length}):**`);
  gates(events).forEach((q, i) => L.push(`    ${i + 1}. ${q.replace(/\s+/g, ' ').slice(0, 110)}`));

  return L.join('\n');
}

// ---------------------------------------------------------------- main
const dirs = process.argv.slice(2);
if (!dirs.length) {
  process.stderr.write('usage: node parity-evidence.mjs <bundle-dir> [<bundle-dir> ...]\n');
  process.exit(2);
}
const out = [];
out.push('# Parity evidence (issue #76 WP-B) — read-only extraction from persisted bundles\n');
for (const d of dirs) {
  try { out.push(reportBundle(d)); }
  catch (err) { out.push(`## ${path.basename(d)}\n- ERROR: ${err.message}`); }
}
process.stdout.write(out.join('\n\n') + '\n');
