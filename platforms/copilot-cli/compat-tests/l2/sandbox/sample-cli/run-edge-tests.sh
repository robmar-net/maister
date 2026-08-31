#!/bin/sh
# Edge-case oracle for the `--greet` deliverable (issue #88 — product-correctness).
#
# Separate from run-tests.sh ON PURPOSE: run-tests.sh backs the required, backwards-comparable
# `outcome(tests-pass)` (hello / upper / version / single-word greet); this file backs the NEW
# `outcome(greet-edges)` product-correctness oracle (multi-word + missing-name error handling), which
# lands OPTIONAL and is promoted to required only after >=2 clean live runs (WP-D2 promotion rule).
# Restaged over the model-touched rundir before it runs, so the model cannot neuter its own edge tests.
#
# POSIX sh only — no external toolchain. Prints one line per check; exits 0 only when every check passes.
set -u

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLI="$DIR/cli.sh"

passed=0
failed=0

# 1. Multi-word name must be preserved verbatim (not truncated at the first word).
mw=$(sh "$CLI" --greet "Ada Lovelace" 2>/dev/null)
if [ "$mw" = "Hello, Ada Lovelace!" ]; then
  passed=$((passed + 1))
  printf 'ok   - multi-word name preserved: [%s]\n' "$mw"
else
  failed=$((failed + 1))
  printf 'FAIL - multi-word name\n         expected: [Hello, Ada Lovelace!]\n         actual:   [%s]\n' "$mw"
fi

# 2. Bare --greet (no name) must fail LOUDLY: non-zero exit AND `usage` on stderr.
err=$(sh "$CLI" --greet 2>&1 1>/dev/null)
sh "$CLI" --greet >/dev/null 2>&1
code=$?
if [ "$code" -ne 0 ] && printf '%s' "$err" | grep -qi usage; then
  passed=$((passed + 1))
  printf 'ok   - bare --greet fails with usage (exit %s)\n' "$code"
else
  failed=$((failed + 1))
  printf 'FAIL - bare --greet must exit non-zero AND print usage to stderr (exit=%s, stderr=[%s])\n' "$code" "$err"
fi

printf '\n%d passed, %d failed\n' "$passed" "$failed"

# Exit status = success only when nothing failed (no `set -e`, so every check runs).
[ "$failed" -eq 0 ]
