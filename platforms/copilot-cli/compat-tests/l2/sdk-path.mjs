// L2 SDK path resolver — locates the bundled @github/copilot-sdk entry for the current platform.
//
// House ESM conventions (per plugins/maister/skills/mockup-studio/server/index.mjs): zero external
// dependencies, `.mjs`, `node:` builtins only, no package.json / bundler. The bundled SDK ships with
// NO package.json, so a bare-specifier import is impossible — we resolve an ABSOLUTE path to
//   ~/.copilot/pkg/<platform>/<newest-semver>/copilot-sdk/index.js
// and never hardcode a version (the SDK self-updates).
//
// Failure model (spec § "Preflight + verdict → exit code"): any unmet precondition throws an Error
// carrying `.exitCode = 2` ("INCOMPLETE — no verdict"); the run.mjs entrypoint maps that to a
// process exit code of 2. This module is otherwise pure (no side effects on import).

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Directory names under a platform dir that are never SDK version candidates:
// `tmp` (SDK download/staging) and `universal` (platform-agnostic bucket).
const EXCLUDED_VERSION_DIRS = new Set(['tmp', 'universal']);

function preconditionError(message) {
  return Object.assign(new Error(message), { exitCode: 2, code: 'L2_SDK_PRECONDITION' });
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Parse a version directory name into a comparable shape:
//   '1.0.73'   → { release: [1, 0, 73], prerelease: null }
//   '1.0.69-0' → { release: [1, 0, 69], prerelease: '0' }   (a prerelease sorts BELOW its release)
// Non-numeric segments coerce to 0; excluded/garbage names never reach here (filtered by name).
function parseVersion(name) {
  const dash = name.indexOf('-');
  const base = dash === -1 ? name : name.slice(0, dash);
  const prerelease = dash === -1 ? null : name.slice(dash + 1);
  const [major, minor, patch] = base.split('.');
  const toInt = (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  };
  return { release: [toInt(major), toInt(minor), toInt(patch)], prerelease };
}

// Descending prerelease compare (numeric-aware): the higher identifier is newer (sorts first).
function comparePrereleaseDesc(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

// Descending semver comparator (LOW-5). Sorts numeric major/minor/patch descending; a plain release
// outranks its own prerelease (`1.0.69` > `1.0.69-0`). Returns <0 when `a` is NEWER than `b`, so
// `Array.prototype.sort(compareVersionsDesc)[0]` is the newest version.
export function compareVersionsDesc(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.release[i] !== pb.release[i]) return pb.release[i] - pa.release[i];
  }
  // Equal release triple → the plain release (no prerelease) is newer than any prerelease.
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return -1; // a is the release → newer
  if (pb.prerelease === null) return 1; // b is the release → newer
  return comparePrereleaseDesc(pa.prerelease, pb.prerelease);
}

// Resolve the absolute path to the bundled Copilot SDK entry for the current platform.
//
// Options (all defaulted for production; injected by tests so the real ~/.copilot is never touched):
//   home     — home directory root                (default os.homedir())
//   platform — process.platform override          (default process.platform)
//   arch     — process.arch override              (default process.arch)
//
// Throws a precondition Error (`.exitCode = 2`) when the SDK cannot be resolved.
export function resolveSdkPath({
  home = os.homedir(),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const pkgRoot = path.join(home, '.copilot', 'pkg');
  if (!isDir(pkgRoot)) {
    throw preconditionError(
      `Copilot SDK not found: ${pkgRoot} does not exist (is the copilot CLI installed?)`,
    );
  }

  const platformDir = `${platform}-${arch}`;
  const platformPath = path.join(pkgRoot, platformDir);
  if (!isDir(platformPath)) {
    throw preconditionError(`Copilot SDK not found for platform "${platformDir}" under ${pkgRoot}`);
  }

  const candidates = fs
    .readdirSync(platformPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !EXCLUDED_VERSION_DIRS.has(name));

  if (candidates.length === 0) {
    throw preconditionError(
      `No Copilot SDK version directories under ${platformPath} (excluded: tmp, universal)`,
    );
  }

  candidates.sort(compareVersionsDesc);
  const newest = candidates[0];

  const entryPath = path.resolve(platformPath, newest, 'copilot-sdk', 'index.js');
  if (!isFile(entryPath)) {
    throw preconditionError(
      `Copilot SDK entry copilot-sdk/index.js missing under selected version ${newest}: ${entryPath}`,
    );
  }
  return entryPath;
}

export default resolveSdkPath;
