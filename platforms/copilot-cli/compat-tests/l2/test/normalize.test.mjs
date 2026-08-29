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

test('1.1c normalize precedes — OPAQUE comma payload, no split, no normalizePhase', () => {
  // Stage 4 (issue #48). ORDER edge: the comma lives INSIDE the single payload; normalize must
  // pass `name` through literally — no 2-arg head, no split, no phase-tag stripping.
  const result = norm([
    { kind: 'precedes', name: 'gap-analyzer,specification-creator', source: 'events', evidence: 'x' },
  ]);
  assert.deepStrictEqual([...result], ['precedes(gap-analyzer,specification-creator)']);
});

test('1.1d normalize min_count — =value head, mirrors gate_count/outcome; nested delegated payload', () => {
  // Stage 4 (issue #48). Token-expansion head: `name="delegated(x)"`, integer value → `=K`.
  const result = norm([
    { kind: 'min_count', name: 'delegated(information-gatherer)', value: 2, source: 'events', evidence: 'x' },
  ]);
  assert.deepStrictEqual([...result], ['min_count(delegated(information-gatherer))=2']);
});

test('1.1e normalize state_schema — 1-arg literal head, conformant|off-schema', () => {
  // Stage 4 (issue #48). Mirrors task_status: literal name payload.
  const conformant = norm([
    { kind: 'state_schema', name: 'conformant', source: 'state', evidence: 'schemaDivergences=0' },
  ]);
  assert.deepStrictEqual([...conformant], ['state_schema(conformant)']);

  const offSchema = norm([
    { kind: 'state_schema', name: 'off-schema', source: 'state', evidence: 'schemaDivergences=3' },
  ]);
  assert.deepStrictEqual([...offSchema], ['state_schema(off-schema)']);
});

test('1.1f dead-entry-trap — a kind not in GRAMMAR_HEADS is rejected at the guard -> null', () => {
  // The `!GRAMMAR_HEADS.has(kind)` guard (normalize.mjs) rejects any head absent from the Set:
  // it is emitted-then-dropped-null and never surfaces as a token. This is the same guard that
  // would silently drop a buildToken case whose head was NOT added to GRAMMAR_HEADS.
  const result = norm([
    { kind: 'not_a_grammar_head', name: 'whatever', source: 'events', evidence: 'x' },
  ]);
  assert.strictEqual(result.size, 0, 'unknown kind must produce NO token (guard rejects it)');
  // Sanity: the three real Stage-4 heads ARE in the Set and DO build (no dead/rejected head).
  const stage4 = norm([
    { kind: 'precedes', name: 'a,b', source: 'events', evidence: 'x' },
    { kind: 'min_count', name: 'delegated(x)', value: 1, source: 'events', evidence: 'x' },
    { kind: 'state_schema', name: 'conformant', source: 'state', evidence: 'x' },
  ]);
  assert.deepStrictEqual(
    [...stage4].sort(),
    ['min_count(delegated(x))=1', 'precedes(a,b)', 'state_schema(conformant)'],
  );
});

test('1.1g normalize hook_effect — INSIDE-parens =value token (TRAP GUARD, exact string)', () => {
  // Stage 6 (issue #48). hook_effect is the ONE value-carrying head that renders the value
  // INSIDE the parens: `hook_effect(destructive_guard=ask)` — NOT the outside-parens shape
  // (`hook_effect(destructive_guard)=ask`) that gate_count/outcome/min_count use. The reference
  // `required[]` entry + compare.test 4.1c assert this EXACT string; a byte for byte match is the
  // whole point of this guard.
  const result = norm([
    { kind: 'hook_effect', name: 'destructive_guard', value: 'ask', source: 'responder', evidence: 'x' },
  ]);
  assert.deepStrictEqual([...result], ['hook_effect(destructive_guard=ask)']);
  // Prove the outside-parens (precedent-pattern-matched) form did NOT leak.
  assert.ok(
    !result.has('hook_effect(destructive_guard)=ask'),
    'value must be INSIDE the parens — do not pattern-match the =value precedent',
  );
});

test('1.1h hook_effect is a LIVE head in BOTH structures — no dead/rejected entry', () => {
  // Dead-entry-trap: a head must be in GRAMMAR_HEADS (else rejected at the guard -> null) AND in
  // buildToken (else emitted-then-dropped-null). hook_effect building a real token proves it lives
  // in both. Paired with a kind that is in NEITHER, which must produce no token.
  const live = norm([
    { kind: 'hook_effect', name: 'destructive_guard', value: 'ask', source: 'responder', evidence: 'x' },
  ]);
  assert.strictEqual(live.size, 1, 'hook_effect must build (present in Set AND buildToken)');

  const dead = norm([
    { kind: 'hook_effect_typo', name: 'destructive_guard', value: 'ask', source: 'responder', evidence: 'x' },
  ]);
  assert.strictEqual(dead.size, 0, 'a kind absent from GRAMMAR_HEADS is rejected at the guard -> null');
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
