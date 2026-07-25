// Reference-integrity tests for the maister-model-derived golden
// (l2/reference/development.skeleton.json) — Task Group 6.
//
// Distinct from compare.test.mjs (which proves the comparator over fixtures):
// these two checks bind the COMMITTED golden to the single hash definition
// (computeHash in ../compare.mjs) and assert its structural invariants — the
// always-on development phases plus the Phase 8 executor skill are REQUIRED,
// while the root user-invocable development skill is OPTIONAL (HIGH-1).
//
// Run ONLY these: node --test l2/test/reference.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeHash } from '../compare.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_PATH = join(__dirname, '..', 'reference', 'development.skeleton.json');

const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8'));

test('6a committed golden: stored hash === computeHash(reference)', () => {
  // The single hash definition (compare.mjs) is what Group 6 stamps and Group 7
  // verifies. If this fails, the golden was edited without re-stamping.
  assert.equal(
    computeHash(reference),
    reference.hash,
    'stored hash must equal computeHash(reference) — re-stamp the golden',
  );
});

test('6b structural invariants: always-on phases + executor skill required, development skill optional', () => {
  const required = new Set(reference.required);
  const optional = new Set(reference.optional);

  // Every always-on development phase must be a required predicate.
  for (const phase of [1, 2, 5, 7, 8, 10, 11, 14]) {
    assert.ok(
      required.has(`phase_completed(${phase})`),
      `phase_completed(${phase}) must be required`,
    );
  }

  // Phase 8 ALWAYS makes the implementation-plan-executor Skill call (HIGH-1).
  assert.ok(
    required.has('invoked_skill(implementation-plan-executor)'),
    'invoked_skill(implementation-plan-executor) must be required',
  );

  // The root user-invocable development skill may or may not surface (HIGH-1).
  assert.ok(
    optional.has('invoked_skill(development)'),
    'invoked_skill(development) must be optional',
  );
});
