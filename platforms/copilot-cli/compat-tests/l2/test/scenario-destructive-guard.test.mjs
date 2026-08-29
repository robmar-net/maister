// Credit-free unit checks for the destructive-guard scenario module — mirrors scenario-quick-bugfix.test.mjs
// (shape + routing determinism), focused on the destructive-guard contract: an events-only shape driven
// against a marker-seeded sandbox, carrying a `permissionResponder` selection field, with `outcome:[]`.
//
// NOTE (Stage 6 staging): the reference-hash self-consistency assertion is GUARDED — it runs only once the
// governance/landing group (G6) has created reference/destructive-guard.skeleton.json. Until then it SKIPS
// with a clear message (rather than failing red). Everything else (shape, sandbox, fixture faithfulness)
// passes now. See the guarded test below.
//
// Run with: node --test l2/test/scenario-destructive-guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import scenario, { fallbackPrompt } from '../scenarios/destructive-guard.mjs';
import { computeHash } from '../compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_ROOT = path.join(__dirname, '..');

// A single destructive-command interception is short, but the timeout is still generous vs the shape.
const GENEROUS_TIMEOUT_FLOOR_MS = 5 * 60 * 1000;

// EXACT mirror of the block-destructive-commands.sh:54 guard regex (case-insensitive). The prompt must
// name a command that this guard would intercept.
const GUARD_REGEX =
  /git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*$|git\s+clean|git\s+push\s+(-f|--force)|rm\s+-rf/i;

test('destructive-guard scenario module exports a well-formed destructive-guard scenario', () => {
  assert.ok(scenario && typeof scenario === 'object', 'scenario must be an object');

  assert.equal(scenario.id, 'destructive-guard');
  assert.equal(scenario.expectedShape, 'destructive-guard');
  assert.equal(
    scenario.taskType,
    'quick-bugfix',
    'taskType reuses the quick-bugfix TREE_PROFILE (no artifacts / no task-dir → events-only skeleton)',
  );

  // Responder-selection field — the key run.mjs reads to install observeDestructiveGuard over approveAll.
  assert.equal(
    scenario.permissionResponder,
    'observe-destructive-guard',
    'permissionResponder must select the observe-destructive-guard responder',
  );

  // Guard-firing is the predicate, NOT a functional outcome — no run-tests.sh oracle.
  assert.ok(Array.isArray(scenario.outcome), 'outcome must be an array');
  assert.equal(scenario.outcome.length, 0, 'outcome must be empty ([]) — no functional oracle');

  // Stage-3/4 spines are empty for a bare destructive-command run.
  assert.deepEqual(scenario.gateMap, [], 'gateMap must be empty');
  assert.deepEqual(scenario.precedesChain, [], 'precedesChain must be empty');
  assert.deepEqual(scenario.minCounts, [], 'minCounts must be empty');
  assert.equal(scenario.model, null, 'model must be null (account/SDK default)');

  // sandboxTemplate names a real tracked dir AND carries the throwaway marker the prompt targets.
  assert.equal(scenario.sandboxTemplate, 'sample-cli-destructive');
  const sandboxDir = path.join(L2_ROOT, 'sandbox', scenario.sandboxTemplate);
  assert.ok(existsSync(sandboxDir), `sandbox template dir must exist: ${sandboxDir}`);
  // The disposable marker the `rm -rf ./.tmp-scratch` cleanup targets is staged in the template.
  assert.ok(
    existsSync(path.join(sandboxDir, '.tmp-scratch')),
    'sandbox must stage the throwaway ./.tmp-scratch marker dir the prompt removes',
  );
  // The CLI is a real, runnable POSIX-sh script (sanity: `hello` greets).
  const out = execFileSync('sh', [path.join(sandboxDir, 'cli.sh'), 'hello'], { encoding: 'utf8' }).trim();
  assert.equal(out, 'Hello, world!', 'sandbox cli.sh must be a runnable POSIX-sh CLI');
  // No run-tests.sh — outcome:[] means no functional oracle to restage/run.
  assert.ok(
    !existsSync(path.join(sandboxDir, 'run-tests.sh')),
    'destructive-guard sandbox must NOT carry a run-tests.sh (outcome:[])',
  );

  // prompt — induces a destructive cleanup the guard intercepts, and does NOT route to research.
  assert.equal(typeof scenario.prompt, 'string');
  assert.ok(scenario.prompt.trim().length > 0, 'prompt must be non-empty');
  assert.match(scenario.prompt, GUARD_REGEX, 'prompt must name a command the destructive guard intercepts');
  assert.match(scenario.prompt, /rm\s+-rf/i, 'prompt must induce an `rm -rf` cleanup');
  assert.doesNotMatch(
    scenario.prompt,
    /\b(research|investigate|explore options)\b/i,
    'prompt must not route to research',
  );

  // timeoutMs — present, finite, generous for the (short) shape.
  assert.equal(typeof scenario.timeoutMs, 'number');
  assert.ok(Number.isFinite(scenario.timeoutMs), 'timeoutMs must be finite');
  assert.ok(scenario.timeoutMs >= GENEROUS_TIMEOUT_FLOOR_MS, `timeoutMs must be >= ${GENEROUS_TIMEOUT_FLOOR_MS}`);

  // fallback prompt — distinct restatement, still names the same rm -rf cleanup, dual export equality.
  assert.equal(typeof fallbackPrompt, 'string');
  assert.notEqual(fallbackPrompt, scenario.prompt, 'fallbackPrompt must be a distinct restatement');
  assert.equal(scenario.fallbackPrompt, fallbackPrompt, 'scenario.fallbackPrompt must equal the named export');
  assert.match(fallbackPrompt, /rm\s+-rf/i, 'fallbackPrompt must name the same rm -rf cleanup');
});

test('recorded permission-destructive fixture is faithful (no fabricated decision field)', () => {
  const fixture = JSON.parse(
    readFileSync(path.join(L2_ROOT, 'test', 'fixtures', 'extractor', 'permission-destructive.json'), 'utf8'),
  );
  assert.ok(Array.isArray(fixture), 'fixture must be an events array');
  const perm = fixture.find((e) => e.type === 'permission.requested');
  assert.ok(perm, 'fixture must contain a permission.requested event');
  assert.equal(perm.data.permissionRequest.kind, 'shell', 'permissionRequest.kind must be shell');
  assert.match(perm.data.permissionRequest.command, /rm\s+-rf/i, 'permissionRequest.command must be an rm -rf');
  assert.equal(typeof perm.data.requestId, 'string', 'permission.requested must carry a requestId');
  // Faithful to the recorded live shape: the SDK does NOT re-surface the decision on the recorded event.
  assert.ok(
    !('permissionDecision' in perm.data),
    'fixture must NOT fabricate a permissionDecision field on the recorded event',
  );
  assert.ok(
    !('permissionDecision' in perm.data.permissionRequest),
    'fixture must NOT fabricate a permissionDecision on the permissionRequest',
  );
});

// GUARDED (Stage 6): the reference-hash self-consistency (tamper guard) check runs only once G6 has
// landed reference/destructive-guard.skeleton.json (schema 4 / wm 5, recomputed hash). Until then it
// SKIPS — this scenario module + sandbox + fixture are the staging (Group 5); the reference + derivation
// + governance re-stamps are the G6 landing group's job. When G6 lands, this asserts:
//   - ref.scenario === 'destructive-guard'
//   - ref.hash === computeHash(ref)         (tamper guard)
//   - required = [hook_effect(destructive_guard=ask), reached_terminal(completion)]  (model-driven, no outcome())
test('destructive-guard reference skeleton hash is self-consistent (tamper guard) [G6-gated]', (t) => {
  const refPath = path.join(L2_ROOT, 'reference', 'destructive-guard.skeleton.json');
  if (!existsSync(refPath)) {
    t.skip('reference/destructive-guard.skeleton.json not yet landed (G6 governance group) — skipping ref-hash check');
    return;
  }
  const ref = JSON.parse(readFileSync(refPath, 'utf8'));
  assert.equal(ref.scenario, 'destructive-guard');
  assert.equal(ref.hash, computeHash(ref), 'stored hash must equal the recomputed hash');
  // required set is model-driven: the guard-firing predicate + terminal, NO outcome()=pass.
  assert.ok(
    ref.required.includes('hook_effect(destructive_guard=ask)'),
    'required must include the inside-parens hook_effect(destructive_guard=ask) token',
  );
  assert.ok(
    ref.required.includes('reached_terminal(completion)'),
    'required must include reached_terminal(completion)',
  );
  for (const p of ref.required) {
    assert.doesNotMatch(p, /^outcome\(/, `destructive-guard required set is model-driven (no outcome()), got: ${p}`);
  }
});
