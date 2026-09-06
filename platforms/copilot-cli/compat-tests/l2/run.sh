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
#   bash run.sh --variant=<arm> --commit=<sha>
#                                      # A/B ARM (#122 G2, ADR-003): stage a THROWAWAY copy of the plugin
#                                      # from the PINNED commit (git archive, never the working tree) via
#                                      # variants/variant.sh, apply the arm's manifest transforms
#                                      # (variants/arms/<arm>.json: plain | plain-legacy | lean | caveman |
#                                      # terse | upstream) and drive that copy live. The pin may come from
#                                      # COMPAT_VARIANT_COMMIT instead of --commit=<sha> (the flag wins).
#                                      # --variant and --mutation are MUTUALLY EXCLUSIVE. All five
#                                      # misuses — invalid arm name (charset / leading dot or dash),
#                                      # unknown arm, --variant with --mutation, --variant without a
#                                      # pin, --commit without --variant — exit 2 at PARSE time,
#                                      # credit-free, before --check-reference and the seat preflight.
#                                      # Staged arms are never kept (--keep-rundir does not
#                                      # apply to them); run.mjs receives COMPAT_VARIANT,
#                                      # COMPAT_ARM_MANIFEST and COMPAT_VARIANT_COMMIT (provenance).
#   bash run.sh -h | --help            # print this header (it IS the help text, reprinted via sed) and exit 0
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
#   COMPAT_VARIANT_COMMIT=<sha>  commit pin for --variant=<arm> (alternative to --commit=<sha>; the flag
#                            wins). Ignored without --variant. Exported to run.mjs as provenance.
#   COMPAT_L2_HTML_OUTPUT=0|1  html_output seeded into the rundir .maister/config.yml (every scenario
#                            but init, which must stay bare). Resolved ONCE here and re-exported
#                            normalized (0|1): the --variant manifest's sandboxSeeds.configYml.html_output
#                            wins, else this env, else 1 — so run.mjs's per-drive rundir and this
#                            wrapper's mirror rundir agree. Anything but 0/1 -> INCOMPLETE (exit 2).
#   COMPAT_L2_SKIP_INSTR=0|1 createSession skipCustomInstructions, passed through untouched to run.mjs
#                            (manifest sessionOptions wins, else this env, else 1 — ADR-001). See
#                            `node run.mjs --help` for COMPAT_L2_EXCLUDED_TOOLS / COMPAT_L2_EFFORT.
#   Exported BY this wrapper (never set them by hand): COMPAT_VARIANT / COMPAT_ARM_MANIFEST /
#   COMPAT_VARIANT_COMMIT on a --variant run, COMPAT_MUTATION on a --mutation run (self-describing
#   provenance, persisted in replay-meta.json); COMPAT_PROMPT_FILE on M1 only (ADR-001).
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
# Staged A/B arm dir (set on the live path when --variant=<arm> is given; #122 G2). Same lifecycle as
# MUTANT_DIR: empty = nothing staged; cleanup() removes it via the mandated if-form; NEVER kept. Defined
# here (not with the arg vars) because cleanup() is sourced + called under `set -u` by the tests.
VARIANT_DIR=""
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
  # Staged A/B arms are NEVER kept either (--keep-rundir / COMPAT_KEEP_RUNDIR do not apply). Same
  # MANDATED if-form, same reason: the function's last statement must not return 1 when empty.
  if [ -n "$VARIANT_DIR" ]; then
    rm -rf "$VARIANT_DIR"
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
# A/B arm (#122 G2): the arm name, and its commit pin — seeded from COMPAT_VARIANT_COMMIT, overridden by
# --commit=<sha>. COMMIT_FLAG records that the FLAG was given (a bare --commit without --variant is an
# operator error; a lingering env pin without --variant is simply ignored).
VARIANT=""
VARIANT_COMMIT="${COMPAT_VARIANT_COMMIT:-}"
COMMIT_FLAG=0
for a in "$@"; do
  case "$a" in
    -h|--help)          print_header; exit 0 ;;
    --check-reference)  CHECK_REFERENCE=1 ;;
    --scenario=*)       SCENARIO="${a#--scenario=}" ;;
    --mutation=*)       MUTATION="${a#--mutation=}" ;;
    --variant=*)        VARIANT="${a#--variant=}" ;;
    --commit=*)         VARIANT_COMMIT="${a#--commit=}"; COMMIT_FLAG=1 ;;
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

# Validate --variant/--commit at PARSE time (#122 G2, spec R6) — in THIS order, every reject exit 2 and
# credit-free, BEFORE the --check-reference short-circuit, the sandbox allowlist, the seat preflight,
# the trap and the de-shadow (no verdict, no SKIP banner, nothing staged, config untouched):
#   1. unknown arm — no manifest at variants/arms/<arm>.json. run.sh deliberately NEVER reads
#      variant.sh's COMPAT_ARMS_DIR (a variants.test.mjs-only seam, like COPILOT_CONFIG): the manifest
#      validated here is exactly the one exported to run.mjs below, so the two can never disagree.
#   2. --variant with --mutation — mutually exclusive: a drive is an A/B arm OR a negative control.
#   3. --variant without a pin — --commit=<sha> or COMPAT_VARIANT_COMMIT (ADR-003: the pin is the point).
#   4. --commit without --variant — a pin with nothing to stage is an operator error, not a no-op.
#   0. (before all of these) the arm-name CHARSET — the same rule variant.sh:81-83 applies (letters,
#      digits, . _ - only, no leading dot) plus no leading dash (`-x` is an option, never an arm): a
#      path-shaped name such as `../plain` must never reach the manifest-existence check below (it
#      would resolve OUTSIDE variants/arms/ and, with a real file there, sail through to the de-shadow
#      before variant.sh finally rejected it). The glob is matched under LC_ALL=C inside a subshell (the
#      locale never leaks) so `[A-Za-z]` is the 52 ASCII letters, never a locale collation range.
if [ -n "$VARIANT" ]; then
  if ! (export LC_ALL=C; case "$VARIANT" in *[!A-Za-z0-9._-]*|.*|-*) exit 1 ;; esac); then
    echo "run.sh: invalid arm name '$VARIANT' (letters, digits, . _ - only, no leading dot or dash; expected a basename of variants/arms/<arm>.json)" >&2; exit 2
  fi
  if [ ! -f "$SCRIPT_DIR/variants/arms/$VARIANT.json" ]; then
    echo "run.sh: unknown arm '$VARIANT' (no manifest at $SCRIPT_DIR/variants/arms/$VARIANT.json)" >&2; exit 2
  fi
  if [ -n "$MUTATION" ]; then
    echo "run.sh: --variant and --mutation are mutually exclusive (an A/B arm is never a negative control)" >&2; exit 2
  fi
  if [ -z "$VARIANT_COMMIT" ]; then
    echo "run.sh: --variant=$VARIANT needs a commit pin: --commit=<sha> or COMPAT_VARIANT_COMMIT=<sha>" >&2; exit 2
  fi
elif [ "$COMMIT_FLAG" = "1" ]; then
  echo "run.sh: --commit=<sha> requires --variant=<arm> (nothing to stage from that commit)" >&2; exit 2
fi

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

# ---------------------------------------------------------------------------- html_output seed value (R1.4, audit #5)
# Resolve html_output ONCE and re-export it normalized (0|1), so run.mjs's seedConfigYml (per-drive
# rundir) and this wrapper's mirror rundir below agree: the --variant manifest's
# sandboxSeeds.configYml.html_output wins, else COMPAT_L2_HTML_OUTPUT, else 1. run.mjs resolves the same
# chain (manifest ?? env 0/1 ?? true) and rejects any other env value, so we reject it here first —
# credit-free, before the preflight, the trap and the de-shadow. A manifest value that is neither boolean
# nor absent is likewise INCOMPLETE (run.mjs would refuse it before spending anyway). Only the live path
# reaches this (--check-reference exec'd above and seeds nothing).
HTML_OUTPUT="${COMPAT_L2_HTML_OUTPUT:-}"
if [ -n "$VARIANT" ]; then
  # MANDATED `if ! X="$(...)"` form (see the mutation block): a failing `node -e` must surface as exit 2.
  # Fix pass 2: the same read also pins the manifest's `arm` to the NAME the operator typed — on a
  # case-insensitive filesystem (macOS default) `--variant=PLAIN` resolves arms/plain.json and the `-f`
  # check above cannot tell; variant.sh compares `arm` to the basename it is GIVEN (variant.sh:118), so
  # the mismatch would otherwise surface only after the de-shadow. A mismatch prints the ARM-MISMATCH
  # marker on stdout (the captured value survives a failed substitution) -> its own exit-2 message.
  if ! MANIFEST_HTML_OUTPUT="$(node -e '
    const [file, arm] = process.argv.slice(1);
    const m = JSON.parse(require("node:fs").readFileSync(file, "utf8"));
    if (m?.arm !== arm) { console.error(`manifest arm ${JSON.stringify(m?.arm)} != --variant=${arm}`); process.stdout.write("ARM-MISMATCH"); process.exit(1); }
    const v = m?.sandboxSeeds?.configYml?.html_output;
    if (v === true) process.stdout.write("1");
    else if (v === false) process.stdout.write("0");
    else if (v != null) { console.error(`sandboxSeeds.configYml.html_output must be a boolean, got ${JSON.stringify(v)}`); process.exit(1); }
  ' "$SCRIPT_DIR/variants/arms/$VARIANT.json" "$VARIANT")"; then
    if [ "$MANIFEST_HTML_OUTPUT" = "ARM-MISMATCH" ]; then
      echo "run.sh: arm/manifest name mismatch: --variant=$VARIANT but $SCRIPT_DIR/variants/arms/$VARIANT.json declares a different arm (case-insensitive filesystem? use the manifest's exact spelling)" >&2; exit 2
    fi
    echo "L2 INCOMPLETE: cannot resolve html_output from the arm manifest $SCRIPT_DIR/variants/arms/$VARIANT.json" >&2; exit 2
  fi
  if [ -n "$MANIFEST_HTML_OUTPUT" ]; then
    HTML_OUTPUT="$MANIFEST_HTML_OUTPUT"
  fi
fi
case "$HTML_OUTPUT" in
  "")  HTML_OUTPUT=1 ;;
  0|1) ;;
  *) echo "L2 INCOMPLETE: COMPAT_L2_HTML_OUTPUT must be 0 or 1, got '$HTML_OUTPUT'" >&2; exit 2 ;;
esac
export COMPAT_L2_HTML_OUTPUT="$HTML_OUTPUT"

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
  # Symmetry with the --variant block: mutants self-describe too (run.mjs persists COMPAT_MUTATION as
  # provenance in replay-meta.json; absent on positive and A/B runs).
  export COMPAT_MUTATION="$MUTATION"
  echo "NEGATIVE CONTROL: mutation $MUTATION staged at $MUTANT_DIR"
  # ADR-001 (M1 only): the committed scenario prompt itself commands "present a fix plan for
  # approval", which would re-impose the very gate M1 strips — a confounded experiment. Export the
  # neutral prompt file instead; env(1) below passes exported vars through to run.mjs. Positive
  # (no --mutation) runs NEVER set COMPAT_PROMPT_FILE.
  if [ "$MUTATION" = "M1" ]; then
    export COMPAT_PROMPT_FILE="$SCRIPT_DIR/mutations/m1-neutral-prompt.txt"
  fi
fi

# ---------------------------------------------------------------------------- A/B arm staging (#122 G2, spec R6)
# Only when --variant=<arm> was given (never together with --mutation — rejected at parse time): stage
# a THROWAWAY copy of the plugin from the PINNED commit via variants/variant.sh (git archive + the
# manifest's transforms — the working tree / COMPAT_PLUGIN_DIR is NOT the source, ADR-003) and repoint
# PLUGIN_DIR at it. Same load-bearing placement as the mutation block (after the trap so cleanup()
# removes it, after the de-shadow so it loads under the REAL name, before the env hand-off) and the
# same MANDATED `if ! X="$(...)"` form: a failing builder is INCOMPLETE (exit 2), never exit 1.
# variant.sh prints exactly one stdout line (the path) on success and nothing on failure; its digest /
# tree oid go to stderr and are NOT parsed here — run.mjs recomputes both for replay-meta.json. The
# exported trio is run.mjs's manifest + provenance seam; env(1) below passes it through.
if [ -n "$VARIANT" ]; then
  if ! VARIANT_DIR="$(bash "$SCRIPT_DIR/variants/variant.sh" "$VARIANT" --commit="$VARIANT_COMMIT")"; then
    echo "L2 INCOMPLETE: variant staging failed" >&2; exit 2
  fi
  PLUGIN_DIR="$VARIANT_DIR"
  export COMPAT_VARIANT="$VARIANT" COMPAT_ARM_MANIFEST="$SCRIPT_DIR/variants/arms/$VARIANT.json" COMPAT_VARIANT_COMMIT="$VARIANT_COMMIT"
  echo "ARM: $VARIANT staged from $VARIANT_COMMIT at $VARIANT_DIR"
fi

# ---------------------------------------------------------------------------- stage the sandbox rundir
# run.mjs does NOT run the workflow in this rundir — driveOnce stages its OWN fresh per-drive mktemp
# rundir from l2/sandbox/<template> (makeFreshRundir; the dev workflow mutates its rundir, so drives
# never share one). A run.sh-provided COMPAT_RUNDIR otherwise surfaces only in the report's
# isolation note. Still stage it: copy the sandbox CONTENTS (incl. the .maister dotfile) into the
# rundir root, preserving +x on the runner scripts, so that note points at a real, populated dir.
cp -R "$SANDBOX_TEMPLATE"/. "$RUNDIR"/
chmod +x "$RUNDIR"/*.sh 2>/dev/null || true
# R1.4 mirror seed (audit #5): the SAME two lines run.mjs's seedConfigYml writes into its per-drive
# rundir (the /maister:init-written shape), from the value resolved once above — so the isolation-note
# dir and the driven rundir agree on html_output. init is exempt in BOTH places: its template must stay
# bare (init-structure oracle). No sandbox template ships a config.yml (run.mjs refuses one, exit 2).
if [ "$SCENARIO" != "init" ]; then
  mkdir -p "$RUNDIR/.maister"
  if [ "$COMPAT_L2_HTML_OUTPUT" = "1" ]; then HTML_OUTPUT_BOOL=true; else HTML_OUTPUT_BOOL=false; fi
  printf 'html_output: %s\nmockup_format: html\n' "$HTML_OUTPUT_BOOL" > "$RUNDIR/.maister/config.yml"
fi

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
