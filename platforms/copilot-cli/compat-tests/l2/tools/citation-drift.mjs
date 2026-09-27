// citation-drift.mjs — the L2 provenance check that `--check-reference` structurally cannot do (#157).
//
// WHY THIS EXISTS. Every L2 reference is derived from the workflow text, and each derivation cites the
// exact SOURCE LINE its predicate came from. Those citations are prose in `*.derivation.md`, so the
// reference hash does not cover them: an upstream merge can reflow a SKILL.md and leave every citation
// pointing at the wrong line while `--check-reference` still reports CURRENT with hashes verified. That
// is exactly what happened in the v2.2.4 sync (#156) — 23 citations silently wrong, six references green
// throughout. A green suite over rotting provenance is the "silent green" AGENTS.md exists to prevent,
// so the drift gets its own guard.
//
// THE CORRECT ASSERTION, and two traps on the way to it. What must hold, per citation, is:
//
//     source@base[OLD_line] == source@worktree[NEW_line]
//
// i.e. the line a citation USED to name must be the line it names NOW.
//
//   Trap 1 — comparing the cited line before vs after (`source@base[N] == source@worktree[N]`) reports
//   every CORRECTLY re-anchored citation as still broken, because a new number legitimately names
//   different content than the old number did.
//
//   Trap 2 — taking OLD_line and NEW_line to be the same number. They are only equal on the first run,
//   before anything is fixed. So the tool reads the DERIVATION at `--base` too, and pairs its citations
//   POSITIONALLY with the working tree's: the Nth citation there is the Nth citation here. A count
//   mismatch means the pairing is unsound (a citation was added or removed), and the reference is
//   reported MISALIGNED rather than mis-paired — never silently zipped short.
//
// Getting this wrong is not hypothetical: the first cut of this tool fell into trap 2 and reported 20
// false drifts against the already-fixed v2.2.4 tree. The unit tests pin both traps.
//
// NEVER GUESS. When the cited content cannot be located uniquely in the new file, this tool refuses and
// says so (AMBIGUOUS / GONE). It does not re-anchor to a nearby heading — a plausible-looking wrong
// citation is worse than a loud unresolved one.
//
// Citations are resolved through each derivation's own declared `Source (read-only citation source)`
// table row, never by inference: `:N` is the unprefixed source, `X:N` the source declared with prefix
// `X` (init uses `I:`, work uses `W:`/`C:`), and an explicit `path/to/file.md:N` overrides both.
//
// Zero-dependency, STRICTLY READ-ONLY unless --fix is passed.
//
// Usage:
//   node l2/tools/citation-drift.mjs --base=<sha>           # report; exit 1 while drift is unresolved
//   node l2/tools/citation-drift.mjs --base=<sha> --json     # machine-readable, same exit codes
//   node l2/tools/citation-drift.mjs --base=<sha> --fix      # rewrite ONLY unique re-anchors, never frozen files
//
// Exit: 0 = nothing actionable · 1 = drift / ambiguity / missing content · 2 = usage or precondition error.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// l2/tools -> repo root. COMPAT_L2_CITATION_ROOT re-roots BOTH the git queries and the reference
// directory onto a synthetic tree [test seam]: the unit tests need a repo whose history they control,
// and pointing at one must never leave a path resolving back into the real checkout.
const REPO = process.env.COMPAT_L2_CITATION_ROOT
  ? path.resolve(process.env.COMPAT_L2_CITATION_ROOT)
  : path.resolve(__dirname, '..', '..', '..', '..', '..');
const REF_DIR = process.env.COMPAT_L2_CITATION_ROOT
  ? path.join(REPO, 'platforms', 'copilot-cli', 'compat-tests', 'l2', 'reference')
  : path.join(__dirname, '..', 'reference');

// Files whose citations are REPORTED but never rewritten. CALIBRATION-LOG.md is append-only by a binding
// rule (AGENTS.md § Decision records): a stale citation in a historical entry stays stale, and the
// correction belongs in a NEW appended entry. Rewriting it would erase the record the log exists to keep.
const FROZEN = new Set(['CALIBRATION-LOG.md']);

const die = (msg) => { console.error(`citation-drift: ${msg}`); process.exit(2); };

// ---------------------------------------------------------------- git access
function gitShow(rev, rel) {
  try {
    return execFileSync('git', ['-C', REPO, 'show', `${rev}:${rel}`], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n');
  } catch { return null; }
}

// ---------------------------------------------------------------- declared citation sources
// The `| Source (read-only citation source[s]) | ... |` row names every file a derivation cites, each
// optionally with the single-letter prefix its bare citations use. Returning [] means the derivation
// declares nothing, and its bare citations are then reported as undeclared rather than guessed at.
export function parseSources(text) {
  const row = text.split('\n').find((l) => /^\|\s*Source\b/i.test(l));
  if (!row) return [];
  const out = [];
  // Each source is a backticked repo-relative path, optionally followed by (`P:N`) declaring its prefix.
  const re = /`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:md|sh|mjs|json))`(?:\s*\(\s*`?([A-Z]):N`?)?/g;
  for (const m of row.matchAll(re)) out.push({ path: m[1], prefix: m[2] ?? null });
  return out;
}

// ---------------------------------------------------------------- citation collection
// Three forms, scanned in precedence order. Earlier forms are masked out of the text before the next
// scan so a pathed `foo/bar.md:12` is never re-counted as a bare `:12`.
const mask = (text, spans) => {
  const buf = [...text];
  for (const [s, e] of spans) for (let i = s; i < e; i++) if (buf[i] !== '\n') buf[i] = ' ';
  return buf.join('');
};

export function collectCitations(text, sources) {
  const cites = [];
  const spans = [];
  const push = (m, file, line, end) => {
    cites.push({ raw: m[0], file, line, end, index: m.index });
    spans.push([m.index, m.index + m[0].length]);
  };

  // 1. explicit path
  const pathed = /([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:md|sh|mjs|json)):(\d{1,5})(?:-(\d{1,5}))?/g;
  for (const m of text.matchAll(pathed)) push(m, m[1], Number(m[2]), m[3] ? Number(m[3]) : null);

  // 2. declared prefix (I:47, W:12, C:5)
  const byPrefix = new Map(sources.filter((s) => s.prefix).map((s) => [s.prefix, s.path]));
  if (byPrefix.size) {
    const t = mask(text, spans);
    const pre = /(?<![A-Za-z0-9_./-])([A-Z]):(\d{1,5})(?:-(\d{1,5}))?(?![\d])/g;
    for (const m of t.matchAll(pre)) {
      const f = byPrefix.get(m[1]);
      if (f) push(m, f, Number(m[2]), m[3] ? Number(m[3]) : null);
    }
  }

  // 3. bare colon -> the single UNPREFIXED declared source. More than one unprefixed source is
  //    ambiguous by construction, so the citations are reported undeclared instead of assigned.
  const plain = sources.filter((s) => !s.prefix);
  const t2 = mask(text, spans);
  const bare = /(?<![A-Za-z0-9_./:-]):(\d{1,5})(?:-(\d{1,5}))?(?![\d])/g;
  for (const m of t2.matchAll(bare)) {
    push(m, plain.length === 1 ? plain[0].path : null, Number(m[1]), m[2] ? Number(m[2]) : null);
  }
  return cites;
}

// ---------------------------------------------------------------- resolution
// An explicit citation path may be written as a bare basename or a tail fragment. It resolves against
// the DECLARED sources first (that is what makes `block-destructive-commands.sh:54` mean our Copilot
// override and not the upstream-rewritten Claude source), then against the tracked tree — and a tail
// that matches more than one tracked file is reported, never picked.
// The GENERATED tree is excluded from tail resolution. `plugins/maister-copilot/**` is a copy of the
// Claude source, so every basename matches twice and every lookup would be "ambiguous" for a reason that
// has nothing to do with provenance. A derivation cites the SOURCE; the generated file is an output.
function trackedFiles() {
  return execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean)
    .filter((p) => !p.startsWith('plugins/maister-copilot/'));
}

export function resolvePath(cited, sources, tracked) {
  if (!cited) return { path: null, why: 'no declared source for a bare citation' };
  const declared = sources.find((s) => s.path === cited || s.path.endsWith('/' + cited));
  if (declared) return { path: declared.path };
  if (tracked.includes(cited)) return { path: cited };
  const hits = tracked.filter((p) => p.endsWith('/' + cited));
  if (hits.length === 1) return { path: hits[0] };
  if (hits.length === 0) return { path: null, why: 'no tracked file matches' };
  return { path: null, why: `${hits.length} tracked files match this tail` };
}

// ---------------------------------------------------------------- the check
// `oldLine` is the number the citation carried at --base; `newLine` the number it carries now. They
// differ once a citation has been re-anchored, which is why both are parameters (trap 2 above).
export function classify({ baseLines, nowLines, oldLine, newLine }) {
  if (!baseLines) return { state: 'NO_BASE' };
  if (oldLine > baseLines.length) return { state: 'BASE_OOB' };
  const want = baseLines[oldLine - 1];
  if (!want.trim()) return { state: 'BLANK' }; // a blank cited line carries no content to track
  const got = newLine <= nowLines.length ? nowLines[newLine - 1] : null;
  if (got === want) return { state: 'OK' };
  const hits = [];
  for (let i = 0; i < nowLines.length; i++) if (nowLines[i] === want) hits.push(i + 1);
  if (hits.length === 1) return { state: 'DRIFT', to: hits[0], want };
  if (hits.length === 0) return { state: 'GONE', want };
  return { state: 'AMBIGUOUS', hits, want };
}

// ---------------------------------------------------------------- main
function main(argv) {
  let base = null, json = false, fix = false;
  for (const a of argv) {
    if (a.startsWith('--base=')) base = a.slice('--base='.length);
    else if (a === '--json') json = true;
    else if (a === '--fix') fix = true;
    else die(`unknown argument '${a}'. Usage: citation-drift.mjs --base=<sha> [--json] [--fix]`);
  }
  if (!base) die('missing --base=<sha> — the pre-merge revision the citations were written against');
  // Probe the OBJECT, not a file: --base is typically an UPSTREAM commit, where fork-only files such as
  // AGENTS.md do not exist, so "can I read a file there" is the wrong existence test.
  try {
    execFileSync('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { die(`--base '${base}' is not a commit in this repository (fetch it first?)`); }

  const tracked = trackedFiles();
  const refs = fs.readdirSync(REF_DIR).filter((f) => f.endsWith('.md')).sort();
  const findings = [];
  const cache = new Map();
  const linesNow = (p) => {
    if (!cache.has(p)) cache.set(p, fs.readFileSync(path.join(REPO, p), 'utf8').split('\n'));
    return cache.get(p);
  };

  const skippedBare = new Map();  // ref -> count, for files that declare no citation source
  const misaligned = [];          // refs whose citation lists cannot be paired with --base
  const REF_REL = path.relative(REPO, REF_DIR);

  for (const ref of refs) {
    const now = fs.readFileSync(path.join(REF_DIR, ref), 'utf8');
    const sources = parseSources(now);
    const citesNow = collectCitations(now, sources);

    // The SAME reference at --base. A reference that did not exist then has nothing to compare against;
    // its citations are new, and a new citation is the author's to get right, not this tool's to police.
    const baseText = gitShow(base, path.posix.join(REF_REL.split(path.sep).join('/'), ref));
    if (!baseText) { misaligned.push({ ref, why: 'reference does not exist at --base (new file)' }); continue; }
    const citesBase = collectCitations(baseText.join('\n'), parseSources(baseText.join('\n')));
    if (citesBase.length !== citesNow.length) {
      misaligned.push({ ref, why: `citation count changed since --base (${citesBase.length} -> ${citesNow.length}); positional pairing would be unsound` });
      continue;
    }

    for (let i = 0; i < citesNow.length; i++) {
      const c = citesNow[i], b = citesBase[i];
      // A file with no declared `Source` row (CALIBRATION-LOG.md is the one: it is a log, not a
      // derivation) cannot have its bare `:N` citations resolved at all — there is nothing to resolve
      // them against. Count them and move on rather than emitting a hundred identical "undeclared"
      // lines that would bury the findings that matter. Its PATHED citations are still checked.
      if (!c.file && !sources.length) { skippedBare.set(ref, (skippedBare.get(ref) ?? 0) + 1); continue; }
      const r = resolvePath(c.file, sources, tracked);
      if (!r.path) { findings.push({ ref, ...c, state: 'UNRESOLVED', why: r.why }); continue; }
      const baseLines = gitShow(base, r.path);
      let nowLines;
      try { nowLines = linesNow(r.path); } catch { findings.push({ ref, ...c, target: r.path, state: 'MISSING' }); continue; }
      const verdict = classify({ baseLines, nowLines, oldLine: b.line, newLine: c.line });
      findings.push({ ref, ...c, target: r.path, oldLine: b.line, ...verdict });
    }
  }

  const by = (s) => findings.filter((f) => f.state === s);
  const frozen = by('DRIFT').filter((f) => FROZEN.has(f.ref));
  const fixable = by('DRIFT').filter((f) => !FROZEN.has(f.ref));
  const blocking = fixable.length + by('AMBIGUOUS').length + by('GONE').length;

  if (json) {
    console.log(JSON.stringify({ base, citations: findings.length, frozen, fixable, ambiguous: by('AMBIGUOUS'), gone: by('GONE'), unresolved: by('UNRESOLVED') }, null, 2));
  } else {
    console.log(`citation-drift: base=${base}  references=${refs.length}  citations=${findings.length}`);
    console.log(`  OK ${by('OK').length}  ·  blank-line ${by('BLANK').length}  ·  outside-base ${by('BASE_OOB').length}  ·  undeclared ${by('UNRESOLVED').length}`);
    for (const [ref, n] of skippedBare) console.log(`  ${ref}: ${n} bare citation(s) not checked — the file declares no Source row`);
    for (const m of misaligned) console.log(`  ${m.ref}: NOT CHECKED — ${m.why}`);
    const show = (label, rows, fmt) => {
      if (!rows.length) return;
      console.log(`\n${label} (${rows.length}):`);
      for (const f of rows) console.log(`  ${f.ref}  ${f.target ?? f.file ?? '<bare>'}:${f.line}${fmt(f)}`);
    };
    show('DRIFT — unique re-anchor available', fixable, (f) => ` -> :${f.to}   ${f.want.trim().slice(0, 70)}`);
    show('FROZEN — append-only file: record the offset in a NEW entry, do NOT rewrite', frozen, (f) => ` -> :${f.to} (report only)`);
    show('AMBIGUOUS — content occurs more than once; refusing to guess', by('AMBIGUOUS'), (f) => ` candidates ${f.hits.join(',')}`);
    show('GONE — cited content no longer present; needs a human', by('GONE'), (f) => `   ${f.want.trim().slice(0, 70)}`);
    show('UNRESOLVED — citation names no declared or tracked file', by('UNRESOLVED'), (f) => `   (${f.why})`);
  }

  if (fix && fixable.length) {
    // Rewrite by descending index inside each reference so earlier offsets stay valid.
    const perRef = new Map();
    for (const f of fixable) { if (!perRef.has(f.ref)) perRef.set(f.ref, []); perRef.get(f.ref).push(f); }
    for (const [ref, rows] of perRef) {
      const p = path.join(REF_DIR, ref);
      let text = fs.readFileSync(p, 'utf8');
      for (const f of rows.sort((a, b) => b.index - a.index)) {
        const replaced = f.raw.replace(new RegExp(`(?<![\\d]):?${f.line}(?![\\d])`), (s) => s.replace(String(f.line), String(f.to)));
        text = text.slice(0, f.index) + replaced + text.slice(f.index + f.raw.length);
      }
      fs.writeFileSync(p, text);
      console.log(`fixed ${rows.length} citation(s) in ${ref}`);
    }
    console.log('re-run without --fix to verify; every fix must come out OK');
    return 1; // the tree changed, so this run is not a passing verification
  }

  return blocking ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
