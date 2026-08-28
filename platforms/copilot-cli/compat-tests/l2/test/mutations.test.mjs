// mutations.test.mjs — Stage 1 negative control, Task Groups 1+2: credit-free scripted checks for
// the mutation builder l2/mutations/mutate.sh (spec R3.1-R3.4) and for run.sh's --mutation arm +
// the ADR-001 COMPAT_PROMPT_FILE prompt seam (spec R3.5-R3.8).
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
//   E. run.sh arg surface — `--mutation=bogus` is a parse-time, credit-free exit 2 (no verdict, no
//      SKIP banner); `--mutation=M1` with no seat keeps the existing SKIP (exit 0) and stages NO
//      mutant (staging is post-preflight); `-h` documents --mutation.
//   F. Cleanup registration — cleanup() removes a set MUTANT_DIR and returns 0 when it is empty
//      (guards the MANDATED if-form; the `[ -n … ] &&` one-liner would return 1); config-restore
//      behavior is unaffected.
//   G. Staging-failure path — a stubbed failing mutate.sh surfaces as
//      "L2 INCOMPLETE: mutation staging failed" on stderr with exit 2, NEVER exit 1 (which would
//      leak REGRESSED semantics).
//   H. Prompt-override plumbing (ADR-001, no session) — m1-neutral-prompt.txt meets its content
//      contract; run.mjs derives the drive prompt from COMPAT_PROMPT_FILE when set (source-level
//      assertion at the sendAndWait call site, build-integration source-check idiom); run.sh hands
//      COMPAT_PROMPT_FILE off ONLY for MUTATION=M1 (stub-harness behavioral assertion).
//   I. Explicit-source-arg happy path — `mutate.sh M1 <dir>` builds the mutant FROM that dir (a
//      marker file proves provenance; defaulting to the repo plugin would silently mutate the wrong
//      source), and a nonexistent source is the documented exit-2 "nothing created" reject.
//   J. Source-arg hand-off — run.sh passes its (COMPAT_PLUGIN_DIR-derived) PLUGIN_DIR to mutate.sh
//      as the source argument: an operator override must compose with --mutation, or the mutant
//      would be built from the default repo plugin while the report claims the override was tested.
//
// Idioms copied from run-sh.test.mjs: guard-before-spawn, spawnSync, mkdtemp + finally cleanup,
// no writes to reports/ or the repo.
//
// SAFETY (E-H): every run.sh spawn is either under NO_COPILOT_PATH (no copilot binary -> preflight
// SKIPs before any live hand-off) or against a THROWAWAY harness copy of run.sh whose run.mjs is a
// do-nothing stub — an accidental live session (credit spend) is impossible by construction.

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
        // Agent-registration knockout: renaming only the SKILL reference self-heals (the agent
        // stays registered under its frontmatter `name:`, observed live 2026-08), so M2 must ALSO
        // rename the registered names in the COPY — and leave the source agent files untouched
        // (Test C covers the source globally; this pins the agent-name lines explicitly).
        const gaCopy = read(mutant, 'agents/gap-analyzer.md');
        const gaSrc = read(SOURCE_PLUGIN, 'agents/gap-analyzer.md');
        const rpCopy = read(mutant, 'agents/research-planner.md');
        const rpSrc = read(SOURCE_PLUGIN, 'agents/research-planner.md');
        assert.match(gaCopy, /^name: gap-analyzer-renamed$/m, 'M2: copy gap-analyzer frontmatter name must be -renamed');
        assert.doesNotMatch(gaCopy, /^name: gap-analyzer$/m, 'M2: no bare gap-analyzer frontmatter name may remain in the copy');
        assert.match(rpCopy, /^name: research-planner-renamed$/m, 'M2: copy research-planner frontmatter name must be -renamed');
        assert.doesNotMatch(rpCopy, /^name: research-planner$/m, 'M2: no bare research-planner frontmatter name may remain in the copy');
        assert.match(gaSrc, /^name: gap-analyzer$/m, 'M2: SOURCE gap-analyzer frontmatter name must be unchanged');
        assert.ok(!gaSrc.includes('-renamed'), 'M2: SOURCE gap-analyzer.md must carry no -renamed');
        assert.match(rpSrc, /^name: research-planner$/m, 'M2: SOURCE research-planner frontmatter name must be unchanged');
        assert.ok(!rpSrc.includes('-renamed'), 'M2: SOURCE research-planner.md must carry no -renamed');
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

// ============================================================================ Task Group 2 (R3.5-R3.8)
const RUN_SH = path.join(L2_DIR, 'run.sh');
const RUN_MJS = path.join(L2_DIR, 'run.mjs');
const NEUTRAL_PROMPT = path.join(L2_DIR, 'mutations', 'm1-neutral-prompt.txt');

// Spawn the REAL run.sh under NO_COPILOT_PATH (run-sh.test.mjs:36-41 idiom, PATH always forced):
// with copilot invisible, the live path can never get past the seat preflight.
function runSh(args) {
  return spawnSync('bash', [RUN_SH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: NO_COPILOT_PATH },
  });
}

// Build a THROWAWAY run.sh harness dir: a verbatim copy of the real run.sh (so SCRIPT_DIR resolves
// to the harness) with a caller-provided mutations/mutate.sh STUB, a do-nothing run.mjs STUB that
// prints its env as one JSON line, minimal sandbox templates, a fake `copilot` binary and a fake
// operator config — so the LIVE path (preflight -> de-shadow -> mutation staging -> env hand-off)
// is exercised end-to-end with zero seat and zero credits (check-4's throwaway-helper idiom).
function makeRunShHarness(mutateStub) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-harness-'));
  fs.copyFileSync(RUN_SH, path.join(dir, 'run.sh'));
  fs.mkdirSync(path.join(dir, 'mutations'));
  fs.writeFileSync(path.join(dir, 'mutations', 'mutate.sh'), mutateStub);
  fs.writeFileSync(
    path.join(dir, 'run.mjs'),
    "process.stdout.write('STUB-RUN-MJS ' + JSON.stringify({" +
      ' promptFile: process.env.COMPAT_PROMPT_FILE ?? null,' +
      ' pluginDir: process.env.COMPAT_PLUGIN_DIR ?? null,' +
      " args: process.argv.slice(2) }) + '\\n');\n"
  );
  for (const t of ['sample-cli', 'sample-cli-bug']) {
    fs.mkdirSync(path.join(dir, 'sandbox', t), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sandbox', t, 'placeholder.txt'), 'harness sandbox\n');
  }
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'copilot'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // JSONC config with maister-copilot installed, so the de-shadow path genuinely runs.
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    '// fake operator config (harness)\n{\n  "installedPlugins": [\n' +
      '    { "name": "maister-copilot", "path": "/opt/plugins/maister-copilot" }\n  ]\n}\n'
  );
  fs.mkdirSync(path.join(dir, 'plugin-src'));
  return dir;
}

function runHarness(dir, args) {
  const env = {
    ...process.env,
    PATH: [path.join(dir, 'bin'), NO_COPILOT_PATH].join(':'), // fake copilot + node + coreutils ONLY
    COPILOT_CONFIG: path.join(dir, 'config.json'),
    COMPAT_PLUGIN_DIR: path.join(dir, 'plugin-src'),
    COMPAT_NO_SEAT: '0',
    COMPAT_KEEP_RUNDIR: '0',
  };
  delete env.COMPAT_PROMPT_FILE; // must only ever come from run.sh itself
  delete env.COMPAT_RUNDIR;
  return spawnSync('bash', [path.join(dir, 'run.sh'), ...args], { encoding: 'utf8', env });
}

function stubPayload(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('STUB-RUN-MJS '));
  assert.ok(line, `the stub run.mjs hand-off must have been reached; stdout:\n${stdout}`);
  return JSON.parse(line.slice('STUB-RUN-MJS '.length));
}

// -------------------------------------------------------------------------- Test E (R3.5)
test('E (run.sh arg surface): bogus id -> credit-free exit 2; M1 no-seat SKIP preserved, no mutant staged; -h documents --mutation', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  // Unknown mutation id: parse-time reject — exit 2, stderr names the id, and NEITHER a verdict NOR
  // a SKIP banner is rendered (the reject fires before --check-reference, preflight, any config write).
  let res = runSh(['--scenario=quick-bugfix', '--mutation=bogus']);
  assert.equal(res.status, 2, `--mutation=bogus must exit 2 (got ${res.status})\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /bogus/, 'stderr must name the bad mutation id');
  assert.doesNotMatch(res.stdout, /REGRESSED|AS-EXPECTED|CURRENT/, 'a bad-id reject must not render a verdict');
  assert.doesNotMatch(res.stdout, /SKIP/i, 'a bad-id reject must not render the SKIP banner');

  // Valid id, no seat: the existing loud SKIP (exit 0) is preserved, and because staging is
  // POST-preflight no l2-mutant-* dir may appear.
  const before = mutantEntries();
  res = runSh(['--scenario=quick-bugfix', '--mutation=M1']);
  assert.equal(res.status, 0, `no-seat --mutation=M1 must SKIP with exit 0 (got ${res.status})\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /\bSKIP\b/, 'the no-seat SKIP banner must still be printed');
  const created = mutantEntries().filter((n) => !before.includes(n));
  assert.deepEqual(created, [], 'a no-seat SKIP must stage NO mutant (staging is post-preflight)');

  // -h documents the new arm.
  res = runSh(['-h']);
  assert.equal(res.status, 0, `-h must exit 0 (got ${res.status})`);
  assert.match(res.stdout, /--mutation/, '-h must document --mutation');
});

// -------------------------------------------------------------------------- Test F (R3.6)
test('F (cleanup registration): cleanup() removes MUTANT_DIR; empty MUTANT_DIR returns 0; config-restore unaffected', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-cleanup-'));
  try {
    const fakeRundir = fs.mkdtempSync(path.join(tmp, 'rundir-'));
    const fakeMutant = fs.mkdtempSync(path.join(tmp, 'mutant-'));
    fs.writeFileSync(path.join(fakeMutant, 'SKILL.md'), 'mutant payload\n');
    // Throwaway config: NEUTRALIZED stays 0, so cleanup()'s restore_config must leave it untouched.
    const cfg = path.join(tmp, 'config.json');
    const cfgBytes = '{ "untouched": true }\n';
    fs.writeFileSync(cfg, cfgBytes);

    // Source run.sh via the source-guard (check-4 pattern) and drive the REAL cleanup() twice:
    // set -e makes any nonzero cleanup() return abort the helper — exactly the regression the
    // MANDATED if-form prevents (the `[ -n … ] &&` one-liner returns 1 on an empty MUTANT_DIR).
    const helper = path.join(tmp, 'cleanup-check.sh');
    fs.writeFileSync(helper, [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'source "$RUN_SH"                # source-guard returns; cleanup()/restore_config in scope',
      'RUNDIR="$FAKE_RUNDIR"           # cleanup() removes $RUNDIR (set -u: must be defined)',
      'COMPAT_KEEP_RUNDIR=0',
      'MUTANT_DIR="$FAKE_MUTANT"',
      'cleanup',
      'if [ -d "$FAKE_MUTANT" ]; then echo "FAIL: mutant dir survived cleanup" >&2; exit 21; fi',
      'MUTANT_DIR=""',
      'cleanup                          # empty MUTANT_DIR MUST return 0 (set -e aborts otherwise)',
      'echo "OK: mutant removed; cleanup rc=0 with MUTANT_DIR empty"',
      '',
    ].join('\n'));

    const res = spawnSync('bash', [helper], {
      encoding: 'utf8',
      env: { ...process.env, RUN_SH, FAKE_RUNDIR: fakeRundir, FAKE_MUTANT: fakeMutant, COPILOT_CONFIG: cfg },
    });

    assert.equal(res.status, 0, `cleanup helper failed (status ${res.status})\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`);
    assert.match(res.stdout, /cleanup rc=0 with MUTANT_DIR empty/, 'both cleanup() calls must succeed');
    assert.ok(!fs.existsSync(fakeMutant), 'the staged mutant dir must be removed by cleanup()');
    assert.equal(fs.readFileSync(cfg, 'utf8'), cfgBytes, 'config-restore behavior must be unaffected (file untouched)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------- Test G (R3.7)
test('G (staging-failure path): failing mutate.sh -> "L2 INCOMPLETE: mutation staging failed", exit 2, never 1', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  const dir = makeRunShHarness('#!/bin/sh\necho "stub mutate.sh: simulated builder failure" >&2\nexit 1\n');
  try {
    const res = runHarness(dir, ['--scenario=quick-bugfix', '--mutation=M1']);
    assert.notEqual(res.status, 1, `a failing builder must NEVER exit 1 (= REGRESSED semantics)\n${res.stdout}\n${res.stderr}`);
    assert.equal(res.status, 2, `a failing builder must surface as INCOMPLETE exit 2 (got ${res.status})\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /L2 INCOMPLETE: mutation staging failed/, 'the mandated INCOMPLETE line must be on stderr');
    // Staging failed -> the credit-spending hand-off must never be reached.
    assert.doesNotMatch(res.stdout, /driving one live/i, 'a failed staging must not hand off to a live run');
    assert.doesNotMatch(res.stdout, /STUB-RUN-MJS/, 'a failed staging must not reach run.mjs');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------- Test H (R3.8 / ADR-001)
test('H (prompt-override plumbing): neutral-prompt contract; run.mjs COMPAT_PROMPT_FILE seam; run.sh wires it ONLY for M1', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  // (a) m1-neutral-prompt.txt exists + content contract: restates the seeded bug, names the
  // workflow, and carries ZERO plan/approval pressure (the whole point of ADR-001).
  assert.ok(fs.existsSync(NEUTRAL_PROMPT), `neutral prompt file must exist: ${NEUTRAL_PROMPT}`);
  const prompt = fs.readFileSync(NEUTRAL_PROMPT, 'utf8');
  assert.match(prompt, /cli\.sh/, 'neutral prompt must mention cli.sh');
  assert.match(prompt, /\bupper\b/, 'neutral prompt must mention the upper command');
  assert.match(prompt, /HELLO/, 'neutral prompt must state the HELLO expectation');
  assert.match(prompt, /quick-bugfix workflow/, 'neutral prompt must name the quick-bugfix workflow');
  assert.doesNotMatch(prompt, /plan/i, 'neutral prompt must not match /plan/i (no plan pressure)');
  assert.doesNotMatch(prompt, /approv/i, 'neutral prompt must not match /approv/i (no approval pressure)');
  // "MUST NOT enumerate workflow steps": no numbered lists, no "Step N" phrasing.
  assert.doesNotMatch(prompt, /^\s*\d+[.)]\s/m, 'neutral prompt must not enumerate steps (numbered list)');
  assert.doesNotMatch(prompt, /step\s*\d/i, 'neutral prompt must not enumerate steps ("Step N")');

  // (b) run.mjs derives the drive prompt from COMPAT_PROMPT_FILE when set — source-level assertion
  // on the sendAndWait call site (build-integration source-check idiom; no session, no credits).
  const src = fs.readFileSync(RUN_MJS, 'utf8');
  const calls = src.match(/session\.sendAndWait\([^)]*\)/g) ?? [];
  assert.equal(calls.length, 1, `run.mjs must have exactly ONE session.sendAndWait call site (got ${calls.length})`);
  assert.doesNotMatch(calls[0], /sc\.prompt/, 'the drive call must not hardwire sc.prompt (must use the derived prompt)');
  assert.match(src, /readFileSync\(process\.env\.COMPAT_PROMPT_FILE,\s*'utf8'\)/, 'run.mjs must read the prompt from COMPAT_PROMPT_FILE (utf8) when set');
  assert.match(src, /=\s*sc\.prompt/, 'env unset must default to sc.prompt (byte-identical default path)');
  assert.match(src, /COMPAT_PROMPT_FILE[^\n]*unreadable/, 'a set-but-unreadable file must be a hard error, never a silent fallback');

  // (c) run.sh includes COMPAT_PROMPT_FILE in the env hand-off ONLY when MUTATION=M1 — behavioral
  // assertion via the stub harness (sourced-helper idiom): the stub run.mjs reports its env.
  const dir = makeRunShHarness(
    '#!/bin/sh\nd="$(mktemp -d "${TMPDIR:-/tmp}/l2-mutant-${1}-XXXXXX")"\necho "$d"\n'
  );
  try {
    // M1: staged + audit line + COMPAT_PROMPT_FILE handed off; mutant repoints the plugin dir.
    let res = runHarness(dir, ['--scenario=quick-bugfix', '--mutation=M1']);
    assert.equal(res.status, 0, `harness M1 run must exit 0 (got ${res.status})\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /NEGATIVE CONTROL: mutation M1 staged at /, 'the loud staging audit line must be on stdout');
    let payload = stubPayload(res.stdout);
    assert.ok(
      payload.promptFile && payload.promptFile.endsWith('/mutations/m1-neutral-prompt.txt'),
      `M1 hand-off must carry COMPAT_PROMPT_FILE -> mutations/m1-neutral-prompt.txt (got ${payload.promptFile})`
    );
    assert.match(path.basename(payload.pluginDir ?? ''), /^l2-mutant-M1-/, 'M1 hand-off must repoint the plugin dir at the staged mutant');
    assert.ok(!fs.existsSync(payload.pluginDir), 'the staged mutant must be cleaned up on exit (mutants are never kept)');

    // M2: staged, but NO COMPAT_PROMPT_FILE (the neutral prompt is M1-only).
    res = runHarness(dir, ['--scenario=quick-bugfix', '--mutation=M2']);
    assert.equal(res.status, 0, `harness M2 run must exit 0 (got ${res.status})\n${res.stdout}\n${res.stderr}`);
    payload = stubPayload(res.stdout);
    assert.equal(payload.promptFile, null, 'COMPAT_PROMPT_FILE must NOT be handed off for M2');
    assert.match(path.basename(payload.pluginDir ?? ''), /^l2-mutant-M2-/, 'M2 hand-off must repoint the plugin dir at the staged mutant');

    // Positive (no --mutation) run: no staging, no COMPAT_PROMPT_FILE, plugin dir untouched.
    res = runHarness(dir, ['--scenario=quick-bugfix']);
    assert.equal(res.status, 0, `harness positive run must exit 0 (got ${res.status})\n${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stdout, /NEGATIVE CONTROL/, 'a positive run must not print the staging audit line');
    payload = stubPayload(res.stdout);
    assert.equal(payload.promptFile, null, 'positive runs must NEVER set COMPAT_PROMPT_FILE');
    assert.equal(payload.pluginDir, path.join(dir, 'plugin-src'), 'a positive run must keep the original plugin dir');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------- Test I (gap-fill: explicit source arg)
// Test D exercises the explicit source arg only on the DOCTORED-failure path; this pins the happy
// path — the mutant must be built FROM the explicit source (marker-file provenance) — and the
// missing-source exit-2 reject (mutate.sh usage contract: exit 2 = nothing created).
test('I (explicit source arg): mutant is built from the given dir, not the default; missing source -> exit 2, nothing created', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  const customSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-custom-src-'));
  let mutant = '';
  try {
    fs.cpSync(SOURCE_PLUGIN, customSrc, { recursive: true });
    // Provenance marker: present ONLY in the custom source, never in the repo plugin.
    fs.writeFileSync(path.join(customSrc, 'CUSTOM-SOURCE-MARKER.txt'), 'explicit-source provenance\n');

    const res = runMutate(['M1', customSrc]);
    assert.equal(res.status, 0, `M1 with explicit source must exit 0 (got ${res.status}) — stderr:\n${res.stderr}`);
    const lines = res.stdout.split('\n').filter((l) => l.length > 0);
    assert.equal(lines.length, 1, `stdout must be exactly one line, got:\n${res.stdout}`);
    mutant = lines[0];

    // Built from the EXPLICIT source: the marker made it into the copy...
    assert.ok(
      fs.existsSync(path.join(mutant, 'CUSTOM-SOURCE-MARKER.txt')),
      'mutant must carry the custom-source marker (built from the explicit source, not the default)'
    );
    // ...and the mutation targeted the copy of THAT source, leaving the custom source unwritten.
    assert.doesNotMatch(read(mutant, 'skills/quick-bugfix/SKILL.md'), /EnterPlanMode|ExitPlanMode/, 'M1 strip applied in the copy');
    assert.match(read(customSrc, 'skills/quick-bugfix/SKILL.md'), /EnterPlanMode/, 'the explicit source itself must stay unmutated');

    // Nonexistent source: documented exit-2 reject, nothing created (mutate.sh:55-56 branch).
    const before = mutantEntries();
    const bad = runMutate(['M1', path.join(customSrc, 'no-such-dir')]);
    assert.equal(bad.status, 2, `missing source must exit 2 (got ${bad.status}) — stderr:\n${bad.stderr}`);
    assert.equal(bad.stdout, '', 'missing source must print nothing to stdout');
    assert.deepEqual(mutantEntries().filter((n) => !before.includes(n)), [], 'missing source must create no l2-mutant-* dir');
  } finally {
    if (mutant) fs.rmSync(mutant, { recursive: true, force: true });
    fs.rmSync(customSrc, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------- Test J (gap-fill: run.sh source hand-off)
// Test H proves run.sh repoints the plugin dir AT the stub's mutant, but its stub ignores $2 — so
// nothing yet fails if run.sh stops passing PLUGIN_DIR to mutate.sh (the builder would silently
// fall back to the repo default while the operator believes their COMPAT_PLUGIN_DIR override is
// under test). This stub records its argv; the assertion pins the --mutation x COMPAT_PLUGIN_DIR
// composition.
test('J (source-arg hand-off): run.sh passes the COMPAT_PLUGIN_DIR-derived plugin dir to mutate.sh as the source', () => {
  assert.ok(!copilotVisibleUnder(NO_COPILOT_PATH), 'test setup: copilot must be absent from NO_COPILOT_PATH');

  // Stub mutate.sh: record "$@" beside the harness root ($0 = <dir>/mutations/mutate.sh), then
  // behave like the real builder (one-line mutant path on stdout).
  const dir = makeRunShHarness([
    '#!/bin/sh',
    'root="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"',
    'printf \'%s\\n\' "$@" > "$root/mutate-args.txt"',
    'd="$(mktemp -d "${TMPDIR:-/tmp}/l2-mutant-${1}-XXXXXX")"',
    'echo "$d"',
    '',
  ].join('\n'));
  try {
    const res = runHarness(dir, ['--scenario=quick-bugfix', '--mutation=M2']);
    assert.equal(res.status, 0, `harness M2 run must exit 0 (got ${res.status})\n${res.stdout}\n${res.stderr}`);
    const argsFile = path.join(dir, 'mutate-args.txt');
    assert.ok(fs.existsSync(argsFile), 'the mutate.sh stub must have been invoked (args file missing)');
    const argv = fs.readFileSync(argsFile, 'utf8').split('\n').filter((l) => l.length > 0);
    assert.deepEqual(
      argv,
      ['M2', path.join(dir, 'plugin-src')],
      'mutate.sh must receive <id> + the COMPAT_PLUGIN_DIR-derived PLUGIN_DIR as its source argument'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
