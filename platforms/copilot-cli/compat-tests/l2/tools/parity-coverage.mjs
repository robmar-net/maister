// parity-coverage.mjs — Parity-Map coverage guard (issue #76 WP-F).
//
// Enumerates the SOURCE inventory the Parity-Map must cover — skills, commands, agents, hooks under
// plugins/maister/** — and cross-references the four L2 references (required/optional/rules/allowlist)
// to mark which inventory items already have ANY L2 evidence (a delegated()/invoked_skill() token).
// The point is the DIFF GUARD: commit the JSON snapshot; CI regenerates and `git diff --exit-code` so a
// new upstream skill/agent/command fails the build until the snapshot AND therefore the map are updated.
// Zero-dependency, STRICTLY READ-ONLY.
//
// Usage:
//   node l2/tools/parity-coverage.mjs            # human-readable inventory + coverage counters
//   node l2/tools/parity-coverage.mjs --json     # canonical JSON snapshot (write to docs/parity/inventory.json)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..'); // l2/tools -> repo root
const PLUGIN = path.join(REPO, 'plugins', 'maister');
const REF_DIR = path.join(__dirname, '..', 'reference');

const ls = (dir, pred) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(pred); }
  catch { return []; }
};

// ---------------------------------------------------------------- source inventory
function inventory() {
  const skills = ls(path.join(PLUGIN, 'skills'), (d) => d.isDirectory()).map((d) => d.name).sort();
  const commands = ls(path.join(PLUGIN, 'commands'), (d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => d.name.replace(/\.md$/, '')).sort();
  const agents = ls(path.join(PLUGIN, 'agents'), (d) => d.isFile() && d.name.endsWith('.md'))
    .map((d) => d.name.replace(/\.md$/, '')).sort();
  const hooks = ls(path.join(PLUGIN, 'hooks'), (d) => d.isFile() && d.name.endsWith('.sh'))
    .map((d) => d.name.replace(/\.sh$/, '')).sort();
  return { skills, commands, agents, hooks };
}

// ---------------------------------------------------------------- L2 evidence surface
// Every token that appears anywhere in any reference (required ∪ optional ∪ allowlist ∪ rule when/require).
function referenceTokens() {
  const tokens = new Set();
  // Coerce an entry to its predicate string: a bare string, or an object's predicate/token/name/pattern
  // field (allowlist entries are {predicate|pattern, reason} objects in some references).
  const asToken = (e) => {
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') return e.predicate ?? e.token ?? e.name ?? e.pattern ?? null;
    return null;
  };
  for (const f of ls(REF_DIR, (d) => d.isFile() && d.name.endsWith('.skeleton.json'))) {
    const ref = JSON.parse(fs.readFileSync(path.join(REF_DIR, f.name), 'utf8'));
    for (const k of ['required', 'optional', 'allowlist']) {
      for (const e of (Array.isArray(ref[k]) ? ref[k] : [])) { const t = asToken(e); if (t) tokens.add(t); }
    }
    for (const r of (Array.isArray(ref.rules) ? ref.rules : [])) {
      for (const t of [asToken(r?.when), asToken(r?.require)]) if (t) tokens.add(t);
    }
  }
  return tokens;
}

// An inventory item has L2 evidence if a token names it as delegated(<name>) / invoked_skill(<name>).
function covered(name, tokens) {
  for (const t of tokens) {
    if (t.includes(`(${name})`) || t.includes(`(${name}=`) || t.includes(`(${name},`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- report
const inv = inventory();
const tokens = referenceTokens();
const kinds = ['skills', 'commands', 'agents', 'hooks'];

const snapshot = { generated: 'STATIC', inventory: inv, coverage: {} };
for (const kind of kinds) {
  snapshot.coverage[kind] = inv[kind].map((name) => ({ name, l2Evidence: covered(name, tokens) }));
}

if (process.argv.includes('--json')) {
  // Deterministic snapshot for the CI diff guard (no timestamps — those would make the diff flap).
  process.stdout.write(JSON.stringify({ inventory: inv, coverage: snapshot.coverage }, null, 2) + '\n');
} else {
  const L = [];
  L.push('# Parity-Map coverage (issue #76 WP-F) — source inventory vs L2 evidence surface\n');
  let total = 0, withEvidence = 0;
  for (const kind of kinds) {
    const rows = snapshot.coverage[kind];
    const n = rows.length, e = rows.filter((r) => r.l2Evidence).length;
    total += n; withEvidence += e;
    L.push(`## ${kind} (${n}) — ${e} with any L2 evidence, ${n - e} without`);
    for (const r of rows) L.push(`- ${r.l2Evidence ? '✅' : '⚪'} ${r.name}`);
    L.push('');
  }
  L.push(`**Totals:** ${total} inventory items · ${withEvidence} touched by ≥1 L2 reference token · ` +
    `${total - withEvidence} with NO L2 evidence yet (⚪ on the Parity-Map).`);
  L.push('\n_Paste the per-section counts into the Parity-Map header. `--json` emits the CI snapshot ' +
    '(`docs/parity/inventory.json`); a diff there means an upstream inventory change the map must absorb._');
  process.stdout.write(L.join('\n') + '\n');
}
