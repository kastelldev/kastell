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
  isFixCommandAllowed,
  collectFixCommands,
} from "../core/audit/fix.js";
import { backupServer } from "../core/backup.js";
import {
  loadFixHistory,
  saveFixHistory,
  generateFixId,
  getLastFixId,
  backupFilesBeforeFix,
  rollbackFix,
  backupRemoteCleanup,
} from "../core/audit/fix-history.js";

/**
 * `kastell fix --safe` command.
 * Applies only SAFE tier fixes with mandatory backup-first execution.
 * --dry-run previews fixes without applying or creating backup.
 * --rollback <id|last> restores files from a previous fix backup.
 * --history shows the last 20 fix operations for the server.
 */
export async function fixSafeCommand(
  query: string | undefined,
  options: {
    safe?: boolean;
    dryRun?: boolean;
    category?: string;
    rollback?: string;
    history?: boolean;
  },
): Promise<void> {
  // ── History display (FIXPRO-02) ──────────────────────────────────────────
  if (options.history) {
    const server = await resolveServer(query, "Select a server:");
    if (!server) return;

    const entries = loadFixHistory(server.ip);
    if (entries.length === 0) {
      logger.info("No fix history found for this server.");
      return;
    }

    // Show last 20 entries
    const recent = entries.slice(-20);
    logger.title("Fix History");
    logger.info("");
    logger.info(
      `  ${"ID".padEnd(24)} ${"Date".padEnd(12)} ${"Checks".padEnd(8)} ${"Score".padEnd(14)} Status`,
    );
    logger.info(`  ${"─".repeat(70)}`);
    for (const entry of recent) {
      const delta =
        entry.scoreAfter !== null
          ? `${entry.scoreBefore}→${entry.scoreAfter}`
          : `${entry.scoreBefore}→-`;
      const statusColor =
        entry.status === "applied"
          ? chalk.green
          : entry.status === "rolled-back"
            ? chalk.yellow
            : chalk.red;
      logger.info(
        `  ${entry.fixId.padEnd(24)} ${entry.timestamp.slice(0, 10).padEnd(12)} ${String(entry.checks.length).padEnd(8)} ${delta.padEnd(14)} ${statusColor(entry.status)}`,
      );
    }
    return;
  }

  // ── Rollback (FIXPRO-01, D-06, D-07) ────────────────────────────────────
  if (options.rollback) {
    const server = await resolveServer(query, "Select a server to rollback:");
    if (!server) return;

    const { ip, name } = server;
    const platform = server.platform ?? server.mode ?? "bare";

    // Resolve fix ID (per D-07: 'last' shortcut)
    let fixId = options.rollback;
    if (fixId === "last") {
      const lastId = getLastFixId(ip);
      if (!lastId) {
        logger.error("No applied fixes found for this server.");
        return;
      }
      fixId = lastId;
      logger.info(`Resolving 'last' to: ${fixId}`);
    }

    // Find history entry
    const entries = loadFixHistory(ip);
    const entry = entries.find((e) => e.fixId === fixId && e.status === "applied");
    if (!entry) {
      logger.error(`Fix not found or already rolled back: ${fixId}`);
      return;
    }

    // Pre-flight SSH check
    if (!checkSshAvailable()) {
      logger.error("SSH client not found. Please install OpenSSH.");
      return;
    }

    // Rollback
    const rollbackSpinner = createSpinner(`Rolling back ${fixId}...`);
    rollbackSpinner.start();
    const { restored, errors: rollbackErrors } = await rollbackFix(
      ip,
      fixId,
      entry.backupPath,
    );
    rollbackSpinner.stop();

    if (restored.length > 0) {
      logger.success(`Restored: ${restored.join(", ")}`);
    }
    if (rollbackErrors.length > 0) {
      logger.error(`Errors: ${rollbackErrors.join("; ")}`);
    }

    // Post-rollback score check (Pitfall 6 from research)
    let scoreAfter: number | null = null;
    if (restored.length > 0) {
      const scoreSpinner = createSpinner("Verifying score...");
      scoreSpinner.start();
      const auditRes = await runAudit(ip, name, platform);
      scoreSpinner.stop();
      if (auditRes.success && auditRes.data) {
        scoreAfter = auditRes.data.overallScore;
        const delta = scoreAfter - (entry.scoreAfter ?? entry.scoreBefore);
        const sign = delta >= 0 ? "+" : "";
        logger.info(
          `Score: ${entry.scoreAfter ?? entry.scoreBefore} → ${scoreAfter} (${sign}${delta})`,
        );
      }
    }

    // Update history entry to rolled-back
    await saveFixHistory({
      fixId: `${fixId}-rollback`,
      serverIp: ip,
      serverName: name,
      timestamp: new Date().toISOString(),
      checks: entry.checks,
      scoreBefore: entry.scoreAfter ?? entry.scoreBefore,
      scoreAfter,
      status: "rolled-back",
      backupPath: entry.backupPath,
    });

    return;
  }

  // Gate check (D-06): --safe flag is required
  if (!options.safe) {
    logger.info("Usage: kastell fix --safe --server <name>");
    logger.info(
      "  --safe              Apply only SAFE tier fixes (no service restarts)",
    );
    logger.info("  --dry-run           Preview fixes without applying");
    logger.info("  --rollback <id>     Rollback a fix by ID (or 'last')");
    logger.info("  --history           Show fix history for server");
    logger.info(
      "  --guarded           Apply GUARDED tier fixes (available in v1.16)",
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

  // Generate fix ID and create remote backup (per D-01, D-03)
  const fixId = generateFixId(ip);
  const fixCommands = collectFixCommands(safePlan);
  const remoteBackupSpinner = createSpinner("Creating remote file backup...");
  remoteBackupSpinner.start();
  const remoteBackupPath = await backupFilesBeforeFix(ip, fixId, fixCommands);
  remoteBackupSpinner.stop();

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
        // Whitelist + shell metachar guard
        if (!isFixCommandAllowed(check.fixCommand)) {
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
  let newScore: number | null = null;
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
    newScore = await runScoreCheck(
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

  // Save to fix history (FIXPRO-02)
  await saveFixHistory({
    fixId,
    serverIp: ip,
    serverName: name,
    timestamp: new Date().toISOString(),
    checks: applied,
    scoreBefore: auditResult.overallScore,
    scoreAfter: newScore,
    status: applied.length > 0 ? "applied" : "failed",
    backupPath: remoteBackupPath,
  });

  // Prune old backups (retention policy)
  await backupRemoteCleanup(ip);
}
