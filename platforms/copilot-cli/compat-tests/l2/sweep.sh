#!/usr/bin/env bash
#
# L2 cost sweep — drive one scenario across several A/B arms under a CUMULATIVE credit budget, and
# leave a manifest + per-drive logs behind (#138 WP2; spec R13-R19). This is the repo-resident
# promotion of the three off-repo tier runners written for issue #123
# (.maister/tasks/research/2026-09-03-copilot-cost-savings/sweeps/{round1,tier2,tier3}/), which are
# now frozen evidence rather than tooling.
#
# Usage:
#   sweep.sh --tier=<name> --scenario=<id> --arms=a,b --runs=N --cap=<AIU> [--plan] [--gate-max=<AIU>] [--pin=<sha>]
#   sweep.sh -h                                            # reprint this header
#
#   --tier=<name>     names the sweep; it appears in the output directory name.
#   --scenario=<id>   the run.sh scenario driven by EVERY drive. It must carry a MEASURED band in
#                     reference/cost-bands.json — see "the seed estimate" below.
#   --arms=a,b        comma-separated A/B arm names; each needs a manifest at variants/arms/<arm>.json.
#   --runs=N          repetitions. Drives are INTERLEAVED arm x N (a,b,a,b,...), never blocked by arm,
#                     so a mid-sweep stop still leaves a balanced corpus.
#   --cap=<AIU>       the CUMULATIVE budget for the whole sweep. See "the two budget flags".
#   --plan            print the matrix and the estimate, then exit 0. Spends nothing, stages nothing,
#                     needs no seat. This is the credit-free way to discover that a cap is too small.
#   --gate-max=<AIU>  the FIRST-DRIVE circuit breaker. See "the two budget flags".
#   --pin=<sha>       the GIT COMMIT staged for every drive, passed straight through to
#                     `run.sh --commit=<sha>` and resolved ONCE before the loop. It is NOT a model pin
#                     — the model is COMPAT_L2_MODEL. Defaults to COMPAT_VARIANT_COMMIT.
#
# THE TWO BUDGET FLAGS ARE DIFFERENT MECHANISMS.
#   --cap is cumulative and is checked BEFORE EVERY DRIVE: if `cum + est > cap`, the sweep stops. It has
#   two distinct outcomes, and conflating them is the bug this comment exists to prevent.
#     * PRE-FIRST-DRIVE (cum = 0, i.e. drive 1's own estimate alone exceeds the cap) is a PRECONDITION
#       REFUSAL: exit 2, nothing created, stdout empty. Nothing was ever going to be affordable.
#     * MID-SWEEP is a CLEAN STOP: exit 0, manifest and logs intact. The budget worked, and a partial
#       corpus is a valid result — tier 3 is one, stopping at `cum 151.843044` against `cap 220`.
#   --gate-max is the first-drive circuit breaker, checked AFTER drive 1 only, against its MEASURED
#   cost. Credits are already spent by then, so a trip is exit 1 (a post-staging miss), never 2. On a
#   PASS it RE-SEEDS the per-drive estimate from measurement, `EST = ceil(measured * 1.4)`, so every
#   later --cap check uses a measured band rather than the seed. Without it a wrong seed spends the
#   whole cap before anyone notices — which is exactly what happened in #110.
#
# THE SEED ESTIMATE IS MEASURED, NEVER DESIGNED. It comes from reference/cost-bands.json, whose every
# entry cites a `reports/<ts>` bundle or a `sweeps/<tier>/manifest.tsv#<idx>` row; a scenario with no
# measured band cannot be swept. Each scenario's `estAiu` is the MAXIMUM of its own observed drives —
# the worst measurement, so the cap is checked against the bad case rather than the average. #110's
# design table budgeted `research` at 13.5 AIU; it measured 105.006005, 7.8x over, and there was no
# caveat anywhere saying the number had never been driven. That is why this file is the only input.
#
# ENV HYGIENE (spec R15). Before the first drive the INHERITED environment's COMPAT_L2_* set must be
# empty except COMPAT_L2_MODEL, or the sweep refuses: a stray COMPAT_L2_DEEP or COMPAT_L2_HTML_OUTPUT
# silently changes what every arm measures, and a sweep that cannot be compared is spent credits with
# no deliverable. The sweep THEN exports what it needs itself (COMPAT_L2_YES=1, and unsets
# COMPAT_L2_DEEP) — the check is on what came IN, taken as a snapshot at startup, and NEVER on the live
# environment. All three promoted runners export COMPAT_L2_YES=1 themselves (sweep-round1.sh:15,
# sweep-tier3.sh:11), so a check against the current environment would make the sweep refuse itself one
# line after its own export.
#
# Env:
#   COMPAT_L2_MODEL       the model pin, passed through to run.sh. The ONE COMPAT_L2_* the hygiene
#                         check allows to be inherited.
#   COMPAT_SWEEP_OUT      output directory override; must be an ABSOLUTE path. Default: a mktemp'd
#                         ${TMPDIR:-/tmp}/l2-sweep-<tier>-XXXXXX.
#   COMPAT_SWEEP_RUNNER   the per-drive command (test seam). Default: this directory's run.sh.
#   COMPAT_SWEEP_REPORTS  where drive bundles land (test seam). Default: ../reports.
#   These three are deliberately COMPAT_* and NOT COMPAT_L2_*: COMPAT_L2_* is the set the hygiene check
#   above polices, so a seam in that namespace would make the sweep refuse itself. COMPAT_PLUGIN_DIR /
#   COMPAT_NO_SEAT / COMPAT_ARMS_DIR use the same spelling for the same reason.
#
# Contract:
#   - stdout is EXACTLY ONE LINE — the absolute output directory. Every diagnostic, progress line, STOP
#     and ABORT goes to stderr (the variant.sh:24-27 rule), so `$(sweep.sh ...)` captures a usable path
#     and nothing else. Under --plan stdout is instead the matrix (one `idx<TAB>arm<TAB>scenario` row
#     per drive) followed by a single `#` summary line; the sweep creates nothing on that path.
#   - Outputs (spec R19): manifest.tsv (the round1/tier3 column set), logs/<idx>-<arm>.log per drive,
#     then a best-effort cost-report per bundle and one ab-compare over the corpus. The reporters are
#     BEST EFFORT by design: a partial corpus is a valid deliverable, and a reporter that cannot read
#     it must never change the sweep's exit status or destroy the evidence.
#   - Exit 2 = usage / precondition (unknown arm or scenario, dirty inherited environment, a cap that
#     cannot pay for drive 1) — NOTHING was created and stdout is EMPTY; every preflight runs before the
#     first mktemp. Exit 1 = post-staging miss: --gate-max tripped, or an output that could not be
#     written. Exit 0 = the sweep completed, OR stopped cleanly on the cap mid-sweep.
#
set -euo pipefail

# ---------------------------------------------------------------------------- paths (run.sh:87-90 idiom)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# NOTE: l2/ is ONE level deeper than the L0/L1 scripts, so repo root is FOUR ups
# (l2 -> compat-tests -> copilot-cli -> platforms -> <repo>), not three. run.sh:87-90 says the same.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
COST_BANDS="$SCRIPT_DIR/reference/cost-bands.json"
REPORTS_DIR="${COMPAT_SWEEP_REPORTS:-$SCRIPT_DIR/../reports}"
RUNNER="${COMPAT_SWEEP_RUNNER:-$SCRIPT_DIR/run.sh}"

usage() {
  echo "Usage: sweep.sh --tier=<name> --scenario=<id> --arms=a,b --runs=N --cap=<AIU> [--plan] [--gate-max=<AIU>] [--pin=<sha>]" >&2
}

# Reprint the header comment block (lines after the shebang, up to `set -euo pipefail`) — the
# run.sh:127-131 / variant.sh:61-63 idiom; it depends on `set -euo pipefail` sitting IMMEDIATELY after
# the header. Never insert code between.
print_header() {
  sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

# Progress goes to stderr, NOT stdout as in the promoted runners: here stdout is the one-line output
# path. Same timestamp shape as sweep-round1.sh:20 / sweep-tier3.sh:17.
say() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }

# die2 MSG — pre-flight reject: nothing has been created yet, so there is nothing to remove.
die2() { echo "sweep.sh: $*" >&2; usage; exit 2; }

# fail MSG — post-staging miss. Whatever was already written STAYS: a partial manifest that is
# REPORTED is better evidence than none, and the drives behind it were paid for.
fail() { echo "sweep.sh: FAILED: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------- inherited-env snapshot
# Taken HERE, before this script exports anything, so check_env_hygiene can never see the sweep's own
# COMPAT_L2_YES=1. Deliberately NOT named COMPAT_L2_* itself, and never exported, so it cannot appear
# in its own snapshot. `grep -v` exits 1 when it filters everything out, which under `set -e` inside a
# command substitution would abort the script — hence the `|| true`.
SWEEP_INHERITED_L2="$(env | sed -n 's/^\(COMPAT_L2_[A-Za-z0-9_]*\)=.*/\1/p' | grep -v '^COMPAT_L2_MODEL$' | sort || true)"

# check_env_hygiene — 0 = the inherited environment was clean, 1 = it was not (the caller decides how
# to fail; a failure function never decides that for it). Reads the SNAPSHOT above, never the live env.
check_env_hygiene() {
  if [ -z "$SWEEP_INHERITED_L2" ]; then
    return 0
  fi
  echo "sweep.sh: refusing: the inherited environment carries COMPAT_L2_* variables other than COMPAT_L2_MODEL:" >&2
  echo "$SWEEP_INHERITED_L2" | sed 's/^/  /' >&2
  echo "sweep.sh: they silently change what every arm measures, so the drives could not be compared. Unset them and re-run." >&2
  return 1
}

# is_positive_number VALUE — 0 when VALUE parses as a finite number > 0. Values reach node via
# process.argv, never interpolated into the source.
is_positive_number() {
  node -e 'const v = Number(process.argv[1]); process.exit(Number.isFinite(v) && v > 0 ? 0 : 1);' "$1"
}

# over_cap CUM EST CAP — prints 1 when the next drive would breach the cap. The arithmetic is
# sweep-tier3.sh:20 verbatim; it is not re-invented here because the tier-3 stop is the only place this
# rule has ever actually fired.
over_cap() {
  node -e 'console.log(Number(process.argv[1])+Number(process.argv[2])>Number(process.argv[3])?"1":"0")' "$1" "$2" "$3"
}

# add_aiu A B — 6-dp cumulative addition (sweep-round1.sh:35 / sweep-tier3.sh:38 verbatim).
add_aiu() {
  node -e 'console.log(Number((Number(process.argv[1])+Number(process.argv[2])).toFixed(6)))' "$1" "$2"
}

# mul_aiu A B — 6-dp multiplication, for the --plan total.
mul_aiu() {
  node -e 'console.log(Number((Number(process.argv[1])*Number(process.argv[2])).toFixed(6)))' "$1" "$2"
}

# ---------------------------------------------------------------------------- source guard (run.sh:170-178)
# When SOURCED (by sweep-sh.test.mjs) expose the helpers — check_env_hygiene above all, whose whole
# contract is "reads the snapshot, not the live environment" and which is only provable by taking the
# snapshot, exporting, and re-checking — but do NOT run main: the preflight `exit 2` would otherwise
# terminate the caller's shell. When EXECUTED, BASH_SOURCE[0] == $0, so this is skipped.
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
  # shellcheck disable=SC2317  # reachable ONLY when sourced (guarded above); false-positive otherwise
  return 0 2>/dev/null || true
fi

# ============================================================================ main
# ---------------------------------------------------------------------------- args (exit 2: nothing created yet)
TIER=""
SCENARIO=""
ARMS_CSV=""
RUNS=""
CAP=""
GATE_MAX=""
PIN=""
PLAN=0
for a in "$@"; do
  case "$a" in
    -h|--help)     print_header; exit 0 ;;
    --tier=*)      TIER="${a#--tier=}" ;;
    --scenario=*)  SCENARIO="${a#--scenario=}" ;;
    --arms=*)      ARMS_CSV="${a#--arms=}" ;;
    --runs=*)      RUNS="${a#--runs=}" ;;
    --cap=*)       CAP="${a#--cap=}" ;;
    --gate-max=*)  GATE_MAX="${a#--gate-max=}" ;;
    --pin=*)       PIN="${a#--pin=}" ;;
    --plan)        PLAN=1 ;;
    *)             die2 "unknown argument '$a'" ;;
  esac
done

[ -n "$TIER" ]     || die2 "missing --tier=<name>"
[ -n "$SCENARIO" ] || die2 "missing --scenario=<id>"
[ -n "$ARMS_CSV" ] || die2 "missing --arms=a,b"
[ -n "$RUNS" ]     || die2 "missing --runs=N"
[ -n "$CAP" ]      || die2 "missing --cap=<AIU> (a sweep without a budget is how #110 happened)"

# The tier name lands in a directory name, so it gets run.sh:225-227's charset rule: letters, digits,
# . _ - only, no leading dot or dash. The glob is matched under LC_ALL=C inside a subshell (the locale
# never leaks) so [A-Za-z] is the 52 ASCII letters, never a locale collation range.
if ! (export LC_ALL=C; case "$TIER" in *[!A-Za-z0-9._-]*|.*|-*) exit 1 ;; esac); then
  die2 "invalid --tier name '$TIER' (letters, digits, . _ - only, no leading dot or dash)"
fi

case "$RUNS" in
  ''|*[!0-9]*) die2 "--runs must be a positive integer, got '$RUNS'" ;;
esac
[ "$RUNS" -ge 1 ] || die2 "--runs must be at least 1, got '$RUNS'"

is_positive_number "$CAP" || die2 "--cap must be a positive number of AIU, got '$CAP'"
if [ -n "$GATE_MAX" ]; then
  is_positive_number "$GATE_MAX" || die2 "--gate-max must be a positive number of AIU, got '$GATE_MAX'"
fi

# Arms: same charset + manifest-existence rule run.sh:225-231 applies at ITS parse time. Validated here
# too rather than deferred to the first drive, because discovering a typo'd arm on drive 7 of 12 has
# already spent six drives' credits on a corpus that cannot be compared.
ARMS="$(echo "$ARMS_CSV" | tr ',' ' ')"
[ -n "$(echo "$ARMS" | tr -d ' ')" ] || die2 "--arms is empty"
for arm in $ARMS; do
  if ! (export LC_ALL=C; case "$arm" in *[!A-Za-z0-9._-]*|.*|-*) exit 1 ;; esac); then
    die2 "invalid arm name '$arm' (letters, digits, . _ - only, no leading dot or dash)"
  fi
  [ -f "$SCRIPT_DIR/variants/arms/$arm.json" ] \
    || die2 "unknown arm '$arm' (no manifest at $SCRIPT_DIR/variants/arms/$arm.json)"
done

# ---------------------------------------------------------------------------- env hygiene (R15)
# Placed ABOVE the --plan short-circuit on purpose: a plan produced under an environment that would
# refuse the sweep is a plan for a sweep that cannot run, and refusing here costs nothing and creates
# nothing, so --plan stays credit-free either way.
check_env_hygiene || exit 2

# ---------------------------------------------------------------------------- the pin (R14)
# Resolved ONCE, before the loop, so every drive of the sweep stages the SAME tree even if the working
# copy moves underneath it (sweep-tier3.sh:10, :25). Resolution reads git and writes nothing.
if [ -n "$PIN" ]; then
  if ! PIN_OID="$(git -C "$REPO_ROOT" rev-parse --verify "$PIN^{commit}" 2>/dev/null)"; then
    die2 "--pin=$PIN does not resolve to a commit in $REPO_ROOT"
  fi
else
  PIN_OID="${COMPAT_VARIANT_COMMIT:-}"
  [ -n "$PIN_OID" ] \
    || die2 "every drive stages an arm, which needs a commit pin: --pin=<sha> or COMPAT_VARIANT_COMMIT=<sha>"
fi

# ---------------------------------------------------------------------------- the seed estimate (R17/R17a)
# cost-bands.json is the ONLY input. A scenario with no measured band is not sweepable — deliberately,
# because the alternative is the design-estimate table that was 7.8x wrong.
[ -f "$COST_BANDS" ] || die2 "missing $COST_BANDS — the measured cost band table is the only seed input"
if ! EST="$(node -e '
  const fs = require("fs");
  const bands = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const b = bands[process.argv[2]];
  if (!b || typeof b.estAiu !== "number") process.exit(1);
  console.log(b.estAiu);
' "$COST_BANDS" "$SCENARIO")"; then
  die2 "no measured cost band for scenario '$SCENARIO' in reference/cost-bands.json (drive it once and record the measurement before sweeping it)"
fi

DRIVES=$((RUNS * $(echo "$ARMS" | wc -w | tr -d ' ')))
if ! EST_TOTAL="$(mul_aiu "$DRIVES" "$EST")"; then
  die2 "could not compute the estimated total"
fi

# ---------------------------------------------------------------------------- --plan (R18)
# The credit-free short-circuit, structurally modelled on run.sh:243-249's `--check-reference`, which
# sits ABOVE the seat preflight at run.sh:306 — that ORDERING is what makes it credit-free, not luck
# with PATH. Everything above this line reads; nothing above it creates. There is no mktemp, no staging
# directory, no seat check and no drive below it on this path.
if [ "$PLAN" = "1" ]; then
  idx=0
  run=0
  while [ "$run" -lt "$RUNS" ]; do
    run=$((run + 1))
    for arm in $ARMS; do
      idx=$((idx + 1))
      printf '%s\t%s\t%s\n' "$idx" "$arm" "$SCENARIO"
    done
  done
  printf '# drives=%s est-per-drive=%s est-total=%s cap=%s pin=%s tier=%s\n' \
    "$DRIVES" "$EST" "$EST_TOTAL" "$CAP" "$PIN_OID" "$TIER"
  exit 0
fi

# ---------------------------------------------------------------------------- cap: pre-first-drive (R16)
# `cum = 0`, so this asks whether drive 1's own seed estimate alone already breaches the cap. It does
# not: it is a PRECONDITION REFUSAL, exit 2, nothing created, stdout empty. Distinguishing it from the
# mid-sweep stop below is the entire point — one means "this was never affordable", the other means
# "the budget worked".
if ! over="$(over_cap 0 "$EST" "$CAP")"; then
  die2 "could not evaluate the cap"
fi
if [ "$over" = "1" ]; then
  die2 "cap $CAP cannot pay for even the first $SCENARIO drive (seed estimate $EST AIU, from reference/cost-bands.json); nothing was driven"
fi

# ---------------------------------------------------------------------------- output dir (first creation)
if [ -n "${COMPAT_SWEEP_OUT:-}" ]; then
  case "$COMPAT_SWEEP_OUT" in
    /*) ;;
    *)  die2 "COMPAT_SWEEP_OUT must be an ABSOLUTE path, got '$COMPAT_SWEEP_OUT'" ;;
  esac
  OUT="$COMPAT_SWEEP_OUT"
  mkdir -p "$OUT" || fail "could not create $OUT"
else
  if ! OUT="$(mktemp -d "${TMPDIR:-/tmp}/l2-sweep-$TIER-XXXXXX")"; then
    fail "could not create a sweep output directory under ${TMPDIR:-/tmp}"
  fi
fi
OUT="$(cd "$OUT" && pwd)"
mkdir -p "$OUT/logs" || fail "could not create $OUT/logs"

# What the sweep needs, exported by the sweep ITSELF — after the hygiene snapshot above, which is why
# COMPAT_L2_YES=1 here can never trip that check (sweep-round1.sh:15, sweep-tier3.sh:11-12).
export COMPAT_L2_YES=1
unset COMPAT_L2_DEEP
export COMPAT_VARIANT_COMMIT="$PIN_OID"

MAN="$OUT/manifest.tsv"
[ -f "$MAN" ] || printf 'idx\tarm\tts\trc\tverdict\taiu\tcum_aiu\n' > "$MAN"

# emit_reports — R19's reporting pass. BEST EFFORT, always: it runs on the complete path, on the
# mid-sweep cap stop and on a --gate-max abort, because a partial corpus is still the deliverable that
# the spent credits bought. Its exit status is discarded so a reporter that cannot read a bundle can
# never rewrite the sweep's own verdict.
emit_reports() {
  bundles=""
  for t in $(cut -f3 "$MAN" | tail -n +2); do
    if [ -d "$REPORTS_DIR/$t" ]; then
      bundles="$bundles $REPORTS_DIR/$t"
      node "$SCRIPT_DIR/tools/cost-report.mjs" "$REPORTS_DIR/$t" > "$OUT/cost-report-$t.md" 2>>"$OUT/reports.log" || true
    fi
  done
  if [ -n "$bundles" ]; then
    # shellcheck disable=SC2086  # deliberate word-splitting: $bundles is a built list of paths
    node "$SCRIPT_DIR/tools/ab-compare.mjs" $bundles > "$OUT/ab-compare.md" 2>>"$OUT/reports.log" || true
  fi
}

# ---------------------------------------------------------------------------- drive loop (R14)
say "sweep $TIER: $DRIVES drives (${RUNS}x [$(echo "$ARMS" | tr ' ' ',')]) scenario=$SCENARIO pin=$PIN_OID cap=$CAP est/drive=$EST"
say "  output: $OUT"
total=0
idx=0
run=0
while [ "$run" -lt "$RUNS" ]; do
  run=$((run + 1))
  for arm in $ARMS; do
    idx=$((idx + 1))

    # The cap is checked before EVERY drive, not only the first. Reaching it here is the mid-sweep
    # CLEAN STOP: exit 0, manifest and logs intact (sweeps/tier3/sweep.log's real stop).
    if ! over="$(over_cap "$total" "$EST" "$CAP")"; then
      fail "could not evaluate the cap before drive $idx"
    fi
    if [ "$over" = "1" ]; then
      say "STOP: next drive (est ${EST}) would exceed cap ${CAP} at cum ${total}"
      emit_reports
      echo "$OUT"
      exit 0
    fi

    before="$(ls -d "$REPORTS_DIR"/2026*/ 2>/dev/null | tr '\n' ' ' || true)"
    say "drive $idx/$DRIVES: arm=$arm scenario=$SCENARIO (cum ${total} AIU)"
    rc=0
    ( cd "$REPO_ROOT" && bash "$RUNNER" --variant="$arm" --commit="$PIN_OID" --scenario="$SCENARIO" ) \
      > "$OUT/logs/$idx-$arm.log" 2>&1 || rc=$?

    # The new bundle is the reports/ directory that was not there before (sweep-tier3.sh:22, :26).
    ts=""
    for d in "$REPORTS_DIR"/2026*/; do
      [ -d "$d" ] || continue
      case " $before " in
        *" $d "*) ;;
        *) ts="$(basename "$d")" ;;
      esac
    done
    [ -n "$ts" ] || ts="(no bundle)"

    verdict="$(grep -Eo 'L2: [A-Z-]+ — [0-9]+ PASS · [0-9]+ LIMITATION · [0-9]+ FAIL' "$OUT/logs/$idx-$arm.log" | head -1 || true)"
    [ -n "$verdict" ] || verdict="(no verdict; rc=$rc)"

    # AIU straight from the bundle's own replay-meta.json (sweep-round1.sh:31-33). An unreadable bundle
    # yields an empty measurement, recorded as `unknown` rather than guessed at.
    aiu="$(node -e '
      const fs = require("fs");
      try {
        const m = JSON.parse(fs.readFileSync(process.argv[1] + "/replay-meta.json", "utf8"));
        console.log(m.cost && m.cost.aiu != null ? m.cost.aiu : "");
      } catch (e) { console.log(""); }
    ' "$REPORTS_DIR/$ts" 2>/dev/null || true)"
    if [ -n "$aiu" ]; then
      if ! total="$(add_aiu "$total" "$aiu")"; then
        fail "cumulative AIU arithmetic failed after drive $idx"
      fi
    fi

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$idx" "$arm" "$ts" "$rc" "$verdict" "${aiu:-unknown}" "$total" >> "$MAN"
    say "  -> ts=$ts rc=$rc aiu=${aiu:-unknown} cum=$total  $verdict"

    # --gate-max: after drive 1 ONLY, against the MEASURED cost (sweep-tier3.sh:41-47).
    if [ "$idx" = "1" ] && [ -n "$GATE_MAX" ]; then
      if ! hi="$(node -e 'console.log(Number(process.argv[1]||0)>Number(process.argv[2])?"1":"0")' "${aiu:-0}" "$GATE_MAX")"; then
        fail "could not evaluate --gate-max after drive 1"
      fi
      if [ "$hi" = "1" ]; then
        # Credits are already spent, so this is exit 1 — a post-staging miss, never the exit 2 of a
        # precondition. The paid drive is KEPT: it is the measurement that proves the seed was wrong.
        say "ABORT: first drive cost ${aiu} AIU (> ${GATE_MAX}); the estimate is wrong again. Spent ${total}."
        emit_reports
        echo "$OUT"
        exit 1
      fi
      say "  cost gate PASSED (${aiu} AIU)"
      if ! EST="$(node -e 'console.log(Math.ceil(Number(process.argv[1])*1.4))' "$aiu")"; then
        fail "could not re-seed the per-drive estimate from drive 1"
      fi
      say "  per-drive estimate updated to ${EST} AIU"
    fi
  done
done

say "SWEEP COMPLETE: $idx drives, cumulative ${total} AIU"
emit_reports
echo "$OUT"
