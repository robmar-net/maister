// Credit-free checks for `l2/tools/bundle-archive.sh` (issue #138 WP5; spec R20-R24, acceptance A5.1-A5.6).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/bundle-archive.test.mjs
//
// What it proves: the archiver puts a replay bundle somewhere `git worktree remove` and `git clean -xdf`
// cannot reach, and can prove afterwards that what it stored is still what it stored —
//   T1  round trip: archive a staged bundle, then `--verify` -> exit 0 (A5.1a).
//   T2  tamper: (a) flip one byte of the stored tar -> non-zero, the TAR path named on stderr;
//       (b) restore the tar from a bundle copy with one byte of `events.json` changed -> non-zero and the
//       OFFENDING INNER PATH (`./events.json`) named, not merely "something moved" (A5.1b).
//   T3  the DEFAULT destination is outside the git tree, and `git clean -xdf -n` does not list it — run in
//       both this worktree and the main checkout (A5.3).
//   T4  script shape: `sha256sum` appears ZERO times (BSD/macOS has no `sha256sum`), the `variant.sh:346`
//       tree-digest idiom appears VERBATIM, mode is 755, no ANSI/colour, no bash-4 `[[`, and `-h` reprints
//       the header (which therefore must still sit immediately before `set -euo pipefail`) (A5.5).
//   T5  never-writes witness: the source bundle's recursive {relpath: mtime} snapshot AND its parent's
//       listing are unchanged after archive + verify — nothing is ever written beside a bundle (A5.2, H8).
//
// A5.4 — THE REAL DEFAULT ARCHIVE IS NEVER TOUCHED. Every invocation that can create anything drives
// `COMPAT_L2_ARCHIVE` into a `mkdtemp` root. The single exception is T3's `--print-dest`, which exists
// precisely so A5.3 is mechanically checkable instead of tautological: it is a PURE RESOLVER that runs
// before any `mkdir`/`mktemp`, writes nothing anywhere, and T3 asserts that by requiring the resolved
// path's existence to be unchanged across the call.
//
// Private TMPDIR for every bash child: the script `mktemp -d`s a scratch extraction root, and `node --test`
// runs test files CONCURRENTLY — diffing or racing the shared `os.tmpdir()` would collide with
// mutations.test.mjs / variants.test.mjs staging their own trees (the run-sh.test.mjs:196-199 rule).
//
// CREDIT-FREE: no seat, no session, no SDK import, no `copilot` binary. Bundles are SYNTHESIZED in a
// mkdtemp tree under 2099-series timestamps, so no operator bundle or report can ever be read or
// overwritten; `reports/` is never touched.
//
// Zero-dependency: node: builtins only. Self-cleaning: every mkdtemp root is removed in `finally`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const TOOL = path.join(L2_DIR, 'tools', 'bundle-archive.sh');
// l2 -> compat-tests -> copilot-cli -> platforms -> <repo>  (run.sh:87-90 depth, from l2/ not l2/tools/)
const REPO_ROOT = path.resolve(L2_DIR, '..', '..', '..', '..');

// Spawn the script. `archiveRoot: null` DELETES COMPAT_L2_ARCHIVE (T3's pure-resolver case only);
// anything else sets it. TMPDIR is always private to the child (see the header note).
function runTool(args, { archiveRoot, tmpDir } = {}) {
  const env = { ...process.env };
  if (archiveRoot === null) delete env.COMPAT_L2_ARCHIVE;
  else if (archiveRoot !== undefined) env.COMPAT_L2_ARCHIVE = archiveRoot;
  if (tmpDir) env.TMPDIR = tmpDir;
  const res = spawnSync('bash', [TOOL, ...args], { cwd: L2_DIR, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// <root>/<ts>/{events.json, replay-meta.json, rundir/notes.md} — the minimal shape of a replay bundle.
function stageBundle(root, ts) {
  const dir = path.join(root, ts);
  fs.mkdirSync(path.join(dir, 'rundir'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify([{ type: 'session.start', ts }], null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'replay-meta.json'), JSON.stringify({ ts, scenario: 'research' }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'rundir', 'notes.md'), '# staged bundle\n');
  return dir;
}

// Recursive { relpath: mtimeMs } snapshot — the "never writes into the bundle" witness
// (cost-report.test.mjs:108-121 / ab-compare.test.mjs:98-110).
function snapshotTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, ent.name);
      out[path.relative(dir, p)] = fs.statSync(p).mtimeMs;
      if (ent.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

const mkroot = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `l2-bundle-archive-${tag}-`));

test('T1 round trip: archive a staged bundle -> exit 0 + one stdout line (the tar), then --verify -> exit 0', () => {
  const src = mkroot('t1-src');
  const dest = mkroot('t1-dest');
  const tmp = mkroot('t1-tmp');
  try {
    const ts = '20990801T000000Z';
    const bundle = stageBundle(src, ts);

    const made = runTool([bundle], { archiveRoot: dest, tmpDir: tmp });
    assert.equal(made.status, 0, `archive exits 0\n${made.stderr}`);
    const lines = made.stdout.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 1, `stdout is EXACTLY one line per bundle, got:\n${made.stdout}`);
    const tar = lines[0];
    assert.ok(path.isAbsolute(tar), 'the stdout line is an absolute path');
    assert.equal(path.dirname(tar), dest, 'the archive lands under COMPAT_L2_ARCHIVE, nowhere else');
    assert.ok(fs.existsSync(tar), 'the tar exists');
    assert.ok(fs.existsSync(path.join(dest, `${ts}.sha256`)), 'a sha256 manifest is written beside the tar (R20)');

    // --verify takes the NAME, not the source: the bundle it describes may be long gone (that is the point).
    fs.rmSync(bundle, { recursive: true, force: true });
    const ok = runTool([ts, '--verify'], { archiveRoot: dest, tmpDir: tmp });
    assert.equal(ok.status, 0, `--verify of an intact archive exits 0 with the SOURCE BUNDLE DELETED\n${ok.stderr}`);
    assert.equal(ok.stdout.split('\n').filter((l) => l !== '').length, 1, '--verify also emits exactly one stdout line');
  } finally {
    for (const d of [src, dest, tmp]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('T2 tamper: a flipped byte in the tar -> non-zero naming the tar; a changed inner file -> non-zero naming ./events.json', () => {
  const src = mkroot('t2-src');
  const dest = mkroot('t2-dest');
  const tmp = mkroot('t2-tmp');
  try {
    const ts = '20990802T000000Z';
    const bundle = stageBundle(src, ts);
    const made = runTool([bundle], { archiveRoot: dest, tmpDir: tmp });
    assert.equal(made.status, 0, `archive exits 0\n${made.stderr}`);
    const tar = made.stdout.trim();
    const pristine = fs.readFileSync(tar);

    // (a) flip one byte of the stored tar.
    const flipped = Buffer.from(pristine);
    const at = Math.floor(flipped.length / 2);
    flipped[at] = flipped[at] ^ 0xff;
    fs.writeFileSync(tar, flipped);
    const bad = runTool([ts, '--verify'], { archiveRoot: dest, tmpDir: tmp });
    assert.notEqual(bad.status, 0, '--verify of a corrupted tar exits NON-ZERO');
    assert.ok(bad.stderr.includes(tar), `--verify names the offending path on stderr, got:\n${bad.stderr}`);

    // (b) a tar that is internally consistent but whose events.json differs by one byte: the failure must
    //     name the INNER path, not merely report "the tar moved".
    fs.writeFileSync(path.join(bundle, 'events.json'), JSON.stringify([{ type: 'session.start', ts: 'X' }], null, 2) + '\n');
    const retar = spawnSync('tar', ['-czf', tar, '-C', src, ts], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } });
    assert.equal(retar.status, 0, `test-side re-tar succeeded\n${retar.stderr}`);
    const inner = runTool([ts, '--verify'], { archiveRoot: dest, tmpDir: tmp });
    assert.notEqual(inner.status, 0, '--verify of a substituted tar exits NON-ZERO');
    assert.ok(/\.\/events\.json/.test(inner.stderr), `--verify names the offending INNER path, got:\n${inner.stderr}`);

    // and the intact archive still verifies, so the two failures above are the tamper and not a flaky script.
    fs.writeFileSync(tar, pristine);
    assert.equal(runTool([ts, '--verify'], { archiveRoot: dest, tmpDir: tmp }).status, 0, 'restoring the tar restores exit 0');
  } finally {
    for (const d of [src, dest, tmp]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('T3 the DEFAULT destination is outside the git tree and `git clean -xdf -n` does not list it', () => {
  const tmp = mkroot('t3-tmp');
  try {
    // The ONLY invocation in this file that does not set COMPAT_L2_ARCHIVE — `--print-dest` is a pure
    // resolver (see the A5.4 note in the header). Its no-write property is asserted below.
    const existedBefore = (p) => fs.existsSync(p);
    const r = runTool(['--print-dest'], { archiveRoot: null, tmpDir: tmp });
    assert.equal(r.status, 0, `--print-dest exits 0\n${r.stderr}`);
    const dest = r.stdout.trim();
    assert.ok(path.isAbsolute(dest), `--print-dest emits an absolute path, got "${dest}"`);
    assert.equal(existedBefore(dest), fs.existsSync(dest), '--print-dest creates nothing (pure resolver)');

    // The main checkout root — the anchor the default is a SIBLING of. In a linked worktree
    // `--show-toplevel` is the worktree, so the common git dir is the only stable anchor.
    const gitCommon = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
    assert.equal(gitCommon.status, 0, 'git rev-parse --git-common-dir succeeds');
    const mainCheckout = path.dirname(gitCommon.stdout.trim());

    const under = (parent, child) => child === parent || child.startsWith(parent + path.sep);
    assert.ok(!under(REPO_ROOT, dest), `the default destination is NOT under this working tree (${REPO_ROOT})`);
    assert.ok(!under(mainCheckout, dest), `the default destination is NOT under the main checkout (${mainCheckout}) — a worktree-local archive dies to the very \`git worktree remove\` this package exists to survive`);

    // `-n` is a DRY RUN: nothing is removed by this test. Run it in both trees.
    for (const tree of [REPO_ROOT, mainCheckout]) {
      const clean = spawnSync('git', ['-C', tree, 'clean', '-xdf', '-n'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      assert.equal(clean.status, 0, `git clean dry run in ${tree} succeeds\n${clean.stderr}`);
      for (const line of clean.stdout.split('\n')) {
        const m = /^Would remove (.*)$/.exec(line);
        if (!m) continue;
        const listed = path.resolve(tree, m[1]);
        assert.ok(!under(listed, dest), `git clean -xdf -n in ${tree} would remove "${m[1]}", which contains the archive ${dest}`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T4 script shape: zero `sha256sum`, the variant.sh:346 digest idiom verbatim, mode 755, no ANSI, no `[[`, -h reprints the header', () => {
  const tmp = mkroot('t4-tmp');
  try {
    const text = fs.readFileSync(TOOL, 'utf8');

    // A5.5 — BSD/macOS has no `sha256sum`; the project digests with `shasum -a 256`.
    assert.equal((text.match(/sha256sum/g) ?? []).length, 0, 'the script never names `sha256sum` (BSD/macOS has no such binary)');
    assert.ok(text.includes('shasum -a 256'), '`shasum -a 256` is used');
    assert.ok(
      text.includes("find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1"),
      'the variant.sh:346 tree-digest idiom appears VERBATIM',
    );

    // Bash 3.2 house style, and the no-colour rule.
    assert.ok(!/\[\[/.test(text), 'no bash-4 `[[` — the harness must run on stock macOS bash 3.2');
    // eslint-disable-next-line no-control-regex
    assert.ok(!/\x1b\[/.test(text), 'no ANSI/colour escapes anywhere');
    assert.ok(text.startsWith('#!/usr/bin/env bash\n'), 'the shebang is `#!/usr/bin/env bash`');
    assert.equal(fs.statSync(TOOL).mode & 0o777, 0o755, 'mode is 755');

    // `print_header` seds `2,/^set -euo pipefail/p`, so this passing IS the proof that the header comment
    // still sits immediately before `set -euo pipefail` with no code spliced between them.
    const h = runTool(['-h'], { archiveRoot: path.join(tmp, 'unused-archive-root'), tmpDir: tmp });
    assert.equal(h.status, 0, `-h exits 0\n${h.stderr}`);
    assert.ok(/COMPAT_L2_ARCHIVE/.test(h.stdout), '-h documents the COMPAT_L2_ARCHIVE override');
    assert.ok(/--verify/.test(h.stdout), '-h documents --verify');
    assert.ok(!fs.existsSync(path.join(tmp, 'unused-archive-root')), '-h creates no destination');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T5 never-writes witness: the source bundle and its parent are byte-and-mtime unchanged after archive + verify (H8)', () => {
  const src = mkroot('t5-src');
  const dest = mkroot('t5-dest');
  const tmp = mkroot('t5-tmp');
  try {
    const ts = '20990803T000000Z';
    const bundle = stageBundle(src, ts);
    // A decoy sibling, so "nothing appeared next to the bundle" is a real assertion and not a listing of one.
    fs.writeFileSync(path.join(src, 'bad'), 'not a bundle\n');

    const beforeTree = snapshotTree(bundle);
    const beforeParent = fs.readdirSync(src).sort();

    assert.equal(runTool([bundle], { archiveRoot: dest, tmpDir: tmp }).status, 0, 'archive exits 0');
    assert.equal(runTool([ts, '--verify'], { archiveRoot: dest, tmpDir: tmp }).status, 0, '--verify exits 0');

    assert.deepEqual(snapshotTree(bundle), beforeTree, 'bundle listing + mtimes unchanged by archive and verify');
    assert.deepEqual(fs.readdirSync(src).sort(), beforeParent, 'nothing created next to the bundle');
    assert.deepEqual(fs.readdirSync(src).sort(), [ts, 'bad'].sort(), 'the parent still holds exactly the staged bundle and the decoy');
    assert.deepEqual(fs.readdirSync(tmp).sort(), [], 'the private TMPDIR is left empty — every mktemp scratch tree is removed');
  } finally {
    for (const d of [src, dest, tmp]) fs.rmSync(d, { recursive: true, force: true });
  }
});
