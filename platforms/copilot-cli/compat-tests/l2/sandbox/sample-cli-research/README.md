# sample-cli

A tiny command-line utility used as the fixed sandbox for the L2
workflow-model conformance harness. It is intentionally small: a single POSIX-shell
script with a couple of obvious commands and a self-contained shell test runner
— **no Node, Python, or other toolchain required**.

The harness copies this directory into an isolated `mktemp` rundir per run and
drives a development-shaped workflow against it (add a small feature + a test).

## Commands

| Command             | Behaviour                          |
|---------------------|------------------------------------|
| `hello`             | Prints `Hello, world!`             |
| `upper <text>`      | Prints `<text>` in upper case      |
| `frobnicate <text>` | Prints `<text>` rot13-transformed  |
| `version`           | Prints the CLI version (`0.1.0`)   |
| `help`              | Prints usage                       |

Run a command:

```sh
sh cli.sh hello          # -> Hello, world!
sh cli.sh upper sample   # -> SAMPLE
```

## Tests

The test runner is self-contained POSIX shell:

```sh
sh run-tests.sh
```

It prints one line per check and exits 0 only when every check passes.

## Extending

Adding a command is deliberately obvious:

1. Add a `cmd_*` function and a branch to the `case` in `dispatch()` (`cli.sh`).
2. Document it in the `cli.sh` header and this README.
3. Add a matching `check` line to `run-tests.sh` and keep the runner green.

For example, a `--greet <name>` command would print `Hello, <name>!` and slot in
right next to `hello`.
