# L2 evidence dispositions — which ⚪ rows the surviving bundles can close

**Produced:** 2026-09-06 · **Issue:** [#138](https://github.com/robmar-net/maister/issues/138) WP4 ·
**Credit-free:** no seat, no SDK, no network, no live session — this is a read-only classification of
bundles that already exist.

## TL;DR

Thirteen inventory rows carry no L2 evidence. **None of them is closable from the seven surviving
bundles** — every one needs a drive, and this file names the verifying scenario for each. One row
(`orchestrator-framework`) is *structurally* unevidenceable and should be re-classified rather than
driven. Separately, the nine behavioral dimensions `parity-evidence.mjs` extracts are mostly already
closed by the bundles; the two that are not are **compaction resume** and — unexpectedly —
**`hook_effect(destructive_guard=ask)`**, which the one surviving `destructive-guard` bundle does *not*
witness. See "Findings" for that last one; it is the only surprise in this pass.

## Key Decisions

- **This file is the in-repo artifact, not the PR body.** The plan (`implementation-plan.md:96`) put the
  list in the PR body; the operator overrode that so the classification is durable, versioned, and
  visible in the diff. The PR body summarizes it.
- **No wiki edit.** The Parity-Map lives on the `robmar-net/maister` wiki, a separate repository.
  Decision D5 keeps this PR out of it. This file is the *input* to a later wiki write, not the write.
- **Structured around the tools' own output, not the wiki's row list.** No wiki clone exists in this
  environment, so the wiki's ⚪ rows cannot be enumerated verbatim. Per the operator's instruction the
  list is therefore built from (a) `parity-coverage.mjs`'s own ⚪ inventory rows and (b) the behavioral
  dimensions `parity-evidence.mjs` reports. Anyone refreshing the wiki should reconcile these against
  the page's own rows before pasting.
- **"Mentioned" is not "evidenced".** All 13 ⚪ names appear as substrings in 6–7 of the 7 bundles. That
  is the leaked plugin catalogue in the system prompt (the `AGENTS.md`/`CLAUDE.md` confound recorded in
  #110), not behavior. A row is counted closable only on a `subagent.started` delegation or an
  `invoked_skill(...)` token. **Zero of the 13 clear that bar in any bundle.**

## Provenance

Seven surviving bundles, read in place from the **shared checkout** — they exist nowhere else, and were
deliberately not copied into the worktree (`compat-tests/reports/` is per-worktree and git-ignored via
`reports/.gitignore:8` = `*/`):

```
R=/Users/robmar/Projects/Maister/maister/platforms/copilot-cli/compat-tests/reports
$R/20260831T022944Z  destructive-guard   254 events    0 delegations
$R/20260831T022952Z  quick-bugfix      1,530 events    0 delegations
$R/20260831T024753Z  development      21,222 events   16 delegations
$R/20260903T000910Z  development      26,655 events   19 delegations
$R/20260903T003148Z  work             21,922 events   11 delegations
$R/20260903T004846Z  init              8,188 events    8 delegations
$R/20260904T214857Z  development      50,712 events   31 delegations
```

Commands run (both read-only, both exit 0):

```bash
node platforms/copilot-cli/compat-tests/l2/tools/parity-evidence.mjs $R/20260831T022944Z $R/20260831T022952Z \
  $R/20260831T024753Z $R/20260903T000910Z $R/20260903T003148Z $R/20260903T004846Z $R/20260904T214857Z
node platforms/copilot-cli/compat-tests/l2/tools/parity-coverage.mjs      # markdown mode: the ⚪ row list
```

---

## Part 1 — the 13 ⚪ inventory rows

Source: `parity-coverage.mjs` markdown mode, run at this PR's tree. Counts are
skills 10/17 evidenced, commands 6/6, agents 22/25, hooks 0/3.

**Disposition legend** — `DRIVE` = needs a live run to close · `RE-DRIVE` = a scenario already exists,
but no surviving bundle witnesses it · `RECLASSIFY` = cannot be evidenced by construction.

### skills — 7 unevidenced

| Row | In any bundle? | Disposition | Verifying scenario |
|---|---|---|---|
| `migration` | no | **DRIVE** | new `migration` scenario (`/maister:migration`); no existing scenario reaches it |
| `mockup-studio` | no | **DRIVE** | needs a **UI-bearing sandbox** — Phase 4 only fires when `task_characteristics.ui_heavy`, and every current sandbox is a POSIX shell CLI. New `development-ui` scenario, or a UI variant of `development` |
| `orchestrator-framework` | no | **RECLASSIFY** | **not drivable.** It is explicitly "NOT an executable skill — provides reference documentation" (`plugins/maister/CLAUDE.md`). It can never emit an `invoked_skill(...)` token, so ⚪ here means *not applicable*, not *untested*. Mark it N/A on the Parity-Map rather than leaving it pending a drive that cannot exist |
| `performance` | no | **DRIVE** | new `performance` scenario (`/maister:performance`) — closes `bottleneck-analyzer` in the same run |
| `product-design` | no | **DRIVE** | new `product-design` scenario — closes `html-companion-writer` in the same run |
| `quick-dev` | no | **DRIVE** | new `quick-dev` scenario; cheapest of the seven (no orchestrator phases) |
| `standards-update` | no | **DRIVE** | new `standards-update` scenario, or an `init` follow-on drive that then updates a standard |

### commands — 0 unevidenced

All 6 commands (`reviews-code`, `reviews-pragmatic`, `reviews-production-readiness`,
`reviews-reality-check`, `reviews-spec-audit`, `work`) now carry evidence. `work` is the row this PR's
regeneration flipped, and it is a **command**, not a skill.

### agents — 3 unevidenced

| Row | In any bundle? | Disposition | Verifying scenario |
|---|---|---|---|
| `ascii-mockup-generator` | no | **DRIVE** | a `mockup-studio` drive with `mockup_format: ascii` (or Node made unavailable, which forces the same fallback) |
| `bottleneck-analyzer` | no | **DRIVE** | the `performance` scenario above — it is that orchestrator's only analysis agent, so one drive closes both rows |
| `html-companion-writer` | no | **DRIVE** | the `product-design` scenario above (Phases 5/6/8). **Note the trap:** three bundles do produce `*.html` companions (`spec.html`, `implementation-plan.html`, `implementation-verification.html`), but in the development workflow those are written by the *producing* subagent, not by `html-companion-writer`. Those files must **not** be read as evidence for this row |

### hooks — 3 unevidenced

| Row | In any bundle? | Disposition | Verifying scenario |
|---|---|---|---|
| `block-destructive-commands` | **no — see Findings** | **RE-DRIVE** | the `destructive-guard` scenario already exists and is designed to emit `hook_effect(destructive_guard=ask)`. The one surviving destructive-guard bundle does not witness it, so this needs a fresh drive, not a new scenario |
| `post-compact-reminder` | no | **DRIVE** | needs a **compaction-inducing** drive; no scenario forces compaction today, and all seven bundles report "Compaction resume: ⚪ not observed". Note that any bundle older than `db6b052` (2026-09-03, #120) could not have evidenced it regardless — the `SessionStart` `additionalContext` was a silent no-op until that fix, so **six of the seven survivors predate the fix** |
| `skill-invocation-reminder` | no (named in 1 bundle, as prompt text only) | **DRIVE** | drivable in principle on any skill-invoking scenario, **but the observability is an open question** — it is unclear which event a reminder injection surfaces as, if any. Resolve observability before spending a drive on it |

---

## Part 2 — behavioral dimensions across the seven bundles

These are the dimensions `parity-evidence.mjs` extracts. Most are already closed; they are listed so a
wiki refresh can cite the specific bundle rather than re-deriving.

| Dimension | Status | Best evidence |
|---|---|---|
| Delegation + per-agent model | ✅ **closable** | 31 delegations in `20260904T214857Z`. Non-default models observed and attributed: `project-analyzer` → `claude-haiku-4.5` (`20260903T004846Z`), `spec-auditor` → `claude-sonnet-4.6` (`20260831T024753Z`), `explore` → `gpt-5.4-mini` throughout |
| Parallel fan-out | ✅ **closable** | peak 10× concurrent `task` executions in `20260904T214857Z`; 6× in `20260903T000910Z`; 4× in `20260831T024753Z` and `20260903T004846Z` |
| Verification fan-out | 🟡 **closable as ADAPTED** | 4 bundles show review agents delegated *via the skill hop* — agents run, isolation kept, but reached through `invoked_skill(reviews-*)`. Widest set in `20260904T214857Z` (5 agents / 5 skills). This is the documented 🟡 delta, not a gap |
| Task items (TaskCreate→todos) | ✅ **closable** | 5 of 7. Richest: `20260903T004846Z` (35 `session.todos_changed`, 13 `sql` calls) |
| Standards lazy-load | ✅ **closable** | 6 of 7. Richest: `20260903T004846Z` (42 reads, including `vision.md` / `roadmap.md`, not just `INDEX.md`) |
| Dashboard + HTML companions | ✅ **closable** | 3 of 7 carry `dashboard.html` + `dashboard-data.js` (`20260831T024753Z`, `20260903T000910Z`, `20260904T214857Z`) |
| Gates (question text, in order) | ✅ **closable** | 6 of 7; 17 gates in `20260903T003148Z`, 16 in two development bundles |
| **Compaction resume** | ⚪ **needs a drive** | 0 of 7. No `session.compaction_*` / truncation event in any bundle — no scenario induces compaction. Pairs with the `post-compact-reminder` hook row above; **one drive closes both** |
| **`hook_effect(destructive_guard=ask)`** | ⚪ **needs a re-drive** | 0 of 1 destructive-guard bundle — see Findings |

---

## Findings

### F1 — the surviving `destructive-guard` bundle does not witness the guard

`scenarios/destructive-guard.mjs` states its own contract: the guard's `ask` "surfaces LIVE as a
`permission.requested` event whose `data.permissionRequest` carries `kind:"hook"` (an ordinary shell
permission is `kind:"shell"`)", and the extractor emits `hook_effect(destructive_guard=ask)` from it.

In `$R/20260831T022944Z` — the only surviving destructive-guard bundle — the observed sequence is:

- `permission.requested` → `permissionRequest.kind` is **`"shell"`**, not `"hook"`; no `hookMessage`
- `permission.completed` → `result.kind` is **`"approved"`**
- `tool.execution_complete` → `success: true`, shell exit code **0**, output `.tmp-scratch removed`

So the destructive command **ran**, and no `hook_effect` predicate could have been emitted from this
bundle. The Copilot override (`hooks-overrides/block-destructive-commands.sh:54`) matches the command
text unconditionally — there is no agent whitelist on the Copilot side — so caller identity does not
explain it.

**This is recorded, not resolved.** It is out of WP4's scope, and it is deliberately not swept under the
rug (AGENTS.md § "Parity, and honest knowledge of the gaps"). Two candidate explanations, neither
verified here: the L2 rundir for that run did not install the plugin hooks, or the guard genuinely did
not fire on `1.0.82` at `maisterVersion 2.2.3`. Note also that this bundle predates `db6b052` (#120),
which fixed a *different* hook (`post-compact-reminder`) that had been a silent no-op — so a
hook-delivery problem in that window is plausible but unproven.

**Recommended follow-up:** a fresh credit-gated `destructive-guard` drive, checking specifically for
`permissionRequest.kind === "hook"`. If the guard still does not fire, that is a live parity gap needing
its own issue, and the currently-green `--check-reference` verdict for this scenario would be checking a
reference against the workflow model while no run demonstrates the modelled behavior.

### F2 — a drive-batching hint

The 12 drivable rows collapse into **6 drives**, not 12:

1. `performance` → closes `performance` + `bottleneck-analyzer`
2. `product-design` → closes `product-design` + `html-companion-writer`
3. `development-ui` (UI-bearing sandbox) → closes `mockup-studio`; with `mockup_format: ascii`, also `ascii-mockup-generator`
4. `migration` → closes `migration`
5. `quick-dev` + `standards-update` (cheap, can share a sandbox) → closes both
6. a compaction-inducing drive → closes `post-compact-reminder` + the compaction-resume dimension

plus the `destructive-guard` **re-drive** (F1). `orchestrator-framework` needs no drive at all.

**Driving these costs credits and is explicitly out of #138's scope** — the spec excludes it as
spend-gated ("WP4 step 2 — grouping 'needs a drive' ⚪ rows into batches and driving them"). This file is
step 1: the credit-free classification. The batching above is the input to that later, separately
approved spend.
