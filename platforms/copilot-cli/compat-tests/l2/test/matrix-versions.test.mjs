// Credit-free unit tests for the Compatibility-Matrix version tripwire (#148).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/matrix-versions.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matrixVersions, bundleVersion, census } from '../tools/matrix-versions.mjs';

const PAGE = `# Compatibility Matrix

## Control experiment (2026-08-31)

Driven on 1.0.82 — this prose version must NOT count as a row.

## Matrix

| maister | Copilot CLI | model | OS | L0 | L1 | L2 | Notes |
|---------|-------------|-------|-----|----|----|----|-------|
| 2.2.3+fork.5 | 1.0.82 (L2) · 1.0.81 (L0) | luna | macOS | — | — | ✅ | notes mention 1.0.79 — Notes column must not count |
| 2.2.3+fork.1 | 1.0.73 | — | macOS | ✅ | ✅ | — | |

## Method appendices

1.0.70 appears here in prose only.
`;

test('matrixVersions: every X.Y.Z in the Copilot CLI column of the ## Matrix table, nothing else', () => {
  const v = matrixVersions(PAGE);
  assert.deepEqual([...v].sort(), ['1.0.73', '1.0.81', '1.0.82']);
  assert.equal(v.has('1.0.79'), false, 'Notes column must not count');
  assert.equal(v.has('1.0.70'), false, 'prose outside the table must not count');
  assert.deepEqual([...matrixVersions('# no matrix here\n')], []);
});

test('bundleVersion: schema-2 cliVersion first, schema-1 copilotVersion banner as fallback, null otherwise', () => {
  assert.equal(bundleVersion({ cliVersion: '1.0.83', copilotVersion: 'GitHub Copilot CLI 1.0.82.' }), '1.0.83');
  assert.equal(bundleVersion({ copilotVersion: "GitHub Copilot CLI 1.0.82.\nRun 'copilot update' to check for updates." }), '1.0.82');
  assert.equal(bundleVersion({}), null);
  assert.equal(bundleVersion(null), null);
});

test('census: an unrecorded version is named; recorded ones pass; version-less bundles are listed, not failed', () => {
  const bundles = [
    { ts: 'a', version: '1.0.83', where: 'r' },
    { ts: 'b', version: '1.0.83', where: 'r' },
    { ts: 'c', version: '1.0.82', where: 'r' },
    { ts: 'd', version: null, where: 'r' },
  ];
  const { rows, unrecorded, noVersion } = census(bundles, new Set(['1.0.82', '1.0.81']));
  assert.deepEqual(rows, [
    { version: '1.0.83', bundles: 2, recorded: false },
    { version: '1.0.82', bundles: 1, recorded: true },
  ]);
  assert.deepEqual(unrecorded, ['1.0.83']);
  assert.equal(noVersion.length, 1);
  // The exact 2026-09-06 situation: six 1.0.83 bundles, a Matrix that stops at 1.0.82 → drift.
  assert.ok(unrecorded.length > 0, 'the tripwire must fire on the situation that motivated it');
});
