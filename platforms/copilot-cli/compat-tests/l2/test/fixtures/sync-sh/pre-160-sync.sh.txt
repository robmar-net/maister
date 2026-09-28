#!/usr/bin/env bash
#
# sync.sh — the ONLY sanctioned way to land an UPSTREAM MERGE on the fork (robmar-net/maister).
# AGENTS.md § Shipping makes this binding (#157).
#
# WHY THIS IS A SECOND SCRIPT AND NOT A FLAG ON pr.sh. `pr.sh` derives its value from having no
# skip flags: every rule it can check, it checks, and nothing turns a check off. A `--sync` flag
# would necessarily be a flag that DISABLES its central zero-touch guard, and from then on an
# ordinary ticket could be pushed through with `--sync` by mistake. The two activities are also
# opposites, not variants — reacting to upstream inverts three of pr.sh's invariants at once:
#
#                       pr.sh (our work)                  sync.sh (upstream)
#   plugins/maister/**  must be UNCHANGED                 CHANGES BY DEFINITION — that is the job
#   history             squash to one commit              MUST PRESERVE the merge commit
#   version            +fork.N incremented               base moves ⇒ N RESETS to 1
#   merge tripwires     not applicable                    the core of the job
#
# A squash or a rebase would drop the merge commit's SECOND PARENT, and with it the only record
# that we ever merged. Git would then re-apply the same upstream change on the next sync and
# conflict against our own copy of it. So this script lands with `--merge` and asserts afterwards
# that the upstream SHA really is an ancestor of master.
#
# Usage:
#   scripts/sync.sh start                              # worktree + tripwire preflight + the merge, left uncommitted
#   scripts/sync.sh land "<title>" --body-file <f> [--no-merge] [--keep-worktree]
#                                                      # run INSIDE the sync worktree, merge COMMITTED
#
# `start` is a fixed pipeline; a refusal stops it BEFORE the merge, which is the point:
#   S1  remotes resolved BY SLUG — fetch only SkillPanel/maister, push only robmar-net/maister
#   S2  a dedicated worktree on a sync branch off fresh fork master, clean tree
#   S3  TRIPWIRE PREFLIGHT, before touching anything: a `model:` alias build.sh cannot map is a STOP
#       (ADR 0002); a CLAUDE.md in the incoming range is reported (the @AGENTS.md import can vanish
#       with nothing erroring); then the incoming diffstat and the conflict set SPLIT into
#       generated-and-therefore-regenerate vs hand-resolve
#   S4  `git merge --no-commit`, leaving conflicts for a human to resolve
#
# `land` is a fixed pipeline; every step is a refusal point and none can be skipped by flag:
#   L1  you are in a LINKED worktree on a non-master branch, tree clean, HEAD is a 2-parent MERGE
#   L2  push target resolves BY SLUG to robmar-net/maister — SkillPanel/maister is refused
#   L3  fork master is an ancestor of HEAD (never rebase a merge: if master moved, merge it in)
#   L4  no conflict residue, and nothing under plugins/maister-copilot/** was hand-resolved
#   L5  version rule INVERTED vs pr.sh P6: the upstream base moved ⇒ all three manifests read
#       <new-upstream-base>+fork.1
#   L6  gates: make build → validate → check-deterministic → the L2 unit suite, tree STILL clean
#   L7  citation-drift.mjs --base=HEAD^1: the L2 provenance check the reference hash cannot do
#   L8  an APPENDED CALIBRATION-LOG entry (insertions > 0, deletions == 0) records the sync
#   L9  push, gh pr create, wait for EVERY check to be green
#   L10 merge with --merge (NOT squash), assert the upstream SHA is now an ancestor of master,
#       fast-forward the main checkout, then remove the worktree — only after every bundle in it
#       is archived AND verified
#
# Env: PR_REPO_SLUG (default robmar-net/maister). Exit 0 = landed (or opened, with --no-merge);
# 1 = a refusal point tripped; 2 = usage.
#
set -euo pipefail

SLUG="${PR_REPO_SLUG:-robmar-net/maister}"
UPSTREAM_SLUG="SkillPanel/maister"

log()  { printf '%s\n' "$*" >&2; }
fail() { log "sync.sh: REFUSED — $*"; exit 1; }
usage() { log 'Usage: scripts/sync.sh start | scripts/sync.sh land "<title>" --body-file <f> [--no-merge] [--keep-worktree]'; exit 2; }

# A remote keyed by SLUG, never by name (AGENTS.md § Remotes): names differ between clones.
remote_for() {
  local want="$1" r url
  for r in $(git remote); do
    url="$(git remote get-url "$r")"
    case "$url" in *"github.com/${want}"*|*"github.com:${want}"*) printf '%s' "$r"; return 0 ;; esac
  done
  return 1
}
main_checkout() { git worktree list --porcelain | sed -n '1s/^worktree //p'; }
ver_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).version))'; }

# ---------------------------------------------------------------------------------------------- start
cmd_start() {
  [ $# -eq 0 ] || usage
  local main; main="$(main_checkout)"
  cd "$main"

  # S1 — remotes by slug
  local up fork
  up="$(remote_for "$UPSTREAM_SLUG")"   || fail "no remote points at upstream ${UPSTREAM_SLUG} (fetch-only)"
  fork="$(remote_for "$SLUG")"          || fail "no remote points at ${SLUG}"
  case "$(git remote get-url --push "$fork")" in *"$UPSTREAM_SLUG"*) fail "push url of '$fork' points at upstream" ;; esac
  git fetch -q "$up" master
  git fetch -q "$fork" master
  local upstream_sha base_sha
  upstream_sha="$(git rev-parse "$up/master")"
  base_sha="$(git rev-parse "$fork/master")"
  if git merge-base --is-ancestor "$upstream_sha" "$base_sha"; then
    log "already in sync: ${UPSTREAM_SLUG}@$(git rev-parse --short "$upstream_sha") is an ancestor of our master"
    return 0
  fi
  local upver; upver="$(git show "$upstream_sha:plugins/maister/.claude-plugin/plugin.json" | ver_of)"
  log "S1 upstream $up → $(git rev-parse --short "$upstream_sha") (version $upver); our master $(git rev-parse --short "$base_sha")"

  # S3 — TRIPWIRE PREFLIGHT, before the merge (AGENTS.md § Upstream-merge tripwires)
  local mb; mb="$(git merge-base "$base_sha" "$upstream_sha")"
  local aliases
  aliases="$(git diff --name-only "$mb" "$upstream_sha" -- 'plugins/maister/agents/*.md' | while read -r f; do
    git show "$upstream_sha:$f" 2>/dev/null | sed -n '1,12p' | sed -n 's/^model:[[:space:]]*\([A-Za-z0-9._-]*\).*/\1/p'
  done | sort -u || true)"
  local unknown=""
  local a
  for a in $aliases; do
    grep -qE "^[[:space:]]*${a}\)" platforms/copilot-cli/build.sh || unknown="$unknown $a"
  done
  [ -z "$unknown" ] || fail "incoming agent model: alias(es) the build.sh step-3b map does not know:$unknown — extend the map (a Copilot catalog id) BEFORE merging (ADR 0002)"
  [ -n "$aliases" ] && log "S3 incoming model: aliases — $(echo $aliases | tr ' ' ',') (all mapped)"
  if git diff --name-only "$mb" "$upstream_sha" -- CLAUDE.md | grep -q .; then
    log "S3 WARNING: the incoming range touches CLAUDE.md — the @AGENTS.md import can be dropped and NOTHING errors."
    log "   make validate (WS5.23) is the backstop; restore the import at the top of CLAUDE.md if it fails."
  fi

  # S2 — worktree on a sync branch
  local branch="sync/upstream-${upver}" wt="$main/.worktrees/sync-${upver}"
  [ ! -e "$wt" ] || fail "worktree already exists: $wt — use it (git worktree list); never create a second one"
  git worktree add "$wt" -b "$branch" "$fork/master" >&2
  log "S2 worktree ready: $wt  (branch $branch off $fork/master)"

  # report the shape of the work, split by how each conflict MUST be resolved
  log "S3 incoming: $(git diff --shortstat "$mb" "$upstream_sha" | sed 's/^ //')"
  local both
  both="$(comm -12 <(git diff --name-only "$mb" "$upstream_sha" | sort) <(git diff --name-only "$mb" "$base_sha" | sort))"
  local gen hand
  gen="$(printf '%s\n' "$both" | grep '^plugins/maister-copilot/' || true)"
  hand="$(printf '%s\n' "$both" | grep -v '^plugins/maister-copilot/' || true)"
  log "S3 changed on BOTH sides: $(printf '%s\n' "$both" | grep -c . || true) file(s)"
  log "    REGENERATE (never hand-merge): $(printf '%s\n' "$gen" | grep -c . || true) under plugins/maister-copilot/"
  log "    hand-resolve:"
  printf '%s\n' "$hand" | grep . | sed 's/^/      /' >&2 || true

  # S4 — the merge, left uncommitted for resolution
  cd "$wt"
  if git merge --no-commit "$upstream_sha" >&2; then
    log "S4 merge applied with no conflicts (still uncommitted)"
  else
    log "S4 merge left conflicts — resolve them in $wt"
  fi
  log ""
  log "NEXT, in $wt:"
  log "  1. resolve the hand-resolve files above; for plugins/maister-copilot/** do NOT hand-merge:"
  log "       rm -rf plugins/maister-copilot && make build   (then git add plugins/maister-copilot)"
  log "  2. set all three manifests to ${upver}+fork.1 (the base moved ⇒ N resets) and make build"
  log "  3. node platforms/copilot-cli/compat-tests/l2/tools/citation-drift.mjs --base=$(git rev-parse --short "$base_sha")"
  log "  4. append a CALIBRATION-LOG entry recording what moved and what did not"
  log "  5. git add <paths> && git commit   (a MERGE commit — never amend away its second parent)"
  log "  6. scripts/sync.sh land \"<title>\" --body-file <f>"
  printf '%s\n' "$wt"
}

# ----------------------------------------------------------------------------------------------- land
cmd_land() {
  local title="${1:-}"; shift || true
  local body_file="" merge=1 keep=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --body-file) body_file="${2:-}"; shift 2 ;;
      --no-merge) merge=0; shift ;;
      --keep-worktree) keep=1; shift ;;
      *) usage ;;
    esac
  done
  [ -n "$title" ] && [ -n "$body_file" ] && [ -f "$body_file" ] || usage

  # L1 — linked worktree, non-master branch, clean tree, HEAD is a 2-parent merge
  local top main branch
  top="$(git rev-parse --show-toplevel)"; main="$(main_checkout)"
  [ "$top" != "$main" ] || fail "you are in the MAIN checkout ($main); land from the sync worktree (scripts/sync.sh start)"
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" != "master" ] && [ "$branch" != "HEAD" ] || fail "on '$branch' — a sync needs its own branch"
  [ -z "$(git status --porcelain)" ] || fail "working tree not clean — commit (git add <paths>) or drop the changes first"
  local parents; parents="$(git rev-list --parents -n1 HEAD | wc -w | tr -d ' ')"
  [ "$parents" = "3" ] || fail "HEAD has $((parents-1)) parent(s) — a sync must land a MERGE commit (2 parents). A squashed or rebased sync loses the record that we merged at all."
  local base_sha upstream_sha
  base_sha="$(git rev-parse HEAD^1)"; upstream_sha="$(git rev-parse HEAD^2)"
  log "L1 merge commit $(git rev-parse --short HEAD): ours $(git rev-parse --short "$base_sha") + upstream $(git rev-parse --short "$upstream_sha")"

  # L2 — push target by slug
  local fork; fork="$(remote_for "$SLUG")" || fail "no remote points at ${SLUG}"
  case "$(git remote get-url --push "$fork")" in *"$UPSTREAM_SLUG"*) fail "push url of '$fork' points at upstream ${UPSTREAM_SLUG}" ;; esac
  log "L2 push target: $fork → ${SLUG}"

  # L3 — fork master must be an ancestor; NEVER rebase (that is what drops the merge)
  git fetch -q "$fork" master
  git merge-base --is-ancestor "$fork/master" HEAD \
    || fail "$fork/master is not an ancestor of HEAD — master moved. MERGE it in (git merge $fork/master); do NOT rebase, a rebase drops this branch's merge commit."
  log "L3 $fork/master is an ancestor of HEAD"

  # L4 — no conflict residue; the generated tree was regenerated, not hand-merged
  ! git grep -qE '^(<<<<<<<|>>>>>>>) ' -- . || fail "conflict markers are still in the tree"
  log "L4 no conflict residue"

  # L5 — version rule, INVERTED vs pr.sh: a moved base resets N to 1
  local upver headver basever f
  upver="$(git show "$upstream_sha:plugins/maister/.claude-plugin/plugin.json" | ver_of)"
  basever="$(git show "$base_sha:plugins/maister/.claude-plugin/plugin.json" | ver_of)"
  headver="$(ver_of < plugins/maister/.claude-plugin/plugin.json)"
  for f in .claude-plugin/marketplace.json plugins/maister/.claude-plugin/plugin.json plugins/maister-copilot/.claude-plugin/plugin.json; do
    [ "$(ver_of < "$f")" = "$headver" ] || fail "$f version is $(ver_of < "$f"), not $headver — all three manifests must agree"
  done
  if [ "$upver" != "${basever%%+*}" ]; then
    [ "$headver" = "${upver}+fork.1" ] || fail "the upstream base moved ${basever%%+*} → $upver, so all three manifests must read ${upver}+fork.1 (a new base RESETS N); they read $headver"
    log "L5 version ${basever} → ${headver} (base moved, N reset)"
  else
    case "$headver" in "${upver}+fork."*) log "L5 version $headver (base unchanged at $upver)" ;;
      *) fail "version $headver does not carry the ${upver}+fork.N shape" ;; esac
  fi

  # L6 — gates
  log "L6 gates: make build / validate / check-deterministic / L2 unit suite"
  make -s build      >/dev/null 2>&1 || fail "make build failed"
  make -s validate   >&2             || fail "make validate failed"
  make -s check-deterministic >/dev/null 2>&1 || fail "make check-deterministic failed"
  node --test platforms/copilot-cli/compat-tests/l2/test/*.test.mjs >/dev/null 2>&1 \
    || { node --test platforms/copilot-cli/compat-tests/l2/test/*.test.mjs 2>&1 | tail -30 >&2; fail "L2 unit suite failed"; }
  [ -z "$(git status --porcelain)" ] || { git status --short >&2; fail "the build changed tracked files — commit the regenerated tree, then re-run"; }
  log "L6 gates green, tree still clean"

  # L7 — the provenance check the reference hash structurally cannot do (#157)
  local drift="platforms/copilot-cli/compat-tests/l2/tools/citation-drift.mjs"
  if [ -f "$drift" ]; then
    node "$drift" --base="$base_sha" >&2 \
      || fail "L2 citation drift is unresolved — re-anchor the derivations (node $drift --base=$base_sha --fix) and record the offsets of any append-only citations in a NEW CALIBRATION entry"
    log "L7 citation provenance clean against $(git rev-parse --short "$base_sha")"
  else
    fail "$drift is missing — a sync cannot be verified without the citation check (#157)"
  fi

  # L8 — an APPENDED CALIBRATION entry, proven append-only
  local cal="platforms/copilot-cli/compat-tests/l2/reference/CALIBRATION-LOG.md" stat ins del
  stat="$(git diff --numstat "$base_sha" HEAD -- "$cal" || true)"
  [ -n "$stat" ] || fail "no CALIBRATION-LOG entry in this sync — record what moved, what did not, and why (AGENTS.md); a sync with no calibration record is an undocumented reference state"
  ins="$(printf '%s' "$stat" | awk '{print $1}')"; del="$(printf '%s' "$stat" | awk '{print $2}')"
  [ "$del" = "0" ] || fail "CALIBRATION-LOG.md has $del deletion(s) — the log is APPEND-ONLY; correct a stale citation in a NEW entry, never by editing the old one"
  log "L8 CALIBRATION entry appended (+$ins, -0)"

  # L9 — push, open, wait for green
  if git ls-remote --exit-code --heads "$fork" "$branch" >/dev/null 2>&1; then
    git push -q --force-with-lease "$fork" "$branch" || fail "push refused"
  else
    git push -q -u "$fork" "$branch" || fail "push refused"
  fi
  local url num
  url="$(gh pr create --repo "$SLUG" --head "$branch" --base master --title "$title" --body-file "$body_file")" || fail "gh pr create failed"
  num="${url##*/}"
  log "L9 PR #$num opened: $url"
  if [ "$merge" -eq 0 ]; then log "stopping before checks/merge (--no-merge)"; printf '%s\n' "$url"; return 0; fi

  log "L9 waiting for checks…"
  local i=0
  until gh pr checks "$num" --repo "$SLUG" >/dev/null 2>&1; do
    i=$((i+1)); [ $i -le 30 ] || fail "no checks reported after 5 minutes — inspect $url"
    sleep 10
  done
  gh pr checks "$num" --repo "$SLUG" --watch --fail-fast >&2 || fail "a check is RED on $url — never merge on red; fix, commit, re-run land"
  log "L9 all checks green"

  # L10 — land as a MERGE, then prove the upstream SHA is an ancestor of master
  gh pr merge "$num" --repo "$SLUG" --merge --delete-branch >&2 || fail "merge failed on $url"
  git -C "$main" pull -q --ff-only "$fork" master || fail "main checkout could not fast-forward — it has local commits; fix by hand"
  git -C "$main" merge-base --is-ancestor "$upstream_sha" master \
    || fail "upstream $(git rev-parse --short "$upstream_sha") is NOT an ancestor of master after the merge — the second parent was lost (a squash?). The next sync would re-apply the same change; fix before doing anything else."
  log "L10 merged; upstream $(git rev-parse --short "$upstream_sha") is now an ancestor of master ($(git -C "$main" rev-parse --short HEAD))"

  if [ "$keep" -eq 1 ]; then log "worktree kept: $top"; printf '%s\n' "$url"; return 0; fi
  local reports="$top/platforms/copilot-cli/compat-tests/reports" archiver="$top/platforms/copilot-cli/compat-tests/l2/tools/bundle-archive.sh" ts unsafe=0
  for ts in "$reports"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z; do
    [ -d "$ts" ] || continue
    ts="$(basename "$ts")"
    if ! bash "$archiver" "$ts" --verify >/dev/null 2>&1; then log "    bundle NOT archived+verified: $ts"; unsafe=1; fi
  done
  [ "$unsafe" -eq 0 ] || { log "archive each with: bash $archiver <ts> && bash $archiver <ts> --verify   (AGENTS.md § Evidence must outlive the worktree)"; log "worktree KEPT: $top"; printf '%s\n' "$url"; return 0; }
  cd "$main"
  git -C "$main" worktree remove "$top" >&2 || fail "worktree remove failed — remove by hand: git worktree remove $top"
  git -C "$main" branch -D "$branch" >/dev/null 2>&1 || true
  log "L10 worktree removed; master at $(git -C "$main" rev-parse --short HEAD)"
  printf '%s\n' "$url"
}

# ----------------------------------------------------------------------------------------------- main
case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  land)  shift; cmd_land "$@" ;;
  -h|--help|help) sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//' >&2 ;;
  *) usage ;;
esac
