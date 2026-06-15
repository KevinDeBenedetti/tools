---
title: Interactive CLI
---

# Interactive CLI

Every local command is built on one declarative framework, so the terminal
experience is consistent across `github`, `todo`, `benchmark` and `copilot`.
This page covers the interactive features layered on top of plain
`bun run tools <group> <command>` invocations.

## Interactive menu

Running the CLI with no arguments on a TTY opens a menu:

```bash
bun run tools          # category → command → options
bun run github -i      # jump straight into the github group
```

The menu is **persistent**: after a command finishes you return to the menu
instead of exiting, so you can chain several actions in one session.

- At the category level, pick a group or **Quit**.
- Inside a group, pick a command or **← Back** to return to the categories.
- <kbd>Ctrl</kbd>+<kbd>C</kbd> exits cleanly from any prompt.

## Guided wizard

When you pick a command without a custom wizard, the framework derives a prompt
flow from the command's flag declarations:

- **Required flags** are always prompted and validated — you cannot continue
  with an empty or invalid value (no more "missing flag" error *after* the fact).
- **Optional flags** are offered through a picker (<kbd>space</kbd> to toggle,
  <kbd>↵</kbd> to confirm) so you only fill what you need. Each entry shows where
  its value would otherwise come from (an env var or its default).
- **List flags** (`string[]`, e.g. `--patterns`) use a small builder: enter
  values one per line, an empty entry finishes the list.
- A **command preview** is shown before anything runs, then a final confirm.

## Remembered values

Scalar flag values you enter through the wizard (for example `--repo`,
`--canonical`, `--keep-latest`) are remembered between sessions and pre-filled
the next time — press <kbd>↵</kbd> to reuse the last value or edit it inline.

State is stored at `~/.config/tools/state.json`. Override the location with the
`TOOLS_STATE_PATH` environment variable. Persistence is best-effort: a missing
or unwritable state file never causes a command to fail, and only string/number
values are stored (booleans and lists are ignored).

## Destructive previews

Destructive commands (`purge-*`) **default to a dry-run preview**. The CLI
resolves exactly what would be deleted and prints it as a table:

```bash
# Dry run — lists the matching tags, deletes nothing
bun run github purge-tags --repo owner/repo --pattern 'v0.*'
```

Add `--execute` to delete. In an interactive terminal you then get a red
confirmation showing the count and repository before anything is removed:

```
Permanently delete 12 tags in owner/repo? This cannot be undone. (y/N)
```

The confirmation defaults to **no**, and a cancel is treated as a refusal. In a
non-interactive context (CI), `--execute` deletes without prompting, so existing
automation is unaffected.

## Did-you-mean suggestions

A mistyped command suggests the closest match before showing help:

```bash
$ bun run tools github purge-tag
Error: unknown command: purge-tag
Did you mean 'purge-tags'?
```

## Shell completion (zsh)

Generate a zsh completion script from the command registry — it completes
groups, commands and `--flags` with their descriptions:

```bash
# Write the script somewhere on your $fpath
bun run tools completion zsh > ~/.zfunc/_tools
```

Ensure the directory is on your `fpath` and completion is initialised, e.g. in
`~/.zshrc`:

```zsh
fpath=(~/.zfunc $fpath)
autoload -Uz compinit && compinit
```

The script binds to the `tools` command by default (handy with an
`alias tools="bun run tools"`). Pass `--name` to bind a different command name:

```bash
bun run tools completion zsh --name mytools > ~/.zfunc/_mytools
```

Regenerate the script after adding or renaming commands.
