import chalk from "chalk";
import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { severityChalk } from "../core/audit/formatters/shared.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { logger, createSpinner } from "../utils/logger.js";
import { runAudit } from "../core/audit/index.js";
import {
  previewSafeFixes,
  runScoreCheck,
  isFixCommandAllowed,
  sortChecksByImpact,
  selectChecksForTop,
  selectChecksForTarget,
  fixCommandsFromChecks,
  type ScoredFixCheck,
} from "../core/audit/fix.js";
import { tryHandlerDispatch, type CollectedDiff } from "../core/audit/handlers/index.js";
import { buildImpactContext } from "../core/audit/scoring.js";
import { filterChecksByProfile, isValidProfile, listAllProfileNames } from "../core/audit/profiles.js";
import { writeFixReport } from "../utils/fixReport.js";
import { backupServer } from "../core/backup.js";
import { classifyError } from "../utils/errorMapper.js";
import {
  loadFixHistory,
  saveFixHistory,
  saveRollbackEntry,
  generateFixId,
  backupFilesBeforeFix,
  rollbackFix,
  backupRemoteCleanup,
  rollbackAllFixes,
  rollbackToFix,
} from "../core/audit/fix-history.js";
import { saveBaseline, loadBaseline, checkRegression } from "../core/audit/regression.js";

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
    checks?: string;
    rollback?: string;
    rollbackAll?: boolean;
    rollbackTo?: string;
    history?: boolean;
    top?: string;
    target?: string;
    profile?: string;
    diff?: boolean;
    report?: boolean;
    interactive?: boolean;
  },
): Promise<void> {
  // ── Flag validation (D-08, D-03, D-11, D-05, D-13) ─────────────────────────
  if (options.top !== undefined && options.target !== undefined) {
    logger.error("--top ve --target birlikte kullanilamaz. Birini secin.");
    return;
  }
  if ((options.top !== undefined || options.target !== undefined) && !options.safe) {
    logger.error("--top / --target sadece --safe ile kullanilir.");
    return;
  }
  // --profile requires --safe (per D-05)
  if (options.profile !== undefined && !options.safe) {
    logger.error("--profile requires --safe. Run: kastell fix --safe --profile <name> --server <server>");
    return;
  }
  // --report requires --safe (per D-13)
  if (options.report && !options.safe) {
    logger.error("--report requires --safe. Run: kastell fix --safe --report --server <server>");
    return;
  }
  // ── Rollback mutual exclusion (FIX-01, FIX-02) ───────────────────────────
  const rollbackFlags = [options.rollback, options.rollbackAll, options.rollbackTo].filter(Boolean).length;
  if (rollbackFlags > 1) {
    logger.error("--rollback, --rollback-all, and --rollback-to are mutually exclusive. Use one.");
    return;
  }
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

    const entries = loadFixHistory(ip);

    let fixId = options.rollback;
    if (fixId === "last") {
      const applied = entries.filter((e) => e.status === "applied");
      if (applied.length === 0) {
        logger.error("No applied fixes found for this server.");
        return;
      }
      fixId = applied[applied.length - 1].fixId;
      logger.info(`Resolving 'last' to: ${fixId}`);
    }

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

    await saveRollbackEntry(entry, scoreAfter);

    return;
  }

  // ── Rollback-All (FIX-01) ────────────────────────────────────────────────
  if (options.rollbackAll) {
    await executeBulkRollback(query, "Rolling back all fixes...", (ip) =>
      rollbackAllFixes(ip),
    );
    return;
  }

  // ── Rollback-To (FIX-02) ─────────────────────────────────────────────────
  if (options.rollbackTo) {
    await executeBulkRollback(query, `Rolling back to ${options.rollbackTo}...`, (ip) =>
      rollbackToFix(ip, options.rollbackTo!),
    );
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
    logger.info("  --rollback-all      Rollback all applied fixes for server");
    logger.info("  --rollback-to <id>  Rollback all fixes from newest down to given fix ID");
    logger.info("  --history           Show fix history for server");
    logger.info("  --top <n>           Apply top N highest-impact SAFE fixes");
    logger.info("  --target <score>    Apply SAFE fixes until score reaches target");
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

  // Regression check — warn-only, does not block fix
  const baseline = loadBaseline(auditResult.serverIp);
  if (baseline) {
    const regression = checkRegression(baseline, auditResult);
    if (regression.regressions.length > 0) {
      logger.warning(
        `Regression detected: ${regression.regressions.length} check(s) previously passed now fail: ${regression.regressions.join(", ")}`,
      );
      logger.info("Fix will proceed — regression gating available in future version.");
    }
  }

  // Filter SAFE fixes
  const { safePlan, guardedCount, forbiddenCount, guardedIds } =
    previewSafeFixes(auditResult);

  // ── Prioritization: sort + select by --top or --target (D-03, D-06, D-07) ──
  const allSafeChecks = safePlan.groups.flatMap((g) => g.checks);

  // Profile filter (D-05): profile -> top/target operates on filtered set
  let profileFilteredChecks = allSafeChecks;
  if (options.profile !== undefined) {
    if (!isValidProfile(options.profile)) {
      logger.error(`Unknown profile: "${options.profile}". Available: ${listAllProfileNames().join(", ")}`);
      return;
    }
    profileFilteredChecks = filterChecksByProfile(allSafeChecks, options.profile);
    logger.info(`Profile "${options.profile}": ${profileFilteredChecks.length} applicable checks (filtered from ${allSafeChecks.length})`);
  }

  const impactCtx = buildImpactContext(auditResult.categories);
  const sortedChecks = sortChecksByImpact(profileFilteredChecks, impactCtx);

  let selectedChecks: ScoredFixCheck[];
  let parsedTarget: number | undefined;

  if (options.top !== undefined) {
    const n = parseInt(options.top, 10);
    if (isNaN(n) || n <= 0) {
      logger.error("--top degeri pozitif bir tam sayi olmalidir.");
      return;
    }
    selectedChecks = selectChecksForTop(sortedChecks, n);
  } else if (options.target !== undefined) {
    parsedTarget = parseInt(options.target, 10);
    if (isNaN(parsedTarget) || parsedTarget < 1 || parsedTarget > 100) {
      logger.error("--target degeri 1-100 arasinda olmalidir.");
      return;
    }
    if (auditResult.overallScore >= parsedTarget) {
      logger.info(
        `Mevcut skor ${auditResult.overallScore}, hedef ${parsedTarget} — fix gerekmez.`,
      );
      return;
    }
    selectedChecks = selectChecksForTarget(sortedChecks, auditResult.overallScore, parsedTarget);
  } else if (options.checks) {
    const checkIds = new Set(options.checks.split(",").map((s) => s.trim()));
    selectedChecks = sortedChecks.filter((c) => checkIds.has(c.id));
  } else {
    selectedChecks = sortedChecks;
  }

  // Check if anything to fix
  const safeCount = selectedChecks.length;
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
  const totalEstimatedImpact = selectedChecks.reduce(
    (sum, c) => sum + c.impact,
    0,
  );

  logger.title("Safe Fix Preview");
  logger.info("");
  logger.info(
    `  SAFE fixes to apply:  ${safeCount} checks (+${totalEstimatedImpact.toFixed(1)} pts estimated)`,
  );
  logger.info(
    "  ──────────────────────────────────────────────",
  );

  for (const check of selectedChecks) {
    const severityColor = severityChalk(check.severity);
    logger.info(
      `  ${severityColor(`[${check.severity}]`.padEnd(12))} ${check.id.padEnd(22)} ${check.category} / ${check.name}`,
    );
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

  // Confirm with user (skip in non-interactive mode for scheduled/automated runs)
  if (options.interactive !== false) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Apply ${safeCount} SAFE fix(es)? (backup will be created first)`,
        default: false,
      },
    ]);
    if (!confirm) return;
  }

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
  const fixCommands = fixCommandsFromChecks(selectedChecks);
  const remoteBackupSpinner = createSpinner("Creating remote file backup...");
  remoteBackupSpinner.start();
  const remoteBackupPath = await backupFilesBeforeFix(ip, fixId, fixCommands);
  remoteBackupSpinner.stop();

  // Apply SAFE fixes (prioritized)
  const fixSpinner = createSpinner("Applying safe fixes...");
  fixSpinner.start();
  const applied: string[] = [];
  const errors: string[] = [];
  const collectedDiffs: CollectedDiff[] = [];

  for (const check of selectedChecks) {
    try {
      // Pre-condition check (lockout prevention)
      if (check.preCondition) {
        const preCheck = await sshExec(ip, raw(check.preCondition));
        if (preCheck.code !== 0) {
          errors.push(`${check.id}: pre-condition failed`);
          continue;
        }
      }
      // Handler dispatch — bypasses shell metachar guard (D-05, D-06)
      const dispatch = await tryHandlerDispatch(ip, check, applied, errors);
      if (dispatch.handled) {
        collectedDiffs.push({ checkId: check.id, category: check.category, severity: check.severity, diff: dispatch.diff });
        // --diff display for handler-applied fixes
        if (options.diff && dispatch.diff) {
          const d = dispatch.diff;
          console.log(chalk.cyan(`  [${d.handlerType}] ${d.key}: ${d.before} -> ${d.after}`));
        } else if (options.diff) {
          console.log(chalk.dim(`  ${check.id}: Shell command — diff not available`));
        }
        continue;
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
        collectedDiffs.push({ checkId: check.id, category: check.category, severity: check.severity });
        // --diff display for shell-applied fixes (no diff available)
        if (options.diff) {
          console.log(chalk.dim(`  ${check.id}: Shell command — diff not available`));
        }
      }
    } catch (err) {
      const classified = classifyError(err);
        const detail = classified.hint ? `${classified.message} (${classified.hint})` : classified.message;
        errors.push(`${check.id}: ${detail}`);
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
      const skippedCount = allSafeChecks.length - selectedChecks.length;
      logger.success(
        `Score: ${auditResult.overallScore} \u2192 ${newScore} (${sign}${delta}) | Applied: ${applied.length} | Skipped: ${skippedCount} (GUARDED: ${guardedCount}, FORBIDDEN: ${forbiddenCount})`,
      );
      // D-06: --target unreachable warning
      if (parsedTarget !== undefined && newScore < parsedTarget) {
        logger.info(
          `Hedef: ${parsedTarget}, ulasilan: ${newScore}. Kalan fix'ler GUARDED/FORBIDDEN tier'da.`,
        );
      }
    }

    // Promote new passes to baseline after successful fix
    await saveBaseline(auditResult).catch(() => {});
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

  // Generate fix report (FIXPRO-07, D-10)
  if (options.report) {
    const selectedIds = new Set(selectedChecks.map((c) => c.id));
    const skipped = allSafeChecks
      .filter((c) => !selectedIds.has(c.id))
      .map((c) => ({ id: c.id, category: c.category, reason: "not selected" }));
    const filename = writeFixReport({
      collectedDiffs, applied, errors,
      server: { name, ip },
      scoreBefore: auditResult.overallScore,
      scoreAfter: newScore,
      skipped,
      profile: options.profile,
      dryRun: false,
    });
    logger.success(`Report saved: ${filename}`);
  }

  // Prune old backups (retention policy)
  await backupRemoteCleanup(ip);
}

/** Shared scaffold for --rollback-all and --rollback-to CLI handlers. */
async function executeBulkRollback(
  query: string | undefined,
  spinnerLabel: string,
  coreFn: (ip: string) => Promise<{ rolledBack: string[]; errors: string[] }>,
): Promise<void> {
  const server = await resolveServer(query, "Select a server to rollback:");
  if (!server) return;
  const { ip, name } = server;
  const platform = server.platform ?? server.mode ?? "bare";

  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  const rollbackSpinner = createSpinner(spinnerLabel);
  rollbackSpinner.start();
  const { rolledBack, errors: rbErrors } = await coreFn(ip);
  rollbackSpinner.stop();

  if (rolledBack.length === 0 && rbErrors.length === 0) {
    logger.info("No applied fixes found — nothing to roll back.");
    return;
  }

  if (rolledBack.length > 0) {
    logger.success(`Rolled back: ${rolledBack.join(", ")}`);
  }
  if (rbErrors.length > 0) {
    logger.error(`Errors: ${rbErrors.join("; ")}`);
  }

  if (rolledBack.length > 0) {
    const scoreSpinner = createSpinner("Verifying score...");
    scoreSpinner.start();
    const auditRes = await runAudit(ip, name, platform);
    scoreSpinner.stop();
    if (auditRes.success && auditRes.data) {
      logger.info(`Score after rollback: ${auditRes.data.overallScore}`);
    }
  }
}
