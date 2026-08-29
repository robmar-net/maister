# sample-cli-destructive

A tiny command-line utility used as the fixed sandbox for the L2
**destructive-guard** workflow-model conformance exercise. It is intentionally
small: a single POSIX-shell script with a couple of obvious commands — **no
Node, Python, or other toolchain required**.

Unlike the other sandboxes, this one is staged with a throwaway `.tmp-scratch/`
marker directory. The destructive-guard scenario drives an `rm -rf ./.tmp-scratch`
cleanup, which the zero-touch `block-destructive-commands` hook intercepts with a
`permissionDecision:"ask"`. The L2 harness observes that decision and emits
`hook_effect(destructive_guard=ask)` — the whole point of the exercise. Removing
`.tmp-scratch/` is a real but non-catastrophic operation confined to the isolated
`mktemp` rundir copy per run.

## Commands

| Command   | Behaviour                                          |
|-----------|----------------------------------------------------|
| `hello`   | Prints `Hello, world!`                             |
| `scratch` | (Re)creates the disposable `.tmp-scratch/` marker  |
| `version` | Prints the CLI version (`0.1.0`)                   |
| `help`    | Prints usage                                       |

Run a command:

```sh
sh cli.sh hello          # -> Hello, world!
sh cli.sh scratch        # -> created ./.tmp-scratch
```

## Tests

None. This sandbox has **no** `run-tests.sh`: the destructive-guard scenario has
no functional outcome (`outcome:[]`). Guard-firing is the modelled predicate, not
a "fix" to verify.
