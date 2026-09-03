#!/usr/bin/env bash
#
# L2 negative control — mutation builder: manufactures a KNOWN-BROKEN throwaway copy of the
# maister-copilot plugin so the conformance harness can prove it DETECTS breakage (a reference that
# never fails a broken plugin tests nothing).
#
# Usage:
#   mutate.sh <M1|M2|M3> [source-plugin-dir]     # default source: <repo>/plugins/maister-copilot
#
# Mutations (each targets the COPY only; the source is NEVER written):
#   M1  gate-removed        — strip quick-bugfix SKILL.md Step 4 (planning mode) up to Step 5,
#                             knocking out the EnterPlanMode/ExitPlanMode approval gate while
#                             leaving every other ask_user site guard intact (surgical, not greedy —
#                             a greedy strip would break MORE than the gate and over-claim detection).
#   M2  delegation-renamed  — rename one development + one research delegation END TO END: the
#                             SKILL reference, the agent frontmatter `name:`, AND the agent FILE
#                             itself all become -renamed, so the delegated(gap-analyzer)/
#                             (research-planner) predicates genuinely go missing. Anything less
#                             self-heals: Copilot registers plugin agents by their FILENAME stem,
#                             not the frontmatter `name:` (observed live 2026-08: with SKILL ref +
#                             frontmatter renamed but the file kept, subagent.started still carried
#                             agentName=research-planner and delegated(research-planner) stayed
#                             PRESENT). Renaming the FILE makes the delegation genuinely resolve to
#                             <agent>-renamed and delegated(<agent>) a candidate-regression.
#   M3  artifact-suppressed — remove the spec.md / research-report.md production instructions at
#                             four anchors ONLY (knocks out created_artifact(...); other mentions of
#                             the artifacts survive by design — see spec R1 "surviving sites").
#
# Contract (why it is shaped this way):
#   - stdout is EXACTLY ONE LINE: the absolute mutant path. run.sh stages the mutant via
#     MUTANT_DIR="$(mutate.sh ...)", so any other stdout chatter would corrupt the captured path —
#     ALL diagnostics go to stderr.
#   - The mutant dir is mktemp'd as ${TMPDIR:-/tmp}/l2-mutant-<ID>-XXXXXX: the id embedded in the
#     directory NAME is the report-annotation channel (run.mjs surfaces the rundir basename).
#   - Exit 2 = usage error / unknown id / missing source — NOTHING was created.
#     Exit 1 = anchor mismatch or post-edit verification miss — the partial copy is REMOVED first,
#     because a surviving half-mutated copy could later be staged as an UNDEFINED mutation.
#     Exit 0 = mutation applied AND every post-edit verification passed.
#   - FAIL-CLOSED: every anchor must match EXACTLY ONCE in the copy before editing (a zero-match
#     means the plugin drifted and the mutation would silently test nothing; a multi-match means
#     the edit would land somewhere unreviewed), and every post-edit verification must pass.
#   - Invariant for ALL ids: the copy's .claude-plugin/plugin.json name stays "maister-copilot" —
#     Copilot must load the mutant under the REAL name or the negative control is vacuous.
#
set -euo pipefail

# ---------------------------------------------------------------------------- paths (run.sh:51-53 idiom)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# NOTE: mutations/ is ONE level deeper than l2/, so repo root is FIVE ups
# (mutations -> l2 -> compat-tests -> copilot-cli -> platforms -> <repo>), not four.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"

usage() { echo "Usage: mutate.sh <M1|M2|M3> [source-plugin-dir]" >&2; }

# ---------------------------------------------------------------------------- args (exit 2: nothing created yet)
MUT="${1:-}"
case "$MUT" in
  M1|M2|M3) ;;
  "") usage; exit 2 ;;
  *)  echo "mutate.sh: unknown mutation id '$MUT' (expected M1|M2|M3)" >&2; usage; exit 2 ;;
esac
SRC="${2:-$REPO_ROOT/plugins/maister-copilot}"
if [ ! -d "$SRC" ] || [ ! -r "$SRC" ]; then
  echo "mutate.sh: source plugin dir missing or unreadable: $SRC" >&2; exit 2
fi

# ---------------------------------------------------------------------------- copy (source never written)
DEST="$(mktemp -d "${TMPDIR:-/tmp}/l2-mutant-${MUT}-XXXXXX")"

# Any anchor/verification miss from here on: remove the partial copy, then exit 1 (fail-closed —
# no residue that a later staging could mistake for a valid mutant).
fail() { echo "mutate.sh: $MUT FAILED: $*" >&2; rm -rf "$DEST"; exit 1; }

cp -R "$SRC"/. "$DEST"/

# ---------------------------------------------------------------------------- fail-closed helpers
# require_once FILE FIXED_LINE — the whole-line anchor must match EXACTLY once (grep -x -F: fixed
# string, full line — the anchors contain backticks/asterisks that must not be regex-interpreted).
require_once() {
  local n
  n="$(grep -cxF -e "$2" "$1" || true)"
  [ "$n" = "1" ] || fail "anchor must match exactly once in $(basename "$1") (got $n): $2"
}

# line_of FILE FIXED_LINE — 1-based line number of the (already-verified-unique) anchor.
line_of() { grep -nxF -e "$2" "$1" | cut -d: -f1; }

# edit_line FILE LINENO OLD NEW — substitute OLD -> NEW on exactly that line (awk index/substr:
# plain-string replacement, immune to regex/backreference metacharacters in either operand).
edit_line() {
  local file="$1" ln="$2" old="$3" new="$4"
  awk -v ln="$ln" -v old="$old" -v new="$new" '
    NR == ln { i = index($0, old); if (i) $0 = substr($0, 1, i - 1) new substr($0, i + length(old)) }
    { print }
  ' "$file" > "$file.mut.tmp" && mv "$file.mut.tmp" "$file"
}

# delete_range FILE FROM TO — drop lines FROM..TO inclusive.
delete_range() {
  awk -v a="$2" -v b="$3" 'NR < a || NR > b' "$1" > "$1.mut.tmp" && mv "$1.mut.tmp" "$1"
}

# ---------------------------------------------------------------------------- mutations
case "$MUT" in

  M1)
    # gate-removed: strip Step 4 (planning mode) inclusive up to the line BEFORE Step 5.
    F="$DEST/skills/quick-bugfix/SKILL.md"
    SF="$SRC/skills/quick-bugfix/SKILL.md"
    [ -f "$F" ] || fail "missing $F"
    A4='### Step 4: Enter Planning Mode'
    A5='### Step 5: TDD Red Gate'
    require_once "$F" "$A4"
    require_once "$F" "$A5"
    L4="$(line_of "$F" "$A4")"
    L5="$(line_of "$F" "$A5")"
    [ "$L4" -lt "$L5" ] || fail "Step 4 anchor (:$L4) must precede Step 5 anchor (:$L5)"
    delete_range "$F" "$L4" "$((L5 - 1))"

    # Post-strip verification: the gate is gone, and ONLY the gate.
    # (#109) The generated variant no longer names EnterPlanMode/ExitPlanMode — Copilot has no
    # plan-mode tool, so build.sh step 7c rewrites the gate onto the `ask_user` approval surface.
    # The marker to check is therefore the rewritten plan-approval instruction, not the dead tool
    # name (checking the tool name would now pass trivially — a silently weakened mutation).
    [ "$(grep -c 'Present the fix plan for user approval' "$F" || true)" = "0" ] \
      || fail "plan-approval instruction still present after strip"
    require_once "$F" "$A5"
    # ask_user count: measured from the SOURCE at run time, never hardcoded — if the plugin gains or
    # loses an ask_user site, a stale constant would mask a too-greedy strip.
    # (#109) Step 4 now CONTAINS an ask_user site (the rewritten plan-approval gate), so the strip
    # legitimately removes some: the expectation is source-count MINUS whatever lived in the stripped
    # range, computed from the range itself — never a hardcoded constant.
    RANGE_ASK="$(awk -v a="$L4" -v b="$((L5 - 1))" 'NR >= a && NR <= b' "$SF" | grep -o 'ask_user' | wc -l | tr -d ' ')"
    SRC_ASK="$(grep -o 'ask_user' "$SF" | wc -l | tr -d ' ')"
    CPY_ASK="$(grep -o 'ask_user' "$F" | wc -l | tr -d ' ')"
    [ "$CPY_ASK" = "$((SRC_ASK - RANGE_ASK))" ] \
      || fail "ask_user count drifted (source=$SRC_ASK range=$RANGE_ASK copy=$CPY_ASK) — strip was not surgical"
    for guard in 'no argument AND no bug context' 'more complex than a quick fix' 'The reproduction test passes'; do
      grep -qF -e "$guard" "$F" || fail "site guard string missing after strip: $guard"
    done
    ;;

  M2)
    # delegation-renamed: point two anchored delegations at -renamed subagents AND rename the
    # agents' frontmatter names AND the agent FILES to match (finding 3: Copilot registers agents
    # by filename, so any partial rename self-heals — see header).
    FD="$DEST/skills/development/SKILL.md"
    FR="$DEST/skills/research/SKILL.md"
    [ -f "$FD" ] && [ -f "$FR" ] || fail "missing development/research SKILL.md"
    AD='1. task tool - `maister-copilot:gap-analyzer` subagent'
    AR='**INVOKE NOW**: Use task tool with `agent_type: maister-copilot:research-planner`'
    require_once "$FD" "$AD"
    require_once "$FR" "$AR"
    edit_line "$FD" "$(line_of "$FD" "$AD")" 'maister-copilot:gap-analyzer' 'maister-copilot:gap-analyzer-renamed'
    edit_line "$FR" "$(line_of "$FR" "$AR")" 'maister-copilot:research-planner' 'maister-copilot:research-planner-renamed'

    # Verification: anchored lines carry -renamed and no longer match the originals; nothing else
    # changed (diff against the source must show exactly one changed line per file).
    require_once "$FD" '1. task tool - `maister-copilot:gap-analyzer-renamed` subagent'
    require_once "$FR" '**INVOKE NOW**: Use task tool with `agent_type: maister-copilot:research-planner-renamed`'
    [ "$(grep -cxF -e "$AD" "$FD" || true)" = "0" ] || fail "original development anchor still present"
    [ "$(grep -cxF -e "$AR" "$FR" || true)" = "0" ] || fail "original research anchor still present"
    [ "$(diff "$SRC/skills/development/SKILL.md" "$FD" | grep -c '^[<>]' || true)" = "2" ] \
      || fail "development SKILL.md changed beyond the single anchored line"
    [ "$(diff "$SRC/skills/research/SKILL.md" "$FR" | grep -c '^[<>]' || true)" = "2" ] \
      || fail "research SKILL.md changed beyond the single anchored line"

    # ALSO rename the agents' frontmatter names (edited here, at the ORIGINAL paths — the file
    # move below comes after, so these anchors stay consistent). The frontmatter rename alone is
    # NOT sufficient (finding 3, live-verified 2026-08): Copilot registers plugin agents by their
    # FILENAME stem, not the frontmatter `name:`, so with only ref + frontmatter renamed the agent
    # stayed callable as research-planner. It is kept for full consistency of the end state:
    # file + frontmatter + SKILL ref all -renamed.
    GA="$DEST/agents/gap-analyzer.md"
    RA="$DEST/agents/research-planner.md"
    [ -f "$GA" ] && [ -f "$RA" ] || fail "missing agents/gap-analyzer.md or agents/research-planner.md"
    NG='name: gap-analyzer'
    NR='name: research-planner'
    require_once "$GA" "$NG"
    require_once "$RA" "$NR"
    edit_line "$GA" "$(line_of "$GA" "$NG")" 'name: gap-analyzer' 'name: gap-analyzer-renamed'
    edit_line "$RA" "$(line_of "$RA" "$NR")" 'name: research-planner' 'name: research-planner-renamed'

    # Verification: renamed frontmatter line present, bare original gone, exactly one line changed
    # per agent file (diff against the source), consistently with the SKILL-side checks above.
    require_once "$GA" 'name: gap-analyzer-renamed'
    require_once "$RA" 'name: research-planner-renamed'
    [ "$(grep -cxF -e "$NG" "$GA" || true)" = "0" ] || fail "bare 'name: gap-analyzer' line still present"
    [ "$(grep -cxF -e "$NR" "$RA" || true)" = "0" ] || fail "bare 'name: research-planner' line still present"
    [ "$(diff "$SRC/agents/gap-analyzer.md" "$GA" | grep -c '^[<>]' || true)" = "2" ] \
      || fail "agents/gap-analyzer.md changed beyond the single frontmatter name line"
    [ "$(diff "$SRC/agents/research-planner.md" "$RA" | grep -c '^[<>]' || true)" = "2" ] \
      || fail "agents/research-planner.md changed beyond the single frontmatter name line"

    # ALSO rename the agent FILES — the decisive knockout. Finding 3 (live-verified 2026-08):
    # Copilot registers agents by filename; M2 renames the agent FILE (+ frontmatter + SKILL ref)
    # so the delegation genuinely resolves to <agent>-renamed and delegated(<agent>) becomes a
    # candidate-regression. Fail-closed: source path must exist, destination must not, and the
    # move must land (old absent, new present, -renamed frontmatter carried along).
    GA2="$DEST/agents/gap-analyzer-renamed.md"
    RA2="$DEST/agents/research-planner-renamed.md"
    [ -f "$GA" ] || fail "agents/gap-analyzer.md missing before file rename"
    [ -f "$RA" ] || fail "agents/research-planner.md missing before file rename"
    [ ! -e "$GA2" ] || fail "agents/gap-analyzer-renamed.md already exists in the copy"
    [ ! -e "$RA2" ] || fail "agents/research-planner-renamed.md already exists in the copy"
    mv "$GA" "$GA2" || fail "mv agents/gap-analyzer.md -> gap-analyzer-renamed.md failed"
    mv "$RA" "$RA2" || fail "mv agents/research-planner.md -> research-planner-renamed.md failed"
    { [ ! -e "$GA" ] && [ -f "$GA2" ]; } \
      || fail "gap-analyzer file rename did not land (old path present or new path missing)"
    { [ ! -e "$RA" ] && [ -f "$RA2" ]; } \
      || fail "research-planner file rename did not land (old path present or new path missing)"
    require_once "$GA2" 'name: gap-analyzer-renamed'
    require_once "$RA2" 'name: research-planner-renamed'
    ;;

  M3)
    # artifact-suppressed: remove the four anchored artifact-production instructions — ONLY these.
    FD="$DEST/skills/development/SKILL.md"
    FR="$DEST/skills/research/SKILL.md"
    [ -f "$FD" ] && [ -f "$FR" ] || fail "missing development/research SKILL.md"

    # (a) development: delete the specification-creator delegation line.
    DL='6. task tool - `maister-copilot:specification-creator` subagent'
    require_once "$FD" "$DL"
    delete_range "$FD" "$(line_of "$FD" "$DL")" "$(line_of "$FD" "$DL")"
    # (b) development: on the one **Output**: line listing implementation/spec.md, drop token + separator.
    N="$(grep -cE -e '^\*\*Output\*\*:.*implementation/spec\.md' "$FD" || true)"
    [ "$N" = "1" ] || fail "**Output**: implementation/spec.md anchor must match exactly once (got $N)"
    OL="$(grep -nE -e '^\*\*Output\*\*:.*implementation/spec\.md' "$FD" | cut -d: -f1)"
    edit_line "$FD" "$OL" ', `implementation/spec.md`' ''
    # (c) research: on the one **Artifacts**: line listing research-report.md, drop token + separator.
    N="$(grep -cE -e '^\*\*Artifacts\*\*:.*outputs/research-report\.md' "$FR" || true)"
    [ "$N" = "1" ] || fail "**Artifacts**: research-report anchor must match exactly once (got $N)"
    AL="$(grep -nE -e '^\*\*Artifacts\*\*:.*outputs/research-report\.md' "$FR" | cut -d: -f1)"
    edit_line "$FR" "$AL" ', `outputs/research-report.md`' ''
    # (d) research: delete the synthesizer report bullet.
    SL='- Comprehensive research report answering research question (`outputs/research-report.md`)'
    require_once "$FR" "$SL"
    delete_range "$FR" "$(line_of "$FR" "$SL")" "$(line_of "$FR" "$SL")"

    # Verification: two lines gone, two lines de-tokenized in the COPY; each token intact in SOURCE.
    [ "$(grep -cxF -e "$DL" "$FD" || true)" = "0" ] || fail "specification-creator line still present"
    [ "$(grep -cxF -e "$SL" "$FR" || true)" = "0" ] || fail "synthesizer bullet still present"
    [ "$(grep -cE -e '^\*\*Output\*\*:.*implementation/spec\.md' "$FD" || true)" = "0" ] \
      || fail "**Output**: line still lists implementation/spec.md"
    [ "$(grep -cE -e '^\*\*Artifacts\*\*:.*outputs/research-report\.md' "$FR" || true)" = "0" ] \
      || fail "**Artifacts**: line still lists outputs/research-report.md"
    grep -qF -e 'implementation/spec.md' "$SRC/skills/development/SKILL.md" \
      || fail "source development SKILL.md lost implementation/spec.md (source was written?!)"
    grep -qF -e 'outputs/research-report.md' "$SRC/skills/research/SKILL.md" \
      || fail "source research SKILL.md lost outputs/research-report.md (source was written?!)"
    ;;
esac

# ---------------------------------------------------------------------------- all-ids invariant
grep -qE '"name"[[:space:]]*:[[:space:]]*"maister-copilot"' "$DEST/.claude-plugin/plugin.json" \
  || fail 'copy .claude-plugin/plugin.json name is no longer "maister-copilot"'

echo "mutate.sh: $MUT applied and verified at $DEST" >&2
# The ONLY stdout line: the absolute mutant path (captured by run.sh via $(...)).
echo "$DEST"
