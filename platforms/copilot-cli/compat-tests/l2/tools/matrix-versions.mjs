#!/usr/bin/env node
// Every Copilot CLI version a persisted L2 bundle was driven on MUST have a Compatibility-Matrix row.
//
// Why this exists (#148): on 2026-09-06 six bundles were driven on Copilot CLI 1.0.83 and no wiki
// page mentioned 1.0.83 — Home still said "latest verified 1.0.82". The wiki's central promise is
// "verified per Copilot CLI release", and nothing enforced it: a bundle on an unrecorded version
// passed every check silently. This tool is the tripwire. It is credit-free and read-only.
//
// Usage:
//   node matrix-versions.mjs <Compatibility-Matrix.md> [--check] [--reports=<dir>]... [--archive=<dir>]
//
//   --check           exit 1 when a bundle version has no Matrix row (default: report only, exit 0)
//   --reports=<dir>   a compat-tests/reports directory to scan (repeatable). Default: this
//                     checkout's own reports/ dir.
//   --archive=<dir>   the bundle-archive.sh destination to scan (*.tar.gz). Default: what
//                     `bundle-archive.sh --print-dest` resolves; pass --archive= (empty) to skip.
//
// Bundle version source: replay-meta.json `cliVersion` (meta schema 2), else the X.Y.Z inside
// `copilotVersion` (schema 1 bundles). Matrix source: every X.Y.Z token in the "Copilot CLI" column of
// the `## Matrix` table (a cell may list several, e.g. "1.0.82 (L2) · 1.0.81 (L0)").
//
// Exit codes: 0 = every bundle version has a row (or --check absent); 1 = drift under --check;
// 2 = usage / unreadable page.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION_RE = /\b\d+\.\d+\.\d+\b/g;

/** X.Y.Z tokens in the "Copilot CLI" column of the `## Matrix` table (a Set of strings). */
export function matrixVersions(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^##\s+Matrix\s*$/.test(l));
  if (start < 0) return new Set();
  const out = new Set();
  let col = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // next section
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (col < 0) {
      col = cells.findIndex((c) => /copilot\s+cli/i.test(c));
      continue; // header row
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator
    const cell = cells[col] ?? '';
    for (const v of cell.match(VERSION_RE) ?? []) out.add(v);
  }
  return out;
}

/** The CLI version a replay-meta.json records, or null when it records none. */
export function bundleVersion(meta) {
  if (typeof meta?.cliVersion === 'string' && VERSION_RE.test(meta.cliVersion)) {
    return meta.cliVersion.match(VERSION_RE)[0];
  }
  if (typeof meta?.copilotVersion === 'string') {
    const m = meta.copilotVersion.match(VERSION_RE);
    if (m) return m[0];
  }
  return null;
}

/**
 * Pure census: bundles = [{ts, version|null, where}], matrix = Set<version>.
 * Returns rows sorted by version (newest first) plus the list of unrecorded versions.
 */
export function census(bundles, matrix) {
  const byVersion = new Map();
  const noVersion = [];
  for (const b of bundles) {
    if (!b.version) { noVersion.push(b); continue; }
    if (!byVersion.has(b.version)) byVersion.set(b.version, []);
    byVersion.get(b.version).push(b);
  }
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
    return 0;
  };
  const rows = [...byVersion.keys()].sort(cmp).map((version) => ({
    version,
    bundles: byVersion.get(version).length,
    recorded: matrix.has(version),
  }));
  return { rows, unrecorded: rows.filter((r) => !r.recorded).map((r) => r.version), noVersion };
}

function readMetaFromDir(reportsDir) {
  const out = [];
  if (!fs.existsSync(reportsDir)) return out;
  for (const ts of fs.readdirSync(reportsDir)) {
    const p = path.join(reportsDir, ts, 'replay-meta.json');
    if (!fs.existsSync(p)) continue;
    try {
      out.push({ ts, version: bundleVersion(JSON.parse(fs.readFileSync(p, 'utf8'))), where: reportsDir });
    } catch { out.push({ ts, version: null, where: reportsDir }); }
  }
  return out;
}

function readMetaFromArchive(archiveDir) {
  const out = [];
  if (!archiveDir || !fs.existsSync(archiveDir)) return out;
  for (const f of fs.readdirSync(archiveDir).filter((f) => f.endsWith('.tar.gz'))) {
    const tar = path.join(archiveDir, f);
    const ts = f.replace(/\.tar\.gz$/, '');
    try {
      const members = execFileSync('tar', ['-tzf', tar], { encoding: 'utf8' }).split('\n');
      const member = members.find((m) => m.endsWith('/replay-meta.json') || m === 'replay-meta.json');
      if (!member) { out.push({ ts, version: null, where: archiveDir }); continue; }
      const json = execFileSync('tar', ['-xOzf', tar, member], { encoding: 'utf8' });
      out.push({ ts, version: bundleVersion(JSON.parse(json)), where: archiveDir });
    } catch { out.push({ ts, version: null, where: archiveDir }); }
  }
  return out;
}

function defaultArchiveDir() {
  try {
    return execFileSync('bash', [path.join(__dirname, 'bundle-archive.sh'), '--print-dest'], { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

function main(argv) {
  const args = argv.slice(2);
  const page = args.find((a) => !a.startsWith('--'));
  const check = args.includes('--check');
  const reports = args.filter((a) => a.startsWith('--reports=')).map((a) => a.slice('--reports='.length));
  const archiveArg = args.find((a) => a.startsWith('--archive='));
  if (!page || !fs.existsSync(page)) {
    console.error('usage: matrix-versions.mjs <Compatibility-Matrix.md> [--check] [--reports=<dir>]... [--archive=<dir>]');
    return 2;
  }
  const reportDirs = reports.length ? reports : [path.resolve(__dirname, '..', '..', 'reports')];
  const archiveDir = archiveArg !== undefined ? archiveArg.slice('--archive='.length) : defaultArchiveDir();

  const matrix = matrixVersions(fs.readFileSync(page, 'utf8'));
  const bundles = [...reportDirs.flatMap(readMetaFromDir), ...readMetaFromArchive(archiveDir)];
  const { rows, unrecorded, noVersion } = census(bundles, matrix);

  console.log(`Matrix rows record: ${[...matrix].sort().join(', ') || '(none)'}`);
  console.log(`Bundles scanned: ${bundles.length} (${reportDirs.join(', ')}${archiveDir ? `, ${archiveDir}` : ''})`);
  for (const r of rows) console.log(`  ${r.recorded ? 'ok  ' : 'MISSING'}  ${r.version}  ${r.bundles} bundle(s)`);
  if (noVersion.length) console.log(`  (no version recorded in ${noVersion.length} pre-schema bundle(s): ${noVersion.map((b) => b.ts).join(', ')})`);
  if (unrecorded.length) {
    console.error(`\nUNRECORDED Copilot CLI version(s) with live bundles but no Compatibility-Matrix row: ${unrecorded.join(', ')}`);
    console.error('Add a Matrix row for each (what ran, verdicts, bundle ts) — the wiki promises "verified per release".');
    return check ? 1 : 0;
  }
  console.log('\nOK — every bundle CLI version has a Compatibility-Matrix row.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
