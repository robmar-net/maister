// mutations.test.mjs — Stage 1 negative control, Task Group 1: credit-free scripted checks for the
// mutation builder l2/mutations/mutate.sh (spec R3.1-R3.4).
//
// mutate.sh manufactures a KNOWN-BROKEN copy of the plugin (M1 gate-removed / M2 delegation-renamed /
// M3 artifact-suppressed) so a later gate can prove the L2 conformance harness actually DETECTS
// breakage. These tests pin the builder's contract:
//   A. Setup guard — `copilot` is invisible under NO_COPILOT_PATH, asserted BEFORE any spawn, and
//      every mutate.sh spawn runs under that PATH: an accidental live session (credit spend) is
//      impossible by construction, even though the builder never should invoke copilot.
//   B. Happy path per id (M1/M2/M3, real plugins/maister-copilot as source) — exit 0, stdout is
//      EXACTLY one line (the mutant path; run.sh captures it with `$(...)`, so any extra chatter on
//      stdout corrupts the path), dir under os.tmpdir() named l2-mutant-<ID>-*, the mutation applied
//      in the COPY and absent in the SOURCE, M1's non-target guards intact (proves the strip range
//      was surgical, not greedy), and the plugin name unchanged (Copilot must still load the mutant
//      under the real name or the negative control tests nothing).
//   C. Zero-touch proof — a recursive content digest of the REAL plugin is identical before/after
//      every invocation: the builder must never write the source, only the copy.
//   D. Fail-closed — bad usage exits 2 with nothing created; a source whose M1 anchor is missing
//      exits 1 AND leaves no l2-mutant-* residue (a half-mutated copy that survives would poison a
//      later run.sh staging with an undefined mutation).
//
// Idioms copied from run-sh.test.mjs: guard-before-spawn, spawnSync, mkdtemp + finally cleanup,
// no writes to reports/ or the repo.

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
const MUTATE_SH = path.join(L2_DIR, 'mutations', 'mutate.sh');
const SOURCE_PLUGIN = path.join(REPO_ROOT, 'plugins', 'maister-copilot');

// A PATH that keeps node + coreutils but HIDES `copilot` (verbatim run-sh.test.mjs:33-34 idiom).
const NODE_BIN_DIR = path.dirname(process.execPath);
const NO_COPILOT_PATH = [NODE_BIN_DIR, '/usr/bin', '/bin'].join(':');

function copilotVisibleUnder(p) {
  const r = spawnSync('bash', ['-c', 'command -v copilot || true'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: p },
  });
  return r.stdout.trim().length > 0;
}

function runMutate(args) {
  return spawnSync('bash', [MUTATE_SH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: NO_COPILOT_PATH },
  });
}

const read = (...segs) => fs.readFileSync(path.join(...segs), 'utf8');
const countOf = (text, needle) => text.split(needle).length - 1;

// Recursive content digest: sorted relative paths + per-file sha256, hashed together. Any file
// added, removed, renamed, or edited under the tree changes the digest.
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

const mutantEntries = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('l2-mutant-'));

// -------------------------------------------------------------------------- Test A (R3.1)
test('A (setup guard): copilot is not visible under NO_COPILOT_PATH', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');
});

// -------------------------------------------------------------------------- Test B (R3.2)
test('B (happy path): M1/M2/M3 against the real plugin — one-line path, mutation in copy only, guards intact', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  for (const id of ['M1', 'M2', 'M3']) {
    const res = runMutate([id]);
    assert.equal(res.status, 0, `${id}: mutate.sh must exit 0 (got ${res.status}) — stderr:\n${res.stderr}`);

    // stdout is EXACTLY one line: the absolute mutant path (run.sh captures it with $(...)).
    const stdoutLines = res.stdout.split('\n').filter((l) => l.length > 0);
    assert.equal(stdoutLines.length, 1, `${id}: stdout must be exactly one line, got:\n${res.stdout}`);
    const mutant = stdoutLines[0];

    try {
      assert.ok(path.isAbsolute(mutant), `${id}: printed path must be absolute: ${mutant}`);
      assert.ok(fs.statSync(mutant).isDirectory(), `${id}: printed path must be a directory`);
      assert.equal(
        fs.realpathSync(path.dirname(mutant)),
        fs.realpathSync(os.tmpdir()),
        `${id}: mutant must live directly under os.tmpdir()`
      );
      assert.match(path.basename(mutant), new RegExp(`^l2-mutant-${id}-`), `${id}: dir name is the report-annotation channel`);

      if (id === 'M1') {
        const copy = read(mutant, 'skills/quick-bugfix/SKILL.md');
        const src = read(SOURCE_PLUGIN, 'skills/quick-bugfix/SKILL.md');
        // Mutation applied in copy, absent in source.
        assert.doesNotMatch(copy, /EnterPlanMode|ExitPlanMode/, 'M1: copy must have zero plan-mode tool mentions');
        assert.match(src, /EnterPlanMode/, 'M1: source must still mention EnterPlanMode');
        assert.match(src, /ExitPlanMode/, 'M1: source must still mention ExitPlanMode');
        // Guards intact — the strip must be surgical (Step 4 range only), never greedy.
        assert.match(copy, /^### Step 5: TDD Red Gate$/m, 'M1: Step 5 heading must survive');
        assert.equal(
          countOf(copy, 'ask_user'),
          countOf(src, 'ask_user'),
          'M1: ask_user count in copy must equal the runtime-measured source count'
        );
        for (const guard of ['no argument AND no bug context', 'more complex than a quick fix', 'The reproduction test passes']) {
          assert.ok(copy.includes(guard), `M1: site guard string must survive: "${guard}"`);
        }
      } else if (id === 'M2') {
        const devCopy = read(mutant, 'skills/development/SKILL.md');
        const devSrc = read(SOURCE_PLUGIN, 'skills/development/SKILL.md');
        const resCopy = read(mutant, 'skills/research/SKILL.md');
        const resSrc = read(SOURCE_PLUGIN, 'skills/research/SKILL.md');
        const devAnchor = '1. task tool - `maister-copilot:gap-analyzer` subagent';
        const devMutated = '1. task tool - `maister-copilot:gap-analyzer-renamed` subagent';
        const resAnchor = '**INVOKE NOW**: Use task tool with `agent_type: maister-copilot:research-planner`';
        const resMutated = '**INVOKE NOW**: Use task tool with `agent_type: maister-copilot:research-planner-renamed`';
        assert.ok(devCopy.includes(devMutated), 'M2: development anchored line must carry -renamed target');
        assert.ok(!devCopy.includes(devAnchor), 'M2: development original anchored line must be gone from the copy');
        assert.ok(devSrc.includes(devAnchor) && !devSrc.includes('-renamed'), 'M2: development source must be intact');
        assert.ok(resCopy.includes(resMutated), 'M2: research anchored line must carry -renamed target');
        assert.ok(!resCopy.includes(resAnchor + '\n'), 'M2: research original anchored line must be gone from the copy');
        assert.ok(resSrc.includes(resAnchor) && !resSrc.includes('-renamed'), 'M2: research source must be intact');
      } else {
        const devCopy = read(mutant, 'skills/development/SKILL.md');
        const devSrc = read(SOURCE_PLUGIN, 'skills/development/SKILL.md');
        const resCopy = read(mutant, 'skills/research/SKILL.md');
        const resSrc = read(SOURCE_PLUGIN, 'skills/research/SKILL.md');
        const specLine = '6. task tool - `maister-copilot:specification-creator` subagent';
        const synthLine = '- Comprehensive research report answering research question (`outputs/research-report.md`)';
        // The two anchored deletions.
        assert.ok(!devCopy.includes(specLine), 'M3: specification-creator delegation line must be deleted from copy');
        assert.ok(!resCopy.includes(synthLine), 'M3: synthesizer report bullet must be deleted from copy');
        // The two anchored token removals (check the anchored LINE, not the whole file — other
        // legitimate mentions of the artifacts survive by design; spec R1 "surviving sites").
        const outLine = devCopy.split('\n').filter((l) => l.startsWith('**Output**:') && l.includes('implementation/spec.md'));
        assert.equal(outLine.length, 0, 'M3: no **Output**: line in the copy may still list implementation/spec.md');
        const artLine = resCopy.split('\n').filter((l) => l.startsWith('**Artifacts**:') && l.includes('outputs/research-report.md'));
        assert.equal(artLine.length, 0, 'M3: no **Artifacts**: line in the copy may still list outputs/research-report.md');
        // Each token/line still present in the SOURCE.
        assert.ok(devSrc.includes(specLine), 'M3: source delegation line intact');
        assert.ok(resSrc.includes(synthLine), 'M3: source synthesizer bullet intact');
        assert.ok(
          devSrc.split('\n').some((l) => l.startsWith('**Output**:') && l.includes('implementation/spec.md')),
          'M3: source **Output**: line intact'
        );
        assert.ok(
          resSrc.split('\n').some((l) => l.startsWith('**Artifacts**:') && l.includes('outputs/research-report.md')),
          'M3: source **Artifacts**: line intact'
        );
      }

      // All-ids invariant: mutant still loads under the REAL plugin name.
      const pluginJson = JSON.parse(read(mutant, '.claude-plugin/plugin.json'));
      assert.equal(pluginJson.name, 'maister-copilot', `${id}: plugin name must remain maister-copilot`);
    } finally {
      fs.rmSync(mutant, { recursive: true, force: true });
    }
  }
});

// -------------------------------------------------------------------------- Test C (R3.3)
test('C (zero-touch): source plugin digest identical before vs after each invocation', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  for (const id of ['M1', 'M2', 'M3']) {
    const before = digestDir(SOURCE_PLUGIN);
    const res = runMutate([id]);
    const mutant = res.stdout.trim();
    try {
      assert.equal(res.status, 0, `${id}: mutate.sh must exit 0 — stderr:\n${res.stderr}`);
      assert.equal(digestDir(SOURCE_PLUGIN), before, `${id}: the real plugins/maister-copilot must be byte-identical after mutate.sh`);
    } finally {
      if (mutant) fs.rmSync(mutant, { recursive: true, force: true });
    }
  }
});

// -------------------------------------------------------------------------- Test D (R3.4)
test('D (fail-closed): bad usage exits 2 with nothing created; missing anchor exits 1 with no residue', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  // Usage errors -> exit 2, nothing created.
  for (const args of [[], ['M9']]) {
    const before = mutantEntries();
    const res = runMutate(args);
    assert.equal(res.status, 2, `mutate.sh ${JSON.stringify(args)} must exit 2 (got ${res.status})`);
    assert.equal(res.stdout, '', `mutate.sh ${JSON.stringify(args)} must print nothing to stdout`);
    const created = mutantEntries().filter((n) => !before.includes(n));
    assert.deepEqual(created, [], `mutate.sh ${JSON.stringify(args)} must create no l2-mutant-* dir`);
  }

  // Doctored source: M1's Step-4 anchor removed -> anchor pre-check must fail CLOSED: exit 1 and
  // the partial copy removed (no l2-mutant-* residue from this invocation).
  const doctored = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-doctored-'));
  try {
    fs.cpSync(SOURCE_PLUGIN, doctored, { recursive: true });
    const skill = path.join(doctored, 'skills/quick-bugfix/SKILL.md');
    const withoutAnchor = fs
      .readFileSync(skill, 'utf8')
      .split('\n')
      .filter((l) => l !== '### Step 4: Enter Planning Mode')
      .join('\n');
    fs.writeFileSync(skill, withoutAnchor);

    const before = mutantEntries();
    const res = runMutate(['M1', doctored]);
    assert.equal(res.status, 1, `doctored source must exit 1 (got ${res.status}) — stderr:\n${res.stderr}`);
    const created = mutantEntries().filter((n) => !before.includes(n));
    assert.deepEqual(created, [], 'a failed mutation must remove its partial copy (no l2-mutant-* residue)');
  } finally {
    fs.rmSync(doctored, { recursive: true, force: true });
  }
});
