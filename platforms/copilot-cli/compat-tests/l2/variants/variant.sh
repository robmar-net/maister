#!/usr/bin/env bash
#
# L2 A/B arm builder — stages a THROWAWAY copy of the maister-copilot plugin from a PINNED git
# commit (`git archive`, never the working tree) and applies the arm's manifest transforms to that
# copy, so an A/B drive runs a reproducible, self-describing plugin tree (#122 G1; ADR-003).
#
# Usage:
#   variant.sh <arm> --commit=<sha>     # arm = basename of l2/variants/arms/<arm>.json
#   variant.sh -h                       # reprint this header
#
# Env:
#   COMPAT_ARMS_DIR   manifest directory override (default: <this dir>/arms). A variants.test.mjs
#                     seam ONLY (like COPILOT_CONFIG): run.sh never sets it — it validates and
#                     exports $SCRIPT_DIR/variants/arms/$VARIANT.json itself.
#   TMPDIR            where the copy is mktemp'd (default /tmp).
#
# Arms (manifest `transforms`, applied to the COPY only; the repo is NEVER written):
#   plain-legacy, plain   none — the copy IS the archive (verified: diff -r vs a second extraction)
#   lean                  append-eof: the leaf-worker guard appended to every agents/*.md
#   caveman, terse        hook-context-append: one line spliced into the SessionStart
#                         additionalContext of hooks/skill-invocation-reminder.sh
#
# Contract (clone of mutations/mutate.sh:29-44 — same reasons):
#   - stdout is EXACTLY ONE LINE: the absolute staged path. run.sh stages the arm via
#     VARIANT_DIR="$(variant.sh ...)", so any other stdout chatter would corrupt the captured path —
#     ALL diagnostics go to stderr, including the final summary
#     `variant.sh: <arm> staged from <commit> (tree <oid>) digest sha256:<…> at <path>`.
#   - The copy is mktemp'd as ${TMPDIR:-/tmp}/l2-variant-<arm>-XXXXXX: the arm embedded in the
#     directory NAME is the report-annotation channel (as l2-mutant-<ID> is for mutants). It is a
#     pure plugin tree — no marker file is written into it (provenance lives in replay-meta.json).
#   - Exit 2 = usage error / unknown arm / missing --commit / manifest unreadable or invalid /
#     unknown transform kind / not a git repo / unknown commit / commit lacks the plugin tree —
#     NOTHING was created (every pre-flight runs BEFORE mktemp).
#     Exit 1 = archive pipeline failure, anchor miss or post-transform verification miss — the
#     partial copy is REMOVED first, because a surviving half-staged copy could later be driven as
#     an UNDEFINED arm.
#     Exit 0 = archive extracted, every transform applied AND every verification passed.
#   - HEAD != <commit> is a stderr WARNING only, never a failure (ADR-003: the pin is the point).
#   - FAIL-CLOSED: every anchor must match EXACTLY ONCE in the copy before editing, and every
#     post-edit verification is MEASURED against a second, pristine extraction of the same archive
#     (agent count, `model:` set, changed-line counts) — never hardcoded.
#   - Invariants for EVERY arm: the copy's .claude-plugin/plugin.json name stays "maister-copilot",
#     and the source repo's plugins/ tree is untouched (git status --porcelain).
#   - The HOOK battery is conditional on the arm's DECLARED `expects.hooksDir` (#138 R-WP1 D4):
#     hooks/skill-invocation-reminder.sh exits 0 and emits JSON with a TOP-LEVEL additionalContext
#     (WS5.21, #113), no hookSpecificOutput, and hooks/*.sh carry no AskUserQuestion / maister:
#     (WS5.15, #95) — for every arm that does NOT declare `expects.hooksDir: false`. An arm that DOES
#     declare it is staging a pre-hook upstream tree, so the opposite is asserted instead: hooks/ must
#     be ABSENT. The opt-out is one-directional and fail-CLOSED (D8) — it removes "hooks must be
#     present" and ADDS "hooks must be absent", so a manifest that declares the opt-out against a tree
#     which DOES carry hooks/ is a hard failure, never a check that quietly did not run.
#
set -euo pipefail

# ---------------------------------------------------------------------------- paths (mutate.sh:47-51 idiom)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# NOTE: variants/ is ONE level deeper than l2/ (same depth as mutations/), so repo root is FIVE ups
# (variants -> l2 -> compat-tests -> copilot-cli -> platforms -> <repo>), not four.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
ARMS_DIR="${COMPAT_ARMS_DIR:-$SCRIPT_DIR/arms}"
PLUGIN_PATH="plugins/maister-copilot"

usage() { echo "Usage: variant.sh <arm> --commit=<sha>   (arm = basename of $ARMS_DIR/<arm>.json)" >&2; }

# Reprint the header comment block (lines after the shebang, up to `set -euo pipefail`) — the
# run.sh:127-131 idiom; it depends on `set -euo pipefail` sitting IMMEDIATELY after the header.
print_header() {
  sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

# die2 MSG — pre-flight reject: nothing has been created yet, so there is nothing to remove.
die2() { echo "variant.sh: $*" >&2; usage; exit 2; }

# ---------------------------------------------------------------------------- args (exit 2: nothing created yet)
ARM=""
COMMIT=""
for a in "$@"; do
  case "$a" in
    -h|--help)  print_header; exit 0 ;;
    --commit=*) COMMIT="${a#--commit=}" ;;
    --*)        die2 "unknown option '$a'" ;;
    *)          [ -z "$ARM" ] || die2 "unexpected extra argument '$a'"; ARM="$a" ;;
  esac
done
[ -n "$ARM" ] || die2 "missing <arm>"
# The arm names a manifest file AND the mktemp directory: letters, digits, . _ - only, no leading dot.
case "$ARM" in
  *[!A-Za-z0-9._-]*|.*) die2 "invalid arm name '$ARM' (letters, digits, . _ - only)" ;;
esac
MANIFEST="$ARMS_DIR/$ARM.json"
{ [ -f "$MANIFEST" ] && [ -r "$MANIFEST" ]; } || die2 "unknown arm '$ARM' (no manifest at $MANIFEST)"
[ -n "$COMMIT" ] || die2 "missing --commit=<sha> (arms are pinned by commit, ADR-003)"

# ---------------------------------------------------------------------------- git pre-flight (still exit 2)
git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die2 "not a git repository: $REPO_ROOT"
COMMIT_OID="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$COMMIT^{commit}")" \
  || die2 "unknown commit '$COMMIT' in $REPO_ROOT"
git -C "$REPO_ROOT" cat-file -e "$COMMIT:$PLUGIN_PATH" 2>/dev/null \
  || die2 "commit $COMMIT ($COMMIT_OID) has no $PLUGIN_PATH tree"
TREE_OID="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$COMMIT:$PLUGIN_PATH")" \
  || die2 "cannot resolve the tree oid of $COMMIT:$PLUGIN_PATH"
HEAD_OID="$(git -C "$REPO_ROOT" rev-parse --verify --quiet HEAD)" \
  || die2 "cannot resolve HEAD in $REPO_ROOT"
if [ "$HEAD_OID" != "$COMMIT_OID" ]; then
  echo "variant.sh: warning: HEAD ($HEAD_OID) != --commit ($COMMIT_OID); staging the PINNED commit, not the checkout (ADR-003)" >&2
fi
# The archive path is the only repo path this script could conceivably touch; snapshot it so the
# "source never written" invariant is MEASURED (scoped to plugins/ so a concurrent editor elsewhere
# in the tree cannot fail a staging).
PORCELAIN_BEFORE="$(git -C "$REPO_ROOT" status --porcelain -- plugins)"

# ---------------------------------------------------------------------------- manifest (R4.3; still exit 2)
# node -e #1: parse + schema-check the manifest and emit ONE JSON.stringify(transform) per line
# (JSON-lines — never TSV, which cannot carry the tabs/newlines the text check below must see).
ROWS="$(node -e '
  const fs = require("node:fs");
  const [file, arm] = process.argv.slice(1);
  const bad = (msg) => { console.error("variant.sh: manifest " + file + ": " + msg); process.exit(2); };
  let m;
  try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { bad("unreadable or not JSON: " + e.message); }
  if (m === null || typeof m !== "object" || Array.isArray(m)) bad("top level must be an object");
  if (m.manifestSchema !== 1) bad("manifestSchema must be 1 (got " + JSON.stringify(m.manifestSchema) + ")");
  if (m.arm !== arm) bad("arm " + JSON.stringify(m.arm) + " != file basename " + JSON.stringify(arm));
  if (!Array.isArray(m.transforms)) bad("transforms must be an array");
  if (!m.sessionOptions || typeof m.sessionOptions.skipCustomInstructions !== "boolean") bad("sessionOptions.skipCustomInstructions must be an explicit boolean");
  // #138 R-WP1: `expects` is OPTIONAL (only the upstream control declares it), but when present it
  // must be an object with a boolean `hooksDir` — it decides which check battery runs below, so a
  // misspelled or mistyped key must be a hard reject here, never a silently ignored declaration.
  if ("expects" in m) {
    const e = m.expects;
    if (e === null || typeof e !== "object" || Array.isArray(e)) bad("expects must be an object when present");
    if (typeof e.hooksDir !== "boolean") bad("expects.hooksDir must be an explicit boolean (got " + JSON.stringify(e.hooksDir) + ")");
  }
  for (const t of m.transforms) {
    if (t === null || typeof t !== "object" || Array.isArray(t)) bad("every transform must be an object");
    process.stdout.write(JSON.stringify(t) + "\n");
  }
' "$MANIFEST" "$ARM")" || die2 "manifest unreadable or invalid: $MANIFEST"

# The arm's DECLARED expectation about hooks/, read AFTER the validator above has already proved it is
# an explicit boolean when present. Absent -> "true": every arm that says nothing keeps the full,
# blocking hook battery. This is the ONLY input to that decision — never a resolved remote slug and
# never git ancestry (#138 D4): f75ef4f is an ancestor of the fork's master too, so no topology query
# can separate upstream from fork. The declaration is then CORROBORATED against the staged tree (D8).
EXPECT_HOOKS_DIR="$(node -e '
  const m = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(m.expects && m.expects.hooksDir === false ? "false" : "true");
' "$MANIFEST")" || die2 "cannot read expects.hooksDir from the manifest: $MANIFEST"

# tfield ROW FIELD — one string field of a JSON-lines row (node -e #2). Missing/non-string/empty ->
# exit 3; a `text` carrying a double quote, backslash, tab, newline or any control character ->
# exit 4 (R4.3: the text is spliced verbatim into a JSON string literal / a markdown file, so it
# must be inert there). The value is written WITHOUT a trailing newline (none can be inside it).
tfield() {
  node -e '
    const t = JSON.parse(process.argv[1]);
    const v = t[process.argv[2]];
    if (typeof v !== "string" || v.length === 0) process.exit(3);
    if (process.argv[2] === "text" && /["\\\x00-\x1f\x7f]/.test(v)) process.exit(4);
    process.stdout.write(v);
  ' "$1" "$2"
}

# A relative path/glob inside the plugin root: no leading /, no .., no whitespace (it is expanded
# unquoted inside the copy).
check_rel() {
  case "$2" in
    ""|/*|*..*|*[[:space:]]*) die2 "transform '$1': '$2' must be a relative, whitespace-free path/glob under the plugin root" ;;
  esac
}

# Validate every transform row BEFORE mktemp: an invalid manifest is exit 2 with nothing created.
N_TRANSFORMS=0
if [ -n "$ROWS" ]; then
  while IFS= read -r ROW; do
    [ -n "$ROW" ] || continue
    T_ID="$(tfield "$ROW" id)" || die2 "transform #$N_TRANSFORMS: missing string 'id'"
    T_KIND="$(tfield "$ROW" kind)" || die2 "transform '$T_ID': missing string 'kind'"
    case "$T_KIND" in
      append-eof)
        T_FILES="$(tfield "$ROW" files)" || die2 "transform '$T_ID': append-eof needs a string 'files' glob"
        check_rel "$T_ID" "$T_FILES" ;;
      hook-context-append)
        T_FILE="$(tfield "$ROW" file)" || die2 "transform '$T_ID': hook-context-append needs a string 'file'"
        check_rel "$T_ID" "$T_FILE"
        tfield "$ROW" anchor >/dev/null || die2 "transform '$T_ID': hook-context-append needs a string 'anchor'" ;;
      *) die2 "transform '$T_ID': unknown kind '$T_KIND' (expected append-eof|hook-context-append)" ;;
    esac
    if ! tfield "$ROW" text >/dev/null; then
      die2 "transform '$T_ID': 'text' is missing, empty, or contains a double quote, backslash, tab, newline or control character (R4.3)"
    fi
    N_TRANSFORMS=$((N_TRANSFORMS + 1))
  done <<< "$ROWS"
fi

# ---------------------------------------------------------------------------- staging (R4.2; source never written)
DEST="$(mktemp -d "${TMPDIR:-/tmp}/l2-variant-${ARM}-XXXXXX")"
DEST="$(cd "$DEST" && pwd)"
PRISTINE=""
# Backstop for EVERY non-zero exit from here on (fail(), an unexpected `set -e` abort, the archive
# pipeline): the pristine helper never survives, and the partial copy never survives a failure.
# shellcheck disable=SC2154  # rc IS assigned inside the trap string itself
trap 'rc=$?; [ -z "$PRISTINE" ] || rm -rf "$PRISTINE"; if [ "$rc" != 0 ]; then rm -rf "$DEST"; fi' EXIT

# Any anchor/verification miss from here on: remove the partial copy, then exit 1 (fail-closed —
# no residue that a later staging could mistake for a valid arm).
fail() { echo "variant.sh: $ARM FAILED: $*" >&2; rm -rf "$DEST"; exit 1; }

if ! git -C "$REPO_ROOT" archive "$COMMIT" "$PLUGIN_PATH" | tar -x -C "$DEST" --strip-components=2; then
  fail "git archive $COMMIT $PLUGIN_PATH | tar -x failed"
fi
# Second, pristine extraction of the SAME archive: the measurement baseline for every verification
# below (removed on every exit path by the trap above).
PRISTINE="$(mktemp -d "${TMPDIR:-/tmp}/l2-variant-pristine-XXXXXX")"
PRISTINE="$(cd "$PRISTINE" && pwd)"
if ! git -C "$REPO_ROOT" archive "$COMMIT" "$PLUGIN_PATH" | tar -x -C "$PRISTINE" --strip-components=2; then
  fail "git archive $COMMIT $PLUGIN_PATH | tar -x (pristine baseline) failed"
fi
[ -f "$DEST/.claude-plugin/plugin.json" ] || fail "archive has no .claude-plugin/plugin.json"

# ---------------------------------------------------------------------------- transform helpers (R4.4)
# (Fix pass: the four mutate.sh:76-101 line-edit helpers — require_once / line_of / edit_line /
# delete_range — were copied here verbatim but never called by any transform; deleted. The arm
# transforms below are append-eof and hook-context-append only; grep -c / perl do their own checks.)
# append_eof FILE TEXT — TEXT must be absent (grep -cF = 0); ensure the file ends with a newline;
# append a blank line + TEXT + newline; TEXT must now be a whole line exactly once (grep -cxF = 1).
append_eof() {
  local file="$1" text="$2" n
  [ -f "$file" ] || fail "append-eof: missing $file"
  n="$(grep -cF -e "$text" "$file" || true)"
  [ "$n" = "0" ] || fail "append-eof: text already present in $(basename "$file") (got $n line(s))"
  if [ -s "$file" ] && [ -n "$(tail -c 1 "$file")" ]; then printf '\n' >> "$file"; fi
  printf '\n%s\n' "$text" >> "$file"
  n="$(grep -cxF -e "$text" "$file" || true)"
  [ "$n" = "1" ] || fail "append-eof: text is not a whole line exactly once in $(basename "$file") after append (got $n)"
}

# append_hook_context FILE ANCHOR TEXT — exactly-once substitution of ANCHOR (e.g. the literal
# `after a compaction."`) by `after a compaction.\n\n<TEXT>"` — the four characters `\n\n` written
# LITERALLY inside the JSON string the hook emits. Both operands travel to perl through the
# ENVIRONMENT, never interpolated into perl source (the Caveman text contains `/`, the anchor `.`
# and `"`): `\Q…\E` makes the anchor literal and the replacement side is a plain variable (no
# metacharacter processing). TEXT is already JSON-string-safe per R4.3.
append_hook_context() {
  local file="$1" anchor="$2" text="$3" n
  [ -f "$file" ] || fail "hook-context-append: missing $file"
  n="$(grep -cF -e "$anchor" "$file" || true)"
  [ "$n" = "1" ] || fail "hook-context-append: anchor must match exactly once in $(basename "$file") (got $n line(s)): $anchor"
  n="$(grep -oF -e "$anchor" "$file" | wc -l | tr -d ' ')"
  [ "$n" = "1" ] || fail "hook-context-append: anchor occurs $n times on its line in $(basename "$file") (need exactly 1): $anchor"
  L2_ANCHOR="$anchor" L2_NEW="${anchor%\"}\\n\\n$text\"" \
    perl -0777 -pi -e 's/\Q$ENV{L2_ANCHOR}\E/$ENV{L2_NEW}/ and $c++; END { exit($c == 1 ? 0 : 1) }' "$file" \
    || fail "hook-context-append: perl substitution did not land exactly once in $(basename "$file")"
  n="$(grep -cF -e "$anchor" "$file" || true)"
  [ "$n" = "0" ] || fail "hook-context-append: bare anchor still present after splice in $(basename "$file")"
  n="$(grep -cF -e "${anchor%\"}\\n\\n$text\"" "$file" || true)"
  [ "$n" = "1" ] || fail "hook-context-append: spliced line not found exactly once in $(basename "$file") (got $n)"
}

# resolve_glob ROOT GLOB — the files GLOB matches under ROOT, one relative path per line (nullglob).
resolve_glob() { ( cd "$1" && shopt -s nullglob && for f in $2; do [ -f "$f" ] && printf '%s\n' "$f"; done; true ); }

# changed_lines PRISTINE COPY MARK — count of diff lines starting with MARK ('<' or '>').
changed_lines() { diff "$1" "$2" | grep -c "^$3" || true; }

# model_set ROOT GLOB — the sorted `model:` lines across the glob (a SET comparison: not every
# agent has one — docs-operator.md has none — so the set, not a per-file value, is what must hold).
model_set() { ( cd "$1" && grep -h '^model:' $2 | LC_ALL=C sort ) || true; }

# ---------------------------------------------------------------------------- transforms (copy only)
TOUCHED=""     # newline-separated relative paths every transform wrote (for the nothing-else-changed check)
N_TOUCHED=0
HOOK_TEXT=""   # the last hook-context-append text (its presence in the emitted JSON is verified below)
if [ -n "$ROWS" ]; then
  while IFS= read -r ROW; do
    [ -n "$ROW" ] || continue
    T_ID="$(tfield "$ROW" id)"
    T_KIND="$(tfield "$ROW" kind)"
    T_TEXT="$(tfield "$ROW" text)"
    case "$T_KIND" in

      append-eof)
        T_FILES="$(tfield "$ROW" files)"
        # The glob is resolved in the COPY; its count must equal the archive's (measured on the
        # pristine extraction, never hardcoded — 25 agents today for lean).
        N_BASE="$(resolve_glob "$PRISTINE" "$T_FILES" | grep -c . || true)"
        [ "$N_BASE" -gt 0 ] || fail "transform '$T_ID': glob '$T_FILES' matches nothing in the archive"
        N_COPY=0
        while IFS= read -r rel; do
          [ -n "$rel" ] || continue
          append_eof "$DEST/$rel" "$T_TEXT"
          # Per file: exactly 2 added lines (blank + text), 0 removed, vs the pristine file.
          [ "$(changed_lines "$PRISTINE/$rel" "$DEST/$rel" '>')" = "2" ] \
            || fail "transform '$T_ID': $rel gained $(changed_lines "$PRISTINE/$rel" "$DEST/$rel" '>') lines (expected 2)"
          [ "$(changed_lines "$PRISTINE/$rel" "$DEST/$rel" '<')" = "0" ] \
            || fail "transform '$T_ID': $rel lost lines (expected 0 removed)"
          TOUCHED="$TOUCHED$rel"$'\n'
          N_COPY=$((N_COPY + 1))
        done < <(resolve_glob "$DEST" "$T_FILES")
        [ "$N_COPY" = "$N_BASE" ] || fail "transform '$T_ID': glob '$T_FILES' matched $N_COPY files in the copy but $N_BASE in the archive"
        [ "$(model_set "$DEST" "$T_FILES")" = "$(model_set "$PRISTINE" "$T_FILES")" ] \
          || fail "transform '$T_ID': the ^model: line set across '$T_FILES' drifted from the archive"
        N_TOUCHED=$((N_TOUCHED + N_COPY))
        echo "variant.sh: $ARM: $T_ID appended to $N_COPY file(s) matching $T_FILES" >&2
        ;;

      hook-context-append)
        T_FILE="$(tfield "$ROW" file)"
        T_ANCHOR="$(tfield "$ROW" anchor)"
        append_hook_context "$DEST/$T_FILE" "$T_ANCHOR" "$T_TEXT"
        # Exactly one changed line ('<' + '>' = 2).
        [ "$(changed_lines "$PRISTINE/$T_FILE" "$DEST/$T_FILE" '[<>]')" = "2" ] \
          || fail "transform '$T_ID': $T_FILE changed beyond the single anchored line"
        TOUCHED="$TOUCHED$T_FILE"$'\n'
        N_TOUCHED=$((N_TOUCHED + 1))
        HOOK_TEXT="$T_TEXT"
        echo "variant.sh: $ARM: $T_ID spliced into $T_FILE" >&2
        ;;
    esac
  done <<< "$ROWS"
fi

# ---------------------------------------------------------------------------- nothing-else-changed (R4.4 table)
# `diff -r` against the pristine extraction may list ONLY the files the transforms wrote (plain and
# plain-legacy: nothing at all); an added/removed file is never acceptable.
DIFFS="$(diff -rq "$PRISTINE" "$DEST" || true)"
N_CHANGED=0
if [ -n "$DIFFS" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      "Files $PRISTINE/"*" and $DEST/"*" differ")
        rel="${line#Files "$PRISTINE"/}"; rel="${rel%% and *}"
        printf '%s' "$TOUCHED" | grep -qxF -e "$rel" || fail "$rel differs from the archive but no transform targeted it"
        N_CHANGED=$((N_CHANGED + 1)) ;;
      *) fail "unexpected tree difference vs the archive: $line" ;;
    esac
  done <<< "$DIFFS"
fi
[ "$N_CHANGED" = "$N_TOUCHED" ] || fail "$N_CHANGED file(s) differ from the archive but $N_TOUCHED were transformed"

# ---------------------------------------------------------------------------- arm invariants (R4.5)
# The plugin-name invariant and the untouched-source check below hold for EVERY arm, upstream control
# included. The hook battery between them is conditional on the arm's DECLARED expects.hooksDir.
grep -qE '"name"[[:space:]]*:[[:space:]]*"maister-copilot"' "$DEST/.claude-plugin/plugin.json" \
  || fail 'copy .claude-plugin/plugin.json name is no longer "maister-copilot"'

if [ "$EXPECT_HOOKS_DIR" = "false" ]; then
  # D8 — the opt-out is ONE-DIRECTIONAL and fail-CLOSED. It removes "hooks must be present" and ADDS
  # "hooks must be absent", so a manifest declaring expects.hooksDir:false against a tree that DOES
  # carry hooks/ is a LYING declaration and a hard failure. This is the whole reason the declared-key
  # design (D4) cannot fail open. It is written EXPLICITLY rather than left to the hooks/*.sh glob
  # below, which would pass silently on an empty match: nullglob is set only inside resolve_glob's
  # own subshell, so an unmatched glob reaches grep as a literal path and merely errors.
  if [ -d "$DEST/hooks" ]; then
    fail "manifest declares expects.hooksDir=false but the staged tree of $COMMIT_OID DOES contain hooks/ — the declaration contradicts the commit (a lying declaration is a hard failure, never a skipped check)"
  fi
else
  HOOK="$DEST/hooks/skill-invocation-reminder.sh"
  [ -f "$HOOK" ] || fail "missing hooks/skill-invocation-reminder.sh in the copy"
  HOOK_OUT="$(bash "$HOOK")" || fail "hooks/skill-invocation-reminder.sh exited non-zero"
  # (a) parses as JSON, (b) TOP-LEVEL string additionalContext, (c) no hookSpecificOutput, and — when
  # a hook transform ran — the emitted context ENDS with "\n\n" + the manifest text (the JSON `\n\n`
  # escapes decode to real newlines).
  printf '%s\n' "$HOOK_OUT" | L2_HOOK_TEXT="$HOOK_TEXT" node -e '
    const j = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (typeof j.additionalContext !== "string") { console.error("no top-level string additionalContext"); process.exit(1); }
    if ("hookSpecificOutput" in j) { console.error("hookSpecificOutput wrapper present"); process.exit(1); }
    const t = process.env.L2_HOOK_TEXT;
    if (t && !j.additionalContext.endsWith("\n\n" + t)) { console.error("additionalContext does not end with the manifest text"); process.exit(1); }
  ' || fail "hook stdout failed the JSON / top-level additionalContext / no-hookSpecificOutput check"
  printf '%s\n' "$HOOK_OUT" | grep -qE '^[[:space:]]{0,2}"additionalContext":' \
    || fail 'WS5.21: hook stdout has no TOP-LEVEL "additionalContext" key'
  if printf '%s\n' "$HOOK_OUT" | grep -q 'hookSpecificOutput'; then fail "hook stdout carries hookSpecificOutput (#113)"; fi
  if grep -nE 'AskUserQuestion|maister:' "$DEST"/hooks/*.sh >&2; then fail "WS5.15: source nomenclature (AskUserQuestion / maister:) in hooks/*.sh"; fi
fi

[ "$(git -C "$REPO_ROOT" status --porcelain -- plugins)" = "$PORCELAIN_BEFORE" ] \
  || fail "the source repo's plugins/ tree changed during staging (git status --porcelain)"

# ---------------------------------------------------------------------------- digest + summary (stderr only)
# R2.3 shell idiom — the same shape run.mjs digestTree() must reproduce (sha256, LC_ALL=C sort).
DIGEST="$(cd "$DEST" && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"

# #138 R-WP1: the repository SLUGS this clone can see, sorted, for a human reading the log — today
# "SkillPanel/maister robmar-net/maister". It rides on STDERR and nowhere else: it never enters
# replay-meta.json (D3) and is NEVER a control-flow input (D4). It could not be one even in principle
# — the same slug set is visible whichever arm is staged. Unresolvable (no remotes, an unparsable URL,
# git unavailable) records the literal `unresolved` and staging CONTINUES; the precedent is the
# HEAD-vs---commit warning above, not the die2 pre-flight rejections, which name real failures.
remote_slugs() {
  local names n url slug out=""
  names="$(git -C "$REPO_ROOT" remote 2>/dev/null)" || return 1
  for n in $names; do
    url="$(git -C "$REPO_ROOT" remote get-url "$n" 2>/dev/null | head -n 1)" || continue
    case "$url" in
      https://github.com/*) slug="${url#https://github.com/}" ;;
      git@github.com:*)     slug="${url#git@github.com:}" ;;
      *)                    continue ;;
    esac
    slug="${slug%.git}"
    case "$slug" in */*) ;; *) continue ;; esac
    out="$out$slug"$'\n'
  done
  [ -n "$out" ] || return 1
  printf '%s' "$out" | LC_ALL=C sort -u | tr '\n' ' ' | sed 's/ *$//'
}
REMOTES="$(remote_slugs)" || REMOTES="unresolved"
[ -n "$REMOTES" ] || REMOTES="unresolved"

echo "variant.sh: $ARM staged from $COMMIT_OID (tree $TREE_OID) digest sha256:$DIGEST remotes: $REMOTES at $DEST" >&2
# The ONLY stdout line: the absolute staged path (captured by run.sh via $(...)).
echo "$DEST"
