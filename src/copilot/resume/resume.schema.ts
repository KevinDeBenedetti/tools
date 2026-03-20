import { z } from "zod";

export const resumeInputSchema = z.object({
  sessionId: z
    .string()
    .optional()
    .describe(
      "Session ID to resume. Defaults to pr-{prNumber}. Must match a previously created session.",
    ),
  prompt: z
    .string()
    .min(1)
    .describe("Follow-up instruction or question to send to the resumed Copilot session."),
  focus: z
    .string()
    .optional()
    .describe('Specific area to focus on (e.g., "security", "performance").'),
});

export type ResumeInput = z.infer<typeof resumeInputSchema>;
