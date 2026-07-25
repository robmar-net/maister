// Credit-free unit tests for the L2 SDK path resolver (Task Group 1, AC2).
//
// These tests build a THROWAWAY fake `~/.copilot/pkg/<platform>/<versions>/` tree in os.tmpdir()
// and inject it via `resolveSdkPath({ home })`. They NEVER read or write the real ~/.copilot.
// (The plan lists a `test/fixtures/sdk/` path; the binding LOW-5 instruction supersedes it with a
// runtime os.tmpdir() tree — self-cleaning and free of any committed pkg-layout coupling.)
//
// Run ONLY these:  node --test platforms/copilot-cli/compat-tests/l2/test/sdk-path.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveSdkPath } from '../sdk-path.mjs';

// The resolver defaults to the current platform; build the fake tree under the same name so the
// default `${process.platform}-${process.arch}` selection is exercised on any machine.
const PLATFORM_DIR = `${process.platform}-${process.arch}`;

// Build a fake home in os.tmpdir(). Each entry is either a version string 'x.y.z' (a version dir
// carrying copilot-sdk/index.js) or { name, index?, underPlatform? }:
//   index: false          → create the dir but omit copilot-sdk/index.js
//   underPlatform: false  → place the dir as a sibling of the platform dir (pkg-level), mirroring
//                           the real layout where `tmp`/`universal` live next to `darwin-arm64`.
function buildFakeHome(entries) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-sdk-path-'));
  const pkgRoot = path.join(home, '.copilot', 'pkg');
  const platformPath = path.join(pkgRoot, PLATFORM_DIR);
  fs.mkdirSync(platformPath, { recursive: true });

  for (const raw of entries) {
    const e = typeof raw === 'string' ? { name: raw, index: true } : raw;
    const base = e.underPlatform === false
      ? path.join(pkgRoot, e.name)
      : path.join(platformPath, e.name);
    fs.mkdirSync(base, { recursive: true });
    if (e.index !== false) {
      fs.mkdirSync(path.join(base, 'copilot-sdk'), { recursive: true });
      fs.writeFileSync(path.join(base, 'copilot-sdk', 'index.js'), '// fake sdk entry\n');
    }
  }
  return home;
}

const rm = (home) => fs.rmSync(home, { recursive: true, force: true });

// The version dir selected is the great-grandparent of .../copilot-sdk/index.js.
const selectedVersion = (resolved) => path.basename(path.dirname(path.dirname(resolved)));

test('resolves the newest semver version, and a prerelease sorts BELOW its release (LOW-5)', () => {
  // Mixed tree incl. the 1.0.69-0 prerelease → newest is 1.0.73.
  const home = buildFakeHome(['0.0.420', '1.0.63', '1.0.69-0', '1.0.70', '1.0.73']);
  try {
    const resolved = resolveSdkPath({ home });
    assert.ok(path.isAbsolute(resolved), 'returns an absolute path (SDK has no package.json)');
    assert.equal(
      resolved,
      path.join(home, '.copilot', 'pkg', PLATFORM_DIR, '1.0.73', 'copilot-sdk', 'index.js'),
    );
    assert.ok(fs.existsSync(resolved), 'resolved copilot-sdk/index.js exists');
  } finally {
    rm(home);
  }

  // Release outranks its own prerelease: 1.0.69 > 1.0.69-0.
  const home2 = buildFakeHome(['1.0.69-0', '1.0.69']);
  try {
    const resolved = resolveSdkPath({ home: home2 });
    assert.equal(selectedVersion(resolved), '1.0.69', 'release 1.0.69 beats prerelease 1.0.69-0');
  } finally {
    rm(home2);
  }
});

test('excludes tmp and universal directories from version candidates (LOW-5)', () => {
  // (a) tmp/universal alongside real versions (and at pkg-level) are never selected.
  const home = buildFakeHome([
    '1.0.70',
    '1.0.73',
    { name: 'tmp', index: true },
    { name: 'universal', index: true },
    { name: 'tmp', index: true, underPlatform: false },
    { name: 'universal', index: true, underPlatform: false },
  ]);
  try {
    const resolved = resolveSdkPath({ home });
    assert.equal(selectedVersion(resolved), '1.0.73');
    assert.ok(!/[/\\](tmp|universal)[/\\]/.test(resolved), 'tmp/universal never selected');
  } finally {
    rm(home);
  }

  // (b) A tree whose ONLY entries are tmp/universal (each WITH copilot-sdk/index.js) must yield NO
  //     candidate — proving name-exclusion, not merely that they happen to sort low.
  const home2 = buildFakeHome([
    { name: 'tmp', index: true },
    { name: 'universal', index: true },
  ]);
  try {
    let threw;
    try {
      resolveSdkPath({ home: home2 });
    } catch (err) {
      threw = err;
    }
    assert.ok(threw, 'tmp/universal are not candidates → precondition failure');
    assert.equal(threw.exitCode, 2, 'carries exit-2 precondition semantics');
  } finally {
    rm(home2);
  }
});

test('fails cleanly (exit-2 semantics + clear message) when copilot-sdk/index.js is absent', () => {
  // Newest version dir (1.0.73) has NO copilot-sdk/index.js; an older one does. The resolver is
  // strict on the selected (newest) version and does NOT silently fall back to 1.0.70.
  const home = buildFakeHome([
    '1.0.70',
    { name: '1.0.73', index: false },
  ]);
  try {
    let threw;
    try {
      resolveSdkPath({ home });
    } catch (err) {
      threw = err;
    }
    assert.ok(threw, 'throws when the selected version lacks copilot-sdk/index.js');
    assert.equal(threw.exitCode, 2, 'carries exit-2 precondition semantics');
    assert.match(threw.message, /copilot-sdk[/\\]index\.js/, 'message names the missing SDK entry');
    assert.match(threw.message, /1\.0\.73/, 'message names the selected (newest) version');
  } finally {
    rm(home);
  }
});
