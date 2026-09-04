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
| Sibling JSON hash | `b7f60681eb1679c995a09e5740c856948bdde5ed52568a522e3c8ea27d5c827d` |
| Audit trail | [CALIBRATION-LOG.md](CALIBRATION-LOG.md) |

`W:N` anchors cite `commands/work.md`; `C:N` anchors cite `agents/task-classifier.md` (both read-only).
Partition sizes: 4 required + 5 optional + 0 rules + 0 allowlist = 9 rows.

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

## Optional (5)

| predicate | partition | citation | note |
|---|---|---|---|
| `invoked_skill(quick-bugfix)` | optional | W routing table (development/quick keywords → bug-fix path); C classification | The EXPECTED route for a small, scoped, reproducible bug is the quick path — but the classifier may route to `development` instead (both fix the bug), so the concrete routed skill is optional, not required |
| `gate_fired(ask)` | optional | routed workflow's gates (task-dependent) | Whatever gate the routed workflow fires belongs to it, not to `work`; presence depends on the route (quick-bugfix's plan gate vs development's phase gates) |
| `gate_fired(permission)` | optional | platform divergence (no model anchor) | Copilot permission prompts are a harness surface, not model-mandated; fire-or-not depends on session permission mode |
| `gate_fired(exit_plan_mode)` | optional | routed workflow's plan gate (task-dependent) | Only present when the routed workflow uses plan mode (e.g. quick-bugfix); platform-dependent whether a distinct exit event is emitted |
| `standards(index_read)` | optional | routed workflow's standards discovery (`.maister/docs/INDEX.md`) | Conditional on the routed workflow reading INDEX.md and on INDEX.md existing; not guaranteed on this bare sandbox |

## Rules (0)

`rules[] = []` — intentionally empty. `work` pins no `gate_fired_at(phase-N)`: phase-numbered exit gates
belong to the ROUTED workflow and are task-dependent, so none are invented at the entry-point layer.

## Allowlist (0)

`allowlist[] = []` at genesis — populated (if needed) from the live N=1 run with any route-specific
predicate the model legitimately emits that is neither required nor a genuine regression (e.g. the
`development` orchestrator's `delegated(...)`/`created_artifact(...)` if the classifier routes there).
