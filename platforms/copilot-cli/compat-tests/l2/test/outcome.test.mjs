// Credit-free unit tests for the L2 FUNCTIONAL ORACLE grammar head `outcome(<id>)=pass|fail`
// (issue #48, Stage 2). Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/outcome.test.mjs
//
// Covers Task Group 1 acceptance (the code triad + version bump):
//   1. buildToken round-trip — {kind:'outcome',name,value} normalizes to `outcome(name)=value`
//      (guards the atomic-landing / dead-entry trap: the head must be in GRAMMAR_HEADS).
//   2. Floor-bypass (a) — phases>0 + artifacts + failing outcome -> compare() REGRESSED.
//   3. Floor-bypass (b) MEDIUM-2 — phases==0 + artifacts + failing outcome -> ex.incomplete===false
//      (the outcome-aware short-circuit) -> compare() REGRESSED, never INCOMPLETE.
//   4. Id-namespace guard — an id shadowing a state-predicate prefix -> extract THROWS
//      (namespace hygiene ONLY, not floor protection).
//   5. Runtime fail — a non-zero / missing command -> `outcome=fail` record, NO exception out of extract.
//   6. Malformed spec (bad shape) -> extract THROWS. (Rule of thumb: bad shape -> throw; bad result -> fail record.)
//
// Idiom: os.tmpdir() rundirs via mkdtempSync + `finally rmSync` (extractor.test.mjs T7). Command-type
// specs here pass `restage: []` so the runtime paths are hermetic (no sandbox template needed); the
// restage / dev-oracle detection tests live in later task groups.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extract } from '../extractor.mjs';
import { normalize } from '../normalize.mjs';
import { compare, EXIT } from '../compare.mjs';

// ---- helpers -------------------------------------------------------------

// Build a throwaway rundir that extractFromTree resolves as a single development task dir (the
// `implementation/` marker is one of the development profile's fallbackDirs), so `artifactsExist`.
function mkRundirWithArtifacts() {
  const rundir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-outcome-'));
  const impl = path.join(rundir, 'implementation');
  fs.mkdirSync(impl, { recursive: true });
  fs.writeFileSync(path.join(impl, 'spec.md'), '# spec\n');
  return rundir;
}

const outcomeRecord = (ex) => ex.records.find((r) => r.kind === 'outcome');

// =========================================================================
// 1. buildToken round-trip (dead-entry trap guard)
// =========================================================================

test('outcome buildToken round-trip: {kind:outcome,name,value} normalizes to outcome(name)=value', () => {
  const pass = normalize([{ kind: 'outcome', name: 'bug-fixed', value: 'pass', source: 'outcome' }]);
  assert.ok(pass.has('outcome(bug-fixed)=pass'), 'pass token must survive normalize');

  const fail = normalize([{ kind: 'outcome', name: 'tests-pass', value: 'fail', source: 'outcome' }]);
  assert.ok(fail.has('outcome(tests-pass)=fail'), 'fail token must survive normalize');

  // Free-form id is carried verbatim (mirrors task_characteristic(name)=value; no pattern rewrite).
  const freeform = normalize([{ kind: 'outcome', name: 'report-produced', value: 'pass', source: 'outcome' }]);
  assert.deepEqual([...freeform], ['outcome(report-produced)=pass']);
});

// =========================================================================
// 2. Floor-bypass (a): phases>0 + artifacts + failing outcome -> REGRESSED
// =========================================================================

test('floor-bypass (a): phases>0 + artifacts + failing outcome -> compare REGRESSED (not masked)', () => {
  const rundir = mkRundirWithArtifacts();
  try {
    const stateYaml = 'orchestrator:\n  completed_phases: ["phase-1"]\ntask:\n  status: completed\n';
    const ex = extract({
      events: [],
      taskDirRoot: rundir,
      stateYaml,
      taskType: 'development',
      outcome: [{ id: 'bug-fixed', command: 'exit 1', restage: [] }],
    });

    // phases present -> the MEDIUM-2 floor does not apply.
    assert.equal(ex.incomplete, false, 'phases>0 must not be INCOMPLETE');

    // The outcome ran and FAILED.
    const rec = outcomeRecord(ex);
    assert.ok(rec, 'an outcome record must be emitted');
    assert.equal(rec.value, 'fail');

    const observed = normalize(ex.records);
    assert.ok(observed.has('outcome(bug-fixed)=fail'), 'observed skeleton carries the fail token');

    // Reference REQUIRES the pass token; every other observed token is modelled optional, so the ONLY
    // candidate regression is the missing pass -> REGRESSED comes solely from the failing outcome.
    const reference = { required: ['outcome(bug-fixed)=pass'], optional: [...observed], allowlist: [] };
    const result = compare(observed, reference);
    assert.equal(result.overall, 'REGRESSED');
    assert.equal(result.exitCode, EXIT.REGRESSED);
  } finally {
    fs.rmSync(rundir, { recursive: true, force: true });
  }
});

// =========================================================================
// 3. Floor-bypass (b) MEDIUM-2: phases==0 + artifacts + failing outcome
//    -> ex.incomplete===false (outcome-aware guard) -> REGRESSED, not INCOMPLETE
// =========================================================================

test('floor-bypass (b) MEDIUM-2: phases==0 + artifacts + failing outcome -> incomplete===false -> REGRESSED', () => {
  const rundir = mkRundirWithArtifacts();
  try {
    // Zero completed phases WHILE artifacts exist: without the outcome-aware guard this trips the
    // MEDIUM-2 short-circuit (INCOMPLETE). A failing outcome must suppress that downgrade.
    const stateYaml = 'orchestrator:\n  completed_phases: []\ntask:\n  status: completed\n';
    const ex = extract({
      events: [],
      taskDirRoot: rundir,
      stateYaml,
      taskType: 'development',
      outcome: [{ id: 'bug-fixed', command: 'exit 1', restage: [] }],
    });

    const rec = outcomeRecord(ex);
    assert.ok(rec && rec.value === 'fail', 'the failing outcome record must be present');

    // The guard fires: a failing outcome is the most trustworthy signal, never downgraded to INCOMPLETE.
    assert.equal(ex.incomplete, false, 'failing outcome must suppress the phases==0 MEDIUM-2 short-circuit');

    const observed = normalize(ex.records);
    const reference = { required: ['outcome(bug-fixed)=pass'], optional: [...observed], allowlist: [] };
    const result = compare(observed, reference);
    assert.equal(result.overall, 'REGRESSED', 'must be REGRESSED, not INCOMPLETE');
    assert.equal(result.exitCode, EXIT.REGRESSED);
  } finally {
    fs.rmSync(rundir, { recursive: true, force: true });
  }
});

// =========================================================================
// 4. Id-namespace guard (LOW-6) — hygiene only, NOT floor protection
// =========================================================================

test('id-namespace guard: an id shadowing a state-predicate prefix makes extract THROW (hygiene)', () => {
  for (const badId of ['phase_completed_x', 'task_characteristic_y', 'task_status_z']) {
    assert.throws(
      () => extract({ outcome: [{ id: badId, command: 'exit 0', restage: [] }] }),
      /namespace|prefix|hygiene|phase_completed|task_characteristic|task_status/i,
      `id "${badId}" must be rejected as a namespace-shadowing id`,
    );
  }
});

// =========================================================================
// 5. Runtime fail — bad RESULT is a fail record, never an exception
// =========================================================================

test('runtime fail: non-zero / missing command -> outcome=fail record, no exception escapes extract', () => {
  // Non-zero exit -> fail.
  const nonzero = extract({ outcome: [{ id: 'bug-fixed', command: 'exit 7', restage: [] }] });
  const r1 = outcomeRecord(nonzero);
  assert.ok(r1, 'a record is emitted even on failure');
  assert.equal(r1.value, 'fail');
  assert.equal(r1.kind, 'outcome');

  // Missing script -> non-zero -> fail (still no throw out of extract).
  const missing = extract({ outcome: [{ id: 'bug-fixed', command: 'sh ./definitely-not-here.sh', restage: [] }] });
  assert.equal(outcomeRecord(missing).value, 'fail');
});

// =========================================================================
// 6. Malformed spec (bad SHAPE) -> extract THROWS
// =========================================================================

test('malformed spec (bad shape) makes extract THROW: missing id / neither command nor assert / unknown assert', () => {
  // missing id
  assert.throws(() => extract({ outcome: [{ command: 'exit 0', restage: [] }] }), /id/i);
  // neither command nor assert
  assert.throws(() => extract({ outcome: [{ id: 'x' }] }), /command|assert/i);
  // unknown assert kind
  assert.throws(() => extract({ outcome: [{ id: 'x', assert: 'not-a-real-assert' }] }), /assert/i);
});
