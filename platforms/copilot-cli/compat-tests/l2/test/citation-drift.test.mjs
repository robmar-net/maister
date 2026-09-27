// Credit-free checks for `l2/tools/citation-drift.mjs` (issue #157).
// Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/citation-drift.test.mjs
//
// What it proves — the tool finds provenance drift that `--check-reference` structurally cannot see, and
// REFUSES rather than guesses whenever the evidence is not unique:
//   T1  clean tree: nothing moved -> exit 0, no DRIFT (the negative control; a guard that cannot pass is
//       useless, and one that always passes is worse).
//   T2  a reflowed source with a UNIQUE re-anchor -> exit 1, DRIFT, and the NEW line number is named.
//   T3  TRAP 2 (the one that broke the first cut of this tool): a citation ALREADY re-anchored reads OK,
//       because the assertion is source@base[OLD] == source@now[NEW], not [N] == [N]. Getting this wrong
//       turns every correct fix into a false alarm, so it is pinned.
//   T4  TRAP 1: the naive same-number comparison is NOT what `classify` does — a moved line whose number
//       was corrected must not be reported.
//   T5  ambiguity: cited content that occurs twice in the new file -> AMBIGUOUS, never re-anchored. A
//       plausible-looking wrong citation is worse than a loud unresolved one.
//   T6  deleted content -> GONE (needs a human), not silently dropped.
//   T7  append-only: a drifted citation inside CALIBRATION-LOG.md is reported FROZEN and `--fix` leaves
//       the file BYTE-IDENTICAL — the correction belongs in a new appended entry (AGENTS.md).
//   T8  misalignment: when the citation COUNT changed since --base, positional pairing is unsound, so the
//       reference is reported NOT CHECKED instead of zipped short against the wrong partners.
//   T9  declared sources: `Source` row parsing, prefix forms (`I:N` / `W:N`), and the rule that a bare
//       `:N` with two unprefixed sources stays unresolved rather than being assigned to the first.
//   T10 `--fix` rewrites only unique, non-frozen drift, and a re-run then reports OK.
//   T11 usage: a bad revision and an unknown flag both exit 2, distinctly from the exit-1 "drift found".
//
// CREDIT-FREE and hermetic: every case builds a THROWAWAY git repo under `mkdtemp` and points the tool at
// it through `COMPAT_L2_CITATION_ROOT` [test seam], so no case can read or write the real checkout, its
// references, or its history. Private TMPDIR per child (the run-sh.test.mjs:196-199 concurrency rule).
//
// Zero-dependency: node: builtins only. Self-cleaning: every mkdtemp root is removed in `finally`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const TOOL = path.join(L2_DIR, 'tools', 'citation-drift.mjs');
const REF_REL = path.join('platforms', 'copilot-cli', 'compat-tests', 'l2', 'reference');

const { parseSources, collectCitations, classify, resolvePath } = await import(TOOL);

// ---------------------------------------------------------------- synthetic repo
// build({ source, refs }) commits a first revision, then applies `after` and leaves it UNCOMMITTED, so
// `--base=HEAD` is the pre-change state and the working tree is the post-change state — exactly the shape
// of a sync (source reflowed by the merge, derivations still carrying the old numbers).
function build({ source, refs, after = {}, afterRefs = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-citdrift-'));
  const w = (rel, body) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  for (const [rel, body] of Object.entries(source)) w(rel, body);
  for (const [name, body] of Object.entries(refs)) w(path.join(REF_REL, name), body);
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  for (const [rel, body] of Object.entries(after)) w(rel, body);
  for (const [name, body] of Object.entries(afterRefs)) w(path.join(REF_REL, name), body);
  return root;
}

function run(root, args = []) {
  const env = { ...process.env, COMPAT_L2_CITATION_ROOT: root, TMPDIR: root };
  const res = spawnSync(process.execPath, [TOOL, '--base=HEAD', ...args], { cwd: root, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(res.error, undefined, `spawn failed: ${res.error && res.error.message}`);
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

const SKILL = 'plugins/maister/skills/demo/SKILL.md';
const derivation = (cites) => [
  '# demo derivation', '',
  '| Field | Value |', '|---|---|',
  `| Source (read-only citation source) | \`${SKILL}\` |`, '',
  ...cites,
].join('\n');

// A source file whose lines are individually identifiable, so a re-anchor can be unique.
const src = (lines) => lines.join('\n');
const BASE_SRC = src(['alpha', 'beta', 'GATE the gate line', 'delta', 'epsilon']);
// One line inserted at the top: every later line shifts by exactly 1.
const SHIFTED_SRC = src(['inserted', 'alpha', 'beta', 'GATE the gate line', 'delta', 'epsilon']);

// ---------------------------------------------------------------- T1
test('T1 clean tree: nothing moved -> exit 0 and no DRIFT', () => {
  const root = build({ source: { [SKILL]: BASE_SRC }, refs: { 'demo.derivation.md': derivation([`| p | required | :3 | the gate |`]) } });
  try {
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /OK 1\b/);
    assert.doesNotMatch(r.stdout, /^DRIFT/m);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T2
test('T2 reflowed source, unique re-anchor -> exit 1, DRIFT names the new line', () => {
  const root = build({
    source: { [SKILL]: BASE_SRC },
    refs: { 'demo.derivation.md': derivation([`| p | required | :3 | the gate |`]) },
    after: { [SKILL]: SHIFTED_SRC },
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^DRIFT/m);
    assert.match(r.stdout, /:3 -> :4/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T3 (the trap that broke v1)
test('T3 TRAP 2: an ALREADY re-anchored citation reads OK, not a false drift', () => {
  const root = build({
    source: { [SKILL]: BASE_SRC },
    refs: { 'demo.derivation.md': derivation([`| p | required | :3 | the gate |`]) },
    after: { [SKILL]: SHIFTED_SRC },
    // the derivation has been corrected: :3 -> :4
    afterRefs: { 'demo.derivation.md': derivation([`| p | required | :4 | the gate |`]) },
  });
  try {
    const r = run(root);
    assert.equal(r.status, 0, `a corrected citation must not be reported as drift:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /OK 1\b/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T4
test('T4 TRAP 1: classify() compares base[OLD] with now[NEW], not [N] with [N]', () => {
  const baseLines = BASE_SRC.split('\n');
  const nowLines = SHIFTED_SRC.split('\n');
  // the naive same-number comparison would call this drift; the correct pairing calls it OK
  assert.equal(classify({ baseLines, nowLines, oldLine: 3, newLine: 4 }).state, 'OK');
  // and an UNcorrected citation is still caught, with the unique new anchor
  const d = classify({ baseLines, nowLines, oldLine: 3, newLine: 3 });
  assert.equal(d.state, 'DRIFT');
  assert.equal(d.to, 4);
});

// ---------------------------------------------------------------- T5
test('T5 ambiguity: content occurring twice -> AMBIGUOUS, never re-anchored', () => {
  const root = build({
    source: { [SKILL]: src(['alpha', 'DUP', 'beta']) },
    refs: { 'demo.derivation.md': derivation([`| p | required | :2 | dup |`]) },
    // the cited line 2 must NOT still hold the content, or the citation is legitimately OK; the content
    // then occurs TWICE elsewhere, which is what makes the re-anchor ambiguous
    after: { [SKILL]: src(['x', 'y', 'DUP', 'z', 'DUP']) },
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^AMBIGUOUS/m);
    assert.doesNotMatch(r.stdout, /^DRIFT/m);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T6
test('T6 deleted content -> GONE, not silently dropped', () => {
  const root = build({
    source: { [SKILL]: src(['alpha', 'VANISHING', 'beta']) },
    refs: { 'demo.derivation.md': derivation([`| p | required | :2 | gone |`]) },
    after: { [SKILL]: src(['alpha', 'beta']) },
  });
  try {
    const r = run(root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^GONE/m);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T7
test('T7 append-only: CALIBRATION-LOG drift is FROZEN and --fix leaves it byte-identical', () => {
  const log = ['# log', '', `| 1 | entry citing \`${SKILL}:3\` |`].join('\n');
  const root = build({
    source: { [SKILL]: BASE_SRC },
    refs: { 'CALIBRATION-LOG.md': log },
    after: { [SKILL]: SHIFTED_SRC },
  });
  const logPath = path.join(root, REF_REL, 'CALIBRATION-LOG.md');
  try {
    const before = fs.readFileSync(logPath);
    const r = run(root, ['--fix']);
    assert.match(r.stdout, /^FROZEN/m, r.stdout);
    assert.deepEqual(fs.readFileSync(logPath), before, 'an append-only file must never be rewritten');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T8
test('T8 misalignment: a changed citation COUNT is reported NOT CHECKED, never mis-paired', () => {
  const root = build({
    source: { [SKILL]: BASE_SRC },
    refs: { 'demo.derivation.md': derivation([`| p | required | :3 | the gate |`]) },
    after: { [SKILL]: SHIFTED_SRC },
    afterRefs: { 'demo.derivation.md': derivation([`| p | required | :4 | the gate |`, `| q | optional | :5 | added |`]) },
  });
  try {
    const r = run(root);
    assert.match(r.stdout, /NOT CHECKED — citation count changed since --base \(1 -> 2\)/, r.stdout);
    assert.doesNotMatch(r.stdout, /^DRIFT/m, 'an unsound pairing must not produce findings');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T9
test('T9 declared sources: row parsing, prefixes, and two unprefixed sources stay unresolved', () => {
  const one = parseSources(derivation([]));
  assert.deepEqual(one, [{ path: SKILL, prefix: null }]);

  const prefixed = ['| Source (read-only citation sources) | `plugins/maister/commands/work.md` (`W:N`), `plugins/maister/agents/task-classifier.md` (`C:N`) |'].join('\n');
  const two = parseSources(prefixed);
  assert.deepEqual(two.map((s) => s.prefix), ['W', 'C']);

  // a prefixed citation binds to its declared file
  const c1 = collectCitations('see W:12 and C:5', two);
  assert.deepEqual(c1.map((c) => [c.file, c.line]), [['plugins/maister/commands/work.md', 12], ['plugins/maister/agents/task-classifier.md', 5]]);

  // a bare :N with TWO unprefixed sources must NOT be assigned to the first one
  const ambigSources = [{ path: 'a/x.md', prefix: null }, { path: 'b/y.md', prefix: null }];
  const c2 = collectCitations('see :9', ambigSources);
  assert.equal(c2.length, 1);
  assert.equal(c2[0].file, null, 'two unprefixed sources make a bare citation unresolvable, not a guess');

  // an explicit path wins over the declared source, and is not double-counted as a bare citation
  const c3 = collectCitations('see other/thing.md:7', one);
  assert.deepEqual(c3.map((c) => [c.file, c.line]), [['other/thing.md', 7]]);

  // a declared source disambiguates a bare BASENAME that matches several tracked files
  const tracked = ['plugins/maister/hooks/g.sh', 'platforms/copilot-cli/hooks-overrides/g.sh'];
  const declared = [{ path: 'platforms/copilot-cli/hooks-overrides/g.sh', prefix: null }];
  assert.equal(resolvePath('g.sh', declared, tracked).path, 'platforms/copilot-cli/hooks-overrides/g.sh');
  assert.equal(resolvePath('g.sh', [], tracked).path, null, 'without a declared source an ambiguous tail must refuse');
});

// ---------------------------------------------------------------- T10
test('T10 --fix rewrites unique non-frozen drift, and a re-run then reports OK', () => {
  const root = build({
    source: { [SKILL]: BASE_SRC },
    refs: { 'demo.derivation.md': derivation([`| p | required | :3 | the gate |`]) },
    after: { [SKILL]: SHIFTED_SRC },
  });
  const refPath = path.join(root, REF_REL, 'demo.derivation.md');
  try {
    assert.equal(run(root).status, 1);
    const fixed = run(root, ['--fix']);
    assert.match(fixed.stdout, /fixed 1 citation/);
    assert.match(fs.readFileSync(refPath, 'utf8'), /\| :4 \|/, 'the citation must now name the new line');
    assert.equal(run(root).status, 0, 'after --fix the same check must pass');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- T11
test('T11 usage errors exit 2, distinctly from the exit-1 "drift found"', () => {
  const root = build({ source: { [SKILL]: BASE_SRC }, refs: { 'demo.derivation.md': derivation([`| p | required | :3 | x |`]) } });
  try {
    const env = { ...process.env, COMPAT_L2_CITATION_ROOT: root, TMPDIR: root };
    const bad = spawnSync(process.execPath, [TOOL, '--base=nope-not-a-rev'], { cwd: root, encoding: 'utf8', env });
    assert.equal(bad.status, 2, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /not a commit/);

    const noBase = spawnSync(process.execPath, [TOOL], { cwd: root, encoding: 'utf8', env });
    assert.equal(noBase.status, 2);
    assert.match(noBase.stderr, /missing --base/);

    const unknown = spawnSync(process.execPath, [TOOL, '--base=HEAD', '--nope'], { cwd: root, encoding: 'utf8', env });
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown argument/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
