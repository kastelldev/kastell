import { z } from "zod";

/** Strict Zod schema for the P142 PluginCheckSkipReason union (P142 Task 4). */
export const PluginCheckSkipReasonSchema = z.object({
  code: z.literal("legacy-mutating"),
  apiVersion: z.literal("2"),
  kind: z.enum(["mutate-local", "mutate-global"]),
});

export const AuditCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  severity: z.string(),
  passed: z.boolean().optional(),
  currentValue: z.string().optional(),
  expectedValue: z.string().optional(),
  details: z.string().optional(),
  skip: PluginCheckSkipReasonSchema.optional(),
});

export const AuditCategorySchema = z.object({
  name: z.string(),
  score: z.number(),
  maxScore: z.number(),
  checks: z.array(AuditCheckSchema).optional(),
});

export const ComplianceControlSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.string(),
});

export type AuditCheck = z.infer<typeof AuditCheckSchema>;
export type AuditCategory = z.infer<typeof AuditCategorySchema>;
