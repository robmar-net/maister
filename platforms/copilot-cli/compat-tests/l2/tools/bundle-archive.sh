#!/usr/bin/env bash
#
# L2 durable-evidence archiver — copies a replay bundle OUT of the repository into a sibling directory
# that neither `git worktree remove` nor `git clean -xdf` can reach, and records a sha256 manifest so the
# copy can later be PROVEN intact rather than merely assumed to be (#138 WP5; spec R20-R24).
#
# Usage:
#   bundle-archive.sh <bundle>...           # archive each bundle -> <name>.tar.gz + <name>.sha256
#   bundle-archive.sh <name>... --verify    # re-check the stored digests (non-zero names the offender)
#   bundle-archive.sh --print-dest          # print the resolved destination root; creates NOTHING
#   bundle-archive.sh -h                    # reprint this header
#
# <bundle> is either a bare timestamp (resolved under compat-tests/reports/<ts>) or a path to a bundle
# directory; the ARCHIVE NAME is always its basename. Under --verify the argument is the archive NAME
# alone — the source bundle need not exist any more. Outliving the source is the entire point.
#
# Env:
#   COMPAT_L2_ARCHIVE   destination root override; must be an ABSOLUTE path. Default: a SIBLING of the
#                       main checkout, `<repo>-l2-archive`.
#   TMPDIR              where --verify mktemp's its scratch extraction (default /tmp).
#
# WHY THE DEFAULT IS OUTSIDE THE REPOSITORY (spec R21, operator decision P1.2). About 16 replay bundles
# were destroyed by `git worktree remove` followed by `git clean -xdf`. compat-tests/reports/ is
# per-worktree AND git-ignored (reports/.gitignore:8 = `*/`), so an archive placed under it dies to
# exactly the command this script exists to survive — the auto-ignoring is what makes that placement
# tempting and it is still wrong. Note the anchor for the default is the COMMON git dir, not this
# script's own path: inside a linked worktree the script sits under .worktrees/<ticket>/, whose parent
# is still inside the repository and is itself reachable by a `git clean -xdf` in the main checkout.
#
# Contract:
#   - stdout is EXACTLY ONE LINE PER BUNDLE — the absolute path of that bundle's tar. Every diagnostic,
#     summary and failure goes to stderr (the variant.sh:24-27 rule), so `$(bundle-archive.sh <ts>)`
#     captures a usable path and nothing else.
#   - NOTHING is ever written beside a source bundle: the source is read in place by find/tar, and
#     --verify extracts into a mktemp tree removed on every exit path (A5.2 / hazard H8).
#   - The tree digest is the variant.sh:346 idiom VERBATIM, and every digest here is taken with
#     `shasum -a 256`. The GNU coreutils spelling of that command does not exist on BSD/macOS, so it
#     must never appear in this file — bundle-archive.test.mjs greps for it and requires zero hits.
#   - Exit 2 = usage error / unknown option / missing or empty bundle directory / no archive or manifest
#     under --verify / unresolvable, non-absolute destination — NOTHING was created and stdout is EMPTY
#     (every pre-flight runs BEFORE the first mkdir or mktemp).
#     Exit 1 = a post-staging miss: an archive or manifest that could not be written, or a --verify
#     digest mismatch — the offending path is NAMED on stderr.
#     Exit 0 = every bundle archived, or every named archive verified intact.
#
set -euo pipefail

# ---------------------------------------------------------------------------- paths (run.sh:87-90 idiom)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# NOTE: tools/ is ONE level deeper than l2/ (same depth as variants/), so repo root is FIVE ups
# (tools -> l2 -> compat-tests -> copilot-cli -> platforms -> <repo>), not four.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
REPORTS_DIR="$SCRIPT_DIR/../../reports"       # compat-tests/reports (two levels up from l2/tools/)

usage() { echo "Usage: bundle-archive.sh <bundle>... [--verify]  |  bundle-archive.sh --print-dest  |  -h" >&2; }

# Reprint the header comment block (lines after the shebang, up to `set -euo pipefail`) — the
# run.sh:127-131 idiom; it depends on `set -euo pipefail` sitting IMMEDIATELY after the header.
print_header() {
  sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

# die2 MSG — pre-flight reject: nothing has been created yet, so there is nothing to remove.
die2() { echo "bundle-archive.sh: $*" >&2; usage; exit 2; }

# fail MSG — post-staging miss. The EXIT trap removes the scratch tree; the destination keeps whatever
# was already written, because a half-written archive that is REPORTED is better evidence than none.
fail() { echo "bundle-archive.sh: FAILED: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------- args (exit 2: nothing created yet)
VERIFY=0
PRINT_DEST=0
BUNDLES=()
for a in "$@"; do
  case "$a" in
    -h|--help)    print_header; exit 0 ;;
    --verify)     VERIFY=1 ;;
    --print-dest) PRINT_DEST=1 ;;
    --*)          die2 "unknown option '$a'" ;;
    *)            BUNDLES+=("$a") ;;
  esac
done

# Resolve the destination root. The default anchors on the COMMON git dir (see the header): in a linked
# worktree `--show-toplevel` is the worktree itself, so only the common dir names the main checkout.
resolve_dest() {
  if [ -n "${COMPAT_L2_ARCHIVE:-}" ]; then
    echo "$COMPAT_L2_ARCHIVE"
    return 0
  fi
  local common
  if ! common="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
    return 1
  fi
  [ -n "$common" ] || return 1
  echo "$(dirname "$common")-l2-archive"
}

if ! DEST="$(resolve_dest)"; then
  die2 "cannot resolve a destination: $REPO_ROOT is not a git repository and COMPAT_L2_ARCHIVE is unset"
fi
# Absolute only: the one stdout line per bundle is a contract, and a relative destination would make it
# depend on the caller's cwd.
case "$DEST" in
  /*) ;;
  *)  die2 "the destination must be an ABSOLUTE path, got '$DEST' (COMPAT_L2_ARCHIVE)" ;;
esac

if [ "$PRINT_DEST" = "1" ]; then
  [ "$VERIFY" = "0" ] || die2 "--print-dest and --verify are mutually exclusive"
  [ ${#BUNDLES[@]} -eq 0 ] || die2 "--print-dest takes no <bundle> arguments"
  # Pure resolver: this path runs before any mkdir/mktemp and writes nothing, anywhere.
  echo "$DEST"
  exit 0
fi
[ ${#BUNDLES[@]} -gt 0 ] || die2 "missing <bundle>"

# A bare timestamp resolves under compat-tests/reports/; anything containing a slash is a path already.
resolve_src() {
  case "$1" in
    */*) echo "$1" ;;
    *)   echo "$REPORTS_DIR/$1" ;;
  esac
}

# ---------------------------------------------------------------------------- pre-flight (still exit 2)
if [ "$VERIFY" = "1" ]; then
  for b in "${BUNDLES[@]}"; do
    name="$(basename "$b")"
    [ -f "$DEST/$name.tar.gz" ] || die2 "no archive for '$name' under $DEST"
    [ -f "$DEST/$name.sha256" ] || die2 "no manifest for '$name' under $DEST"
  done
else
  for b in "${BUNDLES[@]}"; do
    src="$(resolve_src "$b")"
    [ -d "$src" ] || die2 "no such bundle directory: $src"
    # An empty tree would hand `xargs shasum` no arguments, whose behaviour differs between BSD and GNU
    # xargs — reject it here rather than record a digest that means different things on two platforms.
    [ -n "$(find "$src" -type f | head -1)" ] || die2 "bundle directory holds no files: $src"
  done
fi

# ---------------------------------------------------------------------------- scratch + cleanup
SCRATCH=""
cleanup() {
  # MANDATED if-form (run.sh:148-162) — the `[ -n … ] && rm -rf …` one-liner returns 1 when SCRATCH is
  # empty, and as the function's last statement that 1 would become the trap's (hence the script's) status.
  if [ -n "$SCRATCH" ]; then
    rm -rf "$SCRATCH"
  fi
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------- archive
# Writes <DEST>/<name>.tar.gz + <DEST>/<name>.sha256 and echoes the tar path (the ONLY stdout).
archive_one() {
  local src name tar_path man_path parent body tree archive_digest
  src="$1"
  name="$(basename "$src")"
  tar_path="$DEST/$name.tar.gz"
  man_path="$DEST/$name.sha256"
  parent="$(cd "$(dirname "$src")" && pwd)"

  # MANDATED capture form throughout (run.sh:367-373): under `set -euo pipefail` a bare assignment from a
  # failing command substitution aborts with the CHILD's exit code, which could leak an exit 1 that means
  # something else entirely.
  #
  # Per-file digests of the SOURCE, read in place — the manifest body.
  if ! body="$(cd "$src" && find . -type f | LC_ALL=C sort | xargs shasum -a 256)"; then
    fail "$name: per-file digest of $src failed"
  fi
  # Tree digest — the variant.sh:346 idiom, VERBATIM (shasum -a 256, LC_ALL=C sort).
  if ! tree="$(cd "$src" && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"; then
    fail "$name: tree digest of $src failed"
  fi
  # COPYFILE_DISABLE keeps macOS from adding ._ AppleDouble members, which would make the stored tree
  # differ from the source tree it claims to preserve. tar precedent: variant.sh:186/:193.
  if ! COPYFILE_DISABLE=1 tar -czf "$tar_path" -C "$parent" "$name"; then
    fail "$name: tar -czf $tar_path failed"
  fi
  if ! archive_digest="$(shasum -a 256 "$tar_path" | cut -d' ' -f1)"; then
    fail "$name: digest of $tar_path failed"
  fi

  {
    echo "# bundle-archive.sh manifest v1"
    echo "# name: $name"
    echo "# source: $src"
    echo "# created: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# archive: $archive_digest  $name.tar.gz"
    echo "# tree: $tree"
    echo "$body"
  } > "$man_path" || fail "$name: manifest $man_path could not be written"
  [ -s "$man_path" ] || fail "$name: manifest $man_path is empty"

  echo "bundle-archive.sh: $name archived from $src (tree sha256:$tree) at $tar_path" >&2
  echo "$tar_path"
}

# ---------------------------------------------------------------------------- verify
# Re-checks the stored tar against its manifest. Returns 1 and NAMES every offending path on mismatch.
verify_one() {
  local name tar_path man_path want_archive want_tree got_archive got_tree got_body want_body offenders exdir rc
  name="$1"
  tar_path="$DEST/$name.tar.gz"
  man_path="$DEST/$name.sha256"
  rc=0

  if ! want_archive="$(sed -n 's/^# archive: \([0-9a-f][0-9a-f]*\)  .*$/\1/p' "$man_path")"; then
    fail "$name: manifest $man_path is unreadable"
  fi
  if ! want_tree="$(sed -n 's/^# tree: \([0-9a-f][0-9a-f]*\)$/\1/p' "$man_path")"; then
    fail "$name: manifest $man_path is unreadable"
  fi
  [ -n "$want_archive" ] || fail "$name: manifest $man_path records no archive digest"
  [ -n "$want_tree" ] || fail "$name: manifest $man_path records no tree digest"

  if ! got_archive="$(shasum -a 256 "$tar_path" | cut -d' ' -f1)"; then
    fail "$name: digest of $tar_path failed"
  fi
  if [ "$got_archive" != "$want_archive" ]; then
    echo "bundle-archive.sh: MISMATCH $tar_path (stored sha256 $got_archive, manifest records $want_archive)" >&2
    rc=1
  fi

  # Extract into the scratch tree — NEVER beside the source bundle (A5.2 / H8).
  exdir="$SCRATCH/extract"
  rm -rf "$exdir"
  mkdir -p "$exdir"
  if ! tar -xzf "$tar_path" -C "$exdir"; then
    echo "bundle-archive.sh: MISMATCH $tar_path (the stored archive could not be extracted)" >&2
    return 1
  fi
  if [ ! -d "$exdir/$name" ]; then
    echo "bundle-archive.sh: MISMATCH $tar_path (the stored archive has no $name/ member)" >&2
    return 1
  fi

  if ! got_body="$(cd "$exdir/$name" && find . -type f | LC_ALL=C sort | xargs shasum -a 256)"; then
    fail "$name: per-file digest of the extracted copy failed"
  fi
  if ! want_body="$(grep -v '^# ' "$man_path")"; then
    fail "$name: manifest $man_path carries no per-file digests"
  fi
  printf '%s\n' "$want_body" > "$SCRATCH/want.txt"
  printf '%s\n' "$got_body" > "$SCRATCH/got.txt"

  if ! diff -q "$SCRATCH/want.txt" "$SCRATCH/got.txt" >/dev/null; then
    # `|| true` is load-bearing: diff exits 1 when the files differ, and with `pipefail` that would
    # abort the script before a single offending path had been printed.
    if ! offenders="$(diff "$SCRATCH/want.txt" "$SCRATCH/got.txt" | sed -n 's/^[<>] [0-9a-f][0-9a-f]*  //p' | LC_ALL=C sort -u || true)"; then
      offenders=""
    fi
    if [ -n "$offenders" ]; then
      printf '%s\n' "$offenders" | while read -r p; do
        echo "bundle-archive.sh: MISMATCH $p (inside $tar_path — content differs from the manifest)" >&2
      done
    else
      echo "bundle-archive.sh: MISMATCH $tar_path (per-file digests differ from the manifest)" >&2
    fi
    rc=1
  fi

  # Belt and braces: the recorded tree digest is the hash of the manifest body, so a body match implies a
  # tree match. Checking it anyway means a hand-edited manifest cannot pass itself off as intact.
  if ! got_tree="$(cd "$exdir/$name" && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"; then
    fail "$name: tree digest of the extracted copy failed"
  fi
  if [ "$got_tree" != "$want_tree" ]; then
    echo "bundle-archive.sh: MISMATCH $tar_path (tree sha256 $got_tree, manifest records $want_tree)" >&2
    rc=1
  fi

  if [ "$rc" = "0" ]; then
    echo "bundle-archive.sh: $name verified intact (tree sha256:$got_tree) at $tar_path" >&2
    echo "$tar_path"
  fi
  return "$rc"
}

# ---------------------------------------------------------------------------- main
RC=0
if [ "$VERIFY" = "1" ]; then
  SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/l2-bundle-archive-XXXXXX")"
  for b in "${BUNDLES[@]}"; do
    verify_one "$(basename "$b")" || RC=1
  done
else
  mkdir -p "$DEST"
  for b in "${BUNDLES[@]}"; do
    archive_one "$(resolve_src "$b")"
  done
fi
exit "$RC"
