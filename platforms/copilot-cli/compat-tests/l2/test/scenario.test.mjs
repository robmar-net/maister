// Credit-free unit checks for the Group 5 sandbox + dev-routing scenario.
//
// Two checks (per plan step 5.1), each with focused assertions:
//   1. scenarios/development.mjs exports a well-formed
//      { id, sandboxTemplate, prompt, expectedShape: 'development', timeoutMs }
//      with a generous timeout, a routing-deterministic prompt, and a registered
//      fallback prompt (MEDIUM-3).
//   2. the sandbox's self-contained shell runner executes green (exit 0), proving
//      the live workflow will have a runnable test to exercise.
//
// Zero-dependency: `node:` builtins only. Run with:
//   node --test l2/test/scenario.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import scenario, { fallbackPrompt } from '../scenarios/development.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_ROOT = path.join(__dirname, '..');

// "Generous" floor: a full live development run is long; guard against a
// carelessly small timeout that would false-INCOMPLETE a slow-but-progressing run.
const GENEROUS_TIMEOUT_FLOOR_MS = 10 * 60 * 1000;

test('scenario module exports a well-formed development scenario (MEDIUM-3)', () => {
  assert.ok(scenario && typeof scenario === 'object', 'scenario must be an object');

  // id
  assert.equal(typeof scenario.id, 'string');
  assert.ok(scenario.id.length > 0, 'id must be non-empty');

  // sandboxTemplate names a real, tracked template directory under l2/sandbox/
  assert.equal(typeof scenario.sandboxTemplate, 'string');
  assert.ok(scenario.sandboxTemplate.length > 0, 'sandboxTemplate must be non-empty');
  const sandboxDir = path.join(L2_ROOT, 'sandbox', scenario.sandboxTemplate);
  assert.ok(existsSync(sandboxDir), `sandbox template dir must exist: ${sandboxDir}`);

  // expectedShape pins the conformance target
  assert.equal(scenario.expectedShape, 'development');

  // prompt — non-empty and designed to route DETERMINISTICALLY to development
  assert.equal(typeof scenario.prompt, 'string');
  assert.ok(scenario.prompt.trim().length > 0, 'prompt must be non-empty');
  assert.match(
    scenario.prompt,
    /development/i,
    'prompt must name the development workflow (MEDIUM-3 routing determinism)',
  );
  assert.doesNotMatch(
    scenario.prompt,
    /quick-(dev|bugfix)/i,
    'primary prompt must not invite a quick path',
  );

  // timeoutMs — present, finite, and generous
  assert.equal(typeof scenario.timeoutMs, 'number');
  assert.ok(Number.isFinite(scenario.timeoutMs), 'timeoutMs must be a finite number');
  assert.ok(
    scenario.timeoutMs >= GENEROUS_TIMEOUT_FLOOR_MS,
    `timeoutMs must be generous (>= ${GENEROUS_TIMEOUT_FLOOR_MS} ms), got ${scenario.timeoutMs}`,
  );

  // fallback prompt — registered (MEDIUM-3), non-empty, and a DISTINCT restatement
  assert.equal(typeof fallbackPrompt, 'string');
  assert.ok(fallbackPrompt.trim().length > 0, 'fallbackPrompt must be non-empty');
  assert.notEqual(
    fallbackPrompt,
    scenario.prompt,
    'fallbackPrompt must be a distinct restatement of the primary prompt',
  );
  assert.equal(
    scenario.fallbackPrompt,
    fallbackPrompt,
    'scenario.fallbackPrompt must equal the named export (single source)',
  );
});

test('sandbox self-contained runner executes green (exit 0)', () => {
  const sandboxDir = path.join(L2_ROOT, 'sandbox', scenario.sandboxTemplate);

  // Deterministic-init requirement: a minimal INDEX.md ships with the sandbox so
  // a development run inside it does not stall on project initialization.
  const indexMd = path.join(sandboxDir, '.maister', 'docs', 'INDEX.md');
  assert.ok(existsSync(indexMd), `sandbox must ship .maister/docs/INDEX.md: ${indexMd}`);

  // Self-contained shell runner (no Node/Python toolchain assumed in the sandbox).
  const runner = path.join(sandboxDir, 'run-tests.sh');
  assert.ok(existsSync(runner), `sandbox test runner must exist: ${runner}`);

  const result = spawnSync('sh', ['run-tests.sh'], { cwd: sandboxDir, encoding: 'utf8' });

  assert.equal(result.error, undefined, `runner should spawn without error: ${result.error}`);
  assert.equal(
    result.status,
    0,
    `sandbox runner must exit 0.\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
  );
});
