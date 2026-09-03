# L2 Reference Derivation — `work`

Derivation record for `work.skeleton.json`: every reference entry traced to the workflow model it is
derived from. Edits to the sibling JSON are governed by the audit trail in
[CALIBRATION-LOG.md](CALIBRATION-LOG.md).

| | |
|---|---|
| Scenario | `work` (front-door routing; #85, #76 WP-E) |
| Source (read-only citation sources) | `plugins/maister/commands/work.md` (`W:N`), `plugins/maister/agents/task-classifier.md` (`C:N`) |
| maister_version | `2.2.3` |
| workflow_model_version | `6` |
| Sibling JSON hash | `59659cc3984ccbbda9624881eacbcb1044d28137ee8aaca14939041570619293` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) (genesis + live calibration: note 37) |

`W:N` anchors cite `commands/work.md`; `C:N` anchors cite `agents/task-classifier.md` (both read-only).
Partition sizes: 4 required + 21 optional + 0 rules + 0 allowlist = 25 rows. The optional set was
calibrated from the live N=1 drive (bundle `20260903T003148Z`), which routed to `development` — see the
"Optional" note below and CALIBRATION note 37.

**Design — route-INVARIANT required set.** `work` is an ENTRY POINT, not a workflow: it classifies the
task and routes to one of development / performance / migration / research / quick-* (`W` "Workflow Type
Routing" table). The *routed* workflow is therefore task-dependent and must NOT be pinned. The reference
requires only what holds on EVERY route for this sandbox — the entry skill, the classifier delegation,
the terminal deliverable-fixed outcome, and the terminal — and leaves the concrete route's markers
optional. Route-specific extras observed live (e.g. a `development` orchestrator tree) are calibrated
into `optional`/`allowlist` from the N=1 run, never fitted blindly (the quick-bugfix-genesis pattern,
CALIBRATION note 4).

## Required (4)

| predicate | partition | citation | note |
|---|---|---|---|
| `invoked_skill(work)` | required | W:2-3, W:6 | The user-invocable entry skill (`name: maister:work`, W:2). W:6 — "This is a multi-step workflow that invokes the task-classifier subagent and orchestrator skills." Naming the `work` entry point routes through this skill on every task |
| `delegated(task-classifier)` | required | W:6, "How It Works" step 2 ("Invoke task-classifier subagent") | `work` ALWAYS classifies a new task by delegating to the `task-classifier` subagent before routing (`W` step "Classify & Route New Task"). Route-invariant: classification precedes every workflow |
| `outcome(bug-fixed)=pass` | required | W routing → bug-fix path; oracle reused from quick-bugfix | FUNCTIONAL ORACLE (Stage 2). The seeded `upper` defect must actually be fixed by whatever workflow `work` routes to — the restaged `run-tests.sh` passes iff the deliverable is correct. Route-invariant terminal check |
| `reached_terminal(completion)` | required | W "How It Works" (route → orchestrator runs to completion) | The routed workflow runs to its terminal; a completed `work` run reaches a completion terminal |

## Optional (21)

`work` routes task-dependently, so every routed-workflow marker is optional — matched when that route is
taken, silently absent otherwise. The concrete set below was **calibrated** from the live N=1 drive, which
routed to `development`: each development marker is model-grounded (it appears as a REQUIRED predicate in
`development.skeleton.json`'s own reference), so listing it here is not run-fitting — it is naming the
documented predicates of a documented route.

| predicate(s) | partition | citation | note |
|---|---|---|---|
| `invoked_skill(quick-bugfix)` | optional | W routing table (quick keywords → quick path); C classification | The quick route for a small scoped bug — not taken in the N=1 drive (the classifier chose `development`), kept optional so a future quick route matches |
| `invoked_skill(development)`, `invoked_skill(codebase-analyzer)`, `invoked_skill(implementation-plan-executor)`, `invoked_skill(implementation-verifier)`, `invoked_skill(reviews-code)`, `invoked_skill(reviews-spec-audit)` | optional | `development.skeleton.json` (each is a development-route skill); live bundle `20260903T003148Z` | THE ROUTE TAKEN in the N=1 drive. The classifier routed the bug to the full development workflow; these are its documented skill invocations, optional because the route is task-dependent |
| `delegated(explore)`, `delegated(codebase-analysis-reporter)`, `delegated(gap-analyzer)`, `delegated(specification-creator)`, `delegated(spec-auditor)`, `delegated(implementation-planner)`, `delegated(task-group-implementer)`, `delegated(implementation-completeness-checker)`, `delegated(code-reviewer)` | optional | `development.skeleton.json` delegations; live bundle | development's documented subagent delegations along the taken route; optional for the same task-dependent reason |
| `todos(created)` | optional | development orchestrator task-item creation | the routed development workflow creates task items; route-dependent |
| `gate_fired(ask)`, `gate_fired(exit_plan_mode)` | optional | routed workflow's gates (task-dependent) | whatever gate the routed workflow fires belongs to it, not to `work` |
| `gate_fired(permission)` | optional | platform divergence (no model anchor) | Copilot permission prompts are a harness surface, not model-mandated |
| `standards(index_read)` | optional | routed workflow's standards discovery (`.maister/docs/INDEX.md`) | conditional on the routed workflow reading INDEX.md and on it existing; not guaranteed on this bare sandbox |

## Rules (0)

`rules[] = []` — intentionally empty. `work` pins no `gate_fired_at(phase-N)`: phase-numbered exit gates
belong to the ROUTED workflow and are task-dependent, so none are invented at the entry-point layer.

## Allowlist (0)

`allowlist[] = []` at genesis — populated (if needed) from the live N=1 run with any route-specific
predicate the model legitimately emits that is neither required nor a genuine regression (e.g. the
`development` orchestrator's `delegated(...)`/`created_artifact(...)` if the classifier routes there).
