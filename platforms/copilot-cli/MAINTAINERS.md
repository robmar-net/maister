# maister-copilot — maintainer notes

Maintainer-facing companion to [`README.md`](./README.md). The README is **shipped inside the
variant** (`build.sh` copies it to `plugins/maister-copilot/README.md`), so it obeys the
variant's branding contract and cannot name the upstream assistant. This file does not ship, so
it can.

`plugins/maister-copilot/` is **generated** from the Claude source (`plugins/maister/`) by
[`build.sh`](./build.sh). Never edit the generated tree or the Claude source to fix a
Copilot-only issue — fix it in `build.sh` (or the `hooks-overrides/`) so the Claude variant
stays byte-for-byte intact and a rebuild reproduces the fix.

## Build & checks

```bash
make build               # regenerate plugins/maister-copilot/ from plugins/maister/
make validate            # static contracts (naming, branding, ask_user, hooks, guard)
make check-deterministic # two builds must be byte-identical (CI auto-commit stays a no-op)
make test-copilot        # L0: load into a real Copilot CLI, assert 7 runtime contracts
make test-hooks          # L1: hook-effect checks
make test-l2-unit        # L2: credit-free unit suite for the conformance harness
```

## What `build.sh` does

Copies `plugins/maister/` → `plugins/maister-copilot/`, overlays the Copilot-specific hooks
(`hooks-overrides/`), then applies deterministic, guarded transforms: strip plugin-id
prefixes, kind-aware reference rewrites, `CLAUDE.md`→`.github/copilot-instructions.md` in
skills, `AskUserQuestion`→`ask_user`, a branding scrub, the review-workflows-as-skills
rewrite, removal of the (Claude-oriented) documentation-URLs section, the appended
`## Platform: Copilot CLI` note, the top-of-file "not loaded" banner on `CLAUDE.md`, the
plugin-root variable rename, and finally the staging of this directory's `README.md` into the
variant. See the numbered step comments in `build.sh`.

The generated `plugins/maister-copilot/CLAUDE.md` is a maintainer-facing carry-over of the
Claude doc (see the banner at its top), not a runtime input — a plugin's root `CLAUDE.md` is
not loaded into model context on Copilot.

### Plugin-root variable rename (step 9, upstream v2.2.4)

The emitted skills spell the plugin directory `${MAISTER_PLUGIN_ROOT}` rather than
`${CLAUDE_PLUGIN_ROOT}`; `make validate` enforces both the absence of the Claude name in the
emitted skills and count parity with the source tree. Two source skills are affected
(`mockup-studio/SKILL.md` and its `references/visual-companion.md`), where a skill instructs an
agent to start the preview server from the plugin directory.

This rename arrived **from upstream**, not from a fork-side measurement, and the two claims in
play are about different expansion paths — so neither refutes the other:

- **Measured here (live T8/T9):** `${CLAUDE_PLUGIN_ROOT}` inside `hooks/hooks.json` expands
  correctly on Copilot CLI — the runtime substitutes it when it launches a hook. That is why
  `build.sh` keeps the Claude-format `hooks.json` unchanged.
- **Asserted upstream, unverified here:** the variable is absent from the *agent's shell
  environment*, so a skill telling the model to run `node ${CLAUDE_PLUGIN_ROOT}/...` names
  something unset. This is a different mechanism from hook launching and has **not** been
  measured on Copilot.

The rename is therefore adopted as plausible and self-consistent (the variant names its own
variable and the shipped README documents the export), but its premise is still unverified.
Tracked as a follow-up probe rather than silently treated as established.

### Agent `model:` mapping (step 3b, #86)

Copilot **honors** agent-level `model:` frontmatter, but a Claude alias that is not a Copilot
catalog id errors at delegation (`"Model 'haiku' is not available"`) and the agent falls back to
the default model. `build.sh` maps the aliases to live Copilot catalog ids (verified on 1.0.82):

| Claude `model:` | Copilot output |
|---|---|
| `inherit` | left as-is (keyword → session/default) |
| `haiku` | `claude-haiku-4.5` |
| `sonnet` | `claude-sonnet-5` |
| `opus` | `claude-opus-5` |
| anything else | **build fails** — extend the map |

`make validate` (WS5.17) also fails on any bare Claude alias left in a generated agent. Rationale and
the probe that established the failure mode: [`docs/adr/0002`](../../docs/adr/0002-copilot-agent-model-mapping.md).
