import { z } from "zod";

export const reviewInputSchema = z.object({
  event: z
    .enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"])
    .default("COMMENT")
    .describe("Review event type"),
  focus: z
    .string()
    .optional()
    .describe('Specific areas to focus on (e.g., "security", "performance")'),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;
