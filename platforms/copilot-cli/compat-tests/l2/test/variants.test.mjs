// variants.test.mjs — #122 G1: credit-free scripted checks for the A/B arm builder
// l2/variants/variant.sh (spec R4.1-R4.5) and the five arm manifests l2/variants/arms/<arm>.json
// (spec R5).
//
// variant.sh stages a THROWAWAY copy of the maister-copilot plugin from a PINNED commit
// (`git archive <commit> plugins/maister-copilot`, never the working tree) and applies the arm's
// manifest transforms to that copy. These tests pin the builder's contract:
//   1. Fail-closed usage — unknown arm / missing --commit / unknown commit exit 2 with NOTHING
//      created (no l2-variant-* residue in os.tmpdir()) and nothing on stdout.
//   2. plain (+ plain-legacy) — exit 0, stdout is EXACTLY one line (the absolute staged path;
//      run.sh captures it with `$(...)`), the staged tree's digest (final stderr line, R2.3 shell
//      idiom) equals an INDEPENDENT `git archive HEAD | tar` extraction made here, plugin.json name
//      is maister-copilot, and `git status --porcelain -- plugins` is unchanged (the repo is never written).
//      HEAD != --commit is a stderr warning, never a failure (ADR-003).
//   3. lean — every agents/*.md (count MEASURED against the pristine extraction, 25 today) gained
//      the guard exactly once as a whole line; per-file diff = 2 added lines, 0 removed; the
//      `^model:` line SET is byte-identical to the pristine tree; nothing outside agents/ changed.
//   4./5. caveman / terse — the staged SessionStart hook exits 0, its stdout parses as JSON whose
//      TOP-LEVEL additionalContext ends with "\n\n" + the manifest text (the flat envelope Copilot
//      reads, #113 / WS5.21), no hookSpecificOutput, no AskUserQuestion / maister: in hooks/*.sh
//      (WS5.15), hooks.json byte-identical, and the hook file differs by exactly one line.
//   6. All five manifests parse with the R5 schema: manifestSchema 1, arm === basename, explicit
//      boolean skipCustomInstructions (false ONLY for plain-legacy), plain/plain-legacy have zero
//      transforms, every transform kind/keys valid, every text JSON-string-safe (R4.3).
//   7. A broken manifest (anchor that cannot match) reached through the COMPAT_ARMS_DIR seam exits 1
//      AND leaves no l2-variant-* residue (a half-staged copy that survives could later be driven
//      as an undefined arm).
//   8. A manifest text carrying a double quote (or an unknown kind, or a mismatched arm) is refused
//      with exit 2 BEFORE mktemp — no residue at all.
//
// Run only this file:  node --test platforms/copilot-cli/compat-tests/l2/test/variants.test.mjs
// Skip-gated on `git -C <repo> rev-parse --verify HEAD` (an exported tarball has no archive to
// stage from). Fixture = the repo's own HEAD commit; nothing is ever written under reports/ or the
// repo, every staged dir is removed in `finally`.
//
// SAFETY: variant.sh never invokes copilot, and every spawn here additionally runs under a PATH
// that hides `copilot` (mutations.test.mjs idiom) — an accidental live session is impossible by
// construction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');            // l2/
const REPO_ROOT = path.resolve(L2_DIR, '../../../..');   // l2 -> compat-tests -> copilot-cli -> platforms -> <repo>
const VARIANT_SH = path.join(L2_DIR, 'variants', 'variant.sh');
const ARMS_DIR = path.join(L2_DIR, 'variants', 'arms');
const ARMS = ['plain-legacy', 'plain', 'lean', 'caveman', 'terse'];
const HOOK_REL = path.join('hooks', 'skill-invocation-reminder.sh');

// A PATH that keeps node + coreutils (+ git/perl/shasum/tar) but HIDES `copilot`.
const NODE_BIN_DIR = path.dirname(process.execPath);
const NO_COPILOT_PATH = [NODE_BIN_DIR, '/usr/local/bin', '/usr/bin', '/bin'].join(':');

const gitHead = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
const HAS_GIT = gitHead.status === 0 && /^[0-9a-f]{40}$/.test(gitHead.stdout.trim());
const skip = HAS_GIT ? false : `git -C ${REPO_ROOT} rev-parse --verify HEAD failed — no archive to stage from`;

function runVariant(args, extraEnv = {}) {
  return spawnSync('bash', [VARIANT_SH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: NO_COPILOT_PATH, ...extraEnv },
  });
}

const variantEntries = () => new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('l2-variant-')));
const newEntries = (before) => [...variantEntries()].filter((n) => !before.has(n));
// Scoped to `-- plugins` (the ONLY subtree variant.sh archives — the same scope variant.sh itself snapshots):
// node --test runs files concurrently and sibling tests write elsewhere in the tree (reports/, mktemp
// copies), so a whole-tree porcelain diff would flake on unrelated churn.
const gitPorcelain = () => spawnSync('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--', 'plugins'], { encoding: 'utf8' }).stdout;
const read = (...segs) => fs.readFileSync(path.join(...segs), 'utf8');
const countOf = (text, needle) => text.split(needle).length - 1;
const loadManifest = (arm) => JSON.parse(read(ARMS_DIR, `${arm}.json`));

// Independent extraction of the same archive — the measurement baseline (never variant.sh's own).
function extractPristine(commit = 'HEAD') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-vtest-pristine-'));
  const r = spawnSync('bash', ['-c', 'git -C "$1" archive "$2" plugins/maister-copilot | tar -x -C "$3" --strip-components=2', '_', REPO_ROOT, commit, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `test setup: independent git archive extraction must succeed — stderr:\n${r.stderr}`);
  return dir;
}

// R2.3 shell digest idiom (the one variant.sh prints on stderr and run.mjs digestTree must match).
function shellDigest(dir) {
  const r = spawnSync('bash', ['-c', 'cd "$1" && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256', '_', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `test setup: shell digest must succeed — stderr:\n${r.stderr}`);
  const hex = r.stdout.trim().split(/\s+/)[0];
  assert.match(hex, /^[0-9a-f]{64}$/, 'shell digest must be a sha256 hex');
  return hex;
}

// Recursive content digest (mutations.test.mjs idiom): sorted relative paths + per-file sha256.
function digestDir(root) {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(path.relative(root, p));
    }
  })(root);
  const h = crypto.createHash('sha256');
  for (const rel of files.sort()) {
    h.update(rel);
    h.update('\0');
    h.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex'));
    h.update('\n');
  }
  return h.digest('hex');
}

// Stage an arm and return { dir, res }; the caller removes `dir` in `finally`.
function stage(arm, commit = 'HEAD', extraEnv = {}) {
  const res = runVariant([arm, `--commit=${commit}`], extraEnv);
  assert.equal(res.status, 0, `${arm}: variant.sh must exit 0 (got ${res.status}) — stderr:\n${res.stderr}`);
  const lines = res.stdout.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `${arm}: stdout must be EXACTLY one line (got ${lines.length}): ${JSON.stringify(res.stdout)}`);
  assert.equal(res.stdout.endsWith('\n'), true, `${arm}: the single stdout line must be newline-terminated`);
  const dir = lines[0];
  assert.ok(path.isAbsolute(dir), `${arm}: staged path must be absolute: ${dir}`);
  assert.ok(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `${arm}: staged path must be an existing directory: ${dir}`);
  assert.ok(path.basename(dir).startsWith(`l2-variant-${arm}-`), `${arm}: staged dir must be named l2-variant-${arm}-*: ${dir}`);
  return { dir, res };
}

const digestLine = (stderr) => stderr.trimEnd().split('\n').at(-1);
const agentFiles = (root) => fs.readdirSync(path.join(root, 'agents')).filter((n) => n.endsWith('.md')).sort();
const modelSet = (root) => agentFiles(root)
  .flatMap((n) => read(root, 'agents', n).split('\n').filter((l) => l.startsWith('model:')))
  .sort();

// `diff -rq` between two trees: the relative paths of files that differ (asserts no "Only in").
function differingFiles(a, b) {
  const r = spawnSync('diff', ['-rq', a, b], { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, `diff -rq must run (status ${r.status}): ${r.stderr}`);
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^Files (.*) and (.*) differ$/);
    assert.ok(m, `every tree difference must be a changed FILE, never an added/removed one: ${line}`);
    return path.relative(a, m[1]);
  });
}

// The R4.5 invariants shared by every arm + the hook-append checks for caveman/terse.
function assertHookInvariants(arm, dir, pristine, expectedText) {
  const hook = spawnSync('bash', [path.join(dir, HOOK_REL)], { encoding: 'utf8', env: { ...process.env, PATH: NO_COPILOT_PATH } });
  assert.equal(hook.status, 0, `${arm}: staged SessionStart hook must exit 0 — stderr:\n${hook.stderr}`);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(hook.stdout); }, `${arm}: hook stdout must parse as JSON:\n${hook.stdout}`);
  assert.equal(typeof parsed.additionalContext, 'string', `${arm}: hook JSON must carry a TOP-LEVEL string additionalContext`);
  assert.ok(!('hookSpecificOutput' in parsed) && !hook.stdout.includes('hookSpecificOutput'), `${arm}: hook output must not use Claude's hookSpecificOutput wrapper (#113)`);
  // WS5.21 predicate (Makefile:53) — flat envelope, key at indent 0-2.
  assert.ok(hook.stdout.split('\n').some((l) => /^[ \t]{0,2}"additionalContext":/.test(l)), `${arm}: WS5.21 top-level "additionalContext" key must be present`);
  // WS5.15 predicate (Makefile:42-43) — no source nomenclature in any staged hook.
  const ws515 = spawnSync('bash', ['-c', 'grep -nE "AskUserQuestion|maister:" "$1"/hooks/*.sh', '_', dir], { encoding: 'utf8' });
  assert.equal(ws515.status, 1, `${arm}: WS5.15 grep over hooks/*.sh must be empty, got:\n${ws515.stdout}`);
  assert.ok(Buffer.from(read(dir, 'hooks', 'hooks.json')).equals(Buffer.from(read(pristine, 'hooks', 'hooks.json'))), `${arm}: hooks/hooks.json must be byte-identical to the archive`);
  assert.match(read(dir, '.claude-plugin', 'plugin.json'), /"name"\s*:\s*"maister-copilot"/, `${arm}: plugin.json name must stay maister-copilot`);
  if (expectedText !== undefined) {
    assert.ok(parsed.additionalContext.endsWith(`\n\n${expectedText}`), `${arm}: additionalContext must END with "\\n\\n" + the manifest text; tail was: ${JSON.stringify(parsed.additionalContext.slice(-120))}`);
    assert.equal(countOf(parsed.additionalContext, expectedText), 1, `${arm}: the manifest text must appear exactly once in additionalContext`);
    const pristineHook = spawnSync('bash', [path.join(pristine, HOOK_REL)], { encoding: 'utf8' });
    assert.ok(!JSON.parse(pristineHook.stdout).additionalContext.includes(expectedText), `${arm}: sanity — the PRISTINE hook must not already carry the text`);
    const d = spawnSync('diff', [path.join(pristine, HOOK_REL), path.join(dir, HOOK_REL)], { encoding: 'utf8' });
    const changed = d.stdout.split('\n').filter((l) => /^[<>]/.test(l));
    assert.equal(changed.length, 2, `${arm}: the hook must differ by EXACTLY one changed line (1 '<' + 1 '>'), got:\n${d.stdout}`);
    assert.deepEqual(differingFiles(pristine, dir), [HOOK_REL], `${arm}: the hook must be the ONLY file that differs from the archive`);
  }
}

// -------------------------------------------------------------------------- Test 1 (R4.1)
test('1 (fail-closed usage): unknown arm / missing --commit / unknown commit exit 2 with no l2-variant-* residue', { skip }, () => {
  const before = variantEntries();
  const cases = [
    { args: [], why: 'no arguments' },
    { args: ['bogus', '--commit=HEAD'], why: 'unknown arm' },
    { args: ['plain'], why: 'missing --commit' },
    { args: ['plain', '--commit='], why: 'empty --commit' },
    { args: ['plain', '--commit=0000000000000000000000000000000000000000'], why: 'unknown commit' },
    { args: ['plain', '--commit=HEAD', '--bogus-flag'], why: 'unknown option' },
    { args: ['../plain', '--commit=HEAD'], why: 'path-shaped arm name' },
  ];
  for (const c of cases) {
    const res = runVariant(c.args);
    assert.equal(res.status, 2, `${c.why}: must exit 2 (got ${res.status}) — stderr:\n${res.stderr}`);
    assert.equal(res.stdout, '', `${c.why}: nothing may be printed on stdout`);
    assert.ok(res.stderr.trim().length > 0, `${c.why}: a diagnostic must reach stderr`);
  }
  assert.deepEqual(newEntries(before), [], 'exit-2 rejects must create no l2-variant-* directory');
});

// -------------------------------------------------------------------------- Test 2 (R4.2, R4.5)
test('2 (plain, plain-legacy): one-line path, digest equals an independent git archive extraction, name invariant, repo untouched', { skip }, () => {
  const porcelainBefore = gitPorcelain();
  const before = variantEntries();
  const pristine = extractPristine();
  const staged = [];
  try {
    const expectedDigest = shellDigest(pristine);
    const expectedContent = digestDir(pristine);
    for (const arm of ['plain', 'plain-legacy']) {
      const { dir, res } = stage(arm);
      staged.push(dir);
      const last = digestLine(res.stderr);
      const m = last.match(/^variant\.sh: (\S+) staged from ([0-9a-f]{40}) \(tree ([0-9a-f]{40})\) digest sha256:([0-9a-f]{64}) at (.+)$/);
      assert.ok(m, `${arm}: the final stderr line must be the staged/digest summary, got: ${last}`);
      assert.equal(m[1], arm, `${arm}: summary line must name the arm`);
      assert.equal(m[2], gitHead.stdout.trim(), `${arm}: summary must name the resolved HEAD commit`);
      assert.equal(m[5], dir, `${arm}: summary path must equal the stdout path`);
      assert.equal(m[4], expectedDigest, `${arm}: stderr digest must equal the R2.3 shell digest of an independent extraction`);
      assert.equal(shellDigest(dir), expectedDigest, `${arm}: the staged tree's own shell digest must equal the archive's`);
      assert.equal(digestDir(dir), expectedContent, `${arm}: staged tree content must be byte-identical to the archive`);
      assert.deepEqual(differingFiles(pristine, dir), [], `${arm}: diff -r against the archive must be empty`);
      assert.match(read(dir, '.claude-plugin', 'plugin.json'), /"name"\s*:\s*"maister-copilot"/, `${arm}: plugin.json name must be maister-copilot`);
      assert.ok(!res.stderr.includes('warning'), `${arm}: --commit=HEAD must NOT warn — stderr:\n${res.stderr}`);
      assert.ok(!fs.existsSync(path.join(dir, '.l2-variant')) && !fs.existsSync(path.join(dir, 'VARIANT')), `${arm}: no marker file may be written into the copy (R4.2)`);
      assertHookInvariants(arm, dir, pristine);
    }
    // ADR-003: a pin that is not the checkout is a WARNING, never a failure.
    const parent = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', '--verify', '--quiet', 'HEAD~1:plugins/maister-copilot'], { encoding: 'utf8' });
    if (parent.status === 0) {
      const { dir, res } = stage('plain', 'HEAD~1');
      staged.push(dir);
      assert.match(res.stderr, /warning: HEAD .* != --commit/, `plain --commit=HEAD~1: must warn that HEAD differs from the pin — stderr:\n${res.stderr}`);
      assert.ok(fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json')), 'plain --commit=HEAD~1: the parent commit tree must be staged');
    }
  } finally {
    for (const d of staged) fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(pristine, { recursive: true, force: true });
  }
  assert.deepEqual(newEntries(before), [], 'no l2-variant-* residue may survive (pristine helper dirs included)');
  assert.equal(gitPorcelain(), porcelainBefore, 'git status --porcelain -- plugins must be unchanged — the source plugin tree is never written');
});

// -------------------------------------------------------------------------- Test 3 (R4.4 lean)
test('3 (lean): every agents/*.md gained the guard exactly once, model: set identical, nothing else changed', { skip }, () => {
  const manifest = loadManifest('lean');
  const guard = manifest.transforms.find((t) => t.id === 'leaf-worker-guard');
  assert.ok(guard && guard.kind === 'append-eof' && guard.files === 'agents/*.md', 'lean manifest must carry the append-eof leaf-worker-guard on agents/*.md');
  const before = variantEntries();
  const pristine = extractPristine();
  let dir;
  try {
    ({ dir } = stage('lean'));
    const agents = agentFiles(pristine);
    assert.ok(agents.length >= 20, `sanity: the archive must carry the plugin agents (got ${agents.length})`);
    assert.deepEqual(agentFiles(dir), agents, 'lean: the copy must have exactly the archive\'s agent files (none added/removed)');
    for (const n of agents) {
      const src = read(pristine, 'agents', n);
      const out = read(dir, 'agents', n);
      assert.equal(countOf(src, guard.text), 0, `lean: sanity — pristine ${n} must not contain the guard`);
      assert.equal(out.split('\n').filter((l) => l === guard.text).length, 1, `lean: ${n} must contain the guard as a whole line exactly once`);
      assert.ok(out.endsWith(`\n\n${guard.text}\n`), `lean: ${n} must end with blank line + guard + newline`);
      assert.equal(out.slice(0, src.length), src, `lean: ${n} must keep the pristine content as its prefix`);
      const d = spawnSync('diff', [path.join(pristine, 'agents', n), path.join(dir, 'agents', n)], { encoding: 'utf8' });
      const lines = d.stdout.split('\n');
      assert.equal(lines.filter((l) => l.startsWith('>')).length, 2, `lean: ${n} diff must show exactly 2 added lines:\n${d.stdout}`);
      assert.equal(lines.filter((l) => l.startsWith('<')).length, 0, `lean: ${n} diff must show 0 removed lines:\n${d.stdout}`);
    }
    const models = modelSet(pristine);
    assert.ok(models.length > 0 && models.length < agents.length + 1, `sanity: pristine model: lines measured (${models.length})`);
    assert.deepEqual(modelSet(dir), models, 'lean: the ^model: line set must be byte-identical to the archive');
    assert.deepEqual(differingFiles(pristine, dir), agents.map((n) => path.join('agents', n)), 'lean: ONLY agents/*.md may differ from the archive');
    assertHookInvariants('lean', dir, pristine);
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(pristine, { recursive: true, force: true });
  }
  assert.deepEqual(newEntries(before), [], 'lean: no l2-variant-* residue may survive');
});

// -------------------------------------------------------------------------- Tests 4/5 (R4.4 hook arms)
for (const arm of ['caveman', 'terse']) {
  test(`${arm === 'caveman' ? 4 : 5} (${arm}): hook exits 0, JSON additionalContext ends with the manifest text, hooks.json identical, WS5.15/WS5.21 hold`, { skip }, () => {
    const manifest = loadManifest(arm);
    assert.equal(manifest.transforms.length, 1, `${arm}: manifest must carry exactly one transform`);
    const t = manifest.transforms[0];
    assert.equal(t.kind, 'hook-context-append', `${arm}: the transform must be hook-context-append`);
    assert.equal(t.file, HOOK_REL, `${arm}: the transform must target ${HOOK_REL}`);
    const before = variantEntries();
    const pristine = extractPristine();
    let dir;
    try {
      assert.equal(countOf(read(pristine, HOOK_REL), t.anchor), 1, `${arm}: the anchor must occur exactly once in the archived hook`);
      ({ dir } = stage(arm));
      assertHookInvariants(arm, dir, pristine, t.text);
      const hookSrc = read(dir, HOOK_REL);
      assert.equal(countOf(hookSrc, t.anchor), 0, `${arm}: the bare anchor must be consumed by the splice`);
      assert.equal(countOf(hookSrc, `${t.anchor.slice(0, -1)}\\n\\n${t.text}"`), 1, `${arm}: the hook source must carry anchor-minus-quote + literal \\n\\n + text + quote exactly once`);
    } finally {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(pristine, { recursive: true, force: true });
    }
    assert.deepEqual(newEntries(before), [], `${arm}: no l2-variant-* residue may survive`);
  });
}

// -------------------------------------------------------------------------- Test 6 (R5 schema)
test('6 (manifests): all five parse with the R5 schema; arm === basename; explicit skipCustomInstructions; plain arms have zero transforms', () => {
  const files = fs.readdirSync(ARMS_DIR).filter((n) => n.endsWith('.json')).sort();
  assert.deepEqual(files, [...ARMS].map((a) => `${a}.json`).sort(), 'arms/ must hold exactly the five R5 manifests');
  const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  for (const arm of ARMS) {
    const m = loadManifest(arm);
    assert.deepEqual(Object.keys(m).sort(), ['arm', 'manifestSchema', 'role', 'sandboxSeeds', 'sessionOptions', 'tiers', 'transforms'], `${arm}: exactly the R5 top-level keys`);
    assert.equal(m.manifestSchema, 1, `${arm}: manifestSchema must be 1`);
    assert.equal(m.arm, arm, `${arm}: arm must equal the file basename`);
    assert.ok(typeof m.role === 'string' && m.role.length > 0, `${arm}: role must be a non-empty string`);
    assert.ok(isStrArray(m.tiers) && m.tiers.length > 0 && m.tiers.every((t) => /^T[123]$/.test(t)), `${arm}: tiers must be a non-empty array of T1|T2|T3`);
    assert.ok(Array.isArray(m.transforms), `${arm}: transforms must be an array`);
    assert.deepEqual(Object.keys(m.sessionOptions).sort(), ['excludedTools', 'reasoningEffort', 'skipCustomInstructions'], `${arm}: sessionOptions keys`);
    assert.equal(typeof m.sessionOptions.skipCustomInstructions, 'boolean', `${arm}: skipCustomInstructions must be an EXPLICIT boolean`);
    assert.equal(m.sessionOptions.skipCustomInstructions, arm !== 'plain-legacy', `${arm}: skipCustomInstructions is false ONLY for plain-legacy`);
    assert.ok(m.sessionOptions.excludedTools === null || isStrArray(m.sessionOptions.excludedTools), `${arm}: excludedTools must be string[] | null`);
    assert.ok(m.sessionOptions.reasoningEffort === null || typeof m.sessionOptions.reasoningEffort === 'string', `${arm}: reasoningEffort must be string | null`);
    assert.deepEqual(Object.keys(m.sandboxSeeds).sort(), ['configYml', 'hookContextAppend'], `${arm}: sandboxSeeds keys`);
    assert.equal(typeof m.sandboxSeeds.configYml.html_output, 'boolean', `${arm}: sandboxSeeds.configYml.html_output must be a boolean`);
    assert.ok(m.sandboxSeeds.hookContextAppend === null || typeof m.sandboxSeeds.hookContextAppend === 'string', `${arm}: hookContextAppend must be string | null`);
    const hookIds = m.transforms.filter((t) => t.kind === 'hook-context-append').map((t) => t.id);
    assert.equal(m.sandboxSeeds.hookContextAppend, hookIds[0] ?? null, `${arm}: hookContextAppend must name the hook transform id (or be null)`);
    for (const t of m.transforms) {
      assert.ok(typeof t.id === 'string' && t.id.length > 0, `${arm}: transform id must be a non-empty string`);
      assert.ok(['append-eof', 'hook-context-append'].includes(t.kind), `${arm}/${t.id}: kind must be append-eof | hook-context-append`);
      const expectedKeys = t.kind === 'append-eof' ? ['files', 'id', 'kind', 'text'] : ['anchor', 'file', 'id', 'kind', 'text'];
      assert.deepEqual(Object.keys(t).sort(), expectedKeys, `${arm}/${t.id}: transform keys for ${t.kind}`);
      assert.ok(typeof t.text === 'string' && t.text.length > 0, `${arm}/${t.id}: text must be a non-empty string`);
      assert.doesNotMatch(t.text, /["\\\x00-\x1f\x7f]/, `${arm}/${t.id}: text must carry no double quote, backslash, tab, newline or control char (R4.3)`);
      assert.doesNotMatch(t.text, /AskUserQuestion|maister:/, `${arm}/${t.id}: text must not reintroduce WS5.15 source nomenclature`);
    }
  }
  assert.equal(loadManifest('plain').transforms.length, 0, 'plain: zero transforms');
  assert.equal(loadManifest('plain-legacy').transforms.length, 0, 'plain-legacy: zero transforms');
  const cavemanLen = loadManifest('caveman').transforms[0].text.length;
  assert.ok(cavemanLen > 0 && cavemanLen <= 600, `caveman: the Caveman text is non-empty and at most 600 characters (spec R5 sizes it ~596), got ${cavemanLen}`);
  assert.deepEqual(loadManifest('lean').sessionOptions.excludedTools, ['mcp:playwright'], 'lean: excludes the Playwright tool definitions');
  assert.equal(loadManifest('lean').sandboxSeeds.configYml.html_output, false, 'lean: html_output false');
  assert.match(loadManifest('lean').role, /ALL agents\/\*\.md/, 'lean: role records the all-agents guard-scope refinement');
});

// -------------------------------------------------------------------------- Test 7 (R4.1 exit 1)
test('7 (broken manifest via COMPAT_ARMS_DIR): an anchor that cannot match exits 1 with no residue', { skip }, () => {
  const before = variantEntries();
  const armsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-vtest-arms-'));
  try {
    const m = loadManifest('caveman');
    m.transforms[0].anchor = 'THIS ANCHOR DOES NOT EXIST IN THE HOOK 0xDEADBEEF"';
    fs.writeFileSync(path.join(armsDir, 'caveman.json'), JSON.stringify(m, null, 2));
    const res = runVariant(['caveman', '--commit=HEAD'], { COMPAT_ARMS_DIR: armsDir });
    assert.equal(res.status, 1, `anchor miss must exit 1 (got ${res.status}) — stderr:\n${res.stderr}`);
    assert.equal(res.stdout, '', 'anchor miss must print nothing on stdout');
    assert.match(res.stderr, /FAILED.*anchor/i, `stderr must name the anchor miss — stderr:\n${res.stderr}`);
    assert.deepEqual(newEntries(before), [], 'the partial copy must be REMOVED on exit 1 (no l2-variant-* residue)');
    // The seam is variant.sh-only: the real arms dir is untouched by the override.
    assert.equal(loadManifest('caveman').transforms[0].anchor, 'after a compaction."', 'the real caveman manifest must be unaffected by COMPAT_ARMS_DIR');
  } finally {
    fs.rmSync(armsDir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------- Test 8 (R4.3 exit 2)
test('8 (unsafe manifest): a text with a double quote / unknown kind / mismatched arm is refused with exit 2 before mktemp', { skip }, () => {
  const before = variantEntries();
  const armsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-vtest-arms-'));
  try {
    const cases = [
      { why: 'text with a double quote', mutate: (m) => { m.transforms[0].text += ' say "hi"'; } },
      { why: 'text with a backslash', mutate: (m) => { m.transforms[0].text += ' back\\slash'; } },
      { why: 'text with a tab', mutate: (m) => { m.transforms[0].text += '\ttabbed'; } },
      { why: 'text with a newline', mutate: (m) => { m.transforms[0].text += '\nsecond line'; } },
      { why: 'unknown transform kind', mutate: (m) => { m.transforms[0].kind = 'sed-script'; } },
      { why: 'arm != basename', mutate: (m) => { m.arm = 'terse'; } },
      { why: 'manifestSchema != 1', mutate: (m) => { m.manifestSchema = 2; } },
    ];
    for (const c of cases) {
      const m = loadManifest('caveman');
      c.mutate(m);
      fs.writeFileSync(path.join(armsDir, 'caveman.json'), JSON.stringify(m, null, 2));
      const res = runVariant(['caveman', '--commit=HEAD'], { COMPAT_ARMS_DIR: armsDir });
      assert.equal(res.status, 2, `${c.why}: must exit 2 (got ${res.status}) — stderr:\n${res.stderr}`);
      assert.equal(res.stdout, '', `${c.why}: nothing may be printed on stdout`);
      assert.deepEqual(newEntries(before), [], `${c.why}: refused BEFORE mktemp — no l2-variant-* directory may exist`);
    }
    fs.writeFileSync(path.join(armsDir, 'caveman.json'), '{ not json');
    const res = runVariant(['caveman', '--commit=HEAD'], { COMPAT_ARMS_DIR: armsDir });
    assert.equal(res.status, 2, `unparseable manifest: must exit 2 (got ${res.status}) — stderr:\n${res.stderr}`);
    assert.deepEqual(newEntries(before), [], 'unparseable manifest: no residue');
  } finally {
    fs.rmSync(armsDir, { recursive: true, force: true });
  }
});
