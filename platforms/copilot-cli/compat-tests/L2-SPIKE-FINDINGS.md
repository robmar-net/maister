# L2 — Spike 01: driving gates non-interactively (FINDINGS)

> **Question (the L2 go/no-go):** can we run a full maister workflow on Copilot **unattended**,
> deterministically **answering** its interactive gates (`ask_user`) — while the gates still
> *fire* (so we can verify gate placement) — and capture a clean execution trace?
>
> **Verdict: GO — decisively, and more cheaply than [`L2-DESIGN.md`](L2-DESIGN.md) assumed.**
> Established from the bundled SDK's type definitions alone (no credits spent).
>
> **Platform:** GitHub Copilot CLI **1.0.73** · SDK bundled at
> `~/.copilot/pkg/darwin-arm64/1.0.73/copilot-sdk` (exported as `@github/copilot-sdk`).

## TL;DR

Copilot CLI 1.0.73 ships a first-class **Node SDK** ("JSON-RPC based SDK for programmatic
control of GitHub Copilot CLI") that provides, as ordinary session-config callbacks, **exactly
the two hardest pieces of L2**:

1. **Deterministic gate answering** — `onUserInputRequest` (the `ask_user` hook),
   `onPermissionRequest` (+ a built-in `approveAll`), and `onExitPlanModeRequest`. Gates
   **fire and are answered** programmatically — unlike `--no-ask-user`, which suppresses them.
2. **Clean trace extraction** — a **typed `SessionEvent` stream** via `session.on(...)` /
   `session.getEvents()`. No log scraping.

Plus `pluginDirectories` (load `maister-copilot`), `workingDirectory` (point at the sandbox),
and `RuntimeConnection.forStdio({ path: "/usr/local/bin/copilot" })` (spawn the CLI as the
runtime). The L2 harness is now a concrete, small Node program.

## Evidence (from the bundled `.d.ts`, all free)

### Gate-answering handlers — `SessionConfig` callbacks

| Gate | Config callback | Handler type | Notes |
|------|-----------------|--------------|-------|
| **`ask_user`** | `onUserInputRequest` (`types.d.ts:1756`) | `UserInputHandler` (`:895`) | *"When provided, enables the ask_user tool allowing the agent to ask questions."* |
| Permission (incl. our destructive-guard `ask`) | `onPermissionRequest` (`:1745`) | `PermissionHandler` (`:856`) | built-in `approveAll` (`:859`); when omitted, requests surface as events to resolve via RPC |
| Form dialogs | `onElicitationRequest` (`:1762`) | `ElicitationHandler` (`:693`) | richer form UI; also enables the `elicitation` capability |
| Plan-mode exit | `onExitPlanModeRequest` (`:1794`) | `ExitPlanModeHandler` (`:925`) | |

The **`ask_user`** shape is trivial and maps 1:1 onto maister's gate model
(`types.d.ts:864–898`):

```ts
interface UserInputRequest  { question: string; choices?: string[]; allowFreeform?: boolean }
interface UserInputResponse { answer: string; wasFreeform: boolean }
type UserInputHandler = (req: UserInputRequest, ctx: { sessionId: string })
                          => UserInputResponse | Promise<UserInputResponse>
```

A deterministic auto-responder is therefore one function — exactly the "always pick the
recommended default" policy L2-DESIGN specified:

```js
const autoRespond = (req) =>
  req.choices?.length
    ? { answer: req.choices[0], wasFreeform: false }   // maister marks the recommended option first
    : { answer: "yes",         wasFreeform: true };
```

### Trace extraction — typed event stream

`CopilotSession` (`session.d.ts`) exposes:
- `on(eventType, handler)` / `on(handler)` — subscribe to the typed `SessionEvent` stream
  (`generated/session-events.js`);
- `getEvents(): Promise<SessionEvent[]>` — the **complete** session history after the run;
- `sendAndWait(prompt, timeout?)` — send and block until `session.idle`.

This is the predicate-extractor's input: structured, typed events (tool invocations, agent
delegations, permission requests, `ask_user` requests, lifecycle) — no `--log-level debug`
scraping required.

### Plugin loading, sandbox, connection

- **`pluginDirectories?: string[]`** (`types.d.ts:1875`) — the SDK equivalent of `--plugin-dir`;
  loads `maister-copilot` (its agents/skills/rules) into the session.
- **`workingDirectory?: string`** — the session's cwd → point at the reset sandbox project.
- **`RuntimeConnection.forStdio({ path: "/usr/local/bin/copilot" })`** (`client.d.ts:83`) —
  spawn the installed CLI as the runtime; `new CopilotClient({ connection }).createSession(cfg)`
  (`client.d.ts:201`).

## The L2 harness, concretely

```js
import { CopilotClient, RuntimeConnection, approveAll } from "@github/copilot-sdk";

const client = new CopilotClient({
  connection: RuntimeConnection.forStdio({ path: "/usr/local/bin/copilot" }),
});

const events = [];
const session = await client.createSession({
  workingDirectory:  SANDBOX_PATH,            // reset per run
  pluginDirectories: [MAISTER_COPILOT_PATH],  // load the generated plugin
  onPermissionRequest: approveAll,            // (custom handler when testing the guard)
  onUserInputRequest:  autoRespond,           // deterministic gate answers
  onExitPlanModeRequest: () => ({ /* approve */ }),
});
session.on((e) => events.push(e));            // live typed trace
await session.sendAndWait(WORKFLOW_PROMPT);   // e.g. a quick-bugfix task
const history = await session.getEvents();    // full trace
await session.disconnect();

// → reduce (history ∪ events) + task-dir tree + orchestrator-state.yml  ⟶  predicate set
```

## What this changes for L2-DESIGN

- **§7 "the crux / make-or-break" is resolved.** The gate problem was the top feasibility
  risk; the SDK answers it directly. (L2-DESIGN also assumed the ACP bridge was "proposed, not
  shipped" — in fact `copilot --acp` **is** shipped in 1.0.73, and the Node SDK is an even
  cleaner path than raw ACP.)
- **The predicate extractor (§13 step 2) gets much simpler** — a typed event stream replaces
  log parsing. `--output-format json` (JSONL) is a second structured source if we ever drive
  the CLI directly instead of via the SDK.
- **Conformance baseline still holds** — this only concerns the Copilot side; the Claude
  reference is derived as before.

## Remaining unknowns → next step

Everything above is proven from the SDK contract. One **live smoke test** turns "proven by
types" into "proven end-to-end" and starts the MVP:

1. Spawn the CLI via the SDK, `createSession({ pluginDirectories: [maister-copilot], onUserInputRequest, onPermissionRequest })`.
2. Send a trivial prompt that triggers one `ask_user`; assert the handler answers it and the
   run completes.
3. Confirm `session.capabilities.ui?.elicitation` and the event stream contain the expected
   delegation/tool events.

Needs an authenticated Copilot seat and a few AI credits. This is L2-DESIGN phase step 1→2 and
seeds the predicate-schema work.

## Reproduction

```bash
copilot --version                                   # 1.0.73
SDK=~/.copilot/pkg/darwin-arm64/1.0.73/copilot-sdk
sed -n '862,898p;1745,1800p;1875p' "$SDK/types.d.ts" # the handler + pluginDirectories contracts
cat "$SDK/session.d.ts" "$SDK/client.d.ts"           # session + client API
copilot --help | grep -E 'acp|output-format|no-ask-user|plugin-dir'
```
