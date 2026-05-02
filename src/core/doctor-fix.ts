/**
 * Doctor fix engine — interactive SSH remediation for doctor findings.
 *
 * Supports three modes:
 *   dry-run  : Print fix commands without executing any SSH.
 *   force    : Execute all fixable findings without prompting.
 *   interactive: Prompt per-finding before executing.
 *
 * Safety rule: --dry-run always wins over --force.
 * Dispatch: all fixable findings are routed through resolveHandlerChain (D-01).
 */

import inquirer from "inquirer";
import { assertValidIp } from "../utils/ssh.js";
import { resolveHandlerChain, executeHandlerChain } from "./audit/handlers/index.js";
import { saveFixHistory } from "./audit/fix-history.js";
import type { DoctorFinding } from "./doctor.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DoctorFixOptions {
  dryRun: boolean;
  force: boolean;
}

export interface DoctorFixResult {
  /** Finding IDs successfully fixed via handler chain. */
  applied: string[];
  /** Finding IDs skipped (user declined or not auto-fixable). */
  skipped: string[];
  /** Finding IDs where handler failed or format unknown (entry: "ID: reason"). */
  failed: string[];
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run doctor fix for a list of findings on the given server IP.
 *
 * Throws synchronously if `ip` is invalid (from assertValidIp).
 * All handler errors are caught and recorded in `failed` — never rethrown.
 */
export async function runDoctorFix(
  ip: string,
  findings: DoctorFinding[],
  options: DoctorFixOptions,
  serverName?: string,
): Promise<DoctorFixResult> {
  assertValidIp(ip);

  const applied: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  // dry-run wins even when force is also set (safety wins)
  if (options.dryRun) {
    for (const finding of findings) {
      skipped.push(finding.id);
    }
    return { applied, skipped, failed };
  }

  for (const finding of findings) {
    if (!finding.fixCommand) {
      skipped.push(finding.id);
      continue;
    }

    const chain = resolveHandlerChain(finding.fixCommand);
    if (chain === null) {
      failed.push(`${finding.id}: Unknown handler format: "${finding.fixCommand}"`);
      continue;
    }

    if (!options.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `[${finding.severity.toUpperCase()}] ${finding.description}\n  Fix command: ${finding.fixCommand}\n  Apply this fix?`,
          default: false,
        },
      ]);

      if (!confirm) {
        skipped.push(finding.id);
        continue;
      }
    }

    try {
      const handlerResult = await executeHandlerChain(ip, chain);
      if (handlerResult.success) {
        applied.push(finding.id);
      } else {
        failed.push(`${finding.id}: ${handlerResult.error ?? "handler failed"}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push(`${finding.id}: ${message}`);
    }
  }

  if (applied.length > 0 && !options.dryRun) {
    await saveFixHistory({
      fixId: `doctor-fix-${Date.now()}`,
      serverIp: ip,
      serverName: serverName ?? ip,
      timestamp: new Date().toISOString(),
      checks: applied,
      scoreBefore: 0,
      scoreAfter: null,
      status: "applied",
      source: "doctor",
    });
  }

  return { applied, skipped, failed };
}
