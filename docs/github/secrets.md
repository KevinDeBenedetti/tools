---
title: GitHub — Secrets
---

# Scan for leaked secrets

`scan-secrets` searches a repository's working tree — and optionally its full
git history — for high-signal secret patterns.

```bash
# Scan the working tree of the current repository
bun run github scan-secrets

# Include git history
bun run github scan-secrets --history

# Scan a remote repository
bun run github scan-secrets --repo owner/repo --local=false --history
```

## Flags

| Flag         | Default | Description                                          |
| ------------ | ------- | ---------------------------------------------------- |
| `--repo`     | —       | GitHub repo (`owner/repo`) to clone and scan         |
| `--local`    | `true`  | Scan the local repository (set `false` to clone `--repo`) |
| `--history`  | off     | Scan git history in addition to the working tree     |
| `--dry-run`  | off     | Preview what would be scanned without scanning       |
| `--patterns` | —       | Additional custom regex patterns (repeatable)        |
| `--format`   | `text`  | Output format (`text` or `json`)                     |

## Built-in patterns

The scanner ships with rules for common credential shapes:

- **OpenAI-style key** — `sk-…`
- **AWS secret access key** — `AWS_SECRET_ACCESS_KEY=…`
- **GitHub token** — `ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`
- **Private key** — `-----BEGIN … PRIVATE KEY-----`

Patterns are matched with `git grep -E`, which uses POSIX extended regular
expressions — use POSIX character classes (e.g. `[[:space:]]`) rather than
`\s` in custom `--patterns`.

```bash
# Add custom patterns on top of the built-in rules
bun run github scan-secrets --history \
  --patterns 'xoxb-[A-Za-z0-9-]+' \
  --patterns 'AIza[0-9A-Za-z_-]{35}'
```

The output lists each match with its file and rule name, and a count of matched
files. Use `--format json` for machine-readable output in CI.
