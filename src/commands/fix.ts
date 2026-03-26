import chalk from "chalk";
import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { logger, createSpinner } from "../utils/logger.js";
import { runAudit } from "../core/audit/index.js";
import {
  previewSafeFixes,
  runScoreCheck,
  KNOWN_AUDIT_FIX_PREFIXES,
} from "../core/audit/fix.js";
import { backupServer } from "../core/backup.js";

/**
 * `kastell fix --safe` command.
 * Applies only SAFE tier fixes with mandatory backup-first execution.
 * --dry-run previews fixes without applying or creating backup.
 */
export async function fixSafeCommand(
  query: string | undefined,
  options: { safe?: boolean; dryRun?: boolean; category?: string },
): Promise<void> {
  // Gate check (D-06): --safe flag is required
  if (!options.safe) {
    logger.info("Usage: kastell fix --safe --server <name>");
    logger.info(
      "  --safe     Apply only SAFE tier fixes (no service restarts)",
    );
    logger.info("  --dry-run  Preview fixes without applying");
    logger.info(
      "  --guarded  Apply GUARDED tier fixes (available in v1.16)",
    );
    return;
  }

  // Resolve the target server
  const server = await resolveServer(query, "Select a server to fix:");
  if (!server) return;

  const { ip, name } = server;
  const platform = server.platform ?? server.mode ?? "bare";

  // Pre-flight SSH check
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  // Run audit to get current state
  const auditSpinner = createSpinner("Running security audit...");
  auditSpinner.start();
  const result = await runAudit(ip, name, platform);
  auditSpinner.stop();

  if (!result.success || !result.data) {
    logger.error(
      `Audit failed: ${result.error ?? "unknown error"}`,
    );
    if (result.hint) logger.info(result.hint);
    return;
  }

  const auditResult = result.data;

  // Filter SAFE fixes
  const { safePlan, guardedCount, forbiddenCount, guardedIds } =
    previewSafeFixes(auditResult);

  // Check if anything to fix
  const safeCount = safePlan.groups.reduce(
    (sum, g) => sum + g.checks.length,
    0,
  );
  if (safeCount === 0) {
    logger.info("No SAFE tier fixes available.");
    if (guardedCount > 0) {
      logger.info(
        `  ${guardedCount} GUARDED fix(es) available (requires --guarded in v1.16)`,
      );
    }
    if (forbiddenCount > 0) {
      logger.info(
        `  ${forbiddenCount} FORBIDDEN fix(es) (SSH/Firewall/Docker — manual only)`,
      );
    }
    return;
  }

  // Render preview (always shown before dry-run or live)
  const totalEstimatedImpact = safePlan.groups.reduce(
    (sum, g) => sum + g.estimatedImpact,
    0,
  );

  logger.title("Safe Fix Preview");
  logger.info("");
  logger.info(
    `  SAFE fixes to apply:  ${safeCount} checks (+${totalEstimatedImpact} pts estimated)`,
  );
  logger.info(
    "  ──────────────────────────────────────────────",
  );

  for (const group of safePlan.groups) {
    for (const check of group.checks) {
      const severityColor =
        check.severity === "critical"
          ? chalk.red
          : check.severity === "warning"
            ? chalk.yellow
            : chalk.blue;
      logger.info(
        `  ${severityColor(`[${check.severity}]`.padEnd(12))} ${check.id.padEnd(22)} ${check.category} / ${check.name}`,
      );
    }
  }

  logger.info("");

  if (guardedCount > 0) {
    logger.info(
      `  GUARDED fixes (not applied \u2014 requires --guarded in v1.16):  ${guardedCount} checks`,
    );
    logger.info(`    ${guardedIds.join(", ")}`);
  }

  if (forbiddenCount > 0) {
    logger.info(
      `  FORBIDDEN (SSH/Firewall/Docker \u2014 manual only):  ${forbiddenCount} checks`,
    );
  }

  // Dry-run exit (FIX-05): show preview only, no backup or fixes
  if (options.dryRun) {
    return;
  }

  // Confirm with user
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Apply ${safeCount} SAFE fix(es)? (backup will be created first)`,
      default: false,
    },
  ]);
  if (!confirm) return;

  // Backup (FIX-03, D-07 hard abort)
  const backupSpinner = createSpinner("Creating backup...");
  backupSpinner.start();
  const backup = await backupServer(server);
  backupSpinner.stop();

  if (!backup.success) {
    logger.error(
      `Backup failed \u2014 cannot proceed: ${backup.error ?? "unknown error"}`,
    );
    if (backup.hint) logger.info(backup.hint);
    logger.info(
      "Run 'kastell backup <server>' manually to diagnose the issue.",
    );
    return; // Hard abort, no escape hatch (D-07)
  }
  logger.success(`Backup saved to: ${backup.backupPath}`);

  // Apply SAFE fixes
  const fixSpinner = createSpinner("Applying safe fixes...");
  fixSpinner.start();
  const applied: string[] = [];
  const errors: string[] = [];

  for (const group of safePlan.groups) {
    for (const check of group.checks) {
      try {
        // Pre-condition check (lockout prevention)
        if (check.preCondition) {
          const preCheck = await sshExec(ip, raw(check.preCondition));
          if (preCheck.code !== 0) {
            errors.push(`${check.id}: pre-condition failed`);
            continue;
          }
        }
        // Shell metachar guard (existing pattern from fix.ts)
        const SHELL_METACHAR = /[;&|`$()><]/;
        const isKnown = KNOWN_AUDIT_FIX_PREFIXES.some((p) =>
          check.fixCommand.startsWith(p),
        );
        if (!isKnown || SHELL_METACHAR.test(check.fixCommand)) {
          errors.push(`${check.id}: fix command rejected`);
          continue;
        }
        const sshResult = await sshExec(ip, raw(check.fixCommand));
        if (sshResult.code !== 0) {
          errors.push(
            `${check.id}: command failed (exit ${sshResult.code})`,
          );
        } else {
          applied.push(check.id);
        }
      } catch (err) {
        errors.push(
          `${check.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  fixSpinner.stop();

  // Display results
  if (applied.length > 0)
    logger.success(`Fixed: ${applied.join(", ")}`);
  if (errors.length > 0)
    logger.error(`Errors: ${errors.join("; ")}`);

  // Post-fix score delta (FIX-04)
  if (applied.length > 0) {
    const scoreSpinner = createSpinner("Verifying score...");
    scoreSpinner.start();
    const affectedCats = [
      ...new Set(
        applied
          .map((checkId) => {
            for (const cat of auditResult.categories) {
              if (cat.checks.some((ch) => ch.id === checkId))
                return cat.name;
            }
            return undefined;
          })
          .filter((n): n is string => n !== undefined),
      ),
    ];
    const newScore = await runScoreCheck(
      ip,
      platform,
      auditResult,
      affectedCats,
    );
    scoreSpinner.stop();
    if (newScore !== null) {
      const delta = newScore - auditResult.overallScore;
      const sign = delta >= 0 ? "+" : "";
      logger.success(
        `Score: ${auditResult.overallScore} \u2192 ${newScore} (${sign}${delta})`,
      );
    }
  }
}
