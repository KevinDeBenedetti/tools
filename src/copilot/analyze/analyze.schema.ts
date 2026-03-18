import { z } from "zod";

export const analyzeInputSchema = z.object({
  /** What to analyze. */
  target: z.enum(["security", "performance", "quality", "all"]).default("all"),
  /** Custom instructions appended to the system prompt. */
  instructions: z.string().optional(),
  /** Extra context (e.g. architecture notes) injected into the prompt. */
  context: z.string().optional(),
});

export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;
