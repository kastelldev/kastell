/**
 * Doctor fix engine — interactive SSH remediation for doctor findings.
 *
 * Supports three modes:
 *   dry-run  : Print fix commands without executing any SSH.
 *   force    : Execute all fixable findings without prompting.
 *   interactive: Prompt per-finding before executing.
 *
 * Safety rule: --dry-run always wins over --force.
 */

import inquirer from "inquirer";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import type { DoctorFinding } from "./doctor.js";

/** Whitelist of known safe fix commands produced by doctor checks */
const KNOWN_FIX_COMMANDS = new Set([
  "sudo apt update && sudo apt upgrade -y",
  "docker system prune -a --force",
]);

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DoctorFixOptions {
  dryRun: boolean;
  force: boolean;
}

export interface DoctorFixResult {
  /** Finding IDs successfully fixed via SSH. */
  applied: string[];
  /** Finding IDs skipped (user declined or not auto-fixable). */
  skipped: string[];
  /** Finding IDs where sshExec failed (entry: "ID: reason"). */
  failed: string[];
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run doctor fix for a list of findings on the given server IP.
 *
 * Throws synchronously if `ip` is invalid (from assertValidIp).
 * All SSH errors are caught and recorded in `failed` — never rethrown.
 */
export async function runDoctorFix(
  ip: string,
  findings: DoctorFinding[],
  options: DoctorFixOptions,
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

    if (!KNOWN_FIX_COMMANDS.has(finding.fixCommand)) {
      failed.push(`${finding.id}: unrecognized fix command`);
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
      const result = await sshExec(ip, finding.fixCommand);
      if (result.code !== 0) {
        const reason = result.stderr?.trim()
          ? `exit ${result.code} — ${result.stderr.trim()}`
          : `exit ${result.code}`;
        failed.push(`${finding.id}: ${reason}`);
      } else {
        applied.push(finding.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push(`${finding.id}: ${message}`);
    }
  }

  return { applied, skipped, failed };
}
