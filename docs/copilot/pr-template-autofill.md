# PR Template Auto-fill with Copilot SDK

This guide documents the new PR template auto-fill feature that uses the Copilot SDK to generate structured suggestions for pull request fields.

## Overview

When you create a new pull request, two workflows run:

### 1. PR Template Auto-fill (on PR opened)
- Triggers automatically when a PR is created
- Analyzes the PR diff and title
- Generates structured suggestions for:
  - **Description**: Summary of changes
  - **Change Type**: Categorizes as bug, feature, refactor, docs, perf, or breaking
  - **Testing Approach**: Suggests testing strategy
  - **Impact Areas**: Identifies potentially affected code areas
  - **Breaking Changes**: Highlights any breaking changes
- Posts suggestions as a PR comment (read-only reference)

### 2. PR Summary Updates (on push/sync)
- Continues to update the summary on each commit
- Runs on `synchronize` events (new commits pushed)
- Uses existing summary workflow (unchanged)

## How It Works

### Architecture

```
PR Created (opened event)
  ↓
.github/workflows/copilot-pr-autofill.yml
  ↓
Calls ./.github/actions/copilot with tool: generate, type: template
  ↓
GenerateTool routes to TemplateService
  ↓
TemplateService analyzes diff + PR title via Copilot SDK
  ↓
Generates structured TemplateFieldsOutput JSON
  ↓
Formats as markdown comment
  ↓
Posts as PR comment for user reference
```

### File Structure

```
src/copilot/generate/
├── generate.service.ts          (updated to support template type)
├── template.service.ts          (NEW - analyzes and generates template fields)
├── generate.schema.ts           (updated with "template" enum)
├── index.ts                     (GenerateTool - routes to template service)
└── test-local.ts               (updated to support template generation)

.github/
├── pull_request_template.md     (NEW - template for PRs)
└── workflows/
    ├── copilot-pr-autofill.yml  (NEW - runs on PR opened)
    └── copilot-pr-summary.yml   (existing - runs on sync)

src/shared/
├── context.ts                   (updated to extract PR title)
└── types/copilot.ts            (updated ToolContext with prTitle)
```

## Template Service

### TemplateFieldsOutput

```typescript
interface TemplateFieldsOutput {
  description: string;           // 1-2 sentence summary
  changeType: ChangeType;        // bug|feature|refactor|docs|perf|breaking
  testingApproach: string;       // Suggested testing strategy
  impactAreas: string[];         // Potentially affected code areas
  breakingChanges: string[];     // List of breaking changes (if any)
}
```

### Analysis Process

1. **Get Context**: Fetches PR diff from GitHub API
2. **Prepare Prompt**: Constructs prompt asking Copilot to analyze and return JSON
3. **Call Copilot SDK**: Sends to Copilot for analysis
4. **Parse Response**: Extracts JSON from response (handles markdown formatting)
5. **Validate Data**: Normalizes change types, handles missing fields
6. **Fallback**: Uses heuristics if Copilot fails (pattern matching on PR title)
7. **Format**: Converts to markdown for PR comment

### Fallback Strategy

If Copilot analysis fails, the service falls back to heuristics:
- Detects change type from PR title keywords (fix → bug, feat → feature, etc.)
- Uses generic testing suggestion
- Returns empty impact areas

## Usage

### Manual Testing

Test the template generation locally:

```bash
# Get your token
GITHUB_TOKEN=$(gh auth token) bun run src/copilot/generate/test-local.ts \
  --owner your-org \
  --repo your-repo \
  --pr 42 \
  --type template
```

### In GitHub Actions

The workflow automatically runs when a PR is created. To manually test:

1. Push a branch with changes
2. Open a PR against `main`
3. Wait for workflows to complete:
   - **Copilot PR Template Auto-fill** (runs on opened)
   - **Copilot PR Summary** (runs on opened + synchronize)
4. Check PR comments for:
   - Template suggestions (from auto-fill workflow)
   - Summary (from summary workflow)

### Custom Prompts

To customize the analysis, modify the prompt in `TemplateService.generateTemplateFields()`:

```typescript
const analysisPrompt = `Analyze this PR and extract structured information...`
```

## Integration with Existing Features

### PR Summary Workflow (Unchanged)
- Still generates summaries on `opened`, `synchronize`, `reopened` events
- Posts/updates summary comment with model info
- Works alongside template auto-fill (both can post comments)

### Override Mechanisms

Users can override the model used for both workflows:

**For template auto-fill** (edit `.github/workflows/copilot-pr-autofill.yml`):
```yaml
- name: Generate template suggestions
  uses: ./.github/actions/copilot
  with:
    model: gpt-5-mini  # or any available model
    options: '{"type":"template"}'
```

**For summary** (edit `.github/workflows/copilot-pr-summary.yml`):
```yaml
- name: Generate PR summary
  uses: ./.github/actions/copilot
  with:
    model: gpt-5-mini
    options: '{"type":"summary"}'
```

Both use the default model from `src/shared/constants.ts` if not specified.

## Performance Considerations

| Aspect | Notes |
|--------|-------|
| **Speed** | Template generation typically completes in 10-30 seconds |
| **Cost** | Uses `gpt-5-mini` (cost-effective) |
| **Triggers** | Runs once per PR (on opened event only) |
| **Concurrency** | No concurrency config (lightweight) |

## Troubleshooting

### Auto-fill comment doesn't appear

❌ Workflow may not have run yet.

✅ **Check:**
1. Go to PR → **Actions** tab
2. Look for **Copilot PR Template Auto-fill** workflow
3. Check for errors in the workflow run
4. Verify `COPILOT_TOKEN` secret is set correctly

### Template analysis seems inaccurate

❌ Copilot may have generated low-quality analysis.

✅ **Check:**
1. PR title and diff are clear and descriptive
2. Try re-running workflow (Actions tab → workflow run → re-run)
3. Check token has active Copilot subscription
4. Consider testing with a different PR

### "Template not found" error

❌ `.github/pull_request_template.md` may be missing.

✅ **Fix:** Ensure the PR template file exists and is committed to `main` branch.

## Future Enhancements

1. **Multi-turn refinement**: Allow users to ask Copilot questions about suggestions
2. **Auto-apply**: Button to auto-fill PR description with suggestions (requires different approach)
3. **Custom templates**: Per-team or per-project template formats
4. **Validation**: Check for required fields before PR merge
5. **Analytics**: Track which suggestions users adopt
6. **Integration**: Link to project/epic during PR creation

## See Also

- [Copilot PR Summary Workflow](./pr-summary-workflow.md)
- [Copilot Chat & Sessions Guide](./chat-and-sessions.md)
- [Copilot SDK Documentation](https://github.com/github/copilot-sdk)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
