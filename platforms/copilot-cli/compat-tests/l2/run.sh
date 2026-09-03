#!/usr/bin/env bash
#
# L2 — Workflow-model conformance testing harness: thin bash operator wrapper for run.mjs.
#
# Drives ONE Copilot workflow (development by default; research, quick-bugfix, destructive-guard,
# work or init via --scenario) through the bundled @github/copilot-sdk (via l2/run.mjs), reduces
# the typed trace + task-dir tree + orchestrator-state.yml to a normalized predicate Set, and
# set-compares it to the committed maister-model-derived reference. Answers "did this Copilot release or generator change break the
# maister workflow?" with one `make test-l2` — without false-alarming on legitimate LLM
# non-determinism, and honestly SKIPping when there is no seat.
#
# This wrapper is INTENTIONALLY thin: all asserted logic lives in the credit-free ESM modules
# (sdk-path / extractor / normalize / compare) and in run.mjs. Here we only: reprint this help,
# short-circuit the credit-free `--check-reference` staleness guard, gate on a Copilot seat,
# de-shadow the operator's globally-installed maister-copilot, stage a throwaway sandbox rundir,
# and hand off to `node run.mjs`.
#
# Usage:
#   bash run.sh                        # full live run (needs an authenticated Copilot seat + AI credits)
#   bash run.sh --scenario=<id>        # development (default) | research | quick-bugfix |
#                                      # destructive-guard | work | init
#   bash run.sh --check-reference      # CREDIT-FREE: staleness/tamper verdict for the committed reference
#   bash run.sh --scenario=research --check-reference  # CREDIT-FREE verdict for the research reference
#   bash run.sh --scenario=quick-bugfix --check-reference  # CREDIT-FREE verdict for the quick-bugfix reference
#   bash run.sh --keep-rundir          # retain the throwaway sandbox rundir (debugging)
#   bash run.sh --mutation=<M1|M2|M3>  # NEGATIVE CONTROL: stage a KNOWN-BROKEN throwaway copy of the
#                                      # plugin (built by mutations/mutate.sh) and drive it live — the
#                                      # run must come back REGRESSED, proving the harness detects
#                                      # breakage. M1 also hands off the neutral prompt
#                                      # mutations/m1-neutral-prompt.txt via COMPAT_PROMPT_FILE
#                                      # (ADR-001: the committed prompt itself commands a plan gate,
#                                      # which would confound the gate-removed control). Mutants are
#                                      # never kept (--keep-rundir does not apply to them).
#   bash run.sh -h | --help            # print this header and exit 0
#
# Credit-free guarantee (LOW-4):
#   `--check-reference` and `-h/--help` are short-circuited at the TOP, BEFORE the seat preflight
#   and the plugin de-shadow, so the offline staleness verdict is NEVER masked by a no-seat SKIP.
#
# No seat -> loud SKIP (exit 0), never a failure. A true seat can only be confirmed by a live
# call (performed inside run.mjs, which surfaces a missing seat as INCOMPLETE); this wrapper's
# preflight is a best-effort binary + operator-config pre-check.
#
# Env overrides:
#   COMPAT_PLUGIN_DIR=<dir>  plugin under test (default: <repo>/plugins/maister-copilot)
#   COMPAT_KEEP_RUNDIR=1     keep the run-local sandbox rundir (same as --keep-rundir)
#   COMPAT_NO_SEAT=1         force the no-seat SKIP (CI / test without a Copilot seat)
#   COPILOT_CONFIG=<path>    operator config to de-shadow (default: ~/.copilot/config.json) [test seam]
#
# Isolation (side-effect-free) — mirrors L0 run.sh / L1 l1-hook-effects.sh:
#   The operator's globally-installed maister-copilot SHADOWS a same-named --plugin-dir build
#   (Copilot name-dedup), so the fresh build is de-shadowed by temporarily removing it from
#   ~/.copilot/config.json (JSONC-safe), restored BYTE-IDENTICALLY via a trap. The live workflow
#   runs in a mktemp rundir seeded from l2/sandbox/sample-cli; the real repo is never mutated.
#
set -euo pipefail

# ---------------------------------------------------------------------------- paths (mirrors L0 run.sh:37-45)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# NOTE: l2/ is ONE level deeper than the L0/L1 scripts, so repo root is FOUR ups
# (l2 -> compat-tests -> copilot-cli -> platforms -> <repo>), not three. run.mjs uses the same depth.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PLUGIN_DIR="${COMPAT_PLUGIN_DIR:-$REPO_ROOT/plugins/maister-copilot}"
# Staged negative-control mutant dir (set on the live path when --mutation=<id> is given). Empty =
# no mutant staged; cleanup() removes it via the mandated if-form. Mutants are NEVER kept.
MUTANT_DIR=""
# shellcheck disable=SC2034  # defined for L0-parity + operator documentation; run.mjs writes the report
REPORTS_DIR="$SCRIPT_DIR/../reports"          # reports live at compat-tests/reports (one level up from l2/)
RUN_MJS="$SCRIPT_DIR/run.mjs"
# Scenario to drive (default development; override with --scenario=<id>). SANDBOX_TEMPLATE is
# re-resolved + validated from $SCENARIO after arg parsing (live path); this is the safe default.
SCENARIO="development"
SANDBOX_TEMPLATE="$SCRIPT_DIR/sandbox/sample-cli"

# ---------------------------------------------------------------------------- config-restore state
# REAL_CONFIG is overridable via COPILOT_CONFIG (a documented test/operator seam); NEUTRALIZED is
# defined up front (0) so the sourced helpers are safe under `set -u`. CONFIG_BACKUP is set once the
# rundir exists (in main).
REAL_CONFIG="${COPILOT_CONFIG:-$HOME/.copilot/config.json}"
NEUTRALIZED=0
CONFIG_BACKUP=""

# ---------------------------------------------------------------------------- helpers
# Copied VERBATIM from L0 run.sh (documented duplication; a shared-lib refactor is a named deferred
# follow-up per the plan Notes). Bash 3.2 compatible — no associative arrays.

# sedi — portable in-place sed (GNU vs BSD). Retained for L0 parity; unused in L2 (run.mjs owns all
# sandbox templating), kept so the helper block stays a verbatim, drop-in copy of L0 run.sh:59.
sedi() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }

# Strip full-line // comments (Copilot's config.json is JSONC) and drop the maister-copilot entry
# from installedPlugins. Reads $1, writes $2. (Verbatim from L0 run.sh:63-74.)
filter_config() {
  python3 - "$1" "$2" <<'PY'
import json, re, sys
src, dst = sys.argv[1], sys.argv[2]
raw = open(src).read()
stripped = "\n".join(l for l in raw.splitlines() if not re.match(r"^\s*//", l))
c = json.loads(stripped)
if isinstance(c.get("installedPlugins"), list):
    c["installedPlugins"] = [p for p in c["installedPlugins"] if p.get("name") != "maister-copilot"]
json.dump(c, open(dst, "w"), indent=2)
PY
}

# Restore the operator's config from the byte-identical backup (verbatim from L0 run.sh:104-109).
restore_config() {
  if [ "$NEUTRALIZED" = "1" ] && [ -f "$CONFIG_BACKUP" ]; then
    cp -a "$CONFIG_BACKUP" "$REAL_CONFIG" 2>/dev/null || true
    NEUTRALIZED=0
  fi
}

# EXIT/INT/TERM cleanup: restore config, then drop the rundir unless kept (from L0 run.sh:110-113;
# the MUTANT_DIR removal is an L2-only addition — not in L0).
cleanup() {
  restore_config
  [ "${COMPAT_KEEP_RUNDIR:-0}" = "1" ] || rm -rf "$RUNDIR"
  # Negative-control mutants are NEVER kept (COMPAT_KEEP_RUNDIR does not apply). MANDATED if-form —
  # the `[ -n … ] && rm -rf …` one-liner returns 1 when MUTANT_DIR is empty, and as the function's
  # last statement that 1 would become cleanup()'s exit status (tests call cleanup() directly).
  if [ -n "$MUTANT_DIR" ]; then
    rm -rf "$MUTANT_DIR"
  fi
}

# Reprint the header comment block (lines after the shebang, up to `set -euo pipefail`), stripping
# the leading "# " — the L0 run.sh:53 `sed` header-reprint idiom, tightened to exclude code lines.
print_header() {
  sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------------------- source guard
# When SOURCED (by the Group 8 test harness) expose the helper functions but do NOT run main — the
# preflight/SKIP `exit 0` would otherwise terminate the caller's shell. When EXECUTED, BASH_SOURCE[0]
# == $0 so this is skipped and main runs. (The functions above remain a verbatim L0 copy; only this
# guard is added, for testability.)
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
  # shellcheck disable=SC2317  # reachable ONLY when sourced (guarded above); false-positive otherwise
  return 0 2>/dev/null || true
fi

# ============================================================================ main
# ---------------------------------------------------------------------------- args
CHECK_REFERENCE=0
MUTATION=""
for a in "$@"; do
  case "$a" in
    -h|--help)          print_header; exit 0 ;;
    --check-reference)  CHECK_REFERENCE=1 ;;
    --scenario=*)       SCENARIO="${a#--scenario=}" ;;
    --mutation=*)       MUTATION="${a#--mutation=}" ;;
    --keep-rundir)      COMPAT_KEEP_RUNDIR=1 ;;
    *) echo "Unknown argument: $a" >&2; exit 2 ;;
  esac
done

# Validate --mutation at PARSE time (credit-free reject): an unknown id exits 2 BEFORE the
# --check-reference short-circuit, the seat preflight, and any config mutation — no verdict, no SKIP
# banner, nothing staged. Empty = no mutation (the positive path, byte-identical behavior).
case "$MUTATION" in
  ""|M1|M2|M3) ;;
  *) echo "run.sh: unknown mutation id '$MUTATION' (expected M1|M2|M3)" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------- LOW-4 credit-free short-circuit
# `--check-reference` returns the staleness/tamper verdict BEFORE the seat preflight and de-shadow,
# so a missing seat can never mask it as a SKIP. `exec` is safe here: no config mutation, no rundir,
# nothing for a trap to clean. run.mjs's --check-reference likewise constructs no SDK session.
if [ "$CHECK_REFERENCE" = "1" ]; then
  exec node "$RUN_MJS" --check-reference --scenario="$SCENARIO"
fi

# ---------------------------------------------------------------------------- scenario -> sandbox (live path)
# Resolve + validate the sandbox template for the selected scenario. development/research reuse
# sample-cli (research investigates the same codebase read-only); add a case for a new sandbox.
# This live-path allowlist MUST stay in lockstep with the run.mjs SCENARIOS registry — adding a
# scenario there without a case arm here makes `run.sh --scenario=<new>` fail INCOMPLETE.
# --check-reference already exec'd above (it needs no sandbox), so this guards only the live path.
case "$SCENARIO" in
  development|research) SANDBOX_TEMPLATE="$SCRIPT_DIR/sandbox/sample-cli" ;;
  quick-bugfix|work)   SANDBOX_TEMPLATE="$SCRIPT_DIR/sandbox/sample-cli-bug" ;;  # seeded, test-reproducible defect (work routes to a bug-fix workflow over it)
  destructive-guard)   SANDBOX_TEMPLATE="$SCRIPT_DIR/sandbox/sample-cli-destructive" ;;  # exercises the block-destructive-commands hook (#48 Stage 6)
  init)                SANDBOX_TEMPLATE="$SCRIPT_DIR/sandbox/sample-cli-bare" ;;  # a bare project (no .maister/) so init bootstraps it (#85)
  *) echo "L2 INCOMPLETE: unknown scenario '$SCENARIO' (expected development|research|quick-bugfix|destructive-guard|work|init)" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------- seat preflight (mirrors L1 :262-267 no-seat idiom)
# Best-effort: the copilot binary must exist AND the operator must have a Copilot config (written on
# login). Either absent -> loud SKIP (exit 0), never a FAIL. COMPAT_NO_SEAT=1 forces the SKIP. A true
# seat is only confirmable by the live call inside run.mjs (missing seat there -> INCOMPLETE/exit 2).
COPILOT_BIN="$(command -v copilot || true)"
SKIP_REASON=""
if [ "${COMPAT_NO_SEAT:-0}" = "1" ]; then
  SKIP_REASON="COMPAT_NO_SEAT=1 (seat check forced off)"
elif [ -z "$COPILOT_BIN" ]; then
  SKIP_REASON="the 'copilot' CLI is not on PATH"
elif [ ! -f "$REAL_CONFIG" ]; then
  SKIP_REASON="no Copilot config at $REAL_CONFIG (copilot not set up / not signed in)"
fi

if [ -n "$SKIP_REASON" ]; then
  echo "=========================================================================="
  echo " L2 SKIP — $SKIP_REASON."
  echo "           The conformance LIVE run needs an authenticated Copilot seat;"
  echo "           skipping it is NOT a failure (exit 0)."
  echo "           Credit-free staleness check still works:  bash run.sh --check-reference"
  echo "=========================================================================="
  exit 0
fi

# ---------------------------------------------------------------------------- run dir + trap (mirrors L0 run.sh:99-114)
RUNDIR="$(mktemp -d)"
CONFIG_BACKUP="$RUNDIR/config.json.orig"
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------- de-shadow (reversible; restored byte-identical)
# Temporarily remove the installed maister-copilot from the operator's config so the fresh
# --plugin-dir build is loaded under its REAL name; restore_config (explicit + trap) puts the
# original bytes back. If there is no config, there is nothing to shadow — proceed as-is.
#
# FAIL-CLOSED (F2): the de-shadow must NOT fail open. Under `set -euo pipefail` a left-of-`&&`
# failure does not abort, so `filter_config … && mv …` could leave the config un-de-shadowed while
# still flipping NEUTRALIZED — silently driving the operator's INSTALLED plugin instead of the fresh
# build. So (a) preflight python3 (filter_config needs it), (b) check filter_config's exit
# explicitly, and (c) post-condition grep that `maister-copilot` was actually removed. Any miss ->
# INCOMPLETE (exit 2), never a misleading live run. NEUTRALIZED is set BEFORE the grep so a
# post-condition bail still restores the original bytes via the trap.
if [ -f "$REAL_CONFIG" ]; then
  command -v python3 >/dev/null || { echo "L2 INCOMPLETE: python3 required for de-shadow" >&2; exit 2; }
  cp -a "$REAL_CONFIG" "$CONFIG_BACKUP"
  TMP="$REAL_CONFIG.l2.tmp"
  if ! filter_config "$REAL_CONFIG" "$TMP"; then echo "L2 INCOMPLETE: config de-shadow failed" >&2; exit 2; fi
  mv "$TMP" "$REAL_CONFIG"
  NEUTRALIZED=1
  if grep -q 'maister-copilot' "$REAL_CONFIG"; then
    echo "L2 INCOMPLETE: config de-shadow left maister-copilot in $REAL_CONFIG" >&2; exit 2
  fi
fi

# ---------------------------------------------------------------------------- negative-control mutation staging (R2)
# Only when --mutation=<id> was given: manufacture a KNOWN-BROKEN throwaway copy of the plugin via
# mutations/mutate.sh and repoint PLUGIN_DIR at it, so the live run PROVES the harness detects
# breakage. Placement is load-bearing: AFTER the trap is armed (cleanup() removes the mutant) and
# AFTER the de-shadow (the mutant loads under the REAL plugin name, so it must not be shadowed
# either), BEFORE the env hand-off. The source is the CURRENT $PLUGIN_DIR, so this composes with a
# COMPAT_PLUGIN_DIR override. (--check-reference already exec'd above and never reaches staging.)
#
# MANDATED form — never a bare MUTANT_DIR="$(...)" assignment: under `set -euo pipefail` a failing
# command substitution in a plain assignment aborts the script with mutate.sh's own exit code, which
# could leak exit 1 (= REGRESSED semantics). A failing builder is INCOMPLETE (exit 2), never exit 1.
if [ -n "$MUTATION" ]; then
  if ! MUTANT_DIR="$(bash "$SCRIPT_DIR/mutations/mutate.sh" "$MUTATION" "$PLUGIN_DIR")"; then
    echo "L2 INCOMPLETE: mutation staging failed" >&2; exit 2
  fi
  PLUGIN_DIR="$MUTANT_DIR"
  echo "NEGATIVE CONTROL: mutation $MUTATION staged at $MUTANT_DIR"
  # ADR-001 (M1 only): the committed scenario prompt itself commands "present a fix plan for
  # approval", which would re-impose the very gate M1 strips — a confounded experiment. Export the
  # neutral prompt file instead; env(1) below passes exported vars through to run.mjs. Positive
  # (no --mutation) runs NEVER set COMPAT_PROMPT_FILE.
  if [ "$MUTATION" = "M1" ]; then
    export COMPAT_PROMPT_FILE="$SCRIPT_DIR/mutations/m1-neutral-prompt.txt"
  fi
fi

# ---------------------------------------------------------------------------- stage the sandbox rundir
# run.mjs does NOT run the workflow in this rundir — driveOnce stages its OWN fresh per-drive mktemp
# rundir from l2/sandbox/<template> (makeFreshRundir; the dev workflow mutates its rundir, so drives
# never share one). A run.sh-provided COMPAT_RUNDIR otherwise surfaces only in the report's
# isolation note. Still stage it: copy the sandbox CONTENTS (incl. the .maister dotfile) into the
# rundir root, preserving +x on the runner scripts, so that note points at a real, populated dir.
cp -R "$SANDBOX_TEMPLATE"/. "$RUNDIR"/
chmod +x "$RUNDIR"/*.sh 2>/dev/null || true

# ---------------------------------------------------------------------------- hand off to run.mjs
# SUBPROCESS, deliberately NOT `exec`: the trap must survive to (a) restore the config byte-identical
# and (b) clean the rundir — run.mjs intentionally leaves a run.sh-provided COMPAT_RUNDIR alone
# (ownedByUs=false), so this wrapper owns its teardown. run.mjs maps the verdict to the exit code
# (0 AS-EXPECTED / 1 REGRESSED / 2 INCOMPLETE); we propagate it.
echo "  … driving one live '${SCENARIO}' workflow via run.mjs (consumes AI credits) …"
set +e
env COMPAT_RUNDIR="$RUNDIR" COMPAT_PLUGIN_DIR="$PLUGIN_DIR" COMPAT_KEEP_RUNDIR="${COMPAT_KEEP_RUNDIR:-0}" \
  node "$RUN_MJS" --scenario="$SCENARIO"
RC=$?
set -e

restore_config   # restore ASAP (the trap also restores; restore_config is idempotent)
exit "$RC"
