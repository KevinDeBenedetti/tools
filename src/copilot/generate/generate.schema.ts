import { z } from "zod";

export const generateInputSchema = z.object({
  /** What to generate. */
  type: z.enum(["tests", "docs", "changelog", "summary"]).default("summary"),
  /** The file path to target (relative to repo root). */
  filePath: z.string().optional(),
  /** Custom instructions for the generation. */
  instructions: z.string().optional(),
  /** Output format. */
  format: z.enum(["markdown", "typescript", "json"]).default("markdown"),
});

export type GenerateInput = z.infer<typeof generateInputSchema>;
