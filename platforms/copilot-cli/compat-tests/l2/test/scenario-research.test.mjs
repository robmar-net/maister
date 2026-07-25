// Credit-free unit checks for the research scenario module — mirrors scenario.test.mjs (shape +
// routing determinism), focused on the research-specific contract. The sandbox self-runner is
// already covered by scenario.test.mjs (research REUSES the sample-cli sandbox), so it is not
// re-run here.
//
// Run with: node --test l2/test/scenario-research.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import scenario, { fallbackPrompt } from '../scenarios/research.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_ROOT = path.join(__dirname, '..');

// A research run has no implement/verify chain but still fans out planner + gatherers + synthesizer;
// guard against a carelessly small timeout that would false-INCOMPLETE a slow-but-progressing run.
const GENEROUS_TIMEOUT_FLOOR_MS = 10 * 60 * 1000;

test('research scenario module exports a well-formed research scenario', () => {
  assert.ok(scenario && typeof scenario === 'object', 'scenario must be an object');

  // id / shape / taskType pin the conformance target + select the extractor tree profile.
  assert.equal(scenario.id, 'research');
  assert.equal(scenario.expectedShape, 'research');
  assert.equal(
    scenario.taskType,
    'research',
    'taskType selects the research TREE_PROFILE + the .maister/tasks/research/ state subtree',
  );

  // sandboxTemplate names a real, tracked template directory under l2/sandbox/ (reuses sample-cli).
  assert.equal(typeof scenario.sandboxTemplate, 'string');
  assert.ok(scenario.sandboxTemplate.length > 0, 'sandboxTemplate must be non-empty');
  const sandboxDir = path.join(L2_ROOT, 'sandbox', scenario.sandboxTemplate);
  assert.ok(existsSync(sandboxDir), `sandbox template dir must exist: ${sandboxDir}`);

  // prompt — non-empty, routes DETERMINISTICALLY to research, avoids development / quick keywords.
  assert.equal(typeof scenario.prompt, 'string');
  assert.ok(scenario.prompt.trim().length > 0, 'prompt must be non-empty');
  assert.match(scenario.prompt, /research/i, 'prompt must name the research workflow');
  assert.doesNotMatch(scenario.prompt, /development/i, 'primary prompt must not name the development workflow');
  assert.doesNotMatch(
    scenario.prompt,
    /\b(add|fix|implement|enhance|create)\b/i,
    'primary prompt must not use development routing keywords',
  );
  assert.doesNotMatch(scenario.prompt, /quick-(dev|bugfix)/i, 'primary prompt must not invite a quick path');

  // timeoutMs — present, finite, generous.
  assert.equal(typeof scenario.timeoutMs, 'number');
  assert.ok(Number.isFinite(scenario.timeoutMs), 'timeoutMs must be a finite number');
  assert.ok(
    scenario.timeoutMs >= GENEROUS_TIMEOUT_FLOOR_MS,
    `timeoutMs must be generous (>= ${GENEROUS_TIMEOUT_FLOOR_MS} ms), got ${scenario.timeoutMs}`,
  );

  // fallback prompt — registered, non-empty, a DISTINCT restatement that still names research.
  assert.equal(typeof fallbackPrompt, 'string');
  assert.ok(fallbackPrompt.trim().length > 0, 'fallbackPrompt must be non-empty');
  assert.notEqual(fallbackPrompt, scenario.prompt, 'fallbackPrompt must be a distinct restatement');
  assert.equal(
    scenario.fallbackPrompt,
    fallbackPrompt,
    'scenario.fallbackPrompt must equal the named export (single source)',
  );
  assert.match(fallbackPrompt, /research/i, 'fallbackPrompt must name the research skill');
});
