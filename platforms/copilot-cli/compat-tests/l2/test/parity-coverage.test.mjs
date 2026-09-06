// Snapshot guard for parity-coverage.mjs (issue #138 WP4) — the tool CI diffs `docs/parity/inventory.json` against.
//
// What it proves:
//   1. The committed snapshot is CURRENT — regenerating it produces no diff. This is the same guard
//      `.github/workflows/l2-check.yml` runs, but it fails in the LOCAL unit suite instead of only on a
//      manual `workflow_dispatch`. That gap is why the snapshot sat stale from #103/#104 until #138.
//   2. `inventory` and `coverage` drift are asserted SEPARATELY, because they mean different things:
//        - `inventory` drift = an upstream skill/command/agent/hook was added or removed. The Parity-Map
//          must absorb a new BEHAVIOR. This is the signal the guard was built for (#76 WP-F).
//        - `coverage` drift = the L2 evidence surface changed (a `reference/*.skeleton.json` gained or
//          lost a delegated()/invoked_skill() token). Benign and expected whenever a scenario lands.
//      Before #138 both produced one opaque failure whose message named only the first cause, so a
//      coverage-only drift reported itself as "plugins/maister inventory changed" — which it was not.
//   3. The tool is deterministic (two runs byte-identical) and STRICTLY READ-ONLY (writes nothing).
//
// parity-coverage.mjs has NO exports — it runs at import time and writes to stdout — so it is exercised
// as a subprocess, the same way parity-evidence.test.mjs exercises its tool.
//
// CREDIT-FREE: no seat, no SDK, no network, no live session. Zero-dependency, self-cleaning.
//
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/parity-coverage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(__dirname, '..', 'tools', 'parity-coverage.mjs');
// l2/test -> repo root is FIVE ups (same depth as l2/tools, which parity-coverage.mjs itself resolves).
const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SNAPSHOT = path.join(REPO, 'docs', 'parity', 'inventory.json');

const KINDS = ['skills', 'commands', 'agents', 'hooks'];

function regenerate() {
  const res = spawnSync(process.execPath, [TOOL, '--json'], { encoding: 'utf8' });
  assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
  assert.equal(res.status, 0, `parity-coverage.mjs --json must exit 0 — stderr:\n${res.stderr}`);
  assert.equal(res.stderr, '', `parity-coverage.mjs --json must write nothing to stderr, got:\n${res.stderr}`);
  return res.stdout;
}

const committed = () => JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

// Name the drifting entries rather than dumping two 5 KB JSON blobs at the operator.
function coverageDrift(a, b) {
  const out = [];
  for (const kind of KINDS) {
    const A = Array.isArray(a.coverage?.[kind]) ? a.coverage[kind] : [];
    const B = Array.isArray(b.coverage?.[kind]) ? b.coverage[kind] : [];
    if (A.length !== B.length) { out.push(`${kind}: ${A.length} rows committed vs ${B.length} regenerated`); continue; }
    for (let i = 0; i < A.length; i += 1) {
      if (A[i].name !== B[i].name) out.push(`${kind}: row ${i} is "${A[i].name}" committed vs "${B[i].name}" regenerated`);
      else if (A[i].l2Evidence !== B[i].l2Evidence) out.push(`${kind}: ${A[i].name} — committed ${A[i].l2Evidence}, regenerated ${B[i].l2Evidence}`);
    }
  }
  return out;
}

test('inventory: the committed snapshot matches plugins/maister/** on disk', () => {
  const fresh = JSON.parse(regenerate());
  const old = committed();
  // An inventory diff means an upstream skill/command/agent/hook appeared or vanished — a NEW BEHAVIOR
  // the Parity-Map must absorb before merge. This is the signal the #76 WP-F guard exists for.
  for (const kind of KINDS) {
    assert.deepEqual(
      fresh.inventory?.[kind], old.inventory?.[kind],
      `docs/parity/inventory.json is stale for ${kind}: plugins/maister/${kind} changed. ` +
      'Regenerate the snapshot AND absorb the new/removed item into the Parity-Map wiki page.',
    );
  }
});

test('coverage: the committed snapshot matches the current L2 evidence surface', () => {
  const fresh = JSON.parse(regenerate());
  const old = committed();
  const drift = coverageDrift(old, fresh);
  // A coverage diff means the evidence surface moved — typically a new reference/*.skeleton.json
  // contributing delegated()/invoked_skill() tokens. Benign, but the snapshot must be refreshed or the
  // CI diff guard stays red. This is NOT an inventory change; do not report it as one.
  assert.deepEqual(
    drift, [],
    'docs/parity/inventory.json is stale in `coverage` — the L2 evidence surface changed ' +
    '(a reference/*.skeleton.json gained or lost tokens). Regenerate:\n' +
    '  node platforms/copilot-cli/compat-tests/l2/tools/parity-coverage.mjs --json > docs/parity/inventory.json\n' +
    `Drifting entries:\n  ${drift.join('\n  ')}`,
  );
});

test('the snapshot is deterministic — two runs are byte-identical', () => {
  // The CI guard is a `git diff --exit-code`, so any nondeterminism (unsorted keys, a timestamp) would
  // flap the build. parity-coverage.mjs deliberately omits `generated` from --json for this reason.
  assert.equal(regenerate(), regenerate(), 'parity-coverage.mjs --json must be byte-identical across runs');
  assert.ok(!('generated' in JSON.parse(regenerate())), '--json must NOT carry a timestamp field');
});

test('the tool is read-only — it never writes the snapshot itself', () => {
  const before = fs.readFileSync(SNAPSHOT);
  const mtimeBefore = fs.statSync(SNAPSHOT).mtimeMs;
  regenerate();
  assert.deepEqual(fs.readFileSync(SNAPSHOT), before, 'parity-coverage.mjs must not modify docs/parity/inventory.json');
  assert.equal(fs.statSync(SNAPSHOT).mtimeMs, mtimeBefore, 'parity-coverage.mjs must not even touch the snapshot');
});
