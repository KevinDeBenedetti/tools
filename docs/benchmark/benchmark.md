---
title: Benchmark
---

# Model benchmark

The `benchmark` group compares OpenAI-compatible models on **latency, time to
first token (TTFT), throughput and cost**. Models are discovered live from the
provider's `/models` endpoint — there is no predefined model list.

```bash
bun run benchmark            # interactive on a TTY
bun run benchmark --help
```

## Configuration

The only configuration is API credentials, read from the environment (a `.env`
file in the project root is loaded automatically):

```env
# Required: your API key
OPENAI_API_KEY=sk-your-key-here

# Optional: custom endpoint (defaults to https://api.openai.com/v1)
# Point this at any OpenAI-compatible API, e.g. OpenRouter.
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

Credentials load lazily, so `--help` and the command listing never require a
`.env` file or a key.

## `models` — list available models

Fetches the model list from the API. When the provider exposes per-token
pricing (e.g. OpenRouter), `$/1M in` and `$/1M out` are shown; otherwise they
display as `—`.

```bash
bun run benchmark models
```

## `run` — benchmark models

| Flag           | Default          | Description                                       |
| -------------- | ---------------- | ------------------------------------------------- |
| `--models`     | (pick) | Comma-separated model IDs (omit to pick interactively) |
| `--runs`       | `3`              | Runs per model                                    |
| `--max-tokens` | `256`            | Max output tokens                                 |
| `--prompt`     | built-in default | Prompt to benchmark with                          |
| `--stream`     | `true`           | Streaming mode (measures TTFT); `--stream=false` to disable |

```bash
# Specific models, 5 runs each
bun run benchmark --models gpt-4o,gpt-4o-mini --runs 5

# Custom prompt
bun run benchmark --prompt "Summarize the theory of relativity in 2 sentences"

# Non-streaming (disables TTFT measurement)
bun run benchmark --stream=false
```

Model IDs are whatever the provider returns from `bun run benchmark models`
(for OpenRouter, e.g. `openai/gpt-4o`). Unknown IDs are still benchmarked, just
without pricing.

## Using a custom provider

1. Set `OPENAI_BASE_URL` and `OPENAI_API_KEY` for your provider in `.env`.
2. Run `bun run benchmark models` to see the available model IDs (and pricing,
   if the provider exposes it).
3. Benchmark with `bun run benchmark --models <id,id>` or interactively.
