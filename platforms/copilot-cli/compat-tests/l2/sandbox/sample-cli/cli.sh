#!/bin/sh
# sample-cli — a tiny greeting/text utility used as the L2 harness sandbox.
#
# Intentionally small and POSIX-sh portable: no bashisms and no external
# toolchain (no Node, Python, or build step). Run it directly under /bin/sh.
#
# Usage:
#   sh cli.sh <command> [args...]
#
# Commands:
#   hello              Print a fixed greeting ("Hello, world!").
#   upper <text>       Print <text> converted to upper case.
#   version            Print the CLI version.
#   help               Show this help text.
#
# Adding a command: add one `cmd_*` function and a matching branch to the `case`
# in dispatch() below, document it in this header + README.md, and add a `check`
# line to run-tests.sh. For example, a `--greet <name>` command that prints
# "Hello, <name>!" would slot in right next to `hello`.

set -u

VERSION="0.1.0"

print_help() {
  cat <<'EOF'
sample-cli — a tiny greeting/text utility.

Usage:
  sh cli.sh <command> [args...]

Commands:
  hello            Print a fixed greeting ("Hello, world!").
  upper <text>     Print <text> converted to upper case.
  version          Print the CLI version.
  help             Show this help text.
EOF
}

cmd_hello() {
  printf 'Hello, world!\n'
}

cmd_upper() {
  # Upper-case the first argument.
  printf '%s\n' "${1-}" | tr '[:lower:]' '[:upper:]'
}

dispatch() {
  command="${1-help}"
  [ "$#" -gt 0 ] && shift
  case "$command" in
    hello)             cmd_hello ;;
    upper)             cmd_upper "${1-}" ;;
    version | --version) printf '%s\n' "$VERSION" ;;
    help | --help | -h)  print_help ;;
    *)
      printf 'sample-cli: unknown command: %s\n' "$command" >&2
      print_help >&2
      return 2
      ;;
  esac
}

dispatch "$@"
