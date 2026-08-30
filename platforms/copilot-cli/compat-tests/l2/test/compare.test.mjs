// Credit-free unit tests for the comparator + reference-check utility (Task Group 4).
//
// Tests run over INLINE + fixture references (test/fixtures/compare/*), NOT the
// committed golden (l2/reference/development.skeleton.json) — keeping compare's
// logic independent of the maister-model-derived reference (plan step 4.1).
//
// Run ONLY these: node --test l2/test/compare.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  compare,
  computeHash,
  checkReference,
  WORKFLOW_MODEL_VERSION,
  EXIT,
  isReportedOnly,
  WITNESS_REQUIRE_RE,
  witnessTokensForPhase,
} from '../compare.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, 'fixtures', 'compare');

const loadJson = (name) => JSON.parse(readFileSync(join(FIX, name), 'utf8'));

// Fresh copies per test so mutations never bleed across cases.
const loadReference = () => loadJson('reference.sample.json');
const loadSkeletonArray = () => loadJson('skeleton.sample.json');

test('4.1a conforming skeleton -> AS-EXPECTED (exit 0)', () => {
  const reference = loadReference();
  const copilotSet = new Set(loadSkeletonArray());

  const result = compare(copilotSet, reference);

  assert.equal(result.overall, 'AS-EXPECTED');
  assert.equal(result.exitCode, 0);
  assert.equal(result.diffs.length, 0, 'a conforming skeleton has no classified diffs');
  // All 5 required predicates are matched (PASS); no FAIL.
  assert.equal(result.counts.pass, reference.required.length);
  assert.equal(result.counts.fail, 0);
  // The one present optional is informational, never a diff.
  assert.ok(result.optionalPresent.includes('phase_completed(6)'));
});

test('4.1b missing required predicate -> REGRESSED (exit 1)', () => {
  const reference = loadReference();
  // Drop one REQUIRED predicate from an otherwise-conforming skeleton.
  const copilotSet = new Set(
    loadSkeletonArray().filter((p) => p !== 'delegated(gap-analyzer)'),
  );

  const result = compare(copilotSet, reference);

  assert.equal(result.overall, 'REGRESSED');
  assert.equal(result.exitCode, 1);
  assert.equal(result.counts.fail, 1);

  const diff = result.diffs.find((d) => d.predicate === 'delegated(gap-analyzer)');
  assert.ok(diff, 'the absent required predicate is reported as a diff');
  assert.equal(diff.side, 'missing');
  assert.equal(diff.classification, 'CANDIDATE_REGRESSION');
});

test('4.1c allowlisted extra -> LIMITATION (does NOT fail, exit 0)', () => {
  const reference = loadReference();
  // Add an EXTRA predicate that is absent from required u optional but IS on the
  // reference allowlist (the seeded destructive-guard deny->ask adaptation).
  const copilotSet = new Set([
    ...loadSkeletonArray(),
    'hook_effect(destructive_guard=ask)',
  ]);

  const result = compare(copilotSet, reference);

  assert.equal(result.overall, 'AS-EXPECTED', 'an allowlisted diff never fails the run');
  assert.equal(result.exitCode, 0);
  assert.equal(result.counts.limitation, 1);
  assert.equal(result.counts.fail, 0);

  const diff = result.diffs.find(
    (d) => d.predicate === 'hook_effect(destructive_guard=ask)',
  );
  assert.ok(diff, 'the allowlisted extra is still reported (as a LIMITATION) for the table');
  assert.equal(diff.side, 'extra');
  assert.equal(diff.classification, 'LIMITATION');
  assert.match(diff.reason, /deny->ask/i);
});

test('4.1d optional-absent predicate is NOT counted as a diff', () => {
  const reference = loadReference();
  // The base fixture skeleton omits the optional delegated(spec-auditor).
  const copilotSet = new Set(loadSkeletonArray());
  assert.ok(
    reference.optional.includes('delegated(spec-auditor)'),
    'precondition: spec-auditor is modelled optional',
  );
  assert.ok(!copilotSet.has('delegated(spec-auditor)'), 'precondition: it is absent');

  const result = compare(copilotSet, reference);

  // Absent optional is informational only — never a diff, never a fail.
  assert.ok(result.optionalAbsent.includes('delegated(spec-auditor)'));
  assert.ok(
    !result.diffs.some((d) => d.predicate === 'delegated(spec-auditor)'),
    'an absent optional does not appear in the classified diff',
  );
  assert.equal(result.overall, 'AS-EXPECTED');
  assert.equal(result.exitCode, 0);
  assert.equal(result.diffs.length, 0);
});

test('4.1e checkReference: current(0) / bumped-version(1) / corrupt(2) + computeHash determinism', () => {
  const reference = loadReference();

  // computeHash is deterministic AND reproduces the committed fixture hash
  // (this is the single hash definition used by Group 6 to stamp + Group 7 to verify).
  assert.equal(computeHash(reference), computeHash(reference), 'computeHash is deterministic');
  assert.equal(computeHash(reference), reference.hash, 'computeHash reproduces the stamped hash');

  // current: version matches AND stored hash matches recomputed hash -> exit 0.
  const current = checkReference(reference, reference.maister_version);
  assert.equal(current.status, 'current');
  assert.equal(current.exitCode, 0);

  // stale: a bumped maister_version -> exit 1 with a "re-derive" message.
  const stale = checkReference(reference, '99.0.0');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.exitCode, 1);
  assert.match(stale.message, /re-derive/i);

  // corrupt: a tampered/inconsistent hash -> exit 2 (precondition, never trusted).
  const tampered = { ...reference, hash: 'deadbeef' };
  const corrupt = checkReference(tampered, tampered.maister_version);
  assert.equal(corrupt.status, 'corrupt');
  assert.equal(corrupt.exitCode, 2);
});

test('4.1f checkReference keys STALE on workflow_model_version — a package bump does NOT cry wolf (C2)', () => {
  // The fixture reference has NO workflow_model_version (fallback path exercised by 4.1e); adding
  // one here exercises the PREFERRED keyed path. workflow_model_version is not part of the hash, so
  // the stored hash stays valid (corrupt check passes) and only the staleness key changes.
  const base = loadReference();

  // Matching workflow model -> CURRENT regardless of a (deliberately mismatched) package version.
  const matched = { ...base, workflow_model_version: WORKFLOW_MODEL_VERSION };
  const current = checkReference(matched, '99.0.0');
  assert.equal(current.status, 'current', 'a behavior-neutral package bump must stay CURRENT');
  assert.equal(current.exitCode, 0);
  assert.match(current.message, /workflow model/i);

  // Mismatched workflow model -> STALE (re-derive), even when the package version matches.
  const drifted = { ...base, workflow_model_version: WORKFLOW_MODEL_VERSION + 1 };
  const stale = checkReference(drifted, drifted.maister_version);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.exitCode, 1);
  assert.match(stale.message, /re-derive/i);
  assert.match(stale.message, /workflow model/i);

  // Corruption still outranks the version key: a bad hash is exit 2 even with a matching model.
  const corrupt = checkReference({ ...matched, hash: 'deadbeef' }, matched.maister_version);
  assert.equal(corrupt.status, 'corrupt');
  assert.equal(corrupt.exitCode, 2);
});

// ── Stage-3 gates: rules-expansion + rules-in-hash + reported-only (Group 2) ──────────
//
// Inline references (independent of the committed golden) exercise the rules[] promotion of a
// gate_fired_at(phase-N) to *required* when phase_completed(N) is observed, the zero-token
// backward-neutrality of computeHash when rules are absent/empty, and the reported-only
// exclusion of gate_count( from the extra diff. Imitates pipeline.test.mjs negative→REGRESSED.

// A reference whose sole rule promotes the phase-5 gate to required once phase 5 completes.
const rulesReference = () => ({
  scenario: 'gates-fixture',
  schema_version: 2,
  workflow_model_version: WORKFLOW_MODEL_VERSION,
  required: ['task_status(completed)'],
  // A real reference models both the fireable gate (optional, promoted by the rule) and the
  // phase_completed `when` predicate — so an observed phase completion is never a spurious extra.
  optional: ['gate_fired_at(phase-5)', 'phase_completed(5)'],
  allowlist: [],
  rules: [{ when: 'phase_completed(5)', require: 'gate_fired_at(phase-5)' }],
});

test('2.1a rules-expansion: when observed + require absent -> REGRESSED (exit 1)', () => {
  const reference = rulesReference();
  // phase 5 completed but its mandatory gate never fired -> the promoted-required gate is missing.
  const observed = new Set(['task_status(completed)', 'phase_completed(5)']);

  const result = compare(observed, reference);

  assert.equal(result.overall, 'REGRESSED', 'a completed phase without its gate must REGRESS');
  assert.equal(result.exitCode, EXIT.REGRESSED, 'REGRESSED must map to exit 1');
  assert.equal(result.counts.fail, 1);

  const diff = result.diffs.find((d) => d.predicate === 'gate_fired_at(phase-5)');
  assert.ok(diff, 'the promoted-but-absent gate is reported as a diff');
  assert.equal(diff.side, 'missing');
  assert.equal(diff.classification, 'CANDIDATE_REGRESSION');
});

test('2.1b rules-expansion: when absent -> require NOT added (AS-EXPECTED, exit 0)', () => {
  const reference = rulesReference();
  // phase 5 NEVER completed, so its gate legitimately never fires -> no promotion, no false alarm.
  const observed = new Set(['task_status(completed)']);

  const result = compare(observed, reference);

  assert.equal(result.overall, 'AS-EXPECTED', 'an unfired gate for an uncompleted phase must not fail');
  assert.equal(result.exitCode, EXIT.AS_EXPECTED);
  assert.equal(result.counts.fail, 0);
  assert.equal(result.diffs.length, 0, 'no diff when when-predicate is absent');
  // The gate stays an informational absent-optional, never a diff.
  assert.ok(result.optionalAbsent.includes('gate_fired_at(phase-5)'));
  assert.ok(!result.matched.includes('gate_fired_at(phase-5)'), 'an unpromoted gate is not matched-required');
});

test('2.1c rules-expansion: when observed + require present -> matched', () => {
  const reference = rulesReference();
  // phase 5 completed AND its gate fired -> the promoted gate is a matched-required predicate.
  const observed = new Set([
    'task_status(completed)',
    'phase_completed(5)',
    'gate_fired_at(phase-5)',
  ]);

  const result = compare(observed, reference);

  assert.equal(result.overall, 'AS-EXPECTED');
  assert.equal(result.exitCode, EXIT.AS_EXPECTED);
  assert.equal(result.counts.fail, 0);
  assert.equal(result.diffs.length, 0);
  // Promoted gate counts as matched-required (effectiveRequired), NOT as optionalPresent.
  assert.ok(result.matched.includes('gate_fired_at(phase-5)'), 'a fired promoted gate is matched');
  assert.equal(result.counts.pass, 2, 'both task_status and the promoted gate matched');
});

test('2.1d computeHash: a rules edit re-stamps (hash changes)', () => {
  const base = rulesReference();
  const edited = { ...base, rules: [{ when: 'phase_completed(9)', require: 'gate_fired_at(phase-9)' }] };

  assert.notEqual(
    computeHash(base),
    computeHash(edited),
    'editing a rule (when/require) must re-stamp the hash',
  );
  // Adding a rule to a rules-free reference must also re-stamp.
  const noRules = { ...base };
  delete noRules.rules;
  assert.notEqual(computeHash(noRules), computeHash(base), 'adding a rule changes the hash');
});

test('2.1e computeHash: rules:[]/absent => ZERO tokens (== no-rules value; rules:[] === absent)', () => {
  // The committed no-rules fixture hash MUST stay byte-for-byte identical (protects :115 +
  // backward-neutrality for the 3 current references).
  const reference = loadReference();
  assert.equal(reference.hash, '4b3caecb24924fb99b38b54850d8b93288f0d8fd5e1230fe6c9211758cf43760');
  assert.equal(computeHash(reference), reference.hash, 'no-rules hash unchanged vs pre-change algorithm');

  // rules:[] contributes exactly the same as the rules field being absent.
  const withEmptyRules = { ...reference, rules: [] };
  assert.equal(
    computeHash(withEmptyRules),
    computeHash(reference),
    'rules:[] appends zero tokens — identical to a rules-field-absent reference',
  );
  // A rules:[] reference also equals the same reference with rules explicitly deleted.
  const explicitlyAbsent = { ...reference };
  delete explicitlyAbsent.rules;
  assert.equal(computeHash(withEmptyRules), computeHash(explicitlyAbsent), 'rules:[] === rules-field-absent');
});

test('2.1f reported-only: an observed gate_count(ask)=K is never extra/CANDIDATE_REGRESSION', () => {
  const reference = {
    scenario: 'gates-fixture',
    schema_version: 2,
    required: ['task_status(completed)'],
    optional: [],
    allowlist: [],
    rules: [],
  };

  for (const k of [1, 7, 42, 999]) {
    const observed = new Set(['task_status(completed)', `gate_count(ask)=${k}`]);
    const result = compare(observed, reference);
    assert.equal(result.overall, 'AS-EXPECTED', `gate_count(ask)=${k} must never REGRESS`);
    assert.equal(result.exitCode, EXIT.AS_EXPECTED);
    assert.equal(result.counts.fail, 0, `gate_count(ask)=${k} is reported-only, not a candidate regression`);
    assert.ok(
      !result.diffs.some((d) => d.predicate === `gate_count(ask)=${k}`),
      'a reported-only gate_count head never appears in the classified diff',
    );
  }
});

// ── Stage-4 order spine: version bump + min_count reported-only + witness authority (Group 4) ────
//
// Inline references (independent of the committed golden) exercise the wm 3→4 staleness stamp, the
// min_count( head joining gate_count( as reported-only for the EXTRA partition ONLY (required-side
// matching stays intact), and the witnessTokensForPhase authority that run.mjs's N=1 floor imports.

test('4.4a WORKFLOW_MODEL_VERSION is 6 (WP-D todos/standards grammar-head bump)', () => {
  assert.equal(WORKFLOW_MODEL_VERSION, 6, 'the harness now models workflow-model v6');
});

test('4.4b min_count( is reported-only for EXTRA: observed =1,=2 vs required-only =1 never REGRESSES', () => {
  // isReportedOnly covers the whole min_count( head (like gate_count().
  assert.equal(
    isReportedOnly('min_count(delegated(task-group-implementer))=1'),
    true,
    'min_count( is a reported-only head for the extra partition',
  );

  // The extractor emits the full token-expansion =1..c; the reference models ONLY the exact =1 it
  // requires. The superset =2 must NOT classify as `extra` → no false REGRESSED.
  const reference = {
    scenario: 'mincount-fixture',
    schema_version: 3,
    workflow_model_version: WORKFLOW_MODEL_VERSION,
    required: ['min_count(delegated(task-group-implementer))=1'],
    optional: [],
    allowlist: [],
    rules: [],
  };
  const observed = new Set([
    'min_count(delegated(task-group-implementer))=1',
    'min_count(delegated(task-group-implementer))=2',
  ]);

  const result = compare(observed, reference);

  assert.equal(result.overall, 'AS-EXPECTED', 'the =2 expansion must not be classified as extra');
  assert.equal(result.exitCode, EXIT.AS_EXPECTED);
  assert.equal(result.counts.fail, 0);
  assert.ok(
    !result.diffs.some((d) => d.predicate === 'min_count(delegated(task-group-implementer))=2'),
    'the observed-only =2 expansion never appears in the classified diff',
  );
  // Required-side matching still holds: the required =1 is PRESENT → matched.
  assert.ok(result.matched.includes('min_count(delegated(task-group-implementer))=1'));
});

test('4.4c min_count required-side matching intact: required =2 but observed max =1 → REGRESSED (missing)', () => {
  // The isReportedOnly change touches ONLY the extra partition. A required min_count(...)=K that is
  // absent by set membership (observed only reaches =1 when =2 is required) still REGRESSES.
  const reference = {
    scenario: 'mincount-fixture',
    schema_version: 3,
    workflow_model_version: WORKFLOW_MODEL_VERSION,
    required: ['min_count(delegated(information-gatherer))=2'],
    optional: [],
    allowlist: [],
    rules: [],
  };
  // Only one gatherer observed → the extractor emitted =1 only; the required =2 token is absent.
  const observed = new Set(['min_count(delegated(information-gatherer))=1']);

  const result = compare(observed, reference);

  assert.equal(result.overall, 'REGRESSED', 'a required =2 with observed max =1 must REGRESS');
  assert.equal(result.exitCode, EXIT.REGRESSED);
  assert.equal(result.counts.fail, 1);

  const diff = result.diffs.find(
    (d) => d.predicate === 'min_count(delegated(information-gatherer))=2',
  );
  assert.ok(diff, 'the absent required =2 is reported as a diff');
  assert.equal(diff.side, 'missing', 'it REGRESSES on the required (missing) side, not extra');
  assert.equal(diff.classification, 'CANDIDATE_REGRESSION');
});

test('4.4d witnessTokensForPhase returns only witness requires for the phase; ignores gate + min_count rules', () => {
  const rules = [
    // Witness rules for phase 5 — the three witness prefixes.
    { when: 'phase_completed(5)', require: 'delegated(specification-creator)' },
    { when: 'phase_completed(5)', require: 'created_artifact(implementation/spec.md)' },
    { when: 'phase_completed(11)', require: 'invoked_skill(implementation-verifier)' },
    // Non-witness rows sharing the SAME array — MUST be ignored.
    { when: 'phase_completed(5)', require: 'gate_fired_at(phase-5)' }, // Stage-3 gate rule
    { when: 'phase_completed(1)', require: 'min_count(delegated(information-gatherer))=2' }, // research count
    // A witness require for a DIFFERENT phase — MUST NOT leak into phase 5.
    { when: 'phase_completed(7)', require: 'delegated(implementation-planner)' },
  ];

  const p5 = witnessTokensForPhase(rules, 5);
  assert.deepEqual(
    p5.sort(),
    ['created_artifact(implementation/spec.md)', 'delegated(specification-creator)'],
    'only the two phase-5 witness requires come back — gate_fired_at( is excluded',
  );
  assert.ok(
    !p5.some((r) => /^gate_fired_at\(/.test(r)),
    'a gate_fired_at( rule sharing the phase-5 when is not a witness',
  );

  // phase 1 has only a min_count( rule → no witnesses.
  assert.deepEqual(witnessTokensForPhase(rules, 1), [], 'a min_count( rule is not a witness');

  // The exported regex is the authority the floor keys on.
  assert.equal(WITNESS_REQUIRE_RE.test('delegated(x)'), true);
  assert.equal(WITNESS_REQUIRE_RE.test('created_artifact(x)'), true);
  assert.equal(WITNESS_REQUIRE_RE.test('invoked_skill(x)'), true);
  assert.equal(WITNESS_REQUIRE_RE.test('gate_fired_at(x)'), false);
  assert.equal(WITNESS_REQUIRE_RE.test('min_count(delegated(x))=2'), false);

  // Defensive: a non-array rules input yields [].
  assert.deepEqual(witnessTokensForPhase(null, 5), []);
});
