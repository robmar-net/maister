#!/usr/bin/env bash
#
# wiki.sh — the ONLY sanctioned way to change the fork wiki (robmar-net/maister.wiki). AGENTS.md
# § Shipping makes this binding (#148).
#
# Usage:
#   scripts/wiki.sh checkout                 # fresh clone → prints its path (the ONLY stdout line)
#   scripts/wiki.sh check   [<clone>]        # every publish-time guard, read-only, exit 1 on any failure
#   scripts/wiki.sh publish "<msg>" [<clone>]  # guards → pull --rebase → commit → push → verify remote
#
# <clone> defaults to the current directory. `checkout` honours MAISTER_WIKI_DIR (must not exist yet
# or must be empty) and otherwise clones into a fresh mktemp directory — a wiki clone is NEVER shared
# between sessions, for the same reason a worktree is not (AGENTS.md § One ticket = one worktree).
#
# Guards (all credit-free; the CI workflow wiki-census-check.yml runs `check` on a clone too):
#   G1  Parity-Map header census matches its tables            (l2/tools/parity-header.mjs --check)
#   G2  every Copilot CLI version with a local bundle has a Compatibility-Matrix row
#                                                               (l2/tools/matrix-versions.mjs --check)
#   G3  every docs/adr/NNNN-*.md in the repo is linked from Home.md
#   G4  the clone is not behind origin/master (publish rebases anyway; check only warns)
#
# Why the rules are what they are — three drifts caught in one review (2026-09-07): the rollup on
# Home/Parity-Map drifted three times in one session with parallel sessions editing by hand; six
# bundles ran on CLI 1.0.83 and no page mentioned it; Home's ADR index stopped two ADRs short.
# Each guard below is one of those, made impossible to repeat silently.
#
# Contract: `checkout` prints exactly one line on stdout (the clone path); everything else, in every
# mode, goes to stderr. Exit 0 = ok; 1 = a guard failed, a push was refused, or the remote does not
# match after push; 2 = usage.
#
set -euo pipefail

FORK_SLUG="robmar-net/maister"
WIKI_URL="https://github.com/${FORK_SLUG}.wiki.git"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLS="$REPO_ROOT/platforms/copilot-cli/compat-tests/l2/tools"

log()  { printf '%s\n' "$*" >&2; }
fail() { log "wiki.sh: $*"; exit 1; }
usage() { log 'Usage: scripts/wiki.sh checkout | check [<clone>] | publish "<msg>" [<clone>]'; exit 2; }

# ------------------------------------------------------------------------------------------ checkout
cmd_checkout() {
  local dest
  if [ -n "${MAISTER_WIKI_DIR:-}" ]; then
    dest="$MAISTER_WIKI_DIR"
    [ ! -e "$dest" ] || [ -z "$(ls -A "$dest" 2>/dev/null)" ] || fail "MAISTER_WIKI_DIR is not empty: $dest — a clone is never reused across sessions; pick a fresh path"
    mkdir -p "$dest"
  else
    dest="$(mktemp -d "${TMPDIR:-/tmp}/maister-wiki.XXXXXX")"
  fi
  git clone -q "$WIKI_URL" "$dest" >&2 || fail "clone failed: $WIKI_URL"
  log "wiki clone ready at $dest (HEAD $(git -C "$dest" rev-parse --short HEAD)); edit with anchored replaces, then: scripts/wiki.sh publish \"<msg>\" $dest"
  printf '%s\n' "$dest"
}

# --------------------------------------------------------------------------------------------- guards
require_clone() {
  local clone="$1"
  [ -d "$clone/.git" ] || fail "not a git clone: $clone"
  local url; url="$(git -C "$clone" remote get-url origin 2>/dev/null || true)"
  case "$url" in *"${FORK_SLUG}.wiki"*) ;; *) fail "origin of $clone is '$url', not the ${FORK_SLUG} wiki — refusing" ;; esac
  [ -f "$clone/Home.md" ] && [ -f "$clone/Parity-Map.md" ] && [ -f "$clone/Compatibility-Matrix.md" ] \
    || fail "$clone lacks Home.md / Parity-Map.md / Compatibility-Matrix.md"
}

run_guards() {
  local clone="$1" rc=0

  log "G1  Parity-Map header census"
  if node "$TOOLS/parity-header.mjs" "$clone/Parity-Map.md" --check >/dev/null 2>&1; then
    log "    ok"
  else
    log "    FAIL — header counters drifted from the tables. Regenerate the line with:"
    log "    node $TOOLS/parity-header.mjs $clone/Parity-Map.md   and paste it into the 'Header counters' line"
    rc=1
  fi

  log "G2  every bundle CLI version has a Compatibility-Matrix row"
  local out
  if out="$(node "$TOOLS/matrix-versions.mjs" "$clone/Compatibility-Matrix.md" --check 2>&1)"; then
    log "    ok"
  else
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    log "    FAIL — add a Matrix row for every MISSING version above (what ran, verdicts, bundle ts)"
    rc=1
  fi

  log "G3  every ADR in docs/adr/ is linked from Home.md"
  local adr missing=0
  for adr in "$REPO_ROOT"/docs/adr/[0-9][0-9][0-9][0-9]-*.md; do
    [ -e "$adr" ] || continue
    local base; base="$(basename "$adr")"
    if ! grep -q "docs/adr/${base}" "$clone/Home.md"; then
      log "    MISSING from Home.md: $base"
      missing=1
    fi
  done
  if [ "$missing" -eq 0 ]; then log "    ok"; else log "    FAIL — add a row to Home's 'Decisions (ADR)' table for each ADR above"; rc=1; fi

  log "G4  clone freshness"
  git -C "$clone" fetch -q origin master 2>/dev/null || log "    (offline — cannot fetch; publish will fail loudly if behind)"
  local behind; behind="$(git -C "$clone" rev-list --count HEAD..origin/master 2>/dev/null || echo 0)"
  if [ "$behind" -eq 0 ]; then log "    ok (at origin/master)"; else log "    WARN — $behind commit(s) behind origin/master; publish rebases, but re-read anything you edited"; fi

  return $rc
}

cmd_check() {
  local clone="${1:-$PWD}"
  require_clone "$clone"
  if run_guards "$clone"; then log "wiki check: all guards green"; else fail "one or more guards failed — do not publish"; fi
}

# -------------------------------------------------------------------------------------------- publish
cmd_publish() {
  local msg="${1:-}"; local clone="${2:-$PWD}"
  [ -n "$msg" ] || usage
  require_clone "$clone"

  [ -n "$(git -C "$clone" status --porcelain)" ] || fail "nothing to publish — the clone is clean"
  run_guards "$clone" || fail "guards failed — fix them, then publish again"

  local name email
  name="${WIKI_AUTHOR_NAME:-$(git -C "$REPO_ROOT" config --get user.name || true)}"
  email="${WIKI_AUTHOR_EMAIL:-$(git -C "$REPO_ROOT" config --get user.email || true)}"
  [ -n "$name" ] && [ -n "$email" ] || fail "no author identity — set WIKI_AUTHOR_NAME / WIKI_AUTHOR_EMAIL (or git user.name/email)"

  # Stage explicitly: only the pages the caller changed (tracked files), never untracked strays.
  git -C "$clone" add -u
  local untracked; untracked="$(git -C "$clone" ls-files --others --exclude-standard)"
  [ -z "$untracked" ] || { log "untracked files in the clone (add them with git add if intended, they are NOT included):"; printf '%s\n' "$untracked" | sed 's/^/    /' >&2; }
  git -C "$clone" -c user.name="$name" -c user.email="$email" commit -q -m "$msg" || fail "commit failed"

  # Pull-rebase-push in one breath: the window for a parallel session to slip in is seconds, not a session.
  git -C "$clone" -c user.name="$name" -c user.email="$email" pull -q --rebase origin master \
    || { git -C "$clone" rebase --abort 2>/dev/null || true; fail "rebase onto origin/master conflicted — someone else changed the same lines; re-read the page, re-apply, publish again"; }
  # Re-run the content guards on the rebased result: another session's edit may have re-drifted a counter.
  run_guards "$clone" || fail "guards failed AFTER rebase — the incoming wiki change drifted; fix and publish again"

  git -C "$clone" -c credential.helper='!gh auth git-credential' push -q origin HEAD:master || fail "push refused"

  local local_head remote_head
  local_head="$(git -C "$clone" rev-parse HEAD)"
  remote_head="$(git -C "$clone" ls-remote origin refs/heads/master | cut -f1)"
  [ "$local_head" = "$remote_head" ] || fail "remote master ($remote_head) != local HEAD ($local_head) after push — verify by hand"
  log "wiki published: $(git -C "$clone" log -1 --format='%h %s')"
}

# ----------------------------------------------------------------------------------------------- main
case "${1:-}" in
  checkout) cmd_checkout ;;
  check)    shift; cmd_check "$@" ;;
  publish)  shift; cmd_publish "$@" ;;
  -h|--help|help) sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//' >&2 ;;
  *) usage ;;
esac
