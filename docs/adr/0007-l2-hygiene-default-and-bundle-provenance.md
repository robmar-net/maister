# ADR 0007 — L2 drives run **hygienic by default** (`skipCustomInstructions: true`) and every bundle **carries its own provenance**

- **Status:** Accepted — 2026-09-04
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#122](https://github.com/robmar-net/maister/issues/122) (this change), [#110](https://github.com/robmar-net/maister/issues/110) (cost research), [#123](https://github.com/robmar-net/maister/issues/123) (first `plain` drive + sweep)
- **Related:** [ADR 0003](0003-copilot-parallel-fan-out-measurement.md) (the "measured ≠ true" precedent), [`L1-FINDINGS.md:16`](../../platforms/copilot-cli/compat-tests/L1-FINDINGS.md) (the SessionStart envelope was a silent no-op before [PR #120](https://github.com/robmar-net/maister/pull/120)), follow-up [#127](https://github.com/robmar-net/maister/issues/127) (replay overwrites the same-ts report), `docs/copilot-parity-runbook.md` § "A/B arms", CALIBRATION-LOG #40

## Context

#110 wants to compare cost arms (`plain`, `lean`, `caveman`, …) on the L2 harness. Before staging a
single arm, the six persisted 1.0.82 bundles were read the way ADR 0003 taught us to — raw events
first, story second. Three things the harness was silently doing wrong came out, none of them visible
in a verdict:

1. **Every drive so far leaked the operator's own instructions into the model.** `createSession`
   never set `skipCustomInstructions`, so the Copilot runtime loaded its custom-instruction sources
   from the *process* cwd — the repo checkout — even though the session's `workingDirectory` was the
   throwaway rundir. The measured "product user" cost therefore included the operator's global
   `~/.copilot/copilot-instructions.md` (a Caveman-style terseness rule) plus the repo's `AGENTS.md`
   and `CLAUDE.md`.
2. **A replayed report named the wrong plugin.** `runReplay` (`run.mjs:1203` at `66a523c`) rendered
   the header's `Plugin under test` from the **live** `PLUGIN_DIR` of whichever checkout ran the
   replay, not from the bundle. The on-disk `reports/l2-trace-equivalence-20260831T022952Z.md` — a
   replay of an **upstream-control** drive — says
   `` `/Users/robmar/Projects/Maister/maister/plugins/maister-copilot` `` (the fork path). That is a
   false attribution sitting in the evidence directory.
3. **Cost lived outside the evidence.** `meta.cost` came from a `session-store.db` window query; N>1
   bundles persist `cost: null`, and nothing in a bundle said which arm, commit, digest or session
   options produced it.

## What the bundles actually show

**The leak, counted two ways (method matters — the numbers differ by design).**

- *Parsed:* in `20260903T000910Z` the single `model.messages_snapshot` event carries one system
  message containing **3 distinct `<custom_instruction>…</custom_instruction>` blocks** — the global
  Caveman file, `AGENTS.md`, `CLAUDE.md` — **61,904 characters ≈ 15 K tokens** (chars/4) re-sent as
  cached context on every main-agent turn.
- *Raw:* `grep -o '<custom_instruction' events.json | wc -l` gives **6**, and `caveman` gives **8**,
  on four of the six bundles (`022944Z`, `022952Z`, `000910Z`, `003148Z`) — because the same system
  message is persisted twice, once in `system.message` and once in `model.messages_snapshot`
  (3 + 3 tag hits; the string `caveman` occurs four times per copy, 4 + 4). Bundles with more
  snapshot events scale accordingly: `024753Z` 9 / 12, `004846Z` (init) 18 / 24. The raw count is
  the cheap assertion the first hygienic drive must bring to **0 / 0**; the parsed count is the
  token cost.
- *Mechanism:* the runtime's instruction discovery follows the **process cwd** (the repo), while the
  harness only pointed `workingDirectory` at the rundir. No sandbox template ever contained an
  instructions file, so seeding the rundir would not have helped; only the session option does.

**The replay-header defect on disk** — `reports/l2-trace-equivalence-20260831T022952Z.md`, header
line 6, attributes bundle `20260831T022952Z` (`maisterVersion 2.2.3`, plugin loaded from
`/private/tmp/claude-501/upstream-variant-1isJtp/plugins/maister-copilot` per its own
`skill.invoked.data.path`) to the fork's `plugins/maister-copilot`. The bundle is right; the
rendering lied. The red test `replay-provenance.test.mjs` T-PROV-1/2 pinned it before any fix.

**The 36.99498 identity.** On `20260903T000910Z`, Σ `assistant.usage.data.copilotUsage.totalNanoAiu`
/ 1e9 over 164 usage events = **36.99498 AIU** = `meta.cost.aiu` (the DB window read) =
`session.usage_checkpoint.totalNanoAiu` — Δ 0.000000 on all three. The per-class split
(input 4.066585 / cache_read 11.82771 / cache_write 10.562225 / output 10.53846) sums to the same
total, and the per-event `tokenDetails[].costPerBatch / batchSize` re-read gives the price table
`gpt-5.6-luna` 20 / 2 / 25 / 120 and `gpt-5.4-mini` 75 / 7.5 / 0 / 450 AIU per 1 M tokens. Cost is
therefore derivable **from the bundle alone**, exactly, credit-free — the DB is a cross-check, not
the source.

**Six-bundle attribution table** (from `maisterVersion` + `skill.invoked.data.path`, now committed
as `l2/variants/legacy-arms.json`; AIU from `cost-report.mjs`):

| ts | scenario | legacy arm | maister | plugin dir recovered from events | AIU | comparable |
|---|---|---|---|---|---|---|
| `20260831T022944Z` | destructive-guard | `upstream-control` | 2.2.3 | — (no path-bearing event; **operator assertion**: same upstream-variant session as `022952Z`) | 0.844275 | no |
| `20260831T022952Z` | quick-bugfix | `upstream-control` | 2.2.3 | `/private/tmp/claude-501/upstream-variant-1isJtp/plugins/maister-copilot` | 1.504527 | no |
| `20260831T024753Z` | development | `upstream-control` | 2.2.3 | `/private/tmp/claude-501/upstream-variant-NnRsgq/plugins/maister-copilot` | 72.579689 | no |
| `20260903T000910Z` | development | `fork-legacy` | 2.2.3+fork.2 | `/Users/robmar/Projects/Maister/maister/plugins/maister-copilot` | 36.994980 | no |
| `20260903T003148Z` | work | `fork-legacy` | 2.2.3+fork.2 | same | 18.922307 | no |
| `20260903T004846Z` | init | `fork-legacy` | 2.2.3+fork.2 | same | 25.138823 | no |

All six ran with leaked instructions, and the three fork bundles ran `+fork.2`, whose SessionStart
hook was a silent no-op (`L1-FINDINGS.md:16`, fixed in PR #120). **None is comparable to a
post-#122 arm** — they are history, not a baseline.

## Decision

1. **Hygiene is the default, not an arm.** `buildSessionOptions` resolves
   `skipCustomInstructions` as manifest → `COMPAT_L2_SKIP_INSTR` → **`true`**; only the
   `plain-legacy` manifest sets it `false`, and it exists solely to quantify the leak once. Every
   non-`init` rundir is seeded with `.maister/config.yml` (`html_output`, `mockup_format: html`) so
   the workflow finds the file `/maister:init` would have written (`init` stays bare — its oracle
   needs that).
2. **Bundles are self-describing — `replay-meta.json` schema v2.** After the unchanged first twelve
   keys: `metaSchema`, `variant`, `mutation`, `pluginDir`, `pluginName`, `pluginDigest`,
   `pluginSource{commit, treeOid, forkVersion, method: git-archive|working-tree}`, `sessionOptions`
   (the exact object spread into `createSession`), `sandboxSeeds`, `referenceHash`, `cliVersion`,
   `servedModels`, `armManifest`. `run.mjs` is the single authority for digest / tree / reference
   hash, computed **before** the credit-spend confirm — any failure is exit 2 and spends nothing.
3. **Replay renders from the bundle, never from the live checkout.** `provenanceForReplay(meta, ts,
   legacyMap)` fills the header from meta v2, else from the committed **`l2/variants/legacy-arms.json`**
   (the six rows above, `comparable: false`), else prints `UNATTRIBUTED`. The legacy map is **one
   shared file read by both `--replay` and `ab-compare`** — the operator's refinement of the
   analysis decision ADR-002 (which had two consumers with two copies). Never add a post-#122 ts to
   it: provenance must come from the bundle.
4. **Arms are staged from `git archive <pinned commit>`, never from a working tree.**
   `variant.sh <arm> --commit=<sha>` — `--commit` is mandatory (exit 2 without it), there is no
   `--src=<dir>`; the copy is verified against a second pristine extraction; `HEAD ≠ commit` is a
   warning, because the pin is the point (another session switching branches cannot contaminate an
   arm). `run.sh --variant=<arm> --commit=<sha>` wires it in; `--variant` and `--mutation` are
   mutually exclusive.
5. **Cost is bundle-first.** `cost-report.mjs <bundle>` derives AIU by class / model / agent, the
   covariates (`systemTokensInitial`, `toolDefinitionTokens`, reads, skill bytes, cache breaks,
   gates, hook fires, wall minutes) and `--verdict` from `events.json`; prices are **re-read from
   `tokenDetails` per event**, and the `KNOWN_RATES` constant is only a drift cross-check that never
   enters a total. The `session-store.db` query is demoted to a cross-check in the runbook.
6. **`ab-compare` is minimal and refuses what it cannot attribute** — a mutant (unless
   `--allow-mutants`), a v2 bundle driven without `--variant`, a pre-provenance bundle not in the
   legacy map. No ranking, Δ or tier logic here (#123).
7. **`lean` guard scope = all 25 `agents/*.md`** — a deliberate refinement of the HLD's
   "non-orchestrating agents": grep shows **no** plugin agent invokes any of the six workflow skills
   (`development`, `migration`, `performance`, `research`, `product-design`, `work`), so every agent
   is a leaf and the set is the manifest glob, not a hand list; 24 of 25 carry a `model:` line
   (`docs-operator.md` does not), so that invariant is a set comparison.

No file under `plugins/**`, `build.sh`, `hooks-overrides/**`, `l2/compare.mjs` or
`l2/reference/*.json` changed; `make build` is byte-identical and the version stays `2.2.3+fork.4`
(harness and docs only — not installer-visible). The analysis-level decisions the help texts and
manifests cite as ADR-001 … ADR-010 are the #122 design records; this ADR is their repo-level
record.

## Honest limits

1. **Replay neutrality and `--check-reference ×6` prove that the references and the replay path did
   not move — not that live verdicts hold.** `skipCustomInstructions: true` changes what the model
   sees on every future drive; the six identical replays are all credit-free proof there is. The first
   `plain` T1 drive of #123 is the proof. **A moved verdict is a wanted red — fix or LIMITATION with
   workflow-model citation, never relaxed.**
2. **`--replay` overwrites the same-ts live report** (`reports/l2-trace-equivalence-<ts>.md`) —
   pre-existing, first hit on `20260831T022952Z`; not fixed here. Follow-up
   [#127](https://github.com/robmar-net/maister/issues/127). That is why the six real replays are the
   operator's **last** step in #122.
3. **The SDK doc for `skipCustomInstructions` (`types.d.ts:1834-1841`) names
   `.github/copilot-instructions.md`, `AGENTS.md` and `CLAUDE.md` as examples but does not name the
   operator's global `~/.copilot/copilot-instructions.md`.** Whether the global file is suppressed too
   is knowable only live. Pre-declared assertion for the first `plain` drive: `events.json` shows
   **0 `<custom_instruction` and 0 `caveman` hits** (6 / 8 today on the four single-snapshot bundles).
   If the global file survives, `skipCustomInstructions` is insufficient and the finding goes to
   #123 before any arm is compared.
4. **`excludedTools: ["mcp:playwright"]`** — the `mcp:<name>` pattern syntax is documented
   (`types.d.ts:1755`), but the server-name binding is observable only live (`toolDefinitionTokens`
   should drop on the `lean` arm; #123 probe B).
5. **The `destructive-guard` legacy row is an operator assertion.** `20260831T022944Z` carries no
   path-bearing event (no `skill.invoked`), so its `upstream-control` attribution rests on the
   operator's record that it ran in the same upstream-variant session as `022952Z`; the map says so
   in its `note`.
6. **`plain-legacy` bridges `20260831T022952Z` only informationally.** It re-admits the leak on the
   fork tree; the old bundle is upstream 2.2.3 with no fork hook. Same lever, different tree — a
   sanity bridge for the T1 figure, never a comparison row.

## Consequences

- The next live drive is the **new reference baseline** (`plain`), and every earlier live figure in
  the runbook and wiki is marked *pre-hygiene (instructions leaked; pre-#120 hook)* — not
  back-filled, not compared.
- A bundle can now be attributed, costed and re-verdicted **without the repo or the operator's
  memory**: `cost-report.mjs <bundle> --verdict` and `ab-compare.mjs <bundles…>` are the tools;
  `--replay` renders the arm from the bundle.
- The #110 harness gets its arms (`plain`, `plain-legacy`, `lean`, `caveman`, `terse`) as
  reproducible, digest-verified trees pinned to a commit — the precondition #123's sweep needed.
- Operators re-read the runbook § "Cost" and § "A/B arms": the DB query is a cross-check, the
  price table is 4-class, and every env / flag the harness accepts is listed once, matching the
  `-h` texts.
