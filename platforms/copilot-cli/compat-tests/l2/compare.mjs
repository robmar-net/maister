// compare.mjs — Comparator + reference-check utility (Task Group 4).
//
// PURE module (no file I/O, no SDK import): reduces to set algebra over plain data
// so it is fully credit-free unit-testable. It MAY be inlined into run.mjs; it is
// split out here purely so the verdict logic + the hash definition can be proven
// without a Copilot seat (anti-over-engineering note honored — plan step 4.5).
//
// SINGLE HASH DEFINITION: `computeHash` below is the one and only implementation of
// the reference hash. Group 6 uses it to STAMP the committed golden's `hash` field;
// Group 7's `--check-reference` CLI uses it to VERIFY. Never re-implement it.
//
// House conventions (spec Standards Compliance): zero external deps; ESM `.mjs`;
// `node:` builtins only (node:crypto); deterministic output.

import { createHash } from 'node:crypto';

// Verdict/status -> process exit code, per spec § Preflight + verdict → exit code.
export const EXIT = Object.freeze({
  AS_EXPECTED: 0, // live run completes, no candidate regression (PASS + LIMITATION only)
  REGRESSED: 1, //   live run completes, >=1 candidate regression
  INCOMPLETE: 2, //  precondition failure / corrupt reference / no verdict possible
});

// The workflow-model version this harness's reference models. `checkReference` staleness keys on
// THIS (not the maister package version) so a behavior-neutral maister release bump never cries
// wolf (C2). Bump it only when the maister DEVELOPMENT workflow model itself changes — its phase
// set, always-on agents/skills, or predicate grammar — i.e. whenever the reference must be
// re-derived. References predating the stamp fall back to the legacy maister_version comparison.
export const WORKFLOW_MODEL_VERSION = 1;

/**
 * Match a single predicate against a reference allowlist.
 *
 * This is the ONE extension point for allowlist semantics. For the MVP an entry
 * matches by exact predicate string (the seeded `hook_effect(destructive_guard=ask)`
 * is a concrete token, not a wildcard) — a deliberately minimal, deterministic rule.
 * Future pattern support (globs/regex) belongs here and nowhere else.
 *
 * @param {string} predicate
 * @param {Array<{predicate:string,classification?:string,reason?:string}>} allowlist
 * @returns {{predicate:string,classification?:string,reason?:string}|null}
 */
export function allowlistMatch(predicate, allowlist) {
  if (!Array.isArray(allowlist)) return null;
  for (const entry of allowlist) {
    if (entry && entry.predicate === predicate) return entry;
  }
  return null;
}

/**
 * Set-compare an observed Copilot skeleton against a reference partition and
 * classify every one-sided difference.
 *
 *   missing = required \ set                       (required predicate absent)
 *   extra   = set \ (required u optional)          (observed predicate not modelled)
 *   each p in (missing u extra): LIMITATION if the allowlist matches, else
 *                                CANDIDATE_REGRESSION
 *   overall = REGRESSED iff any CANDIDATE_REGRESSION, else AS-EXPECTED
 *
 * Optional predicates are excluded from the diff entirely (present or absent both fine).
 *
 * @param {Set<string>|Iterable<string>} copilotSet normalized observed skeleton
 * @param {{required?:string[],optional?:string[],allowlist?:Array}} reference
 * @returns {{
 *   overall:'AS-EXPECTED'|'REGRESSED',
 *   exitCode:number,
 *   counts:{pass:number,limitation:number,fail:number},
 *   matched:string[],
 *   diffs:Array<{predicate:string,side:'missing'|'extra',classification:'LIMITATION'|'CANDIDATE_REGRESSION',reason:string}>,
 *   optionalPresent:string[],
 *   optionalAbsent:string[]
 * }}
 */
export function compare(copilotSet, reference) {
  const set = copilotSet instanceof Set ? copilotSet : new Set(copilotSet ?? []);
  const required = Array.isArray(reference?.required) ? reference.required : [];
  const optional = Array.isArray(reference?.optional) ? reference.optional : [];
  const allowlist = Array.isArray(reference?.allowlist) ? reference.allowlist : [];

  const requiredSet = new Set(required);
  const optionalSet = new Set(optional);

  // required \ set
  const missing = required.filter((p) => !set.has(p));
  // set \ (required u optional)
  const extra = [...set].filter((p) => !requiredSet.has(p) && !optionalSet.has(p));
  // required n set (PASS)
  const matched = required.filter((p) => set.has(p));
  // optional partition (informational only, never a diff)
  const optionalPresent = optional.filter((p) => set.has(p));
  const optionalAbsent = optional.filter((p) => !set.has(p));

  const classifyDiff = (predicate, side) => {
    const entry = allowlistMatch(predicate, allowlist);
    if (entry) {
      return {
        predicate,
        side,
        classification: entry.classification || 'LIMITATION',
        reason: entry.reason || 'allowlisted expected platform divergence',
      };
    }
    return {
      predicate,
      side,
      classification: 'CANDIDATE_REGRESSION',
      reason:
        side === 'missing'
          ? 'required predicate absent from observed skeleton'
          : 'observed predicate not modelled in required u optional',
    };
  };

  const diffs = [
    ...missing.map((p) => classifyDiff(p, 'missing')),
    ...extra.map((p) => classifyDiff(p, 'extra')),
  ].sort((a, b) => (a.predicate < b.predicate ? -1 : a.predicate > b.predicate ? 1 : 0));

  const fail = diffs.filter((d) => d.classification === 'CANDIDATE_REGRESSION').length;
  const limitation = diffs.filter((d) => d.classification === 'LIMITATION').length;

  const overall = fail > 0 ? 'REGRESSED' : 'AS-EXPECTED';

  return {
    overall,
    exitCode: overall === 'REGRESSED' ? EXIT.REGRESSED : EXIT.AS_EXPECTED,
    counts: { pass: matched.length, limitation, fail },
    matched,
    diffs,
    optionalPresent,
    optionalAbsent,
  };
}

/**
 * THE single reference-hash definition: sha256 hex over the sorted, newline-joined set of
 *   - the DE-DUPLICATED union of `required` u `optional`,
 *   - one `predicate|classification|reason` token per allowlist entry (its FULL semantics), and
 *   - a single `schema:<schema_version>` token.
 *
 * Deterministic: every contribution is collected THEN sorted, so ordering within the committed
 * JSON never affects the hash; a predicate modelled in BOTH partitions is de-duplicated so the
 * overlap can never shift the digest.
 *
 * @param {{required?:string[],optional?:string[],allowlist?:Array<{predicate:string,classification?:string,reason?:string}>,schema_version?:number}} reference
 * @returns {string} sha256 hex digest
 */
export function computeHash(reference) {
  const required = Array.isArray(reference?.required) ? reference.required : [];
  const optional = Array.isArray(reference?.optional) ? reference.optional : [];
  const allowlist = Array.isArray(reference?.allowlist) ? reference.allowlist : [];

  // required u optional, DE-DUPLICATED — a predicate modelled in both partitions must not
  // change the hash by appearing twice.
  const predicates = [...new Set([...required, ...optional].filter((p) => typeof p === 'string'))];

  // Each allowlist entry contributes its FULL semantics (predicate + classification + reason), so
  // editing an entry's classification or reason — not just its predicate — re-stamps the hash.
  const allowTokens = allowlist
    .filter((a) => a && typeof a.predicate === 'string')
    .map((a) => `${a.predicate}|${a.classification}|${a.reason}`);

  // A schema token so a schema_version bump also re-stamps the hash.
  const schemaToken = `schema:${reference?.schema_version}`;

  const canonical = [...predicates, ...allowTokens, schemaToken].sort().join('\n');

  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Credit-free staleness/tamper check for `--check-reference`.
 *
 *   corrupt : stored `hash` != recomputed hash (tampered/inconsistent)          -> exit 2
 *   stale   : `workflow_model_version` != WORKFLOW_MODEL_VERSION                 -> exit 1
 *             (fallback, when no workflow stamp: `maister_version` != currentVersion)
 *   current : consistent                                                        -> exit 0
 *
 * Corruption is checked FIRST: a reference whose own hash is inconsistent cannot be
 * trusted for the version comparison, and a broken reference is a precondition
 * failure (exit 2), not a regression.
 *
 * Staleness keys on the WORKFLOW-MODEL version (C2) so a behavior-neutral maister package bump
 * never cries wolf; references that predate the `workflow_model_version` stamp fall back to the
 * legacy `maister_version`-vs-`currentVersion` comparison.
 *
 * @param {{hash?:string,maister_version?:string,workflow_model_version?:number}} reference
 * @param {string} currentVersion repo maister version (plugins/maister/.claude-plugin/plugin.json); used only on the fallback path
 * @returns {{status:'current'|'stale'|'corrupt',message:string,exitCode:number}}
 */
export function checkReference(reference, currentVersion) {
  const recomputed = computeHash(reference);
  const stored = reference?.hash;

  if (stored !== recomputed) {
    return {
      status: 'corrupt',
      exitCode: EXIT.INCOMPLETE,
      message:
        `reference hash mismatch — stored ${stored ?? '(none)'} != recomputed ${recomputed}; ` +
        'reference is corrupt or tampered (recompute + re-stamp)',
    };
  }

  // Preferred key: the workflow-model version. A behavior-neutral maister package bump keeps the
  // reference CURRENT — only a workflow-model change (bumped WORKFLOW_MODEL_VERSION) marks it stale.
  if (reference?.workflow_model_version != null) {
    const wm = reference.workflow_model_version;
    if (wm !== WORKFLOW_MODEL_VERSION) {
      return {
        status: 'stale',
        exitCode: EXIT.REGRESSED,
        message:
          `reference stale — stamped workflow model v${wm} but this harness models ` +
          `v${WORKFLOW_MODEL_VERSION}; re-derive the reference from maister’s current development model`,
      };
    }
    return {
      status: 'current',
      exitCode: EXIT.AS_EXPECTED,
      message: `reference current — workflow model v${WORKFLOW_MODEL_VERSION}, hash verified`,
    };
  }

  // Fallback (references without a workflow_model_version stamp): legacy package-version compare.
  const stamp = reference?.maister_version;
  if (stamp !== currentVersion) {
    return {
      status: 'stale',
      exitCode: EXIT.REGRESSED,
      message:
        `reference stale — stamped maister ${stamp ?? '(none)'} but repo is ${currentVersion}; ` +
        're-derive the reference from maister’s current development model',
    };
  }

  return {
    status: 'current',
    exitCode: EXIT.AS_EXPECTED,
    message: `reference current — maister ${stamp}, hash verified`,
  };
}
