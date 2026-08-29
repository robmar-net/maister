// Reference-integrity tests for the maister-model-derived research golden
// (l2/reference/research.skeleton.json) — mirrors reference.test.mjs.
//
// Binds the COMMITTED golden to the single hash definition (computeHash in ../compare.mjs) and
// asserts its structural invariants: the Phase-1 research FOUNDATION (phase 1 + the three always-on
// delegations + the two always-produced deliverables + terminal + completed status) is REQUIRED,
// while the root user-invocable research skill and the conditional brainstorming/design phases are
// OPTIONAL. Reference authored from the DOCUMENTED research workflow model (tautology guard), not a run.
//
// Run ONLY these: node --test l2/test/reference-research.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeHash } from '../compare.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_PATH = join(__dirname, '..', 'reference', 'research.skeleton.json');

const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8'));

test('research golden: stored hash === computeHash(reference)', () => {
  assert.equal(
    computeHash(reference),
    reference.hash,
    'stored hash must equal computeHash(reference) — re-stamp the golden',
  );
});

test('research golden: scenario id + version stamps', () => {
  assert.equal(reference.scenario, 'research');
  assert.equal(reference.schema_version, 2);
  assert.equal(reference.workflow_model_version, 3, 'workflow model v3 (Stage 3 gates: rules[] + gate_fired_at optional rows + rules-in-hash re-stamp)');
});

test('research structural invariants: Phase-1 foundation required; root skill + conditional phases optional', () => {
  const required = new Set(reference.required);
  const optional = new Set(reference.optional);

  // The research foundation is the invariant core of ANY correct run, independent of gate answers.
  for (const p of [
    'phase_completed(1)',
    'delegated(research-planner)',
    'delegated(information-gatherer)',
    'delegated(research-synthesizer)',
    'created_artifact(analysis/synthesis.md)',
    'created_artifact(outputs/research-report.md)',
    'gate_fired(ask)',
    'reached_terminal(completion)',
    'task_status(completed)',
  ]) {
    assert.ok(required.has(p), `${p} must be required`);
  }

  // The root user-invocable research skill may or may not surface as skill.invoked (HIGH-1, cf. the
  // development golden which models invoked_skill(development) optional).
  assert.ok(optional.has('invoked_skill(research)'), 'invoked_skill(research) must be optional');

  // Brainstorming/design are gate-conditional -> their phases + delegations are optional.
  for (const p of [
    'phase_completed(3)',
    'phase_completed(5)',
    'delegated(solution-brainstormer)',
    'delegated(solution-designer)',
  ]) {
    assert.ok(optional.has(p), `${p} must be optional`);
  }

  // The partition must be disjoint (no predicate both required and optional).
  for (const p of required) assert.ok(!optional.has(p), `${p} appears in BOTH required and optional`);
});
