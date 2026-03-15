# Generate `README.md` for this repository

You are writing the `README.md` for this repository. Your goal is to produce a
**synthetic, scannable** file that lets any developer understand the project at a
glance and follow links to the full documentation — without duplicating it inline.

---

## Rules

- Only document facts you have **verified** by reading actual files in this repo.
- Do **not** hallucinate commands, paths, badges, or links that don't exist.
- Keep the output to **≤ 150 lines** of Markdown.
- Write in natural language. Use ATX headings (`#`), blank lines between sections.
- **Do not repeat** content that lives in the docs site — link to it instead.
- If a section has nothing relevant to say, **omit it entirely**.
- All text must be in **English**.

---

## Steps to follow

### 1 — Inventory the repository

Read and reason over each of the following before writing anything:

- Root files: `package.json` / `Cargo.toml` / `pyproject.toml` — name, description, scripts
- `prek.toml` — pre-commit hooks and required tools
- `.github/workflows/*.yml` — CI badge URL and what the pipeline does
- `docs/.vitepressrc.json` — whether a docs entry exists on the unified hub
- `docs/` — top-level pages available for deep-linking
- `LICENSE` — license identifier (MIT, Apache-2.0, …)

### 2 — Resolve the docs URL

If `docs/` folder exists, the project's docs live at:

```
https://kevindebenedetti.github.io/<repo-name>/
```

Use that URL for every "→ full docs" link. If the file does not exist, omit the
docs section entirely.

### 3 — Write the README

Produce `README.md` structured **exactly** as follows (keep section order):

```markdown
# <Project name>

<!-- One CI/CD badge if a workflow exists, otherwise omit -->
[![CI/CD](<badge-url>)](<workflow-url>)

> One sentence: what this project does and who it is for.

## Features

<!-- 3–6 bullet points: the most distinctive capabilities. No prose. -->
- …

## Prerequisites

<!-- Only hard requirements. One bullet per tool with minimum version. -->
- …

## Installation

<!-- Minimal steps to get the project running locally. Code block(s) only. -->
```sh
…
```

## Usage

<!-- One or two representative examples. Keep it short. -->
```sh
…
```

→ Full usage guide: [docs](<docs-url>)

## Documentation

Full documentation is available at **<docs-url>**.
It is generated from the `docs/` directory and published automatically on push.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[issue templates](https://github.com/KevinDeBenedetti/<repo>/issues/new/choose).

## License

<License identifier> — see [LICENSE](LICENSE).
```

### 4 — Self-verify

Before saving, confirm:

- Badge URL is real (copied from an existing workflow file, not invented).
- All linked paths (`CONTRIBUTING.md`, `LICENSE`, `docs/`) actually exist in the repo.
- The docs URL matches `docs/ → "repo"` field, if present.
- File is **≤ 150 lines**.
- No section exceeds what is needed — prefer a link over inline prose.
- Conventional Commits type for the resulting commit: `docs: add README`.
