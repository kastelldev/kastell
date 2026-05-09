import { getFullCheckCatalog, findCheckById } from "../../core/audit/explainCheck.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

export function readCheckCatalog(): ReadResourceResult {
  const catalog = getFullCheckCatalog();
  const checks = catalog.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    severity: c.severity,
  }));

  return {
    contents: [{
      uri: "kastell://checks",
      mimeType: "application/json",
      text: JSON.stringify({ checks, totalCount: checks.length }),
    }],
  };
}

export function readCheckDetail(checkId: string): ReadResourceResult {
  const { match, suggestions } = findCheckById(checkId);

  if (!match) {
    return {
      contents: [{
        uri: `kastell://checks/${checkId}`,
        mimeType: "application/json",
        text: JSON.stringify({
          error: `Check not found: ${checkId}`,
          suggestions: suggestions ?? [],
        }),
      }],
    };
  }

  return {
    contents: [{
      uri: `kastell://checks/${match.id}`,
      mimeType: "application/json",
      text: JSON.stringify({
        id: match.id,
        name: match.name,
        category: match.category,
        severity: match.severity,
        explain: match.explain,
        fixCommand: match.fixCommand ?? null,
        fixTier: match.fixTier,
        complianceRefs: match.complianceRefs,
      }),
    }],
  };
}
