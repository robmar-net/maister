# `pre-160-sync.sh.txt` — the vendored pre-#160 `scripts/sync.sh`

## The rule, first

**This directory is data, never code. `pre-160-sync.sh.txt` must never be edited — and in
particular must never be edited to make a failing control pass.**

If the control in `sync-sh-160.test.mjs` goes red, exactly one of two things happened, and
neither of them is fixed here:

1. **`scripts/sync.sh` changed.** The *current*-code oracles moved. Re-derive them from the
   live script and update the test — not the fixture.
2. **The fixture drifted.** Some edit reached these bytes. `2.T3` says which case you are in:
   it asserts the three digests below unconditionally, so a drifted fixture fails on the
   digests while a changed `sync.sh` does not.

A third possibility — the control passes for an unrelated reason, e.g. the spawn crashed
before reaching L3 — is closed by `FR3` asserting the **presence** of the old-code strings,
not merely the absence of the new ones.

## Provenance

| field | value |
|---|---|
| source commit | `9765a95^` — the **parent** of PR #160's fix |
| parent commit id | `2ec3be3f988c4ebc2ccfb89186b63ecaba48a7ce` |
| fix commit (`9765a95`) | `fix(sync/#159): derive the upstream tip from the remote by slug, not from parent position (#160)` |
| source path | `scripts/sync.sh` |
| lines | **289** |
| bytes | **17792** |
| sha256 | **`87b6661ec1f5aff94f63329d4b8d5714145f2067558447d77f090b80afff5bb3`** |
| git blob id | **`c3c7499a1a75fd4059151c215cf72997acce57de`** |
| mode | **`0644`** |

Reproduce all four:

```sh
git show 9765a95^:scripts/sync.sh | wc -l        # 289
git show 9765a95^:scripts/sync.sh | wc -c        # 17792
git show 9765a95^:scripts/sync.sh | shasum -a 256
git rev-parse 9765a95^:scripts/sync.sh           # c3c7499a…
git hash-object pre-160-sync.sh.txt              # c3c7499a…  (same blob, verbatim copy)
```

### Mode is `0644`, deliberately

It is **data, never executed in place**. `2.T2` copies it to a temp file and runs
`bash <tmp>`, so the fixture needs no execute bit. (The live `scripts/sync.sh` is `0755`;
that is `FR6`'s assertion about the *subject*, not about this file.)

## Why it is vendored rather than read from git history

The original design probed git history at test time. That is **not** viable, and the two
obvious repairs are both wrong:

- **CI clones at depth 1.** `.github/workflows/l2-check.yml:38` runs `actions/checkout` with
  no `fetch-depth`, so the default depth-1 clone applies. `9765a95^` does not exist there.
  Under `NFR8` (no silent skips) a history-dependent assertion would be a **permanent red**
  in CI, not a graceful skip.
- **Gating on `9765a95^{commit}` is also wrong.** That form peels `9765a95` *itself* — the
  **fix** commit — while the assertion needs its **parent's** tree. Measured across clone
  depths 1–7: at **depth 3 the commit probe exits 0 while `git show 9765a95^:scripts/sync.sh`
  exits 128**. The commit can be present while the blob is absent.

Vendoring the bytes removes the history dependency entirely, so the control runs everywhere.

**Do not re-introduce a history probe as a "safety check".** The one assertion in this PR
permitted to skip is `2.T3`'s byte-equality against `git show 9765a95^:scripts/sync.sh`, and
its gate probes **the blob the assertion reads** — `git cat-file -e 9765a95^:scripts/sync.sh`
— never `9765a95^{commit}`. It skips with a named reason (`variants.test.mjs:407-413` shape).
The **control itself never skips**, because it runs these vendored bytes.

## What the control proves (`FR3`)

The vendored script is copied to a temp file and run against the **same** topology-D fixture
as the `FR2` acceptance case. Both of `FR2`'s oracles must **fail** here, and both old-code
strings must be **present**:

| | current `sync.sh` (FR2, must pass) | vendored pre-#160 (FR3, must fail) |
|---|---|---|
| L3 log | `L3 contains <fork>/master <short M'> and upstream <short X>; merge commit present` | `L3 <fork>/master is an ancestor of HEAD` — **no SHAs** (vendored `:190`) |
| L5 version | `the upstream base moved 2.2.3 → 2.2.4` | `the upstream base moved 2.2.3 → 2.2.3+fork.5` |

The L5 difference is the whole defect: the vendored code takes `upstream_sha` from **parent
position** (`git rev-parse HEAD^2`, vendored `:178`), which in topology D is our own master
`M'` — so it reads `M'`'s manifest, `2.2.3+fork.5`. The fix derives the upstream tip from the
remote **by slug** instead, which is why the current code reads the real upstream `2.2.4`.

## `NFR5` — why these bytes are safe to track

`scripts/sync.sh:204` is:

```
! git grep -qE '^(<<<<<<<|>>>>>>>) ' -- . || fail "conflict markers are still in the tree"
```

It matches lines **beginning** with seven `<` or seven `>` followed by a space, anchored at
column 0, across **all tracked files**. One such line in any tracked file makes real
`sync.sh land` refuse **forever**, blaming "the tree" rather than the file.

`pre-160-sync.sh.txt` is a tracked file and is covered by the rule. **Verified: zero matching
lines.** Its own copy of the L4 guard (vendored `:193`) begins with `!`, not with a marker
run, so it commits verbatim — no encoding and no line-prefixing is needed.

Self-check before staging either file in this directory:

```sh
grep -cE '^(<<<<<<<|>>>>>>>) ' pre-160-sync.sh.txt README.md   # must be 0 for both
```

If a future re-vendoring ever did introduce such a line, the file would have to be stored
base64-encoded with the test decoding it to a temp file. **That is not the case today and
must not be implemented speculatively.**

## Registers no tests

Neither file here is matched by the suite glob
`platforms/copilot-cli/compat-tests/l2/test/*.test.mjs`
(`Makefile:149`, `l2-check.yml:50`, `pr.sh:117`, `sync.sh:228-229` are all pure globs over
that one directory level). Adding this directory changes no test count.
