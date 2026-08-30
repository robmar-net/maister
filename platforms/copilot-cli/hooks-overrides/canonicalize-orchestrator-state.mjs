// #57 normalizer PROTOTYPE — canonicalize a Copilot-authored off-schema orchestrator-state.yml
// into the shape the L2 extractor's parseState scores as state_schema(conformant).
//
// Targeted, zero-dep, line-based (mirrors extractor.mjs parseState — NO YAML library). It fixes ONLY
// the two divergence sites the conformance oracle keys on, and is otherwise byte-preserving:
//   (1) completed_phases bare-ints  ([1, 2, 6])         -> phase-N strings (["phase-1","phase-2",...])
//   (2) status readable only via the top-level fallback  -> promote into a real top-level `task:` block
//       (so parseTaskStatus takes the PRIMARY branch and records no schemaDivergence)
//
// It does NOT restructure the whole document (that is a larger parity effort); it makes the file
// conformance-clean while leaving the model's own keys intact. Idempotent: a file that already has a
// top-level `task:` block and phase-N completed_phases is returned unchanged.

const PHASE_INT_RE = /^(\s*)completed_phases\s*:\s*\[([^\]]*)\]\s*$/;

// first line-anchored `status:` at indent <= 2 (== parseTaskStatus fallback), value cleaned.
function findTopLevelStatus(lines) {
  for (const l of lines) {
    if (!/^\s{0,2}status\s*:/.test(l)) continue;
    const m = l.match(/^\s*status\s*:\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim() || null;
  }
  return null;
}

// first top-level `type:` at indent <= 2 (orchestrator.type) — best-effort, for the task: block.
function findTopLevelType(lines) {
  for (const l of lines) {
    const m = l.match(/^\s{0,2}type\s*:\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim() || null;
  }
  return null;
}

export function canonicalize(text) {
  const lines = String(text ?? '').split('\n');
  const changed = { phases: false, task: false };

  // (1) rewrite bare-int completed_phases -> phase-N strings (only when the values are bare ints).
  const out = lines.map((l) => {
    const m = l.match(PHASE_INT_RE);
    if (!m) return l;
    const indent = m[1];
    const inner = m[2].trim();
    if (inner === '') return l; // empty array, nothing to convert
    const parts = inner.split(',').map((s) => s.trim()).filter(Boolean);
    // already phase-N (any element carries the prefix) -> leave untouched (idempotent).
    if (parts.some((p) => /phase[-_]/i.test(p))) return l;
    if (!parts.every((p) => /^\d+$/.test(p))) return l; // not pure bare-ints -> don't touch
    changed.phases = true;
    const canon = parts.map((n) => `"phase-${n}"`).join(', ');
    return `${indent}completed_phases: [${canon}]`;
  });

  // (2) ensure a top-level `task:` block carrying status (parseTaskStatus PRIMARY, no divergence).
  const hasTaskBlock = out.some((l) => /^task\s*:\s*$/.test(l));
  if (!hasTaskBlock) {
    const status = findTopLevelStatus(out);
    if (status != null) {
      const type = findTopLevelType(out);
      const block = ['task:', `  status: ${status}`];
      if (type != null) block.splice(1, 0, `  type: ${type}`);
      out.unshift(...block);
      changed.task = true;
    }
  }

  return { text: out.join('\n'), changed };
}

// CLI: `node canonicalize-orchestrator-state.mjs <file>` prints canonical text to stdout (file
// untouched); with `--in-place` rewrites the file. stdin also accepted when no file arg.
//
// Main-module detection is realpath-based (NOT `import.meta.url === \`file://${process.argv[1]}\``,
// which false-negatives when the invoking path crosses a symlink — e.g. macOS /tmp -> /private/tmp,
// making import.meta.url's resolved path differ from the argv[1] the hook passes, silently skipping
// this block and emitting nothing).
const invokedAsCli = await (async () => {
  try {
    const { realpathSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
})();
if (invokedAsCli) {
  const fs = await import('node:fs');
  const args = process.argv.slice(2);
  const inPlace = args.includes('--in-place');
  const file = args.find((a) => !a.startsWith('--'));
  const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const { text, changed } = canonicalize(input);
  if (inPlace && file) { fs.writeFileSync(file, text); process.stderr.write(`canonicalized ${file} (${JSON.stringify(changed)})\n`); }
  else process.stdout.write(text);
}
