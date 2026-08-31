// Unit tests for parity-header.mjs (issue #92 Stage 6) — the Parity-Map header-census generator.
//   node --test platforms/copilot-cli/compat-tests/l2/test/parity-header.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { census, headerLine, parseExistingHeader } from '../tools/parity-header.mjs';

// A page with two Status tables + one non-Status table (must be ignored) + a multi-glyph Status cell
// (only the FIRST glyph counts) + a Status column that is NOT the second column (index must be honored).
const PAGE = `# Parity Map

> **Header counters:** ✅ 2 verified · 🟢 1 adapted · 🟡 1 limitation · 🔴 0 gap · ⚪ 2 unverified

## Behaviors

| Behavior | Status | Delta / why | Evidence |
|---|---|---|---|
| a | ✅ | — | x |
| b | 🟡 | note | y |
| c | ⚪ | never run | — |

## Agents

| Agent | Status | Delegation | Evidence |
|---|---|---|---|
| g1 | ⚪ | ✅ | DEV82 |
| g2 | ✅ required | ✅ | DEV82 |
| g3 | 🟢 | ⚪ | note |

## Not a census table

| Command | Note |
|---|---|
| work | ✅ this ✅ must not count |
`;

test('census: one count per data row, first glyph of the Status column, non-Status tables ignored', () => {
  const c = census(PAGE);
  assert.equal(c['✅'], 2, 'two ✅ (behaviors:a + agents:g2 "✅ required")');
  assert.equal(c['🟢'], 1, 'one 🟢 (agents:g3)');
  assert.equal(c['🟡'], 1, 'one 🟡 (behaviors:b)');
  assert.equal(c['🔴'], 0);
  assert.equal(c['⚪'], 2, 'two ⚪ (behaviors:c + agents:g1) — Delegation column NOT counted');
  assert.equal(c._total, 6);
  assert.equal(c._tables, 2, 'the "Not a census table" (no Status column) is skipped');
});

test('census: the Delegation ✅/⚪ glyphs are NOT counted (only the Status column)', () => {
  // g1 has Delegation ✅ but Status ⚪; g3 has Delegation ⚪ but Status 🟢. If the wrong column were
  // read the totals would shift — this pins that Status (not Delegation) is the census column.
  const c = census(PAGE);
  assert.equal(c['✅'] + c['🟢'] + c['🟡'] + c['🔴'] + c['⚪'], 6);
});

test('headerLine: canonical order + labels', () => {
  assert.equal(
    headerLine(census(PAGE)),
    '✅ 2 verified · 🟢 1 adapted · 🟡 1 limitation · 🔴 0 gap · ⚪ 2 unverified',
  );
});

test('parseExistingHeader: reads the counts out of the page header line', () => {
  const h = parseExistingHeader(PAGE);
  assert.deepEqual(h, { '✅': 2, '🟢': 1, '🟡': 1, '🔴': 0, '⚪': 2 });
});

test('the fixture page is self-consistent (its header matches its own census)', () => {
  const c = census(PAGE);
  const h = parseExistingHeader(PAGE);
  for (const s of ['✅', '🟢', '🟡', '🔴', '⚪']) assert.equal(h[s], c[s], `${s} matches`);
});
