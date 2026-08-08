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
| `src/web/serve.ts`    | `Bun.serve` — HTML route + `/api/commands` + `/api/run` |
| `src/web/catalog.ts`  | Command registry → JSON the browser can render          |
| `src/web/args.ts`     | Form values → argv (shared by server and browser)       |
| `src/web/runner.ts`   | Spawns the CLI, streams output as NDJSON                |
| `src/web/protocol.ts` | Wire types shared by both halves                        |
| `src/web/app/`        | React app, bundled by Bun's dev server (no build step)  |

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
