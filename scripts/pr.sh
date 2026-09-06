#!/usr/bin/env bash
#
# pr.sh — the ONLY sanctioned way to open and land a PR on the fork (robmar-net/maister). AGENTS.md
# § Shipping makes this binding (#148).
#
# Usage:
#   scripts/pr.sh start <ticket> <branch>          # fresh worktree .worktrees/<ticket> on <branch> off fork master
#   scripts/pr.sh ship  "<title>" --body-file <f> [--draft] [--no-merge] [--keep-worktree]
#                                                  # run INSIDE the ticket worktree, everything committed
#
# `ship` is a fixed pipeline; every step is a refusal point and none can be skipped by flag:
#   P1  you are in a LINKED worktree (never the main checkout) on a non-master branch, tree clean
#   P2  the push target resolves, BY SLUG, to robmar-net/maister — SkillPanel/maister is refused
#   P3  rebase onto fresh fork master (a conflict aborts; you resolve, you re-run)
#   P4  zero-touch: plugins/maister/** unchanged except the version line of its plugin.json
#   P5  gates: make build → make validate → make check-deterministic → make test-l2-unit, and the tree
#       is STILL clean afterwards (a build that changes the generated tree means you forgot to commit it)
#   P6  version rule (AGENTS.md § Versioning): installer-visible paths changed ⇒ +fork.N bumped;
#       nothing installer-visible changed ⇒ version untouched
#   P7  push (force-with-lease after the rebase), gh pr create, wait for EVERY check to be green
#   P8  squash-merge with branch deletion, fast-forward the main checkout, then remove the worktree —
#       only after the merge is confirmed on master AND every bundle in the worktree is archived+verified
#
# Why: 56 PRs landed in one week, all self-merged, three sessions in parallel, and two of the incidents
# in AGENTS.md (cross-branch leak into PR #128, ~16 bundles destroyed by worktree removal) happened at
# exactly the steps this script now refuses to skip.
#
# Env: PR_REPO_SLUG (default robmar-net/maister). Exit 0 = landed (or opened, with --no-merge);
# 1 = a refusal point tripped; 2 = usage.
#
set -euo pipefail

SLUG="${PR_REPO_SLUG:-robmar-net/maister}"
UPSTREAM_SLUG="SkillPanel/maister"

log()  { printf '%s\n' "$*" >&2; }
fail() { log "pr.sh: REFUSED — $*"; exit 1; }
usage() { log 'Usage: scripts/pr.sh start <ticket> <branch> | scripts/pr.sh ship "<title>" --body-file <f> [--draft] [--no-merge] [--keep-worktree]'; exit 2; }

# The remote whose FETCH url is our fork, keyed by slug — never by name (AGENTS.md § Remotes).
fork_remote() {
  local r url
  for r in $(git remote); do
    url="$(git remote get-url "$r")"
    case "$url" in *"github.com/${SLUG}"*|*"github.com:${SLUG}"*) printf '%s' "$r"; return 0 ;; esac
  done
  return 1
}

main_checkout() { git worktree list --porcelain | sed -n '1s/^worktree //p'; }

# ---------------------------------------------------------------------------------------------- start
cmd_start() {
  local ticket="${1:-}" branch="${2:-}"
  [ -n "$ticket" ] && [ -n "$branch" ] || usage
  [[ "$ticket" =~ ^[0-9]+$ ]] || fail "ticket must be a number (the fork issue), got '$ticket'"
  local main; main="$(main_checkout)"
  local remote; remote="$(fork_remote)" || fail "no remote points at ${SLUG}"
  local wt="$main/.worktrees/$ticket"
  [ ! -e "$wt" ] || fail "worktree already exists: $wt — use it (git worktree list); never create a second one"
  git -C "$main" fetch -q "$remote" master
  git -C "$main" worktree add "$wt" -b "$branch" "$remote/master" >&2
  log "worktree ready: $wt  (branch $branch off $remote/master @ $(git -C "$wt" rev-parse --short HEAD))"
  log "do ALL work there; stage with git add <paths>; then: scripts/pr.sh ship \"<title>\" --body-file <f>"
  printf '%s\n' "$wt"
}

# ----------------------------------------------------------------------------------------------- ship
cmd_ship() {
  local title="${1:-}"; shift || true
  local body_file="" draft=0 merge=1 keep=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --body-file) body_file="${2:-}"; shift 2 ;;
      --draft) draft=1; shift ;;
      --no-merge) merge=0; shift ;;
      --keep-worktree) keep=1; shift ;;
      *) usage ;;
    esac
  done
  [ -n "$title" ] && [ -n "$body_file" ] && [ -f "$body_file" ] || usage

  # P1 — linked worktree, non-master branch, clean tree
  local top main branch
  top="$(git rev-parse --show-toplevel)"; main="$(main_checkout)"
  [ "$top" != "$main" ] || fail "you are in the MAIN checkout ($main); ship from the ticket worktree (scripts/pr.sh start)"
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" != "master" ] && [ "$branch" != "HEAD" ] || fail "on '$branch' — a PR needs its own branch"
  [ -z "$(git status --porcelain)" ] || fail "working tree not clean — commit (git add <paths>) or drop the changes first"

  # P2 — push target by slug
  local remote; remote="$(fork_remote)" || fail "no remote points at ${SLUG}"
  case "$(git remote get-url --push "$remote")" in *"$UPSTREAM_SLUG"*) fail "push url of '$remote' points at upstream ${UPSTREAM_SLUG}" ;; esac
  log "P2 push target: $remote → ${SLUG}"

  # P3 — rebase onto fresh master
  git fetch -q "$remote" master
  git rebase -q "$remote/master" || { git rebase --abort; fail "rebase onto $remote/master conflicted — resolve on the branch, commit, re-run"; }
  local base="$remote/master"
  log "P3 rebased onto $(git rev-parse --short "$base")"

  # P4 — zero-touch on the Claude source
  local touched
  touched="$(git diff --name-only "$base"...HEAD -- plugins/maister | grep -v '^plugins/maister/.claude-plugin/plugin.json$' || true)"
  [ -z "$touched" ] || { printf '%s\n' "$touched" | sed 's/^/    /' >&2; fail "plugins/maister/** is zero-touch (only its plugin.json version line may change)"; }
  if git diff --name-only "$base"...HEAD -- plugins/maister/.claude-plugin/plugin.json | grep -q .; then
    local nonver; nonver="$(git diff "$base"...HEAD -- plugins/maister/.claude-plugin/plugin.json | grep '^[-+]' | grep -v '^[-+][-+]' | grep -v '"version"' || true)"
    [ -z "$nonver" ] || fail "plugins/maister/.claude-plugin/plugin.json changed beyond the version line"
  fi
  log "P4 zero-touch ok"

  # P5 — gates
  log "P5 gates: make build / validate / check-deterministic / test-l2-unit"
  make -s build      >/dev/null 2>&1 || fail "make build failed"
  make -s validate   >&2             || fail "make validate failed"
  make -s check-deterministic >/dev/null 2>&1 || fail "make check-deterministic failed"
  node --test platforms/copilot-cli/compat-tests/l2/test/*.test.mjs >/dev/null 2>&1 || { node --test platforms/copilot-cli/compat-tests/l2/test/*.test.mjs 2>&1 | tail -30 >&2; fail "L2 unit suite failed"; }
  [ -z "$(git status --porcelain)" ] || { git status --short >&2; fail "the build changed tracked files — commit the regenerated tree, then re-run"; }
  log "P5 gates green, tree still clean"

  # P6 — version rule
  local ver_base ver_head installer_paths
  ver_base="$(git show "$base:plugins/maister/.claude-plugin/plugin.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).version))')"
  ver_head="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("plugins/maister/.claude-plugin/plugin.json","utf8")).version)')"
  installer_paths="$(git diff --name-only "$base"...HEAD | grep -E '^(plugins/|platforms/copilot-cli/build\.sh$|platforms/copilot-cli/hooks-overrides/|\.claude-plugin/marketplace\.json$)' | grep -v -E '^plugins/(maister|maister-copilot)/\.claude-plugin/plugin\.json$' || true)"
  if [ -n "$installer_paths" ]; then
    [ "$ver_base" != "$ver_head" ] || { printf '%s\n' "$installer_paths" | head -20 | sed 's/^/    /' >&2; fail "installer-visible paths changed but the version is still $ver_head — bump +fork.N in the two source manifests, make build, commit"; }
    log "P6 version bumped $ver_base → $ver_head (installer-visible change)"
  else
    [ "$ver_base" = "$ver_head" ] || fail "version changed ($ver_base → $ver_head) but nothing installer-visible did — docs/harness-only PRs do not bump +fork.N"
    log "P6 version untouched ($ver_head) — docs/harness-only change"
  fi

  # P7 — push, open, wait for green
  if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
    git push -q --force-with-lease "$remote" "$branch" || fail "push refused"
  else
    git push -q -u "$remote" "$branch" || fail "push refused"
  fi
  local url num
  local -a create=(--repo "$SLUG" --head "$branch" --base master --title "$title" --body-file "$body_file")
  [ "$draft" -eq 1 ] && create+=(--draft)
  url="$(gh pr create "${create[@]}")" || fail "gh pr create failed"
  num="${url##*/}"
  log "P7 PR #$num opened: $url"
  if [ "$merge" -eq 0 ] || [ "$draft" -eq 1 ]; then log "stopping before checks/merge (--no-merge/--draft)"; printf '%s\n' "$url"; return 0; fi

  log "P7 waiting for checks…"
  local i=0
  until gh pr checks "$num" --repo "$SLUG" >/dev/null 2>&1; do   # "no checks reported" right after push
    i=$((i+1)); [ $i -le 30 ] || fail "no checks reported after 5 minutes — inspect $url"
    sleep 10
  done
  gh pr checks "$num" --repo "$SLUG" --watch --fail-fast >&2 || fail "a check is RED on $url — never merge on red; fix, commit, re-run ship"
  log "P7 all checks green"

  # P8 — merge, fast-forward main, archive-verified worktree removal
  gh pr merge "$num" --repo "$SLUG" --squash --delete-branch >&2 || fail "merge failed on $url"
  git -C "$main" pull -q --ff-only "$remote" master || fail "main checkout could not fast-forward — it has local commits; fix by hand"
  git -C "$main" log -1 --format=%s | grep -q "(#$num)" || fail "master's tip is not PR #$num's squash — inspect before touching the worktree"
  log "P8 merged: $(git -C "$main" log -1 --format='%h %s')"

  if [ "$keep" -eq 1 ]; then log "worktree kept: $top"; printf '%s\n' "$url"; return 0; fi
  local reports="$top/platforms/copilot-cli/compat-tests/reports" archiver="$top/platforms/copilot-cli/compat-tests/l2/tools/bundle-archive.sh" ts unsafe=0
  for ts in "$reports"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z; do
    [ -d "$ts" ] || continue
    ts="$(basename "$ts")"
    if ! bash "$archiver" "$ts" --verify >/dev/null 2>&1; then log "    bundle NOT archived+verified: $ts"; unsafe=1; fi
  done
  [ "$unsafe" -eq 0 ] || { log "archive each with: bash $archiver <ts> && bash $archiver <ts> --verify   (AGENTS.md § Evidence must outlive the worktree)"; log "worktree KEPT: $top  (remove by hand only after every bundle verifies)"; printf '%s\n' "$url"; return 0; }
  cd "$main"
  git -C "$main" worktree remove "$top" >&2 || fail "worktree remove failed — remove by hand: git worktree remove $top"
  git -C "$main" branch -D "$branch" >/dev/null 2>&1 || true
  log "P8 worktree removed; master at $(git -C "$main" rev-parse --short HEAD)"
  printf '%s\n' "$url"
}

# ----------------------------------------------------------------------------------------------- main
case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  ship)  shift; cmd_ship "$@" ;;
  -h|--help|help) sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//' >&2 ;;
  *) usage ;;
esac
