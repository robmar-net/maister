// L2 Group 3 — Normalizer + Allowlist.
//
// Turns the extractor's raw predicate records into a canonical, platform-independent
// "normalized skeleton": a SORTED, DE-DUPLICATED Set<string> of predicate tokens. This
// is the layer that makes a Copilot trace comparable to the workflow-model reference.
//
// What it does (per the Shared Data Contract):
//   1. Canonical verb map — maps BOTH platforms' verb forms to identical tokens:
//        Task(subagent_type:"maister:<n>")  |  task(agent_type:"maister-copilot:<n>")  -> delegated(<n>)
//        Skill(skill:"maister:<n>")         |  skill("<n>")                            -> invoked_skill(<n>)
//        AskUserQuestion                    |  ask_user                                -> gate_fired(ask)
//        exit_plan_mode(.requested)                                                    -> gate_fired(exit_plan_mode)
//        permission(.requested)                                                        -> gate_fired(permission)
//   2. Plugin-prefix stripping — `maister:` and `maister-copilot:` are removed so a
//      naming-only platform difference never surfaces as a diff.
//   3. Verification-path collapse — any `created_artifact(verification/<report>)` collapses
//      to the single canonical token `created_artifact(verification/*)`, so the concrete
//      report filename never matters.
//   4. Noise dropping — records whose `kind` is not a grammar head (excluded tool-arg /
//      ordering / narration / tool.execution payloads) produce no token.
//   5. Sort + dedup — the output Set iterates in lexicographic order with no duplicates.
//
// Design notes:
//   - PURE: no I/O, no SDK, no external deps, no `node:` imports. Fully fixture-testable.
//   - Robust to BOTH shapes the extractor may hand us: a record whose `name` still carries
//     the literal platform verb form (e.g. `Task(subagent_type:"…")`) AND a record already
//     reduced to a prefixed bare name (e.g. `maister:gap-analyzer`) with `kind` set.
//   - The EXPECTED-difference allowlist is NOT normalize's concern: it lives as DATA in the
//     committed reference JSON (`reference.allowlist`) and is applied at compare time by the
//     SINGLE matcher `compare.allowlistMatch` (exact `predicate` match). normalize neither owns
//     nor consults an allowlist. `hook_effect(...)` is intentionally NOT a normalize grammar
//     head — it is a forward-looking difference pattern (classified against the reference
//     allowlist at compare time), not a skeleton token.

const PLUGIN_PREFIX_RE = /^maister(?:-copilot)?:/;

// Grammar heads normalize is allowed to emit. Anything else is noise -> dropped.
const GRAMMAR_HEADS = new Set([
  'phase_completed',
  'task_characteristic',
  'task_status',
  'created_artifact',
  'delegated',
  'invoked_skill',
  'gate_fired',
  'reached_terminal',
  'outcome',
]);

function stripPluginPrefix(name) {
  return String(name).replace(PLUGIN_PREFIX_RE, '');
}

// Recognise a literal platform verb form embedded in `name` and rewrite the record to a
// canonical { kind, name }. Handles both Claude and Copilot syntaxes (optional whitespace
// after `:` / inside the call). If nothing matches, trust the extractor's own kind + name.
function resolveVerb(record) {
  const rawName = String(record.name ?? '');
  let m;

  if ((m = /^Task\(subagent_type:\s*"([^"]+)"\)$/.exec(rawName)) ||
      (m = /^task\(agent_type:\s*"([^"]+)"\)$/.exec(rawName))) {
    return { kind: 'delegated', name: m[1], value: record.value };
  }
  if ((m = /^Skill\(skill:\s*"([^"]+)"\)$/.exec(rawName)) ||
      (m = /^skill\(\s*"([^"]+)"\s*\)$/.exec(rawName))) {
    return { kind: 'invoked_skill', name: m[1], value: record.value };
  }
  if (/^(?:AskUserQuestion|ask_user|user_input(?:\.requested)?)$/.test(rawName)) {
    return { kind: 'gate_fired', name: 'ask', value: record.value };
  }
  if (/^exit_plan_mode(?:\.requested)?$/.test(rawName)) {
    return { kind: 'gate_fired', name: 'exit_plan_mode', value: record.value };
  }
  if (/^permission(?:\.requested)?$/.test(rawName)) {
    return { kind: 'gate_fired', name: 'permission', value: record.value };
  }

  return { kind: record.kind, name: rawName, value: record.value };
}

// Strip a defensive `phase[-_]` prefix so both `8` and `"phase-8"` -> `8`.
function normalizePhase(name) {
  return String(name).replace(/^phase[-_]/i, '');
}

// Collapse any verification report path to the single canonical token payload.
function collapseArtifactPath(relpath) {
  const p = String(relpath).replace(/\\/g, '/');
  return /^verification\//.test(p) ? 'verification/*' : p;
}

// Build the canonical token string for one resolved record, or null to drop it.
function buildToken(resolved) {
  const { kind, name, value } = resolved;
  if (!GRAMMAR_HEADS.has(kind)) return null; // noise / excluded / unknown

  switch (kind) {
    case 'delegated':
      return `delegated(${stripPluginPrefix(name)})`;
    case 'invoked_skill':
      return `invoked_skill(${stripPluginPrefix(name)})`;
    case 'gate_fired':
      return `gate_fired(${name})`;
    case 'phase_completed':
      return `phase_completed(${normalizePhase(name)})`;
    case 'task_status':
      return `task_status(${name})`;
    case 'task_characteristic':
      return `task_characteristic(${name})=${value}`;
    case 'outcome':
      // Functional-oracle head (issue #48). Mirrors task_characteristic: free-form id, value pass|fail.
      return `outcome(${name})=${value}`;
    case 'created_artifact':
      return `created_artifact(${collapseArtifactPath(name)})`;
    case 'reached_terminal':
      return `reached_terminal(${name || 'completion'})`;
    default:
      return null;
  }
}

/**
 * Reduce raw predicate records to the normalized skeleton.
 * @param {Array<{kind:string,name:*,value?:*,source?:string,evidence?:string}>} rawRecords
 * @returns {Set<string>} sorted, de-duplicated set of canonical predicate tokens
 */
export function normalize(rawRecords) {
  const tokens = [];
  for (const record of rawRecords ?? []) {
    if (!record || typeof record !== 'object') continue;
    const token = buildToken(resolveVerb(record));
    if (token != null) tokens.push(token);
  }
  // Set() de-duplicates; sort() gives a deterministic canonical order; the returned Set
  // therefore iterates in sorted order with no duplicates.
  return new Set([...new Set(tokens)].sort());
}
