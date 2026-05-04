import { z } from "zod";
import { findCheckById, formatSuggestions } from "../../core/audit/explainCheck.js";
import { mcpError, mcpSuccess } from "../utils.js";

export const serverExplainSchema = z.object({
  checkId: z.string().describe("Audit check ID to explain (e.g. SSH-PASSWORD-AUTH). Case-insensitive, fuzzy matching supported."),
});

type ServerExplainParams = z.infer<typeof serverExplainSchema>;

export const serverExplainOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  severity: z.string(),
  description: z.string(),
  fix: z.string(),
  why: z.string(),
  fixTier: z.string(),
  compliance: z.array(z.object({
    framework: z.string(),
    controlId: z.string(),
    description: z.string(),
  })).optional(),
});

type ServerExplainOutput = z.infer<typeof serverExplainOutputSchema>;

export async function serverExplainHandler(params: ServerExplainParams) {
  const result = findCheckById(params.checkId);

  if (!result.match) {
    return mcpError(
      `Unknown check ID: ${params.checkId}. ${formatSuggestions(result.suggestions)}`,
      "Use server_audit with listChecks action or kastell audit --list-checks to see all available check IDs.",
    );
  }

  const data: ServerExplainOutput = {
    id: result.match.id,
    name: result.match.name,
    category: result.match.category,
    severity: result.match.severity,
    description: result.match.explain,
    fix: result.match.fixCommand ?? "",
    why: "",
    fixTier: result.match.fixTier,
    compliance: result.match.complianceRefs?.map((ref) => ({
      framework: ref.framework,
      controlId: ref.controlId,
      description: ref.description,
    })),
  };
  return mcpSuccess(data);
}
