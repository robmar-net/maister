# ADR 0005 — Post-compaction resume on Copilot: a structural LIMITATION, mitigated by the always-on reminder

- **Status:** Accepted — 2026-09-03
- **Deciders:** robmar (operator) + agent
- **Tracking:** [robmar-net/maister#76](https://github.com/robmar-net/maister/issues/76) (WP-C2), [#13](https://github.com/robmar-net/maister/issues/13)
- **Related:** [AGENTS.md](../../AGENTS.md) "Parity, and honest knowledge of the gaps"; `platforms/copilot-cli/build.sh` (WS2d); Parity-Map "Post-compaction resume" row

## Context

On Claude, maister ships a `SessionStart` hook matched to `compact` (`hooks/post-compact-reminder.sh`)
that fires **after a context compaction** and re-injects "re-read `orchestrator-state.yml`, use the phase
gates" — so a long orchestrator run survives a compaction without losing its place. The Parity-Map row
"Post-compaction resume" was 🟡 with "consequence never measured" and a pointer to a probe (#76 WP-C2:
force a compaction, check whether a hook-emitted reminder survives into the post-compaction context).

## Decision

Record post-compaction resume as a **documented, structural LIMITATION with a shipped mitigation** — not
an open "unmeasured" row awaiting a probe. The probe is unnecessary because the mechanism it would test
for **does not exist on Copilot**, and this is already established, not speculative:

1. **Copilot has no post-compaction hook surface.** `SessionStart` on Copilot supports no `matcher` and
   has no `compact` source (sources are startup / resume / new); a real compaction fires `preCompact`
   (*before*, not after) and there is no `postCompact` (verified live + the hooks-configuration reference;
   build.sh WS2d). So a Claude-style `SessionStart:compact` reminder can never fire on Copilot — shipped
   unchanged it would instead over-fire on **every** session start with misleading "post-compaction"
   wording.
2. **So the hook is de-registered** (build.sh WS2d, [#13](https://github.com/robmar-net/maister/issues/13)),
   and its state-reread nudge is **folded into the always-on `SessionStart` skill-invocation reminder**
   (`hooks-overrides/skill-invocation-reminder.sh`, the "⚠️ ACTIVE WORKFLOW STATE" rule) — the closest
   available substitute, verified injected live on 1.0.82 (L1c) and corrected to Copilot nomenclature in
   [#95](https://github.com/robmar-net/maister/issues/95). It rides **every** session start rather than
   firing specifically after a compaction.

The delta the user actually experiences is therefore **not** "resume is lost", but "the resume reminder
is not compaction-*scoped* — it is always on". That is a benign over-fire, not a missing capability.

## Consequences

- The Parity-Map "Post-compaction resume" row stays **🟡** but its why-not is now this ADR (a structural
  platform gap + a shipped mitigation), not "never measured". No `compaction_*` events appeared in any
  persisted bundle, so there is nothing to measure from evidence either — the limitation is upstream of
  measurement.
- **No probe is spent** on WP-C2: forcing a compaction would only confirm the absence of a `postCompact`
  surface that the platform is already documented not to have.
- **Possible future fix (not taken now):** if a Copilot release adds a `preCompact` plugin-hook surface
  that can inject `additionalContext` surviving into the post-compaction context, a Copilot-only
  `hooks-overrides/pre-compact-reminder.sh` could make the reminder compaction-scoped again (→ 🟢). Until
  such a surface exists this is untestable; tracked as a note on the row, not an open probe.

## Alternatives rejected

- **Ship the Claude `SessionStart:compact` hook unchanged** — Copilot ignores the matcher and over-fires
  the reminder on every start with false "post-compaction" wording (worse than the fold-in mitigation).
- **Leave the row "unmeasured" pending a probe** — the probe cannot find a mechanism the platform does
  not expose; that would spend credits to reconfirm a documented absence and leave the 🟡 without a
  why-not, which AGENTS.md forbids.
