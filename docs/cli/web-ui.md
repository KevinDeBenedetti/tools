---
title: Web UI
---

# Web UI

A local browser front-end over the same commands as the CLI, for when picking
flags from a form beats remembering their names.

```bash
bun run ui          # http://127.0.0.1:3030
```

The server binds to `127.0.0.1` only. It can start any command in the registry,
so it is a local convenience — never expose it on a network.

## What it shows

The UI is **generated from the command registry**, the same `CommandGroup`
declarations that drive `bun run tools`. Adding a command to a group makes it
appear in the sidebar with its flags as form fields — there is no UI to update.

| Flag type  | Field                                            |
| ---------- | ------------------------------------------------ |
| `boolean`  | checkbox                                         |
| `number`   | number input                                     |
| `string`   | text input (placeholder = default, or `$ENV_VAR`) |
| `string[]` | text input, comma-separated                      |

Above the form sits the **equivalent command line**, updated as you type. Click
it to copy — it is exactly what you would have run in a terminal, which makes
the UI a decent way to learn the flags rather than a replacement for them.

Only fields you actually change become flags, so an untouched form runs the
command with its declared defaults, just like the CLI.

## Running

Press **Run** (or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>). The command
runs as a child process of the real CLI and its output streams into the console
pane at the bottom as it is produced — stderr in red, then the exit code.
**Stop** kills the child; so does closing the tab.

The console follows the tail only while you are already at it, so scrolling back
to read an early line doesn't yank you forward on the next chunk.

## Arranging the workspace

The toggle at the right of the output toolbar moves the console:

| Mode          | Layout                                                   |
| ------------- | -------------------------------------------------------- |
| **Bottom**    | options on top, output underneath — the default           |
| **Right**     | side by side, for wide screens or long-running output      |
| **Full**      | output only; the toolbar stays, so you can still run and switch back |

Drag the divider to resize. **Each arrangement remembers its own split**, and
the chosen mode is remembered too — both in `localStorage`, so the layout you
left is the layout you come back to.

The options grid reflows on the *pane's* width rather than the window's (CSS
container queries), so docking the console to the right collapses the fields to
one or two columns instead of squeezing three. The toolbar does the same: its
button labels drop to icons when the pane gets narrow.

| Shortcut                                     | Action              |
| -------------------------------------------- | ------------------- |
| <kbd>/</kbd>                                  | focus the filter    |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> | run the command     |
| <kbd>Esc</kbd>                                | close the confirmation |

## API inspector

The **API inspector** button in the header opens a page for pointing at an
OpenAI-compatible provider and finding out what is actually there. Enter a base
URL and an API key — or tick *use the session credentials* to check whatever
`OPENAI_BASE_URL` / `OPENAI_API_KEY` the server is already holding, without
retyping the key.

### Routes, public or private

Every route is probed **twice — once with the key, once without** — and the two
answers are compared. That second attempt is what makes the access column mean
something: a route that responds identically with no credentials does not require
any.

| Verdict           | What it means                                                 |
| ----------------- | ------------------------------------------------------------- |
| `available`       | The route answered. A validation error counts — it is there.    |
| `not implemented` | 404/405/501: the provider has no such route                   |
| `key rejected`    | The route exists but refused these credentials                |
| `rate limited`    | 429 — live, but not right now                                 |
| `no answer`       | Nothing responded: a base URL or network problem              |

| Access    | What it means                                                     |
| --------- | ----------------------------------------------------------------- |
| `private` | Answered 401/403 with no key — credentials are enforced            |
| `public`  | Answered anyway — **unauthenticated**, normal only for a local runtime |
| `unknown` | Not determined: the route is absent, so there is nothing to guard  |

A route the provider does not implement is reported as `unknown` rather than
`private`, even though it answers 401 without a key. Providers authenticate
before they route, so that 401 describes the middleware, not the route.

### The catalogue

`/models` is parsed with **the same code the benchmark uses**
(`toModelDef` in `src/openai-benchmark/models.ts`), so pricing, free detection and
modality never disagree between the table and a run. Each model shows its context
window, price per 1M tokens, input/output modalities, advertised parameters, and
badges for free, embedding, reasoning and moderated.

Filter by name, narrow to free / text-only / embedding / reasoning, and sort by
name, price or context. Providers that publish no pricing (OpenAI itself) say so
rather than showing a guessed zero.

### Cost

**Inspecting spends nothing.** Every POST the probe sends is an empty object,
which the provider rejects on validation before loading a model — there is a test
pinning that.

The per-model **Test** button is the one thing that spends: it sends a single
capped request (`Say OK.`) and reports latency, token usage and the opening of
the answer. It is per-model deliberately — a 300-model catalogue would otherwise
be 300 billable requests on page load.

A reasoning model often burns the whole budget thinking and answers with an empty
string. That is still a pass, and the published thinking is shown separately —
labelled as thinking, never as the answer.

## Destructive commands

Commands that can delete things are marked with a red dot in the sidebar. Their
`--execute` flag is off by default, exactly as on the command line, and turning
it on turns the Run button red and adds a confirmation step showing the command
about to run.

This matters more here than in a terminal: the CLI's own red confirmation prompt
only appears on a TTY, and a command started from the browser has none. The
dialog is that gate.

## Configuration

| Variable         | Default | Purpose      |
| ---------------- | ------- | ------------ |
| `TOOLS_UI_PORT`  | `3030`  | Listen port  |

Commands inherit the server's environment, so `GITHUB_TOKEN`, `OPENAI_API_KEY`
and friends come from the same `.env` the CLI uses.

The theme button in the header cycles **system → light → dark**. "System" keeps
following the OS, so a machine that flips at sunset flips the UI with it.

## Layout

| Path                  | Role                                                   |
| --------------------- | ------------------------------------------------------ |
| `src/web/serve.ts`    | `Bun.serve` — HTML route + `/api/*`                     |
| `src/web/catalog.ts`  | Command registry → JSON the browser can render          |
| `src/web/args.ts`     | Form values → argv (shared by server and browser)       |
| `src/web/runner.ts`   | Spawns the CLI, streams output as NDJSON                |
| `src/web/env.ts`      | Environment inspection and session credential overrides |
| `src/web/inspect.ts`  | Probes a provider's routes and catalogue; tests a model  |
| `src/web/protocol.ts` | Wire types shared by both halves                        |
| `src/web/app/`        | React app, bundled by Bun's dev server (no build step)  |

The inspector probes from the **server**, not the browser: providers send no CORS
headers, so a fetch from the page would be blocked before it was sent. Keys are
used and dropped — as with the environment panel, the wire carries only a redacted
rendering, and no endpoint hands one back.

## UI stack

[shadcn/ui](https://ui.shadcn.com) (new-york, zinc) on Tailwind CSS v4 and Radix
primitives, with `react-resizable-panels` behind the draggable dividers. There
is no build step: Bun's dev server bundles the TSX and runs Tailwind through
`bun-plugin-tailwind`, wired in `bunfig.toml`.

Components are vendored under `src/web/app/components/ui/` — they are ordinary
source files, so edit them in place. `components.json` is configured for the
shadcn CLI if you want to pull in more:

```bash
bunx shadcn@latest add select
```

Aliases go through **`package.json#imports`** (`#components/…`, `#lib/…`,
`#hooks/…`) rather than the usual `@/…` tsconfig paths: Bun's bundler only
honours tsconfig `paths` alongside a `baseUrl`, and TypeScript 7 removed
`baseUrl`. shadcn supports this alias style natively.
