# Documentation Index

**IMPORTANT**: Read this file at the beginning of any development task to
understand the project and its conventions. This project is **already
initialized** — do not run project initialization.

## Project Overview

`sample-cli` is a tiny POSIX-shell command-line utility (see `../../README.md`
and `../../cli.sh`). It has a couple of obvious commands and a self-contained
shell test runner. There is no Node / Python / build toolchain — the script runs
directly under `/bin/sh`.

- **Language / runtime**: POSIX shell (`/bin/sh`), zero external dependencies.
- **Entry point**: `../../cli.sh` — a `dispatch()` function with a `case` over
  commands (`hello`, `upper`, `version`, `help`).
- **Tests**: `../../run-tests.sh` — run with `sh run-tests.sh`; prints one line
  per check and exits 0 only when green.

## Conventions (standards)

These are the project's coding standards. No separate `standards/` files exist,
and none need to be created.

- Keep the CLI POSIX-sh portable: no bashisms, no external toolchain.
- One command = one `cmd_*` shell function, dispatched from the `case` in
  `dispatch()`. Document every command in the `cli.sh` header and `README.md`.
- Every command has at least one matching `check` line in `run-tests.sh`.
- Keep output stable and single-purpose (each command prints exactly one line).

## How to Use This Documentation

1. **Start here**: read this INDEX first.
2. **Read the code**: `../../cli.sh` (implementation) and `../../run-tests.sh`
   (tests) — they are short and self-explanatory.
3. **Follow the conventions** above when adding a feature, and keep the test
   runner green.
