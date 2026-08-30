// Smoke test for the Parity-Map evidence extractor (issue #76 WP-B, l2/tools/parity-evidence.mjs).
// Runs the real CLI over a SYNTHETIC bundle (mkdtemp) and asserts the extractor classifies the planted
// signals correctly — so the diagnostic can't silently rot. Zero-dep, self-cleaning.
//
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/parity-evidence.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(__dirname, '..', 'tools', 'parity-evidence.mjs');

function stageBundle(root) {
  const dir = path.join(root, '20990101T000000Z');
  const taskDir = path.join(dir, 'rundir', '.maister', 'tasks', 'development', 'x');
  fs.mkdirSync(path.join(taskDir, 'verification'), { recursive: true });
  // Planted signals: two review-agent delegations + two reviews-* skills, a todos_changed, an INDEX.md
  // read via a read-like tool, a dashboard + an html companion.
  const events = [
    { type: 'subagent.started', timestamp: '2026-01-01T00:00:01Z', parentId: 'p', data: { toolCallId: 'c1', agentName: 'maister-copilot:code-reviewer', model: 'gpt-x' } },
    { type: 'subagent.completed', data: { toolCallId: 'c1', durationMs: 1000, model: 'gpt-x' } },
    { type: 'subagent.started', timestamp: '2026-01-01T00:00:01Z', parentId: 'p', data: { toolCallId: 'c2', agentName: 'maister-copilot:reality-assessor', model: 'gpt-x' } },
    { type: 'subagent.completed', data: { toolCallId: 'c2', durationMs: 1000, model: 'gpt-x' } },
    { type: 'skill.invoked', data: { name: 'reviews-code' } },
    { type: 'skill.invoked', data: { name: 'reviews-reality-check' } },
    { type: 'session.todos_changed', data: {} },
    { type: 'tool.execution_start', data: { toolName: 'view', arguments: { path: '/tmp/x/.maister/docs/INDEX.md' } } },
    // apply_patch that MENTIONS INDEX.md must NOT count as a read:
    { type: 'tool.execution_start', data: { toolName: 'apply_patch', arguments: { patch: 'project_doc_paths: .maister/docs/INDEX.md' } } },
    { type: 'user_input.requested', data: { question: 'Continue to Phase 5?' } },
  ];
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(events));
  fs.writeFileSync(path.join(dir, 'replay-meta.json'), JSON.stringify({ scenario: 'development', copilotVersion: '1.0.82' }));
  fs.writeFileSync(path.join(taskDir, 'dashboard.html'), '<html></html>');
  fs.writeFileSync(path.join(taskDir, 'dashboard-data.js'), 'window.x=1');
  fs.writeFileSync(path.join(taskDir, 'verification', 'implementation-verification.html'), '<html></html>');
  return dir;
}

test('parity-evidence: classifies planted signals (todos ✅, standards read count excludes apply_patch, fan-out 🟡, concurrency, dashboard)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-ev-'));
  try {
    const dir = stageBundle(root);
    const res = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });
    assert.equal(res.status, 0, `exit 0 expected\n${res.stderr}`);
    const out = res.stdout;

    assert.match(out, /Task items.*✅ 1 session\.todos_changed/, 'todos_changed counted');
    // Exactly ONE standards read (the view), NOT two (apply_patch mention excluded).
    assert.match(out, /Standards lazy-load.*✅ 1 read\(s\)/, 'apply_patch mention must not inflate the read count');
    assert.match(out, /reviews-code, reviews-reality-check/, 'reviews-* skills listed');
    assert.match(out, /🟡 agents run \(isolation kept\) VIA the skill hop/, 'fan-out classified 🟡 (agents + skills both present)');
    // Two siblings under one parent with overlapping 1s windows → peak concurrency 2.
    assert.match(out, /Parallel waves.*2× of 2/, 'overlapping siblings → peak concurrency 2');
    assert.match(out, /dashboard\.html ✅ · dashboard-data\.js ✅/, 'dashboard artifacts found');
    assert.match(out, /implementation-verification\.html/, 'html companion found');
    assert.match(out, /not observed — no session\.compaction/, 'no compaction → honest not-observed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
