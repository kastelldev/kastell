/**
 * Audit runner orchestrator.
 * Builds SSH commands, executes them, parses results, and calculates scores.
 */

import type { KastellResult } from "../../types/index.js";
import type { AuditResult } from "./types.js";
import { buildAuditBatchCommands, BATCH_TIMEOUTS } from "./commands.js";
import { calculateOverallScore } from "./scoring.js";
import { parseAllChecks, mergeComplianceRefs } from "./checks/index.js";
import { COMPLIANCE_MAP } from "./compliance/mapper.js";
import { sshExec } from "../../utils/ssh.js";
import { calculateQuickWins } from "./quickwin.js";
import { AUDIT_VERSION } from "../../constants.js";

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

    // Execute each batch with its tier-specific timeout
    for (const batch of batches) {
      try {
        const result = await sshExec(ip, batch.command, {
          timeoutMs: BATCH_TIMEOUTS[batch.tier],
        });
        batchOutputs.push(result.stdout);
      } catch {
        // If a batch fails, push empty string so name-keyed routing stays safe
        batchOutputs.push("");
      }
    }

    // Parse all batch outputs through the check registry
    const rawCategories = parseAllChecks(batchOutputs, platform);
    const categories = mergeComplianceRefs(rawCategories, COMPLIANCE_MAP);
    const overallScore = calculateOverallScore(categories);

    const auditResult: AuditResult = {
      serverName,
      serverIp: ip,
      platform: platform as AuditResult["platform"],
      timestamp: new Date().toISOString(),
      auditVersion: AUDIT_VERSION,
      categories,
      overallScore,
      quickWins: [],
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
