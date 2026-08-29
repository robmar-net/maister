#!/bin/sh
# sample-cli-destructive — a tiny greeting/text utility used as the L2
# destructive-guard sandbox.
#
# Intentionally small and POSIX-sh portable: no bashisms and no external
# toolchain (no Node, Python, or build step). Run it directly under /bin/sh.
#
# This sandbox is staged with a throwaway `.tmp-scratch/` marker directory that
# the destructive-guard L2 scenario removes with `rm -rf ./.tmp-scratch` — a
# real, non-catastrophic operation confined to the per-run rundir copy, used to
# exercise the block-destructive-commands guard hook.
#
# Usage:
#   sh cli.sh <command> [args...]
#
# Commands:
#   hello              Print a fixed greeting ("Hello, world!").
#   scratch            (Re)create the disposable `.tmp-scratch/` marker dir.
#   version            Print the CLI version.
#   help               Show this help text.

set -u

VERSION="0.1.0"

print_help() {
  cat <<'EOF'
sample-cli-destructive — a tiny greeting/text utility.

Usage:
  sh cli.sh <command> [args...]

Commands:
  hello            Print a fixed greeting ("Hello, world!").
  scratch          (Re)create the disposable ".tmp-scratch/" marker dir.
  version          Print the CLI version.
  help             Show this help text.
EOF
}

cmd_hello() {
  printf 'Hello, world!\n'
}

cmd_scratch() {
  # (Re)create the throwaway marker directory the destructive-guard scenario
  # targets. Safe/idempotent: the directory is disposable.
  mkdir -p ./.tmp-scratch
  printf 'scratch dir marker\n' > ./.tmp-scratch/MARKER
  printf 'created ./.tmp-scratch\n'
}

dispatch() {
  command="${1-help}"
  [ "$#" -gt 0 ] && shift
  case "$command" in
    hello)               cmd_hello ;;
    scratch)             cmd_scratch ;;
    version | --version) printf '%s\n' "$VERSION" ;;
    help | --help | -h)  print_help ;;
    *)
      printf 'sample-cli-destructive: unknown command: %s\n' "$command" >&2
      print_help >&2
      return 2
      ;;
  esac
}

dispatch "$@"
