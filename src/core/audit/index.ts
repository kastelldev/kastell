/**
 * Audit runner orchestrator.
 * Builds SSH commands, executes them, parses results, and calculates scores.
 */

import type { KastellResult } from "../../types/index.js";
import type { AuditCategory, AuditResult } from "./types.js";
import { buildAuditBatchCommands, BATCH_TIMEOUTS } from "./commands.js";
import { calculateOverallScore, calculateCategoryScore } from "./scoring.js";
import { parseAllChecks, mergeComplianceRefs } from "./checks/index.js";
import { COMPLIANCE_MAP } from "./compliance/mapper.js";
import { sshExec } from "../../utils/ssh.js";
import { raw } from "../../utils/sshCommand.js";
import { calculateQuickWins } from "./quickwin.js";
import { extractVpsType, applyVpsAdjustments } from "./vps.js";
import { AUDIT_VERSION } from "../../constants.js";

/**
 * Detect categories where all checks have "not installed" or "N/A" currentValue.
 * Empty categories (0 checks) are not considered skipped.
 * Used to show informative "Skipped: X (not installed)" lines without affecting scores.
 */
export function detectSkippedCategories(categories: AuditCategory[]): string[] {
  const skipped: string[] = [];
  for (const cat of categories) {
    if (cat.checks.length === 0) continue;  // Empty categories are not "skipped"
    const allSkipped = cat.checks.every(
      (c) => c.currentValue.includes("not installed") || c.currentValue === "N/A",
    );
    if (allSkipped) skipped.push(cat.name);
  }
  return skipped;
}

/**
 * Run a full server security audit.
 *
 * 1. Build SSH batch commands for the target platform
 * 2. Execute each batch via SSH with per-batch timeout
 * 3. Parse output sections by name and route to category parsers
 * 4. Calculate per-category and overall scores
 * 5. Return AuditResult wrapped in KastellResult
 */
export async function runAudit(
  ip: string,
  serverName: string,
  platform: string,
): Promise<KastellResult<AuditResult>> {
  try {
    const batches = buildAuditBatchCommands(platform);
    const batchOutputs: string[] = [];
    const batchErrors: Array<{ tier: string; error: string }> = [];

    // Execute each batch with its tier-specific timeout
    for (const batch of batches) {
      try {
        const result = await sshExec(ip, raw(batch.command), {
          timeoutMs: BATCH_TIMEOUTS[batch.tier],
          useStdin: true,
        });
        batchOutputs.push(result.stdout);
      } catch (batchErr) {
        // Track which batch failed and why
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
        batchErrors.push({ tier: batch.tier, error: msg });
        batchOutputs.push("");
      }
    }

    // Parse all batch outputs through the check registry
    const rawCategories = parseAllChecks(batchOutputs, platform);
    const categories = mergeComplianceRefs(rawCategories, COMPLIANCE_MAP);

    // VPS detection: extract type from batch outputs, adjust severity before scoring
    const vpsType = extractVpsType(batchOutputs);
    const { categories: adjustedCategories, adjustedCount } = applyVpsAdjustments(categories, vpsType);

    // Mark categories from failed batches as connectionError.
    // Uses check-content heuristic (all checks "Unable to determine" or empty) rather than
    // tier-to-category mapping because the batch→category relationship is N:M — one batch
    // can produce checks across multiple categories. The batchErrors guard ensures this
    // only triggers when an actual SSH batch failure occurred.
    if (batchErrors.length > 0) {
      for (const cat of adjustedCategories) {
        const allUndetermined = cat.checks.length > 0 && cat.checks.every(
          (c) => !c.passed && (c.currentValue === "Unable to determine" || c.currentValue === ""),
        );
        if (allUndetermined) {
          (cat as AuditCategory).connectionError = true;
        }
      }
    }

    // Recalculate scores after VPS adjustment (severity changes affect weights)
    const finalCategories = adjustedCategories.map((cat) => {
      // Exclude connection-error categories from scoring
      if (cat.connectionError) {
        return { ...cat, score: 0, maxScore: 0 };
      }
      const { score, maxScore } = calculateCategoryScore(cat.checks);
      return { ...cat, score, maxScore };
    });

    const overallScore = calculateOverallScore(finalCategories);
    const skippedCategories = detectSkippedCategories(finalCategories);

    // Build warnings from batch errors
    const warnings: string[] = batchErrors.map(
      (e) => `SSH ${e.tier} batch failed: ${e.error}`,
    );

    const auditResult: AuditResult = {
      serverName,
      serverIp: ip,
      platform: platform as AuditResult["platform"],
      timestamp: new Date().toISOString(),
      auditVersion: AUDIT_VERSION,
      categories: finalCategories,
      overallScore,
      quickWins: [],
      ...(skippedCategories.length > 0 ? { skippedCategories } : {}),
      ...(vpsType ? { vpsType, vpsAdjustedCount: adjustedCount } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    auditResult.quickWins = calculateQuickWins(auditResult);

    return { success: true, data: auditResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Audit failed: ${message}`,
      hint: "Ensure SSH access to the server is configured correctly",
    };
  }
}
