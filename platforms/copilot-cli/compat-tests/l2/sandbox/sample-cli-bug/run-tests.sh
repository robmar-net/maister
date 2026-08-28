#!/bin/sh
# Self-contained test runner for sample-cli.
#
# POSIX sh only — no external toolchain (no Node, Python, or test framework). It
# prints one line per check and exits 0 only when every check passes, so the
# development workflow has a real, runnable test to exercise and extend.
#
# Add a test: append another `check "<description>" "<expected>" "<actual>"` line.
# When you add the `--greet <name>` command to cli.sh, add a check such as:
#   check "greet names the person" "Hello, Ada!" "$(sh "$CLI" --greet Ada)"

set -u

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLI="$DIR/cli.sh"

passed=0
failed=0

check() {
  description="$1"
  expected="$2"
  actual="$3"
  if [ "$expected" = "$actual" ]; then
    passed=$((passed + 1))
    printf 'ok   - %s\n' "$description"
  else
    failed=$((failed + 1))
    printf 'FAIL - %s\n         expected: [%s]\n         actual:   [%s]\n' \
      "$description" "$expected" "$actual"
  fi
}

check "hello prints the fixed greeting" "Hello, world!" "$(sh "$CLI" hello)"
check "upper upper-cases its argument"  "SAMPLE"        "$(sh "$CLI" upper sample)"
check "version reports the CLI version" "0.1.0"         "$(sh "$CLI" version)"

printf '\n%d passed, %d failed\n' "$passed" "$failed"

# Exit status = success only when nothing failed (no `set -e`, so every check runs).
[ "$failed" -eq 0 ]
