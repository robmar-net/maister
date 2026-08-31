// Credit-free RUNDIR-FIXTURE tests for the L2 functional oracle `outcome(<id>)=pass|fail`
// (issue #48, Stage 2). Run ONLY this file:
//   node --test platforms/copilot-cli/compat-tests/l2/test/outcome-rundir.test.mjs
//
// Where outcome.test.mjs proves the GRAMMAR / floor plumbing with hermetic `restage:[]` specs,
// THIS file proves the oracle actually RUNS a produced deliverable in a real throwaway rundir and
// that the restage (MEDIUM-5) makes it tamper-resistant. Each test builds an os.tmpdir() rundir via
// `fs.mkdtempSync` + `finally rmSync` (extractor.test.mjs T7 idiom), cpSync's a committed sandbox
// template into it, mutates it like a workflow would, then drives extract()/normalize()/compare().
//
// The five tests PROVE, end to end over live rundirs:
//   1. passing sandbox   -> outcome(bug-fixed)=pass   (fix applied, trusted runner green)
//   2. failing sandbox   -> REGRESSED                 (seeded bug -> failing deliverable is the regression)
//   3. restage / tamper  -> still fail (MEDIUM-5)      (a `run-tests.sh`=`exit 0` tamper is defeated)
//   4. research assertion both directions             (real report+synthesis pass; degenerate/absent fail)
//   5. dev-oracle detection both directions (HIGH-3)  (pristine sample-cli fails; --greet impl passes)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../extractor.mjs';
import { normalize } from '../normalize.mjs';
import { compare, EXIT } from '../compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L2_DIR = path.resolve(__dirname, '..');
const SANDBOX = path.join(L2_DIR, 'sandbox');
const CLI_BUG = path.join(SANDBOX, 'sample-cli-bug');
const CLI_OK = path.join(SANDBOX, 'sample-cli');

const QUICK_BUGFIX_REF = JSON.parse(
  fs.readFileSync(path.join(L2_DIR, 'reference', 'quick-bugfix.skeleton.json'), 'utf8'),
);

// ---- helpers -------------------------------------------------------------
const mkRundir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'l2-rundir-'));
const outcomeRecord = (ex) => ex.records.find((r) => r.kind === 'outcome');

// The seeded bug in sample-cli-bug/cli.sh: `upper` lower-cases. The workflow "fix" flips the tr set.
const BUG_TR = "tr '[:upper:]' '[:lower:]'";
const FIX_TR = "tr '[:lower:]' '[:upper:]'";

// =========================================================================
// 1. Passing sandbox -> outcome(bug-fixed)=pass
// =========================================================================

test('rundir passing sandbox: cmd_upper fix + trusted restaged runner -> outcome(bug-fixed)=pass', () => {
  const rundir = mkRundir();
  try {
    fs.cpSync(CLI_BUG, rundir, { recursive: true });

    // Apply the deliverable FIX a workflow would make: rewrite cli.sh so `upper` upper-cases.
    const cliPath = path.join(rundir, 'cli.sh');
    const before = fs.readFileSync(cliPath, 'utf8');
    assert.ok(before.includes(BUG_TR), 'guard: the seeded bug must be present pre-fix');
    fs.writeFileSync(cliPath, before.replace(BUG_TR, FIX_TR));

    const ex = extract({
      taskDirRoot: rundir,
      outcome: [{ id: 'bug-fixed', command: 'sh run-tests.sh', restage: ['run-tests.sh'] }],
      sandboxTemplateDir: CLI_BUG,
    });

    const rec = outcomeRecord(ex);
    assert.ok(rec, 'an outcome record must be emitted');
    assert.equal(rec.value, 'pass', `expected pass, got ${rec.value} (${rec.evidence})`);

    const observed = normalize(ex.records);
    assert.ok(observed.has('outcome(bug-fixed)=pass'), 'normalized skeleton must carry the pass token');
  } finally {
    fs.rmSync(rundir, { recursive: true, force: true });
  }
});

// =========================================================================
// 2. Failing sandbox -> REGRESSED against the committed quick-bugfix reference
// =========================================================================

test('rundir failing sandbox: seeded bug -> outcome=fail -> compare(quick-bugfix ref) REGRESSED', () => {
  const rundir = mkRundir();
  try {
    // UNMODIFIED sample-cli-bug: the `upper` bug survives, so the trusted runner fails.
    fs.cpSync(CLI_BUG, rundir, { recursive: true });

    const ex = extract({
      taskDirRoot: rundir,
      outcome: [{ id: 'bug-fixed', command: 'sh run-tests.sh', restage: ['run-tests.sh'] }],
      sandboxTemplateDir: CLI_BUG,
    });

    const rec = outcomeRecord(ex);
    assert.ok(rec && rec.value === 'fail', `expected fail, got ${rec && rec.value} (${rec && rec.evidence})`);

    const observed = normalize(ex.records);
    assert.ok(observed.has('outcome(bug-fixed)=fail'), 'observed skeleton carries the fail token');

    const result = compare(observed, QUICK_BUGFIX_REF);
    assert.equal(result.overall, 'REGRESSED', 'a failing deliverable must REGRESS against the golden');
    assert.equal(result.exitCode, EXIT.REGRESSED, 'REGRESSED must map to exit 1');

    // The regression is specifically the required pass token going missing (the deliverable did not work).
    assert.ok(
      result.diffs.some((d) => d.predicate === 'outcome(bug-fixed)=pass' && d.side === 'missing'),
      'the missing required outcome(bug-fixed)=pass must be the regression',
    );
  } finally {
    fs.rmSync(rundir, { recursive: true, force: true });
  }
});

// =========================================================================
// 3. Restage / tamper-resistance (MEDIUM-5)
// =========================================================================

test('rundir tamper (MEDIUM-5): run-tests.sh overwritten with `exit 0` over a broken cli.sh -> restage defeats it -> fail', () => {
  const rundir = mkRundir();
  try {
    // Broken deliverable (seeded bug intact) + a tampered runner the model rewrote to always pass.
    fs.cpSync(CLI_BUG, rundir, { recursive: true });
    fs.writeFileSync(path.join(rundir, 'run-tests.sh'), '#!/bin/sh\n# neutered by the model\nexit 0\n');

    // CONTROL: WITHOUT restage the tamper WINS (proves the tampered script is really `exit 0`, and
    // that restage — not some other effect — is what defeats it).
    const tampered = extract({
      taskDirRoot: rundir,
      outcome: [{ id: 'bug-fixed', command: 'sh run-tests.sh', restage: [] }],
      sandboxTemplateDir: CLI_BUG,
    });
    assert.equal(outcomeRecord(tampered).value, 'pass', 'sanity: without restage the tampered exit-0 runner passes');

    // Re-seed the tamper (the control run left the tampered file in place; keep the intent explicit).
    fs.writeFileSync(path.join(rundir, 'run-tests.sh'), '#!/bin/sh\n# neutered by the model\nexit 0\n');

    // REAL PATH: restage the trusted committed run-tests.sh over the tamper, then run it against the
    // still-broken cli.sh -> the real checks run and FAIL. The model cannot neuter its own oracle.
    const ex = extract({
      taskDirRoot: rundir,
      outcome: [{ id: 'bug-fixed', command: 'sh run-tests.sh', restage: ['run-tests.sh'] }],
      sandboxTemplateDir: CLI_BUG,
    });
    assert.equal(outcomeRecord(ex).value, 'fail', 'restage of the trusted runner must defeat the tamper -> fail');
  } finally {
    fs.rmSync(rundir, { recursive: true, force: true });
  }
});

// =========================================================================
// 4. Research assertion — both directions
// =========================================================================

test('rundir research assertion: real report+synthesis -> pass; degenerate report OR missing synthesis -> fail', () => {
  const rundir = mkRundir();
  try {
    const taskDir = path.join(rundir, '.maister', 'tasks', 'research', '2026-08-29-l2-oracle');
    const outputs = path.join(taskDir, 'outputs');
    const analysis = path.join(taskDir, 'analysis');
    fs.mkdirSync(outputs, { recursive: true });
    fs.mkdirSync(analysis, { recursive: true });

    const reportPath = path.join(outputs, 'research-report.md');
    const synthesisPath = path.join(analysis, 'synthesis.md');

    // A non-trivial report: >=200 bytes, >=5 non-blank lines, >=1 markdown heading.
    const goodReport = [
      '# Research Report: L2 Functional Oracle',
      '',
      '## Findings',
      'The functional oracle runs the produced deliverable in a throwaway rundir.',
      'It restages the trusted runner so the model cannot neuter its own test.',
      'A failing deliverable is REGRESSED, never a silent INCOMPLETE.',
      '',
      '## Conclusion',
      'The rundir-fixture tests prove real detection power without spending a Copilot seat.',
      '',
    ].join('\n');
    assert.ok(Buffer.byteLength(goodReport, 'utf8') >= 200, 'guard: fixture report must clear minBytes');
    fs.writeFileSync(reportPath, goodReport);
    fs.writeFileSync(synthesisPath, '# Synthesis\n\nCross-referenced findings into an actionable conclusion.\n');

    const spec = [{ id: 'report-produced', assert: 'research-deliverables', params: { minBytes: 200, minNonBlankLines: 5 } }];

    // (a) Real deliverables present -> pass.
    const pass = extract({ taskDirRoot: rundir, taskType: 'research', outcome: spec });
    assert.equal(outcomeRecord(pass).value, 'pass', `expected pass (${outcomeRecord(pass).evidence})`);
    assert.ok(normalize(pass.records).has('outcome(report-produced)=pass'), 'skeleton carries the pass token');

    // (b) Degenerate one-line report -> fail (too few non-blank lines / too small).
    fs.writeFileSync(reportPath, '# only a heading\n');
    const failThin = extract({ taskDirRoot: rundir, taskType: 'research', outcome: spec });
    assert.equal(outcomeRecord(failThin).value, 'fail', 'a one-line report must fail the content assertion');

    // (c) Real report but MISSING synthesis -> fail (synthesize phase corroboration absent).
    fs.writeFileSync(reportPath, goodReport);
    fs.rmSync(synthesisPath);
    const failNoSynth = extract({ taskDirRoot: rundir, taskType: 'research', outcome: spec });
    assert.equal(outcomeRecord(failNoSynth).value, 'fail', 'missing analysis/synthesis.md must fail the assertion');
    assert.match(outcomeRecord(failNoSynth).evidence, /synthesis/i, 'evidence must name the missing synthesis');
  } finally {
    fs.rmSync(rundir, { recursive: true, force: true });
  }
});

// =========================================================================
// 5. Dev-oracle detection power (HIGH-3) — both directions
// =========================================================================

test('rundir dev-oracle (HIGH-3): pristine sample-cli (no --greet) -> fail; cli.sh implementing --greet -> pass', () => {
  const rundir = mkRundir();
  try {
    // Pristine sample-cli: `cli.sh` has NO `--greet`; the trusted runner's greet check must fail it.
    fs.cpSync(CLI_OK, rundir, { recursive: true });
    const cliPath = path.join(rundir, 'cli.sh');
    assert.ok(!fs.readFileSync(cliPath, 'utf8').includes('cmd_greet'), 'guard: pristine cli.sh has no --greet');

    const spec = [{ id: 'tests-pass', command: 'sh run-tests.sh', restage: ['run-tests.sh'] }];

    const fail = extract({ taskDirRoot: rundir, outcome: spec, sandboxTemplateDir: CLI_OK });
    assert.equal(outcomeRecord(fail).value, 'fail', 'pristine sample-cli must FAIL the greet deliverable check');

    // Implement the deliverable in the rundir's cli.sh: a `--greet <name>` -> "Hello, <name>!".
    const cli = fs.readFileSync(cliPath, 'utf8');
    const withGreet = cli
      .replace('cmd_hello() {', "cmd_greet() {\n  printf 'Hello, %s!\\n' \"${1-}\"\n}\n\ncmd_hello() {")
      .replace('  case "$command" in', '  case "$command" in\n    --greet)           cmd_greet "${1-}" ;;');
    assert.ok(withGreet.includes('cmd_greet') && withGreet.includes('--greet)'), 'guard: --greet was wired in');
    fs.writeFileSync(cliPath, withGreet);

    const pass = extract({ taskDirRoot: rundir, outcome: spec, sandboxTemplateDir: CLI_OK });
    assert.equal(outcomeRecord(pass).value, 'pass', `implementing --greet must PASS the oracle (${outcomeRecord(pass).evidence})`);
    assert.ok(normalize(pass.records).has('outcome(tests-pass)=pass'), 'skeleton carries the pass token');
  } finally {
    fs.rmSync(rundir, { recursive: true, force: true });
  }
});

// =========================================================================
// 6. #88 product-correctness: outcome(greet-edges) both directions
//    A restaged edge oracle (run-edge-tests.sh) over the SAME --greet deliverable:
//    multi-word preserved + bare --greet fails with usage. Correct impl -> pass (2/2);
//    a bare-broken impl ("Hello, !" exit 0) -> fail (1/2). Kept separate from tests-pass.
// =========================================================================

const greetRec = (ex) => ex.records.find((r) => r.kind === 'outcome' && r.name === 'greet-edges');
const GREET_SPEC = [{ id: 'greet-edges', command: 'sh run-edge-tests.sh', restage: ['run-edge-tests.sh'] }];

test('#88 greet-edges: correct --greet (errors on missing name) -> pass (2/2), tally in evidence', () => {
  const rundir = mkRundir();
  try {
    fs.cpSync(CLI_OK, rundir, { recursive: true });
    const cliPath = path.join(rundir, 'cli.sh');
    const cli = fs.readFileSync(cliPath, 'utf8');
    // A CORRECT impl: preserve the whole name; bare --greet -> usage on stderr + non-zero exit.
    const good = "cmd_greet() {\n  if [ \"$#\" -eq 0 ] || [ -z \"${1-}\" ]; then\n    printf 'usage: cli.sh --greet <name>\\n' >&2\n    return 2\n  fi\n  printf 'Hello, %s!\\n' \"$1\"\n}\n\ncmd_hello() {";
    const withGreet = cli
      .replace('cmd_hello() {', good)
      .replace('  case "$command" in', '  case "$command" in\n    --greet)           cmd_greet "${1-}" ;;');
    fs.writeFileSync(cliPath, withGreet);
    const ex = extract({ taskDirRoot: rundir, outcome: GREET_SPEC, sandboxTemplateDir: CLI_OK });
    assert.equal(greetRec(ex).value, 'pass', `correct impl must pass (${greetRec(ex).evidence})`);
    assert.match(greetRec(ex).evidence, /2\/2 checks/, 'evidence carries the k/N tally');
  } finally { fs.rmSync(rundir, { recursive: true, force: true }); }
});

test('#88 greet-edges: bare-broken --greet ("Hello, !" exit 0) -> fail (1/2), NOT via tests-pass', () => {
  const rundir = mkRundir();
  try {
    fs.cpSync(CLI_OK, rundir, { recursive: true });
    const cliPath = path.join(rundir, 'cli.sh');
    const cli = fs.readFileSync(cliPath, 'utf8');
    // A BARE-BROKEN impl: multi-word ok, but bare --greet prints "Hello, !" and exits 0 (no usage).
    const broken = "cmd_greet() {\n  printf 'Hello, %s!\\n' \"${1-}\"\n}\n\ncmd_hello() {";
    const withGreet = cli
      .replace('cmd_hello() {', broken)
      .replace('  case "$command" in', '  case "$command" in\n    --greet)           cmd_greet "${1-}" ;;');
    fs.writeFileSync(cliPath, withGreet);
    const ex = extract({ taskDirRoot: rundir, outcome: GREET_SPEC, sandboxTemplateDir: CLI_OK });
    assert.equal(greetRec(ex).value, 'fail', `bare-broken impl must fail (${greetRec(ex).evidence})`);
    assert.match(greetRec(ex).evidence, /1\/2 checks/, 'evidence shows 1/2 (multi-word ok, bare broken)');
  } finally { fs.rmSync(rundir, { recursive: true, force: true }); }
});
