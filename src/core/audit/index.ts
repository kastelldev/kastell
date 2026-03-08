/**
 * Audit runner orchestrator.
 * Builds SSH commands, executes them, parses results, and calculates scores.
 */

import type { KastellResult } from "../../types/index.js";
import type { AuditResult } from "./types.js";
import { buildAuditBatchCommands } from "./commands.js";
import { calculateOverallScore } from "./scoring.js";
import { parseAllChecks } from "./checks/index.js";
import { sshExec } from "../../utils/ssh.js";

/**
 * Run a full server security audit.
 *
 * 1. Build SSH batch commands for the target platform
 * 2. Execute each batch via SSH (with per-batch error handling)
 * 3. Split output into sections and route to category parsers
 * 4. Calculate per-category and overall scores
 * 5. Return AuditResult wrapped in KastellResult
 */
export async function runAudit(
  ip: string,
  serverName: string,
  platform: string,
): Promise<KastellResult<AuditResult>> {
  try {
    const batchCommands = buildAuditBatchCommands(platform);
    const batchOutputs: string[] = [];

    // Execute each batch — handle partial failures gracefully
    for (const cmd of batchCommands) {
      try {
        const result = await sshExec(ip, cmd);
        batchOutputs.push(result.stdout);
      } catch {
        // If a batch fails, push empty string so section indexing stays aligned
        batchOutputs.push("");
      }
    }

    // Parse all batch outputs through the check registry
    const categories = parseAllChecks(batchOutputs, platform);
    const overallScore = calculateOverallScore(categories);

    const auditResult: AuditResult = {
      serverName,
      serverIp: ip,
      platform: platform as AuditResult["platform"],
      timestamp: new Date().toISOString(),
      categories,
      overallScore,
      quickWins: [], // Plan 03+ will populate quick wins
    };

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
