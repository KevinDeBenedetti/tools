# Copilot Chat & Session Management

Build interactive AI-powered workflows using the Copilot SDK. This guide covers persistent multi-turn chat sessions, PR summarization, and session resumption.

> 💰 **Cost-friendly:** This guide uses example models like `gpt-5-mini` — a fast, inexpensive model ideal for summaries and chat.

## Overview

### What you get

| Feature | Purpose | Use Case |
|---------|---------|----------|
| **💬 Interactive Chat** | Multi-turn Copilot conversation in CLI | Ask questions, get summaries, iterate on code reviews |
| **📝 PR Summary** | Auto-generate PR summaries with GitHub Actions | Post summaries as PR comments automatically |
| **🔄 Resume Sessions** | Continue a Copilot conversation later | Persistent session state for long workflows |

## Quick Start

### 1. Interactive Copilot Chat (local)

Start an interactive chat session in your terminal:

```bash
GITHUB_TOKEN=$(gh auth token) bun run chat
```

**Commands inside chat:**

```
You › What's this PR doing?

Copilot › [streams response word-by-word]

/help       — Show all commands
/summary    — Ask Copilot to summarize the conversation
/history    — Print full conversation transcript
/clear      — Start a new session (old session ends)
/quit       — Exit chat
```

### 2. Generate PR Summary (local test)

Test the summary generation against a real PR:

```bash
GITHUB_TOKEN=$(gh auth token) bun run summary \
  --owner my-org \
  --repo my-repo \
  --pr 42 \
  --type summary \
  --model gpt-5-mini
```

**Available types:** `summary`, `docs`, `changelog`, `tests`

### 3. Automated PR Summary (GitHub Actions)

The workflow runs automatically on every PR:

```
PR opened/updated → GitHub Actions
  ↓
Copilot SDK generates summary (example: using default model)
  ↓
Posts comment on PR + Actions summary tab
```

## Architecture

### `CopilotChatSession` — Persistent Sessions

Unlike the one-shot `CopilotClient.complete()`, `CopilotChatSession` keeps the SDK session **alive** between prompts:

```typescript
import { CopilotChatSession } from "./copilot/chat/chat.session";

// Start — session persists until stop()
// Example: using gpt-5-mini for cost-effective conversational AI
const chat = new CopilotChatSession(token, "gpt-5-mini");
await chat.start();

// First turn
const reply1 = await chat.ask("Explain async/await");
console.log(reply1);

// Second turn — session remembers the previous exchange
const reply2 = await chat.ask("Now show me an example");
console.log(reply2);

// Get full history
const history = chat.getHistory();
console.log(history);
// [
//   { role: "user", content: "Explain async/await" },
//   { role: "assistant", content: "..." },
//   { role: "user", content: "Now show me an example" },
//   { role: "assistant", content: "..." }
// ]

await chat.stop();
```

### `ResumeService` — Resume by Session ID

Resume a previous session (e.g., after a workflow step completes):

```typescript
import { ResumeService } from "./copilot/resume/resume.service";

const service = new ResumeService(copilot, github);

// Resumes session "pr-42" or creates it if missing
// gpt-5-mini is fast and affordable for follow-ups
const response = await service.resumePR(
  { owner: "me", repo: "myrepo" },
  42,  // PR number
  {
    prompt: "Any security issues?",
    focus: "security"
  }
);
```

**Session ID defaults to `pr-{prNumber}`** — easily track by PR number.

### Event Streaming

Responses stream in real-time via SDK events:

```typescript
// Chunks arrive as: "The", " quick", " brown", ...
const chunks: string[] = [];
const fullResponse = await chat.ask("Hello", (chunk) => {
  chunks.push(chunk);
  process.stdout.write(chunk);  // Print as it arrives
});
```

## GitHub Actions Workflow

### Setup

1. **Create a Classic PAT** (not fine-grained):
   - Go to github.com → Settings → Developer settings → Tokens (classic)
   - Scopes: `repo` (that's all — no "copilot" scope exists)
   - **Account must have GitHub Copilot Individual or Business active**

2. **Add secret to your repo:**
   - Settings → Secrets and variables → Actions → New secret
   - Name: `COPILOT_TOKEN`
   - Value: `ghp_xxxx...` (your Classic PAT)

3. **Workflow runs automatically** on every PR targeting `main`:
   ```yaml
   on:
     pull_request:
       types: [opened, synchronize, reopened]
   ```

### How it works

```mermaid
PR opened
  ↓
.github/workflows/copilot-pr-summary.yml triggers
  ↓
Copilot Action calls generate tool
  ↓
GenerateService reads PR diff
  ↓
Copilot SDK (gpt-5-mini) generates summary
  ↓
Summary posted as PR comment + Actions summary tab
  ↓
On re-run, old comment is deleted (stays fresh)
```

### Customizing the workflow

Edit `.github/workflows/copilot-pr-summary.yml`:

```yaml
# Generate different type (default: summary)
options: '{"type":"changelog","format":"markdown"}'

# Use gpt-5-mini (fast, cost-effective)
model: gpt-5-mini

# Add custom instructions
options: '{"type":"summary","instructions":"Focus on breaking changes"}'
```

## API Reference

### `CopilotChatSession`

```typescript
class CopilotChatSession {
  // Create a session (does not start yet)
  // model defaults to gpt-5-mini for cost efficiency
  constructor(token: string, model?: string, sessionId?: string);

  // Connect to Copilot SDK
  async start(): Promise<void>;

  // Send prompt and stream response
  async ask(prompt: string, onChunk?: (chunk: string) => void): Promise<string>;

  // Ask for conversation summary
  async summary(onChunk?: (chunk: string) => void): Promise<string>;

  // Get all messages exchanged so far
  getHistory(): Readonly<ChatMessage[]>;

  // Close session and stop SDK
  async stop(): Promise<void>;
}
```

### `ResumeService`

```typescript
class ResumeService {
  async resumePR(
    repo: { owner: string; repo: string },
    prNumber: number | undefined,
    options: {
      prompt: string;
      sessionId?: string;          // defaults to pr-{prNumber}
      focus?: string;              // e.g., "security"
    }
  ): Promise<string>;
}
```

### `ResumeTool` (GitHub Actions)

**Inputs:**

| Input | Required | Example |
|-------|----------|---------|
| `tool` | ✓ | `resume` |
| `token` | ✓ | `${{ secrets.COPILOT_TOKEN }}` |
| `options` | ✗ | `{"prompt":"Any issues?","focus":"security"}` |
| `model` | ✗ | `gpt-5-mini` (default) |

**Outputs:**

| Output | Description |
|--------|-------------|
| `summary` | Tool execution summary |
| `success` | `"true"` or `"false"` |
| `response` | Copilot's text response |
| `sessionId` | Session ID (for tracing) |

### `GenerateService` (for summaries)

```typescript
const output = await generateService.generate(
  { owner, repo },
  prNumber,
  {
    type: "summary",      // summary | docs | changelog | tests
    filePath: "src/app.ts", // optional
    instructions: "...",  // custom prompt
    format: "markdown"    // markdown | typescript | json
  }
);
```

## Testing

### Unit tests (no token needed)

```bash
# All tests
bun test src/tests/ src/cli/ src/copilot/

# Specific suites
bun test src/copilot/chat/
bun test src/copilot/resume/
```

### Integration test (requires token)

```bash
# Chat session (uses gpt-5-mini by default)
GITHUB_TOKEN=$(gh auth token) bun run chat

# Resume a session
GITHUB_TOKEN=$(gh auth token) bun run src/copilot/resume/test-local.ts \
  --owner my-org --repo my-repo --pr 42 \
  --prompt "Any issues?" --focus security

# Generate a summary (gpt-5-mini)
GITHUB_TOKEN=$(gh auth token) bun run summary \
  --owner my-org --repo my-repo --pr 42 \
  --model gpt-5-mini
```

## Troubleshooting

### "copilot" scope not found in PAT settings

✅ **This is normal.** The Copilot SDK does NOT require a special scope. It auto-detects `COPILOT_GITHUB_TOKEN` and validates the account has an active Copilot subscription server-side.

### Token error: "Copilot subscription not found"

🔍 **Your token's account doesn't have GitHub Copilot.** Verify:
- The account on github.com has an active **Copilot Individual** or **Copilot Business** subscription
- The PAT was created from that same account

### Session timeout or "session not found"

⏱️ **Sessions expire after inactivity.** The SDK's `resumeSession()` falls back to creating a new session if the old one is gone — this is normal.

### Streaming not showing in Actions

📝 **Actions UI doesn't stream in real-time.** Streaming works locally and shows in step logs. The full response is always captured in `outputs.response`.

## Examples

### Example 1: PR Review Feedback Loop

```bash
# Local: Ask Copilot about a PR (gpt-5-mini)
GITHUB_TOKEN=$(gh auth token) bun run src/copilot/resume/test-local.ts \
  --owner me --repo tools --pr 7 \
  --prompt "Review the security of the authenticate() function" \
  --model gpt-5-mini

# Follow-up question in same session
GITHUB_TOKEN=$(gh auth token) bun run src/copilot/resume/test-local.ts \
  --owner me --repo tools --pr 7 \
  --session-id pr-7 \
  --prompt "How would you improve the error handling?"
```

### Example 2: Interactive Code Review Chat

```bash
# Start interactive chat (gpt-5-mini by default)
GITHUB_TOKEN=$(gh auth token) bun run chat

# Inside chat:
You › Summarize what we've discussed
Copilot › [summary of conversation]

You › /history
# [prints all turns]

You › /clear
# [starts fresh session]
```

### Example 3: Custom Action in Workflow

```yaml
- name: Generate detailed changelog
  uses: ./.github/actions/copilot
  with:
    tool: generate
    token: ${{ secrets.COPILOT_TOKEN }}
    model: gpt-5-mini
    options: |
      {
        "type": "changelog",
        "instructions": "Include breaking changes, new features, and deprecations"
      }
```

## See Also

- [Copilot SDK Official Docs](https://github.com/github/copilot-sdk)
- [Session Persistence](https://github.com/github/copilot-sdk/blob/main/docs/features/session-persistence.md)
- [Streaming Events](https://github.com/github/copilot-sdk/blob/main/docs/features/streaming-events.md)
