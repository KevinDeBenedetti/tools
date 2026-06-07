# OpenAI Benchmark

Compare OpenAI models on latency, throughput, and cost.

## Quick Start

```bash
bun run benchmark --help
```

## Configuration

Configuration is split between two files:

1. **Models and pricing** → `benchmark.config.json` (models, default models)
2. **API credentials** → `.env` file (API key and URL)

### Environment Setup

Create a `.env` file in the project root:

```env
# Required: Your API key
OPENAI_API_KEY=sk-your-key-here

# Optional: Custom API endpoint (defaults to https://api.openai.com/v1)
OPENAI_BASE_URL=https://api.openai.com/v1
```

For reference, see [.env.example](.env.example).

### Models Configuration File

Create a `benchmark.config.json` file to customize models and pricing:

```json
{
  "models": [
    {
      "id": "gpt-4o",
      "label": "GPT-4o",
      "inputPricePer1M": 2.5,
      "outputPricePer1M": 10
    },
    {
      "id": "my-custom-model",
      "label": "My Custom Model",
      "inputPricePer1M": 1,
      "outputPricePer1M": 3
    }
  ],
  "defaultModelIds": ["gpt-4o", "my-custom-model"]
}
```

### Configuration Options

**benchmark.config.json:**

- **models**: Array of model definitions
  - `id`: Unique identifier for the model
  - `label`: Human-readable name
  - `inputPricePer1M`: USD per 1 million input tokens
  - `outputPricePer1M`: USD per 1 million output tokens

- **defaultModelIds**: Array of model IDs to benchmark by default

**.env file:**

- **OPENAI_API_KEY** (required): Your API key
- **OPENAI_BASE_URL** (optional): Custom API endpoint URL

## Usage

### Run with defaults

```bash
bun run benchmark
```

### Select models interactively

```bash
bun run benchmark --interactive
```

### Run with specific models

```bash
bun run benchmark --models gpt-4o,gpt-4o-mini --runs 5
```

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
  -m, --models <ids>       Comma-separated model IDs
  -n, --runs <n>           Runs per model (default: 3)
  -p, --prompt <text>      Prompt to use for benchmarking
      --max-tokens <n>     Max output tokens (default: 256)
      --stream             Force streaming mode (measures TTFT)
      --no-stream          Force non-streaming mode
  -h, --help               Show help
```

## Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key (required, set in `.env` file)
- `OPENAI_BASE_URL`: Custom API endpoint (optional, defaults to `https://api.openai.com/v1`)

## Adding Custom Models

1. Edit `benchmark.config.json` and add your model to the `models` array with pricing information
2. Update your `.env` file with the API key and URL for your provider
3. Run the benchmark with `--models your-model-id`

Example:

**benchmark.config.json:**

```json
{
  "models": [
    {
      "id": "my-provider/model-v1",
      "label": "My Provider Model v1",
      "inputPricePer1M": 0.5,
      "outputPricePer1M": 1.5
    }
  ],
  "defaultModelIds": ["my-provider/model-v1"]
}
```

**.env:**

```env
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.my-provider.com/v1
```
