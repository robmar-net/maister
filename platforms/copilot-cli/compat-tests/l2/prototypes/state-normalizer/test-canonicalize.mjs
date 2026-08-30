// Credit-free proof: canonicalize() turns REAL captured off-schema state files into ones the
// L2 extractor scores as state_schema(conformant), with task.status still derivable.
import fs from 'node:fs';
import { canonicalize } from './canonicalize-orchestrator-state.mjs';
import { parseState } from '../../extractor.mjs';

const files = process.argv.slice(2);
let pass = 0, fail = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const before = parseState(raw);
  const { text, changed } = canonicalize(raw);
  const after = parseState(text);
  const beforeConformant = before.schemaDivergences.length === 0;
  const afterConformant = after.schemaDivergences.length === 0;
  const statusOk = after.status != null;
  const phasesOk = Array.isArray(after.phases) && after.phases.length > 0;
  // valid outcomes: an off-schema file is FIXED (changed -> conformant), OR an already-conformant
  // file is left UNCHANGED (idempotent no-op). Either way it must end conformant + status/phases OK.
  const fixed = !beforeConformant && afterConformant;
  const idempotent = beforeConformant && afterConformant && !changed.phases && !changed.task;
  const ok = (fixed || idempotent) && statusOk && phasesOk;
  console.log(`\n=== ${f.replace('/tmp/maister-clone/platforms/copilot-cli/compat-tests/','')} ===`);
  console.log(`  changed:            ${JSON.stringify(changed)}`);
  console.log(`  BEFORE: schemaDivergences=${before.schemaDivergences.length}  status=${JSON.stringify(before.status)}  phases=[${before.phases}]`);
  console.log(`          divergences: ${JSON.stringify(before.schemaDivergences)}`);
  console.log(`  AFTER:  schemaDivergences=${after.schemaDivergences.length}  status=${JSON.stringify(after.status)}  phases=[${after.phases}]`);
  console.log(`          divergences: ${JSON.stringify(after.schemaDivergences)}`);
  console.log(`  VERDICT: ${fixed ? 'FIXED off-schema->conformant' : idempotent ? 'already-conformant (idempotent no-op)' : 'UNEXPECTED'}  status_derivable=${statusOk}  phases_ok=${phasesOk}  => ${ok ? 'PASS' : 'FAIL'}`);
  ok ? pass++ : fail++;
}
console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
process.exit(fail ? 1 : 0);
