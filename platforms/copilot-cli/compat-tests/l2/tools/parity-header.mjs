// parity-header.mjs — generate (and check) the Parity-Map header counter from the page itself.
//
// Issue #92 Stage 6. The Parity-Map header line ("✅ N verified · 🟢 N adapted · …") was
// hand-maintained and drifted (it reconciled with no counting rule; see the #92 comment). This
// tool makes it GENERATED and CHECKABLE: the unit is **one table row**, and every Parity-Map table
// that carries a `Status` column contributes its rows to a 5-way census. `parity-coverage.mjs` is a
// DIFFERENT number (source-inventory coverage) — this tool does not touch that.
//
// Usage:
//   node l2/tools/parity-header.mjs <path-to-Parity-Map.md>            # print the canonical header line
//   node l2/tools/parity-header.mjs <path-to-Parity-Map.md> --check    # exit 1 if the file's header line disagrees
//
// The wiki is a separate repo; pass a path into a wiki clone (e.g. /tmp/maister-wiki/Parity-Map.md).
// Zero-dependency: node: builtins only.

import fs from 'node:fs';

const SYMBOLS = ['✅', '🟢', '🟡', '🔴', '⚪'];
const LABEL = { '✅': 'verified', '🟢': 'adapted', '🟡': 'limitation', '🔴': 'gap', '⚪': 'unverified' };

// Split a markdown table row "| a | b | c |" into trimmed cells (drops the leading/trailing empties).
function cells(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim());
}

const isSeparator = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line);
const isRow = (line) => /^\s*\|/.test(line);

// Census over every table that has a `Status` column: one count per data row, keyed on the FIRST
// status glyph in that row's Status cell. Returns { '✅': n, ... , _total, _tables }.
export function census(md) {
  const lines = md.split(/\r?\n/);
  const counts = Object.fromEntries(SYMBOLS.map((s) => [s, 0]));
  let statusIdx = -1; // -1 = not in a Status table
  let tables = 0;

  for (const line of lines) {
    if (isRow(line)) {
      const c = cells(line);
      if (statusIdx === -1) {
        // Looking for a header row that names a Status column.
        const idx = c.indexOf('Status');
        if (idx !== -1) { statusIdx = idx; tables += 1; }
        continue; // header row itself is not counted
      }
      if (isSeparator(line)) continue; // the |---|---| divider
      const cell = c[statusIdx] ?? '';
      const glyph = SYMBOLS.find((s) => cell.includes(s));
      if (glyph) counts[glyph] += 1;
      continue;
    }
    // A non-table line ends the current table.
    statusIdx = -1;
  }
  const total = SYMBOLS.reduce((a, s) => a + counts[s], 0);
  return { ...counts, _total: total, _tables: tables };
}

// The canonical header line the Parity-Map should carry.
export function headerLine(c) {
  return SYMBOLS.map((s) => `${s} ${c[s]} ${LABEL[s]}`).join(' · ');
}

// Pull the counts out of a page's existing "> **Header counters:** …" line, if present.
export function parseExistingHeader(md) {
  const m = md.match(/Header counters:[^\n]*/);
  if (!m) return null;
  const out = {};
  for (const s of SYMBOLS) {
    const mm = m[0].match(new RegExp(`${s}\\s*(\\d+)`, 'u'));
    out[s] = mm ? Number(mm[1]) : null;
  }
  return out;
}

function main(argv) {
  const path = argv.find((a) => !a.startsWith('--'));
  const check = argv.includes('--check');
  if (!path) {
    process.stderr.write('usage: node parity-header.mjs <Parity-Map.md> [--check]\n');
    process.exit(2);
  }
  const md = fs.readFileSync(path, 'utf8');
  const c = census(md);
  const line = headerLine(c);

  if (!check) {
    process.stdout.write(line + '\n');
    process.stderr.write(`(${c._total} rows across ${c._tables} Status tables)\n`);
    return;
  }

  const existing = parseExistingHeader(md);
  const drift = existing && SYMBOLS.some((s) => existing[s] !== c[s]);
  if (!existing) {
    process.stderr.write('no "Header counters:" line found to check against\n');
    process.exit(2);
  }
  if (drift) {
    process.stderr.write('DRIFT — header counters disagree with the page census:\n');
    process.stderr.write(`  page census : ${line}\n`);
    process.stderr.write(`  header line : ${SYMBOLS.map((s) => `${s} ${existing[s]}`).join(' · ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`OK — header matches the page census: ${line}\n`);
}

// Run only as a CLI (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
