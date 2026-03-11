/**
 * Audit command — thin wrapper for `kastell audit [server-name]`.
 * Delegates to core/audit/runAudit + formatters + fix + history + watch.
 */

import chalk from "chalk";
import { resolveServer } from "../utils/serverSelect.js";
import { assertValidIp } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { runAudit } from "../core/audit/index.js";
import { selectFormatter } from "../core/audit/formatters/index.js";
import { saveAuditHistory, loadAuditHistory, detectTrend } from "../core/audit/history.js";
import { saveSnapshot, listSnapshots } from "../core/audit/snapshot.js";
import { runFix } from "../core/audit/fix.js";
import { watchAudit } from "../core/audit/watch.js";
import { diffAudits, resolveSnapshotRef, formatDiffTerminal, formatDiffJson } from "../core/audit/diff.js";
import { getServers } from "../utils/config.js";
import type { AuditCliOptions } from "../core/audit/formatters/index.js";

export interface AuditCommandOptions extends AuditCliOptions {
  host?: string;
  threshold?: string;
  fix?: boolean;
  dryRun?: boolean;
  watch?: string;
  category?: string;
  snapshot?: boolean | string;
  snapshots?: boolean;
  diff?: string;
  compare?: string;
}

/**
 * Execute the audit command.
 * Flow: resolveServer (or parse --host) -> runAudit -> select formatter -> output -> threshold check
 */
export async function auditCommand(
  serverName?: string,
  options: AuditCommandOptions = {},
): Promise<void> {
  let ip: string;
  let name: string;
  let platform: string;

  if (options.host) {
    // Parse user@ip format
    const parts = options.host.split("@");
    if (parts.length === 2) {
      ip = parts[1];
    } else {
      ip = parts[0];
    }
    assertValidIp(ip);
    name = ip;
    platform = "bare";
  } else {
    const server = await resolveServer(serverName, "Select a server to audit:");
    if (!server) return;
    ip = server.ip;
    name = server.name;
    platform = server.platform ?? server.mode ?? "bare";
  }

  // --snapshots mode: list saved snapshots without running audit
  if (options.snapshots) {
    const entries = await listSnapshots(ip);
    if (entries.length === 0) {
      logger.info(`No snapshots found for ${name} (${ip})`);
      return;
    }
    logger.info(`Snapshots for ${name} (${ip}):\n`);
    for (const entry of entries) {
      const nameStr = entry.name ? ` [${entry.name}]` : "";
      const scoreColor =
        entry.overallScore >= 80
          ? chalk.green
          : entry.overallScore >= 50
            ? chalk.yellow
            : chalk.red;
      console.log(
        `  ${entry.savedAt}  ${scoreColor(entry.overallScore + "/100")}${nameStr}  ${chalk.dim(entry.filename)}`,
      );
    }
    return;
  }

  // --diff mode: compare two snapshots for this server
  if (options.diff) {
    const parts = (options.diff as string).split(":");
    if (parts.length !== 2) {
      logger.error("--diff requires format: before:after (e.g. pre-upgrade:latest)");
      return;
    }
    const [beforeRef, afterRef] = parts;
    const beforeSnap = await resolveSnapshotRef(ip, beforeRef);
    const afterSnap = await resolveSnapshotRef(ip, afterRef);
    if (!beforeSnap) { logger.error(`Snapshot not found: ${beforeRef}`); return; }
    if (!afterSnap) { logger.error(`Snapshot not found: ${afterRef}`); return; }
    const diff = diffAudits(beforeSnap.audit, afterSnap.audit, {
      before: beforeSnap.name ?? beforeRef,
      after: afterSnap.name ?? afterRef,
    });
    if (options.json) {
      console.log(formatDiffJson(diff));
    } else {
      console.log(formatDiffTerminal(diff));
    }
    if (diff.regressions.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  // --compare mode: compare latest snapshots from two servers
  if (options.compare) {
    const parts = (options.compare as string).split(":");
    if (parts.length !== 2) {
      logger.error("--compare requires format: server1:server2");
      return;
    }
    const [serverARef, serverBRef] = parts;
    const servers = getServers();
    const serverA = servers.find((s) => s.name === serverARef || s.ip === serverARef);
    const serverB = servers.find((s) => s.name === serverBRef || s.ip === serverBRef);
    if (!serverA) { logger.error(`Server not found: ${serverARef}`); return; }
    if (!serverB) { logger.error(`Server not found: ${serverBRef}`); return; }
    const snapA = await resolveSnapshotRef(serverA.ip, "latest");
    const snapB = await resolveSnapshotRef(serverB.ip, "latest");
    if (!snapA) { logger.error(`No snapshots for ${serverA.name}`); return; }
    if (!snapB) { logger.error(`No snapshots for ${serverB.name}`); return; }
    const diff = diffAudits(snapA.audit, snapB.audit, {
      before: serverA.name,
      after: serverB.name,
    });
    if (options.json) {
      console.log(formatDiffJson(diff));
    } else {
      console.log(formatDiffTerminal(diff));
    }
    if (diff.regressions.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  // --watch mode: delegate to watchAudit and return
  if (options.watch !== undefined) {
    const interval = options.watch ? parseInt(options.watch, 10) : undefined;
    if (interval !== undefined && (isNaN(interval) || interval < 1)) {
      logger.error("Watch interval must be a positive number (seconds)");
      return;
    }
    const formatter = await selectFormatter(options);
    logger.info(`Starting watch mode for ${name} (interval: ${interval ?? 300}s)`);
    await watchAudit(ip, name, platform, {
      interval,
      formatter,
    });
    return;
  }

  const spinner = createSpinner(`Running security audit on ${name}...`);
  spinner.start();

  const result = await runAudit(ip, name, platform);

  if (!result.success || !result.data) {
    spinner.fail(result.error ?? "Audit failed");
    if (result.hint) {
      logger.info(result.hint);
    }
    return;
  }

  spinner.succeed(`Audit complete for ${name}`);

  const auditResult = result.data;

  // Detect trend from history (load BEFORE save so we compare against previous)
  const history = loadAuditHistory(auditResult.serverIp);
  const trend = detectTrend(auditResult.overallScore, history);

  // Save to history (after trend detection)
  await saveAuditHistory(auditResult);
  if (trend !== "first audit") {
    logger.info(`Trend: ${trend}`);
  }

  // --snapshot: save point-in-time snapshot
  if (options.snapshot !== undefined) {
    const snapshotName = typeof options.snapshot === "string" ? options.snapshot : undefined;
    await saveSnapshot(auditResult, snapshotName);
    logger.success(`Snapshot saved for ${name}`);
  }

  // --fix mode: run fix engine
  if (options.fix) {
    const fixResult = await runFix(ip, auditResult, {
      dryRun: options.dryRun ?? false,
    });

    if (fixResult.preview) {
      // Dry run: show fix plan
      for (const group of fixResult.preview.groups) {
        logger.info(`[${group.severity}] ${group.checks.length} fixable issue(s) (+${group.estimatedImpact} pts)`);
        for (const check of group.checks) {
          logger.info(`  ${check.id}: ${check.name} — ${check.fixCommand}`);
        }
      }
    } else {
      // Applied fixes
      if (fixResult.applied.length > 0) {
        logger.success(`Fixed: ${fixResult.applied.join(", ")}`);
      }
      if (fixResult.skipped.length > 0) {
        logger.info(`Skipped: ${fixResult.skipped.join(", ")}`);
      }
      if (fixResult.errors.length > 0) {
        logger.error(`Errors: ${fixResult.errors.join(", ")}`);
      }
    }
    return;
  }

  // --score-only: just print score and exit
  if (options.scoreOnly) {
    console.log(`${auditResult.overallScore}/100`);

    if (options.threshold) {
      const threshold = parseInt(options.threshold, 10);
      if (auditResult.overallScore < threshold) {
        process.exit(1);
      }
    }
    return;
  }

  // Select and run formatter
  const formatter = await selectFormatter(options);
  const output = formatter(auditResult);
  console.log(output);

  // Show quick wins in terminal output
  if (auditResult.quickWins.length > 0 && !options.json && !options.badge && !options.report) {
    const lastWin = auditResult.quickWins[auditResult.quickWins.length - 1];
    logger.info(
      `Quick wins: ${auditResult.quickWins.length} fix(es) to reach ${lastWin.projectedScore}/100`,
    );
  }

  // Threshold check
  if (options.threshold) {
    const threshold = parseInt(options.threshold, 10);
    if (auditResult.overallScore < threshold) {
      logger.error(`Score ${auditResult.overallScore} is below threshold ${threshold}`);
      process.exit(1);
    }
  }
}
