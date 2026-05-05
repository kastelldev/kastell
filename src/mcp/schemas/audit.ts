import { z } from "zod";

export const AuditCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  severity: z.string(),
  passed: z.boolean().optional(),
  currentValue: z.string().optional(),
  expectedValue: z.string().optional(),
  details: z.string().optional(),
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
