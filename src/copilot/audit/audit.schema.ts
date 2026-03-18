import { z } from "zod";

export const auditInputSchema = z.object({
  /** What to audit. */
  scope: z.enum(["dependencies", "secrets", "licenses", "all"]).default("all"),
  /** Fail the action if any issue of this severity or higher is found. */
  failOn: z.enum(["critical", "high", "medium", "low", "none"]).default("high"),
  /** Custom instructions. */
  instructions: z.string().optional(),
});

export type AuditInput = z.infer<typeof auditInputSchema>;
