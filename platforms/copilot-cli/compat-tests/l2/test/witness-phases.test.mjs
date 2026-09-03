// Credit-free unit tests for WITNESS-DERIVED phases (issue #71 / ADR 0004).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/witness-phases.test.mjs
//
// The property under test is the parity stance itself: `orchestrator-state.yml` is off-schema and
// non-deterministic on Copilot (ADR 0001, #57), so `phase_completed(N)` must be derivable from the
// run's own event/tree footprint and MUST NOT be derivable from the state file — in either
// direction. A state file that lies (claims phases nothing witnesses) adds no predicate; a state
// file that is unparseable removes none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract, witnessMatches, witnessedPhaseRecords } from '../extractor.mjs';
import { scenario as DEV } from '../scenarios/development.mjs';
import { scenario as RESEARCH } from '../scenarios/research.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readRef = (name) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'reference', `${name}.skeleton.json`), 'utf8'));

const rec = (kind, name) => ({ kind, name, source: 'events', evidence: 'test' });

test('witnessMatches: exact names, plugin-prefix tolerance, and the verification/* prefix form', () => {
  const records = [
    rec('delegated', 'maister-copilot:gap-analyzer'),
    rec('invoked_skill', 'codebase-analyzer'),
    { kind: 'created_artifact', name: 'verification/implementation-verification.md', source: 'tree', evidence: 't' },
  ];

  // The maister:/maister-copilot: prefix is a naming-only platform difference — never a miss.
  assert.ok(witnessMatches(records, 'delegated(gap-analyzer)'));
  assert.ok(witnessMatches(records, 'invoked_skill(codebase-analyzer)'));
  // A trailing /* is a prefix match, mirroring normalize's verification-path collapse.
  assert.ok(witnessMatches(records, 'created_artifact(verification/*)'));

  // Non-matches stay non-matches: wrong kind, wrong name, and a bare token with no parens.
  assert.equal(witnessMatches(records, 'invoked_skill(gap-analyzer)'), false);
  assert.equal(witnessMatches(records, 'delegated(specification-creator)'), false);
  assert.equal(witnessMatches(records, 'delegated'), false);
  // The prefix form must not degenerate into "matches anything with that head".
  assert.equal(witnessMatches(records, 'created_artifact(implementation/*)'), false);
});

test('witnessedPhaseRecords: ALL witnesses of a phase must be present (partial evidence emits nothing)', () => {
  const witnesses = [{ phase: 5, all: ['delegated(specification-creator)', 'created_artifact(implementation/spec.md)'] }];

  // Delegation without the documented artifact is a half-run — not a completed phase.
  const partial = witnessedPhaseRecords([rec('delegated', 'specification-creator')], witnesses);
  assert.deepEqual(partial, []);

  const full = witnessedPhaseRecords(
    [rec('delegated', 'specification-creator'), { kind: 'created_artifact', name: 'implementation/spec.md', source: 'tree', evidence: 't' }],
    witnesses,
  );
  assert.equal(full.length, 1);
  assert.equal(full[0].kind, 'phase_completed');
  assert.equal(full[0].name, '5');
  assert.equal(full[0].source, 'witness', 'a phase record must declare the witness source, not state');
  assert.match(full[0].evidence, /specification-creator/, 'evidence must name the witnesses that fired');
});

test('witnessedPhaseRecords: a scenario with no witness map emits nothing (quick-bugfix / destructive-guard / work / init)', () => {
  const records = [rec('delegated', 'gap-analyzer'), rec('reached_terminal', 'completion')];
  assert.deepEqual(witnessedPhaseRecords(records, []), []);
  assert.deepEqual(witnessedPhaseRecords(records, undefined), []);
});

test('extract: the state file can neither ADD a phase nor REMOVE one (#71 — zero verdict weight)', () => {
  // One real witness: development phase 2 <= delegated(gap-analyzer) (SKILL.md:143).
  const events = [
    { type: 'subagent.started', data: { agentName: 'maister-copilot:gap-analyzer' } },
  ];

  // (a) A state file claiming phases 1/5/7 adds NOTHING — none of them is witnessed here.
  const lying = extract({
    events,
    stateYaml: 'orchestrator:\n  completed_phases: ["phase-1", "phase-5", "phase-7"]\n',
    phaseWitnesses: DEV.phaseWitnesses,
  });
  assert.deepEqual(
    lying.records.filter((r) => r.kind === 'phase_completed').map((r) => r.name),
    ['2'],
    'only the witnessed phase may appear, whatever the state file claims',
  );

  // (b) No state file at all removes NOTHING — the witness still stands on its own.
  const stateless = extract({ events, stateYaml: null, phaseWitnesses: DEV.phaseWitnesses });
  assert.deepEqual(stateless.records.filter((r) => r.kind === 'phase_completed').map((r) => r.name), ['2']);

  // (c) An unparseable/off-schema state file likewise cannot move the phase set — the exact failure
  //     mode ADR 0001 documents (Copilot serializes this file off-schema).
  const offSchema = extract({
    events,
    stateYaml: 'orchestrator:\n  completed_phases: [1, 2, 5]\n  status: completed\n',
    phaseWitnesses: DEV.phaseWitnesses,
  });
  assert.deepEqual(offSchema.records.filter((r) => r.kind === 'phase_completed').map((r) => r.name), ['2']);
  // ...while the state_schema conformance token still reports the divergence (state keeps its
  // diagnostic role — it just has no verdict weight).
  assert.ok(offSchema.records.some((r) => r.kind === 'state_schema'), 'state_schema must still be emitted');
});

test('every required phase_completed(N) in the committed references has a witness relation (#71 acceptance)', () => {
  for (const [name, sc, ref] of [
    ['development', DEV, readRef('development')],
    ['research', RESEARCH, readRef('research')],
  ]) {
    const witnessed = new Set((sc.phaseWitnesses || []).map((w) => String(w.phase)));
    const requiredPhases = ref.required
      .filter((t) => t.startsWith('phase_completed('))
      .map((t) => t.slice('phase_completed('.length, -1));
    for (const p of requiredPhases) {
      assert.ok(
        witnessed.has(p),
        `${name}: required phase_completed(${p}) has no witness relation — it would be unobservable (#71)`,
      );
    }
  }
});
