// Credit-free unit checks for the quick-bugfix scenario module — mirrors scenario.test.mjs (shape +
// routing determinism), focused on the quick-bugfix contract: an events-only shape driven against a
// bug-seeded sandbox. Also asserts the committed reference hash is self-consistent.
//
// Run with: node --test l2/test/scenario-quick-bugfix.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import scenario, { fallbackPrompt } from '../scenarios/quick-bugfix.mjs';
import { computeHash } from '../compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_ROOT = path.join(__dirname, '..');

// Quick paths are short (single-file TDD loop, no subagent fan-out), but still generous vs the shape.
const GENEROUS_TIMEOUT_FLOOR_MS = 5 * 60 * 1000;

test('quick-bugfix scenario module exports a well-formed quick-bugfix scenario', () => {
  assert.ok(scenario && typeof scenario === 'object', 'scenario must be an object');

  assert.equal(scenario.id, 'quick-bugfix');
  assert.equal(scenario.expectedShape, 'quick-bugfix');
  assert.equal(
    scenario.taskType,
    'quick-bugfix',
    'taskType selects the quick-bugfix TREE_PROFILE (no artifacts / no task-dir → events-only skeleton)',
  );

  // sandboxTemplate names a real tracked dir AND carries the seeded, reproducible defect.
  assert.equal(scenario.sandboxTemplate, 'sample-cli-bug');
  const sandboxDir = path.join(L2_ROOT, 'sandbox', scenario.sandboxTemplate);
  assert.ok(existsSync(sandboxDir), `sandbox template dir must exist: ${sandboxDir}`);
  // The bug is present and reproducible: `upper hello` must currently print the WRONG (lower) case.
  const out = execFileSync('sh', [path.join(sandboxDir, 'cli.sh'), 'upper', 'hello'], { encoding: 'utf8' }).trim();
  assert.equal(out, 'hello', 'seeded bug: `upper hello` must currently print lower-case (to be fixed by the run)');

  // prompt — names quick-bugfix, states the bug, and does NOT route to research.
  assert.equal(typeof scenario.prompt, 'string');
  assert.ok(scenario.prompt.trim().length > 0, 'prompt must be non-empty');
  assert.match(scenario.prompt, /quick-bugfix/i, 'prompt must name the quick-bugfix workflow');
  assert.match(scenario.prompt, /\bbug\b/i, 'prompt must frame a bug fix');
  assert.doesNotMatch(scenario.prompt, /\b(research|investigate|explore options)\b/i, 'prompt must not route to research');

  // timeoutMs — present, finite, generous for the (short) shape.
  assert.equal(typeof scenario.timeoutMs, 'number');
  assert.ok(Number.isFinite(scenario.timeoutMs), 'timeoutMs must be finite');
  assert.ok(scenario.timeoutMs >= GENEROUS_TIMEOUT_FLOOR_MS, `timeoutMs must be >= ${GENEROUS_TIMEOUT_FLOOR_MS}`);

  // fallback prompt — distinct restatement, still names quick-bugfix.
  assert.equal(typeof fallbackPrompt, 'string');
  assert.notEqual(fallbackPrompt, scenario.prompt, 'fallbackPrompt must be a distinct restatement');
  assert.equal(scenario.fallbackPrompt, fallbackPrompt, 'scenario.fallbackPrompt must equal the named export');
  assert.match(fallbackPrompt, /quick-bugfix/i, 'fallbackPrompt must name the quick-bugfix skill');
});

test('quick-bugfix reference skeleton hash is self-consistent (tamper guard)', () => {
  const ref = JSON.parse(readFileSync(path.join(L2_ROOT, 'reference', 'quick-bugfix.skeleton.json'), 'utf8'));
  assert.equal(ref.scenario, 'quick-bugfix');
  assert.equal(ref.hash, computeHash(ref), 'stored hash must equal the recomputed hash');
  // Events-only shape: no phase_completed / created_artifact / delegated / task_status required.
  for (const p of ref.required) {
    assert.doesNotMatch(p, /^(phase_completed|created_artifact|delegated|task_status)\b/, `quick-bugfix required predicate should be events-only, got: ${p}`);
  }
});
