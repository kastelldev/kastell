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
import { saveAuditHistory, loadAuditHistory, detectTrend, computeTrend } from "../core/audit/history.js";
import { formatTrendTerminal, formatTrendJson } from "../core/audit/formatters/trend.js";
import { saveSnapshot, listSnapshots } from "../core/audit/snapshot.js";
import { runFix, runScoreCheck } from "../core/audit/fix.js";
import { watchAudit } from "../core/audit/watch.js";
import { diffAudits, resolveSnapshotRef, formatDiffTerminal, formatDiffJson } from "../core/audit/diff.js";
import { getServers } from "../utils/config.js";
import { listAllChecks, formatListChecksTerminal, formatListChecksJson } from "../core/audit/listChecks.js";
import { filterByProfile, calculateComplianceDetail } from "../core/audit/compliance/scoring.js";
import { formatComplianceReport } from "../core/audit/formatters/compliance.js";
import { FRAMEWORK_KEY_MAP, type ProfileName } from "../core/audit/compliance/types.js";
import type { FrameworkKey } from "../core/audit/compliance/mapper.js";
import type { AuditCliOptions } from "../core/audit/formatters/index.js";
import type { AuditDiffResult } from "../core/audit/types.js";
import { filterAuditResult, buildFilterAnnotation, parseSeverity } from "../core/audit/filter.js";
import type { AuditFilter } from "../core/audit/filter.js";

function printDiff(diff: AuditDiffResult, json?: boolean): void {
  console.log(json ? formatDiffJson(diff) : formatDiffTerminal(diff));
  if (diff.regressions.length > 0) {
    process.exitCode = 1;
  }
}

export interface AuditCommandOptions extends AuditCliOptions {
  host?: string;
  threshold?: string;
  fix?: boolean;
  dryRun?: boolean;
  watch?: string;
  category?: string;
  severity?: string;
  snapshot?: boolean | string;
  snapshots?: boolean;
  diff?: string;
  compare?: string;
  trend?: boolean;
  days?: string;
  listChecks?: boolean;
  profile?: string;
  compliance?: string;
}

/**
 * Execute the audit command.
 * Flow: resolveServer (or parse --host) -> runAudit -> select formatter -> output -> threshold check
 */
export async function auditCommand(
  serverName?: string,
  options: AuditCommandOptions = {},
): Promise<void> {
  // --list-checks: static catalog display — no SSH connection needed
  if (options.listChecks) {
    const filter: { category?: string; severity?: "critical" | "warning" | "info" } = {};
    if (options.category) filter.category = options.category;
    if (options.severity) {
      const parsed = parseSeverity(options.severity);
      if (parsed) filter.severity = parsed;
    }
    const checks = listAllChecks(filter);
    if (options.json) {
      console.log(formatListChecksJson(checks));
    } else {
      console.log(formatListChecksTerminal(checks));
    }
    return;
  }

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

  // --trend mode: display score timeline without running SSH audit
  if (options.trend) {
    const history = loadAuditHistory(ip);
    const rawDays = options.days ? parseInt(options.days, 10) : undefined;
    const days = rawDays !== undefined && isNaN(rawDays) ? undefined : rawDays;
    const trendResult = computeTrend(history, { days });
    if (options.json) {
      console.log(formatTrendJson(trendResult));
    } else {
      console.log(formatTrendTerminal(trendResult));
    }
    return;
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
    const parts = options.diff.split(":");
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
    printDiff(diff, options.json);
    return;
  }

  // --compare mode: compare latest snapshots from two servers
  if (options.compare) {
    const parts = options.compare.split(":");
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
    printDiff(diff, options.json);
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
  const trend = detectTrend(auditResult.overallScore, auditResult.auditVersion, history);

  // Save to history (after trend detection)
  await saveAuditHistory(auditResult);
  if (trend === "methodology-change") {
    logger.warning("Score methodology updated. New baseline established.");
  } else if (trend !== "first audit") {
    logger.info(`Trend: ${trend}`);
  }

  // --compliance: detailed Framework>Control>Check grouped report
  if (options.compliance) {
    const frameworks = options.compliance
      .split(",")
      .map((f) => FRAMEWORK_KEY_MAP[f.trim().toLowerCase()])
      .filter((f): f is FrameworkKey => !!f);
    if (frameworks.length === 0) {
      logger.error("Invalid framework. Use: cis, pci-dss, hipaa");
      return;
    }
    if (options.json) {
      const detail = calculateComplianceDetail(auditResult.categories);
      const filtered = detail.filter((d) => frameworks.includes(d.framework));
      console.log(JSON.stringify({ overallScore: auditResult.overallScore, compliance: filtered }, null, 2));
    } else {
      console.log(formatComplianceReport(auditResult, frameworks));
    }
    return;
  }

  // --profile: filtered audit view by compliance framework
  if (options.profile) {
    const validProfiles: readonly string[] = ["cis-level1", "cis-level2", "pci-dss", "hipaa"] satisfies ProfileName[];
    if (!validProfiles.includes(options.profile)) {
      logger.error(`Invalid profile. Use: ${validProfiles.join(", ")}`);
      return;
    }
    const profileName = options.profile as ProfileName;
    const filteredResult = filterByProfile(auditResult, profileName);
    filteredResult.complianceDetail = calculateComplianceDetail(filteredResult.categories);
    const formatter = await selectFormatter(options);
    const output = formatter(filteredResult);
    console.log(output);
    const profileFramework =
      profileName.startsWith("cis") ? "CIS" : profileName === "pci-dss" ? "PCI-DSS" : "HIPAA";
    const detail = calculateComplianceDetail(auditResult.categories);
    const profileScore = detail.find((d) => d.framework === profileFramework);
    if (profileScore) {
      logger.info(
        `Profile ${options.profile}: ${profileScore.passedControls}/${profileScore.totalControls} controls (${profileScore.passRate}%)`,
      );
    }
    return;
  }

  // --snapshot: save point-in-time snapshot
  if (options.snapshot !== undefined) {
    const snapshotName = typeof options.snapshot === "string" ? options.snapshot : undefined;
    await saveSnapshot(auditResult, snapshotName);
    logger.success(`Snapshot saved for ${name}`);
  }

  // Apply display-only filter (AUX-01, AUX-02, AUX-03)
  // MUST be after saveAuditHistory + saveSnapshot to preserve unfiltered data (AUX-04)
  const parsedSeverity = parseSeverity(options.severity);
  if (options.severity && !parsedSeverity) {
    logger.warning(`Invalid severity "${options.severity}" — expected: critical, warning, info. Showing all.`);
  }
  const auditFilter: AuditFilter = {
    category: options.category,
    severity: parsedSeverity,
  };
  const displayResult = filterAuditResult(auditResult, auditFilter);
  const filterAnnotation = buildFilterAnnotation(auditFilter);

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

      // Score delta after fix (AUX-05, AUX-06, AUX-07)
      // Guard: only run when fixes were actually applied (not dry-run, not zero-fix)
      if (fixResult.applied.length > 0) {
        const affectedCats = [
          ...new Set(
            fixResult.applied
              .map((checkId) => {
                for (const cat of auditResult.categories) {
                  if (cat.checks.some((ch) => ch.id === checkId)) return cat.name;
                }
                return undefined;
              })
              .filter((name): name is string => name !== undefined),
          ),
        ];

        const newScore = await runScoreCheck(ip, platform, auditResult, affectedCats);
        if (newScore !== null) {
          const delta = newScore - auditResult.overallScore;
          const sign = delta >= 0 ? "+" : "";
          logger.success(`Score: ${auditResult.overallScore} \u2192 ${newScore} (${sign}${delta})`);
        }
      }
    }
    return;
  }

  // --score-only: just print score and exit
  if (options.scoreOnly) {
    console.log(`${auditResult.overallScore}/100${filterAnnotation}`);

    if (options.threshold) {
      const threshold = parseInt(options.threshold, 10);
      if (isNaN(threshold)) {
        logger.error("--threshold must be a number");
        return;
      }
      if (auditResult.overallScore < threshold) {
        process.exitCode = 1;
        return;
      }
    }
    return;
  }

  // Select and run formatter (uses displayResult for filtered output)
  const formatter = await selectFormatter(options);
  const output = formatter(displayResult);
  console.log(output);

  // Show filter annotation when active
  if (filterAnnotation) {
    logger.info(`Score: ${auditResult.overallScore}/100${filterAnnotation}`);
  }

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
    if (isNaN(threshold)) {
      logger.error("--threshold must be a number");
      return;
    }
    if (auditResult.overallScore < threshold) {
      logger.error(`Score ${auditResult.overallScore} is below threshold ${threshold}`);
      process.exitCode = 1;
      return;
    }
  }
}
