# OpenAI Benchmark

Compare OpenAI-compatible models on latency, throughput, and cost.

Models are discovered live from the provider's `/models` endpoint — there is no
predefined model list. When the provider exposes per-token pricing (e.g.
OpenRouter), cost is computed from it; otherwise cost is reported as `—`.

## Quick Start

```bash
bun run benchmark --help
```

## Configuration

The only configuration is API credentials, via environment variables (a `.env`
file in the project root is loaded automatically):

```env
# Required: your API key
OPENAI_API_KEY=sk-your-key-here

# Optional: custom endpoint (defaults to https://api.openai.com/v1)
# Point this at any OpenAI-compatible API, e.g. OpenRouter.
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

For reference, see [.env.example](.env.example).

- **OPENAI_API_KEY** (required): your API key
- **OPENAI_BASE_URL** (optional): custom endpoint URL

## Usage

### List the models the API offers

```bash
bun run benchmark models
```

### Select models interactively

Fetches the model list from the API and lets you pick from it:

```bash
bun run benchmark --interactive
```

### Run with specific models

```bash
bun run benchmark --models gpt-4o,gpt-4o-mini --runs 5
```

Model IDs are whatever the provider returns from `bun run benchmark models`
(for OpenRouter, e.g. `openai/gpt-4o`). Unknown IDs are still benchmarked, just
without pricing.

### Custom prompt

```bash
bun run benchmark --prompt "Summarize the theory of relativity in 2 sentences"
```

### Non-streaming mode (disables TTFT measurement)

```bash
bun run benchmark --no-stream
```

## Command-line Options

```
      --models <ids>       Comma-separated model IDs (omit to pick interactively)
      --runs <n>           Runs per model (default: 3)
      --prompt <text>      Prompt to use for benchmarking
      --max-tokens <n>     Max output tokens (default: 256)
      --stream             Streaming mode (measures TTFT); --no-stream to disable
  -h, --help               Show help
```

## Using a custom provider

1. Set `OPENAI_BASE_URL` and `OPENAI_API_KEY` for your provider in `.env`.
2. Run `bun run benchmark models` to see the available model IDs (and pricing,
   if the provider exposes it).
3. Benchmark with `bun run benchmark --models <id,id>` or interactively.
