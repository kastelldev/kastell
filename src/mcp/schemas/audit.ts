import { z } from "zod";

/**
 * P144 T6: PluginCheckSkipReason union (legacy-mutating + active-probe).
 * Used as the `skip` field value on AuditCheckSchema — the parent schema
 * (AuditCheckSchema) is the object-shape that MCP SDK normalizeObjectSchema
 * accepts. Inline discriminatedUnion here mirrors the serverAuditOutputSchema
 * pattern (`z.object({ result: z.discriminatedUnion(...) })`).
 */
export const PluginCheckSkipReasonSchema = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("legacy-mutating"),
    apiVersion: z.literal("2"),
    kind: z.enum(["mutate-local", "mutate-global"]),
  }),
  z.object({
    code: z.literal("active-probe"),
    apiVersion: z.literal("3"),
  }),
]);

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
