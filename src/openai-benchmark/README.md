# OpenAI Benchmark

Compare OpenAI-compatible models on latency, throughput, instruction-following
quality, and cost — `benchmark run` for chat models, `benchmark embed` for
embedding models.

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

## Comparing free models

The case this tool is tuned for: a provider like OpenRouter lists hundreds of
models, several dozen of them free, and you want to know which one to actually
use.

```bash
bun run benchmark models --free
bun run benchmark run --free --limit 8 --quality --json reports/free.json
```

Filters combine with AND, and an empty result reports the funnel so you can see
which one emptied it — `3 available → 2 free → 0 matching /qwen/i` means free
models exist and Qwen models exist, but no Qwen model is free.

A model counts as free when the provider **declares** it: the id carries
OpenRouter's `:free` suffix, or `is_free` is set. A price of zero deliberately
does not count — catalogues use zero both for "costs nothing" and for "no
published price" (BYOK, self-hosted and routed entries), and the two are
indistinguishable per model. Reading zero as free let paid models through
`--free`, which spends real credit; missing a genuinely free model only shows
fewer rows, and the funnel says why.

`run` prints that funnel on every discovery run, so the selection is always
accountable:

```
  Models:   12 (free only)
  Selected: 340 available → 12 free → 12 text-only
```

Four things make this workable on a free tier:

- **Non-text models are excluded.** OpenRouter lists music and image generators
  at zero cost in the same catalogue. The test is whether text is the model's
  _only_ output: Lyria reports `output_modalities: ["text", "audio"]`, so
  "emits text" would have kept it. `run` drops them by default — pass
  `--text-only=false` to keep them, and `models --text-only` to apply the same
  filter when listing.
- **Reasoning models get a real output budget.** A reasoning model spends its
  allowance thinking before it writes, so a task asking for 32 tokens comes back
  with `content: null` and scores zero — a measurement artefact, not a bad
  model. Reasoning is switched off via OpenRouter's `reasoning.enabled` for
  models that advertise it (and only those: it is a provider extension, and
  strict servers reject unknown parameters), with a 512-token floor covering
  models that ignore the switch. Answers that still come back empty are
  reported as `no text`, never as a 0% score.
- **Probe first.** Before benchmarking, each candidate gets one 8-token request.
  Retired endpoints and models gated behind a paid tier are dropped up front
  instead of polluting the results. Disable with `--probe=false`.
- **Rate limits are handled, not counted as failures.** A 429 is retried with
  exponential backoff honouring `Retry-After`, and any that remain are reported
  separately from real failures — the `OK` column marks them `(429)`.
- **Quality is measured, not assumed.** Every free model costs $0, so latency
  alone would rank the least useful model first. `--quality` scores the model
  and probes its real capabilities (see below).

The run header prints how many requests the whole run will issue, since free
tiers cap requests per day.

## Quality scoring

`--quality` runs a deterministic suite: each task has a fixed prompt and a
mechanical assertion (regex, exact match, JSON parse + required keys, word
count). No judge model, no extra cost, same verdict on every run. The suite
measures instruction following and format compliance — a correct answer buried
in "Sure! Here you go:" fails, which is the point.

It also probes two capabilities against reality rather than metadata:

- **JSON mode** — does `response_format: json_object` return parseable JSON?
- **Tools** — does the model actually emit a tool call when given one?

A model advertising a capability it does not deliver is flagged `✗ (claimed)`
in the Capabilities table.

## Embedding models

```bash
bun run benchmark models --embedding --free
bun run benchmark embed --free --limit 5
```

OpenRouter's `/models` defaults to `output_modalities=text`, so embedding models
are **absent from the default catalogue entirely** — both commands request them
explicitly. Embedding models also bill input only, so a missing completion price
is read as zero rather than unknown; otherwise no free one would ever be
detected.

Speed says almost nothing here — every embedding model is fast, and a fast model
that retrieves the wrong document is worthless. So `embed` scores retrieval by
default (`--quality=false` to skip). Each case pairs a query with one correct
document and three **hard negatives** that share its vocabulary: "password"
appears in all four documents of the first case, so lexical overlap carries no
signal and only a model that encodes meaning ranks the positive first. An easy
suite of unrelated documents would score every model at 100% and tell you
nothing.

Reported per model:

- **P@1** — fraction of cases where the correct document ranked first
- **MRR** — mean reciprocal rank, giving partial credit for near misses
- **Margin** — mean gap between the positive and the best negative. A model can
  rank first with a margin of 0.005, which will not survive real data; margins
  below 0.02 are flagged.
- **Dims** — vector width, which drives storage and search cost downstream
- **Vectors** — whether they come back unit-length. Unnormalised vectors are
  usable but must be normalised before a dot product, a quiet source of wrong
  results in a vector store.

Queries and documents go in two separate batched requests, so scoring a model
costs two calls however many cases the suite holds.

### Asymmetric models

Retrieval models often want queries and documents encoded differently, and the
accepted vocabulary is provider-specific: NVIDIA takes `query`/`passage` and
rejects the `search_query`/`search_document` spelling OpenRouter documents.
Sending the wrong one is a 400, and sending none at all under-measures the model.

So the vocabulary is negotiated during the probe — each variant is tried once,
the first accepted wins — and the retrieval suite then encodes each side
correctly. The `Encoding` column shows what was used, `symmetric` when the model
takes no `input_type`. Disable with `--input-type=false`.

Note that `encoding_format: "float"` is always sent: the OpenAI SDK defaults to
base64 and decodes it client-side, which several providers reject outright.

## Usage

### List the models the API offers

```bash
bun run benchmark models
bun run benchmark models --free --match qwen
```

### Select models interactively

Fetches the model list, offers a free-only filter and a name filter, then lets
you pick from what is left:

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

### Provider-specific filters

`--query` forwards `key=value` pairs straight to `/models`, so provider filters
work without this tool knowing about them. For OpenRouter:

```bash
bun run benchmark models --query max_price=0 --query sort=latency-low-to-high
```

Providers ignore parameters they do not recognise, so `--free` / `--match`
remain the portable path.

### Save a run

```bash
bun run benchmark run --free --quality --json reports/$(date +%F).json
```

The JSON snapshot holds per-model stats, quality scores, capability results and
the models dropped by the probe. Free catalogues change week to week, so a
snapshot is worth more than a re-run.

## Command-line Options

```
      --models <ids>       Comma-separated model IDs (omit to select via --free/--match)
      --runs <n>           Runs per model (default: 3)
      --prompt <text>      Prompt to use for benchmarking
      --max-tokens <n>     Max output tokens (default: 256)
      --stream             Streaming mode (measures TTFT); --stream=false to disable
      --free               Only models the provider charges nothing for
      --match <regex>      Filter model id/label, case-insensitive
      --limit <n>          Keep at most N models
      --text-only          Exclude image/audio generators (default: true on run)
      --query <k=v>        Extra parameter passed to /models (repeatable)
      --probe              Drop unreachable models first (default: true)
      --input-type         Negotiate query/passage encoding on embed (default: true)
      --quality            Score instruction-following and probe tool/JSON support
      --timeout <ms>       Per-request timeout (default: 60000)
      --retries <n>        Retries on rate limits and transient errors (default: 2)
      --json <path>        Write a JSON snapshot of the run
  -h, --help               Show help
```

## Using a custom provider

1. Set `OPENAI_BASE_URL` and `OPENAI_API_KEY` for your provider in `.env`.
2. Run `bun run benchmark models` to see the available model IDs (and pricing,
   if the provider exposes it).
3. Benchmark with `bun run benchmark --models <id,id>` or interactively.
