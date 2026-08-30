// Credit-free unit tests for the WP-D cheap predicates (issue #76): `todos(created)`,
// `standards(index_read)`, and the two dashboard `created_artifact` tree entries.
// Run ONLY this file:  node --test platforms/copilot-cli/compat-tests/l2/test/wpd-predicates.test.mjs
//
// Shapes here mirror the REAL 1.0.82 development bundle (reports/20260830T155522Z, git-ignored):
//   - session.todos_changed (10 in the real run)  -> one todos(created), never per-event
//   - view of .maister/docs/INDEX.md (27 reads)    -> one standards(index_read)
//   - apply_patch that MENTIONS the docs path      -> NOT a read (write, not a READ_TOOL)
//   - dashboard.html + dashboard-data.js at task root -> two created_artifact records
// The extractor emit + normalize tokens are asserted end-to-end; the reference lands them OPTIONAL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractFromEvents, extractFromTree, TREE_PROFILES } from '../extractor.mjs';
import { normalize } from '../normalize.mjs';

const namesOf = (records, kind) => records.filter((r) => r.kind === kind).map((r) => r.name);

// --------------------------------------------------------------- normalize heads
test('WP-D normalize: todos + standards are 1-arg literal heads', () => {
  const records = [
    { kind: 'todos', name: 'created', source: 'events' },
    { kind: 'standards', name: 'index_read', source: 'events' },
  ];
  const tokens = new Set(normalize(records));
  assert.ok(tokens.has('todos(created)'), 'todos(created) built');
  assert.ok(tokens.has('standards(index_read)'), 'standards(index_read) built');
});

// --------------------------------------------------------------- events -> census predicates
test('WP-D events: >=1 session.todos_changed -> exactly ONE todos(created) (never per-event)', () => {
  const events = [
    { type: 'session.todos_changed', data: {} },
    { type: 'session.todos_changed', data: {} },
    { type: 'session.todos_changed', data: {} },
  ];
  const todos = namesOf(extractFromEvents(events), 'todos');
  assert.deepEqual(todos, ['created'], 'three events collapse to a single created census token');
});

test('WP-D events: no session.todos_changed -> no todos record (honest absence)', () => {
  const todos = namesOf(extractFromEvents([{ type: 'session.idle', data: {} }]), 'todos');
  assert.deepEqual(todos, [], 'absent signal -> absent predicate');
});

test('WP-D events: a READ-tool read of INDEX.md -> ONE standards(index_read); apply_patch mention excluded', () => {
  const events = [
    { type: 'tool.execution_start', data: { toolName: 'view', arguments: { path: '/tmp/x/.maister/docs/INDEX.md' } } },
    { type: 'tool.execution_start', data: { toolName: 'rg', arguments: { pattern: 'x', path: '/tmp/x/.maister/docs/INDEX.md' } } },
    // apply_patch WRITE that merely mentions the path (the state file lists project_doc_paths) — NOT a read:
    { type: 'tool.execution_start', data: { toolName: 'apply_patch', arguments: { patch: '*** Update File\nproject_doc_paths: .maister/docs/INDEX.md' } } },
  ];
  const std = namesOf(extractFromEvents(events), 'standards');
  assert.deepEqual(std, ['index_read'], 'two reads collapse to one token; the apply_patch write is not counted');
});

test('WP-D events: reads of OTHER docs (not INDEX.md) do not emit standards(index_read)', () => {
  const events = [
    { type: 'tool.execution_start', data: { toolName: 'view', arguments: { path: '/tmp/x/.maister/docs/project/vision.md' } } },
  ];
  assert.deepEqual(namesOf(extractFromEvents(events), 'standards'), [], 'only INDEX.md keys the predicate');
});

// --------------------------------------------------------------- tree -> dashboard artifacts
test('WP-D tree: dashboard.html + dashboard-data.js at task root -> created_artifact records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wpd-tree-'));
  try {
    const taskDir = path.join(root, '.maister', 'tasks', 'development', '2026-08-30-x');
    fs.mkdirSync(path.join(taskDir, 'implementation'), { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'dashboard.html'), '<html></html>');
    fs.writeFileSync(path.join(taskDir, 'dashboard-data.js'), 'window.x=1');
    fs.writeFileSync(path.join(taskDir, 'implementation', 'spec.md'), '# spec');
    const arts = new Set(namesOf(extractFromTree(root, TREE_PROFILES.development), 'created_artifact'));
    assert.ok(arts.has('dashboard.html'), 'dashboard.html emitted');
    assert.ok(arts.has('dashboard-data.js'), 'dashboard-data.js emitted');
    assert.ok(arts.has('implementation/spec.md'), 'pre-existing artifacts unaffected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('WP-D tree: dashboard files are development-only (research profile does not emit them)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wpd-tree-r-'));
  try {
    const taskDir = path.join(root, '.maister', 'tasks', 'research', '2026-08-30-y');
    fs.mkdirSync(path.join(taskDir, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'dashboard.html'), '<html></html>');
    const arts = new Set(namesOf(extractFromTree(root, TREE_PROFILES.research), 'created_artifact'));
    assert.equal(arts.has('dashboard.html'), false, 'research profile has no dashboard artifact');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
