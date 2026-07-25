// Credit-free `--check-reference` CLI test (Task Group 7 / AC1).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/check-reference.test.mjs
//
// Invokes the real entrypoint as a subprocess (`node run.mjs --check-reference`) and asserts
// the PROCESS EXIT CODE — the actual operator contract — for both branches:
//   * committed reference + matching workflow model -> exit 0, verdict says "current"
//   * a bumped maister PACKAGE version              -> STILL exit 0 "current": staleness keys on
//     the reference's workflow_model_version (C2), so a behavior-neutral package bump never cries
//     wolf. (The stale -> exit 1 "re-derive" path is unit-tested in compare.test.mjs 4.1e/4.1f.)
//
// This path is CREDIT-FREE by construction: `--check-reference` returns before any SDK import or
// session is constructed (LOW-4 on the node side), so no seat / credits are consumed here.
//
// The package-version bump is simulated via COMPAT_MAISTER_VERSION — the documented test/operator
// override for the repo maister version that `run.mjs` would otherwise read from
// plugins/maister/.claude-plugin/plugin.json. This keeps the check zero-touch (the real plugin.json
// is never edited) and race-free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_MJS = path.resolve(__dirname, '..', 'run.mjs');

function runCheckReference(extraEnv = {}) {
  const res = spawnSync(process.execPath, [RUN_MJS, '--check-reference'], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  // Surface spawn failures (e.g. a missing run.mjs) as a clear assertion, not a cryptic null status.
  assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

test('--check-reference: committed reference + matching repo version -> exit 0 "current"', () => {
  const { status, out } = runCheckReference();
  assert.equal(status, 0, `expected exit 0 (current), got ${status}\n${out}`);
  assert.match(out.toLowerCase(), /current/, 'verdict should report the reference is current');
});

test('--check-reference: a behavior-neutral maister PACKAGE bump stays CURRENT (C2 — keys on workflow_model_version)', () => {
  const { status, out } = runCheckReference({ COMPAT_MAISTER_VERSION: '9.9.9' });
  assert.equal(status, 0, `expected exit 0 (current): staleness keys on workflow_model_version, so a package bump must not cry wolf; got ${status}\n${out}`);
  assert.match(out.toLowerCase(), /current/, 'a behavior-neutral maister bump must not mark the reference stale');
});
