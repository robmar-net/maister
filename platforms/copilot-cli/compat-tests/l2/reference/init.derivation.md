# L2 Reference Derivation — `init`

Derivation record for `init.skeleton.json`: every reference entry traced to the workflow model it is
derived from. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `init` (first-touch bootstrap; #85, #76 WP-E) |
| Source (read-only citation source) | `plugins/maister/skills/init/SKILL.md` (`I:N`) |
| maister_version | `2.2.3` |
| workflow_model_version | `6` |
| Sibling JSON hash | `1984d7d63304d4f0197923f9e8b0c7468ddf25dced11bd0e7724eef7349416be` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) (genesis: note 38) |

`I:N` anchors cite `skills/init/SKILL.md` (read-only). Partition sizes: 6 required + 5 optional + 0 rules
+ 0 allowlist = 11 rows. Sandbox: NEW `sample-cli-bare` (no `.maister/`); the `init` TREE_PROFILE uses
`rootRel: .maister/docs` so `created_artifact(INDEX.md)` is read from the docs tree init writes.

## Required (6)

| predicate | partition | citation | note |
|---|---|---|---|
| `invoked_skill(init)` | required | I:1-3 | the user-invocable bootstrap skill (`name: maister:init`) |
| `delegated(project-analyzer)` | required | I:49 | "Invoke `project-analyzer` subagent via the Task tool" — codebase analysis precedes doc generation on every init |
| `delegated(docs-operator)` | required | I:11, I:112, I:160 | all docs-manager operations run via the `docs-operator` subagent (I:11 — "Use the Task tool with `docs-operator` subagent … for all docs-manager operations"); creates the docs structure (I:112) and regenerates INDEX.md (I:160) |
| `created_artifact(INDEX.md)` | required | I:167 | "Verify INDEX.md exists" — the master index is the always-created core of the `.maister/docs/**` tree (read via the docs-rooted TREE_PROFILE) |
| `outcome(init-structure)=pass` | required | I:160, I:167, I:175 | FUNCTIONAL ORACLE (Stage 2). The bootstrap must produce a materially non-trivial docs index, not a stub: `.maister/docs/INDEX.md` exists with >=5 non-blank lines (I:175 "Structure created (tree with check marks for created items)") |
| `reached_terminal(completion)` | required | I:175 | the skill's terminal — the created-structure summary |

## Optional (5)

| predicate | partition | citation | note |
|---|---|---|---|
| `invoked_skill(standards-discover)` | optional | I:11 (Phase 8, "Use the Skill tool only for standards-discover … the last phase") | the final phase invokes `standards-discover` via the Skill tool; conditional on that phase running, so optional |
| `gate_fired(ask)` | optional | init's interactive setup questions (standards selection etc.) | init asks setup questions; the presence/number of gates depends on the project + the selected options |
| `gate_fired(permission)` | optional | platform divergence (no model anchor) | Copilot permission prompts are a harness surface, not model-mandated |
| `gate_fired(exit_plan_mode)` | optional | platform divergence | init is not a plan-mode workflow; listed optional only to absorb a platform-emitted plan event if one occurs |
| `standards(index_read)` | optional | init CREATES the index rather than reading it | a read of `.maister/docs/INDEX.md` is not expected on a fresh bootstrap; optional to absorb one if the model re-reads what it wrote |

## Rules (0)

`rules[] = []` — no phase-numbered exit gate invented; init's questions are setup choices, not
phase-completion gates.

## Allowlist (0)

`allowlist[] = []` at genesis — populated (if needed) from the live N=1 run with any predicate the model
legitimately emits that is neither required nor a genuine regression (e.g. an instruction-file
`created_artifact` if the docs-rooted profile is later extended to capture `.github/copilot-instructions.md`).
