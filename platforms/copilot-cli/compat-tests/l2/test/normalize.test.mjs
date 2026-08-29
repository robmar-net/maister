// L2 Group 3 — Normalizer + Allowlist tests (credit-free, node:test only).
//
// Verifies normalize(rawRecords) collapses BOTH Claude and Copilot platform verb
// forms + plugin-prefix variants to identical canonical predicate tokens, collapses
// verification report paths to the single canonical token, and emits a sorted,
// de-duplicated Set<string>. (The EXPECTED-difference allowlist is NOT normalize's
// concern — it lives in the committed reference and is applied by compare.allowlistMatch;
// see compare.test.mjs.)
//
// Run ONLY this file:  node --test l2/test/normalize.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalize } from '../normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'normalize', 'raw-predicates.sample.json'), 'utf8'),
);

// Small helper: build a token Set from an inline record list.
const norm = (records) => normalize(records);

test('3.1a canonical verb map — Claude AND Copilot forms collapse to identical tokens', () => {
  // Both platforms name the same concept differently; after normalize they must be identical.
  const claude = norm([
    { kind: 'delegated', name: 'Task(subagent_type:"maister:gap-analyzer")', source: 'events', evidence: 'x' },
    { kind: 'invoked_skill', name: 'Skill(skill:"maister:codebase-analyzer")', source: 'events', evidence: 'x' },
    { kind: 'gate_fired', name: 'AskUserQuestion', source: 'events', evidence: 'x' },
  ]);
  const copilot = norm([
    { kind: 'delegated', name: 'task(agent_type:"maister-copilot:gap-analyzer")', source: 'events', evidence: 'x' },
    { kind: 'invoked_skill', name: 'skill("codebase-analyzer")', source: 'events', evidence: 'x' },
    { kind: 'gate_fired', name: 'ask_user', source: 'events', evidence: 'x' },
  ]);

  const expected = ['delegated(gap-analyzer)', 'gate_fired(ask)', 'invoked_skill(codebase-analyzer)'];

  // Identical canonical tokens regardless of platform verb form (the whole point of L2).
  assert.deepStrictEqual([...claude], expected);
  assert.deepStrictEqual([...copilot], expected);
  assert.deepStrictEqual([...claude], [...copilot]);

  // The other two gate kinds map too.
  const gates = norm([
    { kind: 'gate_fired', name: 'exit_plan_mode.requested', source: 'events', evidence: 'x' },
    { kind: 'gate_fired', name: 'permission.requested', source: 'events', evidence: 'x' },
  ]);
  assert.deepStrictEqual([...gates], ['gate_fired(exit_plan_mode)', 'gate_fired(permission)']);
});

test('3.1b plugin-prefix stripping — maister: and maister-copilot: both strip to the bare token', () => {
  const result = norm([
    { kind: 'delegated', name: 'maister:gap-analyzer', source: 'events', evidence: 'x' },
    { kind: 'delegated', name: 'maister-copilot:gap-analyzer', source: 'events', evidence: 'x' },
    { kind: 'invoked_skill', name: 'maister:implementation-plan-executor', source: 'events', evidence: 'x' },
    { kind: 'invoked_skill', name: 'maister-copilot:implementation-plan-executor', source: 'events', evidence: 'x' },
  ]);

  // Naming-only platform difference must never surface as a diff: both prefixes -> one token each.
  assert.deepStrictEqual(
    [...result],
    ['delegated(gap-analyzer)', 'invoked_skill(implementation-plan-executor)'],
  );
  // No residual prefix anywhere.
  for (const t of result) {
    assert.ok(!/maister(-copilot)?:/.test(t), `prefix leaked in token: ${t}`);
  }
});

test('3.1c verification-path collapse — any verification/<report> collapses to verification/*', () => {
  const result = norm([
    { kind: 'created_artifact', name: 'verification/verification-report.md', source: 'tree', evidence: 'x' },
    { kind: 'created_artifact', name: 'verification/spec-audit.md', source: 'tree', evidence: 'x' },
    { kind: 'created_artifact', name: 'implementation/spec.md', source: 'tree', evidence: 'x' },
  ]);

  // Two DIFFERENT verification reports collapse to ONE canonical token (collapse + dedup);
  // the non-verification artifact is left untouched.
  assert.deepStrictEqual(
    [...result],
    ['created_artifact(implementation/spec.md)', 'created_artifact(verification/*)'],
  );
  assert.ok(result.has('created_artifact(verification/*)'));
  assert.ok(!result.has('created_artifact(verification/verification-report.md)'));
});

test('1.1a normalize gate_fired_at — LITERAL phase tag, NO normalizePhase strip', () => {
  // gate_fired_at mirrors gate_fired/phase_completed but its payload is the phase TAG itself
  // (phase-N), not a bare number: normalizePhase must NOT run. `phase-8` stays `phase-8`.
  const result = norm([
    { kind: 'gate_fired_at', name: 'phase-8', source: 'events', evidence: 'x' },
  ]);
  assert.deepStrictEqual([...result], ['gate_fired_at(phase-8)']);
  // Explicitly prove the bare-number form did NOT leak (would mean normalizePhase ran).
  assert.ok(!result.has('gate_fired_at(8)'), 'phase tag was stripped — normalizePhase must not run here');
});

test('1.1b normalize gate_count — =value head, mirrors task_characteristic/outcome', () => {
  const result = norm([
    { kind: 'gate_count', name: 'ask', value: 7, source: 'events', evidence: 'x' },
  ]);
  assert.deepStrictEqual([...result], ['gate_count(ask)=7']);
});

test('3.1d sorted/de-duplicated Set over the committed fixture', () => {
  // --- normalize over the committed fixture: sorted, de-duplicated Set<string> ---
  const result = normalize(fixture);
  assert.ok(result instanceof Set, 'normalize returns a Set');

  // Expected canonical tokens (declared unsorted — the test sorts them, so this is not
  // coupled to a hand-computed order). 23 grammar records + 1 comment + 1 noise -> 18 tokens.
  const expected = [
    'delegated(gap-analyzer)',
    'delegated(specification-creator)',
    'invoked_skill(codebase-analyzer)',
    'invoked_skill(implementation-plan-executor)',
    'gate_fired(ask)',
    'gate_fired(exit_plan_mode)',
    'gate_fired(permission)',
    'created_artifact(verification/*)',
    'created_artifact(implementation/spec.md)',
    'created_artifact(implementation/implementation-plan.md)',
    'created_artifact(implementation/work-log.md)',
    'phase_completed(8)',
    'phase_completed(10)',
    'phase_completed(2)',
    'task_characteristic(ui_heavy)=false',
    'task_characteristic(has_reproducible_defect)=false',
    'task_status(completed)',
    'reached_terminal(completion)',
  ];

  // Content equality (order-independent) proves canonicalization + collapse + dedup.
  assert.deepStrictEqual([...result].slice().sort(), [...new Set(expected)].slice().sort());
  // Iteration order is sorted (compare normalize's own order to a freshly-sorted copy).
  assert.deepStrictEqual([...result], [...result].slice().sort());
  // Exact distinct count (dedup: many raw records collapse to fewer tokens).
  assert.strictEqual(result.size, 18);

  // Dedup proof: 4 gap-analyzer records (2 verb forms + 2 prefixes) -> exactly one token.
  assert.strictEqual([...result].filter((t) => t === 'delegated(gap-analyzer)').length, 1);

  // Noise / excluded records and the fixture comment object produce NO tokens and no leaks.
  for (const t of result) {
    assert.ok(!/^(Task|task|Skill|skill)\(/.test(t), `raw verb form leaked: ${t}`);
    assert.ok(!/maister(-copilot)?:/.test(t), `prefix leaked: ${t}`);
    assert.ok(!/AskUserQuestion|ask_user|\.requested/.test(t), `raw gate form leaked: ${t}`);
    assert.ok(!/Bash|tool_execution|git status|_comment/.test(t), `excluded/noise leaked: ${t}`);
  }
});
