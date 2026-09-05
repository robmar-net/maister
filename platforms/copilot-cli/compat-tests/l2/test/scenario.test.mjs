// Credit-free unit checks for the Group 5 sandbox + dev-routing scenario.
//
// Two checks (per plan step 5.1), each with focused assertions:
//   1. scenarios/development.mjs exports a well-formed
//      { id, sandboxTemplate, prompt, expectedShape: 'development', timeoutMs }
//      with a generous timeout, a routing-deterministic prompt, and a registered
//      fallback prompt (MEDIUM-3).
//   2. the sandbox's self-contained shell runner is a REAL oracle: on the pristine
//      sample-cli (which lacks the `--greet` deliverable) it exits NON-ZERO because
//      the greet check fails, while the three pre-existing checks (hello/upper/version)
//      still pass — proving the runner has genuine detection power (HIGH-3).
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

test('pristine sandbox missing deliverable -> runner is a real oracle (exits non-zero)', () => {
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

  // DETECTION POWER (HIGH-3): pristine sample-cli has no `--greet` subcommand, so the
  // greet check FAILS and the runner exits NON-ZERO. `run-tests.sh` exit 0 is therefore
  // a real functional oracle — pristine sandbox fails, dev-workflow-completed passes.
  assert.notEqual(
    result.status,
    0,
    `pristine sandbox runner must exit NON-ZERO (missing --greet deliverable).\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
  );

  // The three pre-existing checks still pass on the pristine sandbox — the ONLY
  // failing check is the newly added greet deliverable test.
  assert.match(
    result.stdout,
    /ok\s+- hello prints the fixed greeting/,
    `hello check must still pass.\n--- stdout ---\n${result.stdout}`,
  );
  assert.match(
    result.stdout,
    /ok\s+- upper upper-cases its argument/,
    `upper check must still pass.\n--- stdout ---\n${result.stdout}`,
  );
  assert.match(
    result.stdout,
    /ok\s+- version reports the CLI version/,
    `version check must still pass.\n--- stdout ---\n${result.stdout}`,
  );

  // The greet deliverable check is the failing one (the detection-power proof).
  assert.match(
    result.stdout,
    /FAIL - greet names the person/,
    `greet deliverable check must be the failing check.\n--- stdout ---\n${result.stdout}`,
  );
});

// Phase-11 exit-gate placement (regression for the 1.0.82 live REGRESSED, run 20260830T155522Z).
// Phase 11's mandatory exit gate is "Continue to Phase 12?" (SKILL.md:436), but phases 12/13 are
// CONDITIONAL (SKILL.md:120-122); when both skip, the orchestrator points the gate at the next ACTIVE
// phase — 14 — so the question becomes "Continue to Phase 14 finalization?". BOTH phrasings are the
// Phase-11 gate and must map to phase 11, without stealing phase-13's own →14 ("documentation complete").
test('development gateMap: Phase-11 exit gate maps for BOTH the literal-12 and the skipped-12/13 →14 phrasing', () => {
  const gm = scenario.gateMap;
  assert.ok(Array.isArray(gm) && gm.length, 'scenario.gateMap must be a non-empty array');
  const place = (q) => { const hit = gm.find((g) => g.re.test(q)); return hit ? hit.phase : null; };

  // Literal (12 active): the documented gate text.
  assert.equal(place('Continue to Phase 12?'), 11, 'literal "Continue to Phase 12?" → phase 11');

  // Skipped 12/13 (the observed 1.0.82 phrasing): verification summary + →14/finalization.
  assert.equal(
    place('Re-verification passed: 12/12 tests, no critical issues; approved validation fixes are complete. One production-documentation mitigation remains outside scope. Continue to Phase 14 finalization?'),
    11,
    'verification-summary gate that continues to Phase 14 (12/13 skipped) → phase 11',
  );

  // Phase-13's OWN exit to 14 must NOT be stolen by phase-11 (no verification-summary text; its marker
  // is "documentation complete").
  assert.equal(
    place('User documentation complete. Continue to Phase 14 finalization?'),
    13,
    'phase-13 "documentation complete" →14 gate stays on phase 13, not phase 11',
  );

  // A phase-11 FIX-LOOP question ("...Which should I fix?") is not the exit gate and must not spuriously
  // map to a later phase; it lacks "continue to phase 14", so phase-11's exit branch does not match it.
  assert.notEqual(
    place('Verification found no critical issues. Warnings: ... Which should I fix?'),
    12,
    'the fix-loop question must not map to phase 12',
  );
});

// =========================================================================
// #131 — QUALIFIER TOLERANCE in the "continue to <phase noun>" gate family.
//
// SKILL.md gives each of these gates a verbatim question (e.g. :296 → "Continue to specification
// audit?"). The model routinely inserts a qualifier taken from SKILL.md's OWN phase headings
// between "Continue to" and the noun — "Continue to *the recommended* specification audit?",
// Phase 6 being titled "Specification Audit (Recommended)". The mandatory gate HAS fired; only the
// literal regex missed it, and the phase token then read as a regression.
//
// Measured on three otherwise-identical 1.0.82 development drives: 2 of 3 lost
// `gate_fired_at(phase-5)` exactly this way (reports 20260904T212138Z / 213801Z vs 214857Z).
// The questions below are those runs' verbatim gate text, kept here as a REGRESSION FIXTURE — the
// observed wording belongs in a test, never in a reference (AGENTS.md: never fit a predicate to a run).
test('#131 gateMap tolerates a qualifier between "continue to" and the phase noun, and still steals nothing', () => {
  const gm = scenario.gateMap;
  const place = (q) => { const hit = gm.find((g) => g.re.test(q)); return hit ? hit.phase : null; };

  // The two drives that regressed, and the one that did not — all three are the SAME Phase-5 gate.
  assert.equal(
    place('Specification complete: it defines the exact greeting output, quoted-name preservation, missing-name usage error, documentation updates, and three required test cases. Continue to the recommended specification audit?'),
    5,
    '20260904T212138Z Phase-5 exit gate must place on phase 5 despite the inserted "the recommended"',
  );
  assert.equal(
    place('Specification complete: it covers exact output, quoted multi-word names, missing-name error semantics, documentation, and existing shell tests. Continue to the recommended specification audit?'),
    5,
    '20260904T213801Z Phase-5 exit gate must place on phase 5',
  );
  assert.equal(
    place('Specification complete: scope is the existing POSIX CLI, one `cmd_greet` dispatch branch, help/README updates, and shell tests. Continue to specification audit?'),
    5,
    '20260904T214857Z (the drive that passed) must keep placing on phase 5 — the fix is additive',
  );

  // The tolerance must not let phase 5 swallow phase 6's own gate: that question also contains
  // "specification audit", but BEFORE "continue to", and `[^?]*` cannot cross the '?'.
  assert.equal(
    place('Specification audit passed with minor concerns: the edge cases are implementable. Continue to implementation planning?'),
    6,
    'phase-6 exit gate stays on phase 6 even though it mentions "specification audit"',
  );

  // The rest of the family keeps its own gate under the same tolerance.
  assert.equal(place('Implementation plan complete: two sequential groups. Continue to implementation?'), 7);
  assert.equal(place('Implementation complete: both test runners pass. Continue to verification?'), 8);
  assert.equal(place('Gap analysis complete: low-risk enhancement. Continue to Phase 5: technical approach?'), 2);
});
