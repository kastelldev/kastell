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
import { runFix, runPostFixReAudit, extractAffectedCategories } from "../core/audit/fix.js";
import type { Severity } from "../types/severity.js";
import { watchAudit } from "../core/audit/watch.js";
import { diffAudits, resolveSnapshotRef, formatDiffTerminal, formatDiffJson, buildCategorySummary, formatCompareSummaryTerminal, formatCompareSummaryJson, resolveAuditPair } from "../core/audit/diff.js";
import { getServers } from "../utils/config.js";
import { listAllChecks, formatListChecksTerminal, formatListChecksJson } from "../core/audit/listChecks.js";
import { filterByProfile, calculateComplianceDetail } from "../core/audit/compliance/scoring.js";
import { formatComplianceReport } from "../core/audit/formatters/compliance.js";
import { FRAMEWORK_KEY_MAP, type ProfileName } from "../core/audit/compliance/types.js";
import type { FrameworkKey } from "../core/audit/compliance/mapper.js";
import type { AuditCliOptions } from "../core/audit/formatters/index.js";
import type { AuditDiffResult, RegressionResult } from "../core/audit/types.js";
import { filterAuditResult, buildFilterAnnotation, parseSeverity } from "../core/audit/filter.js";
import type { AuditFilter } from "../core/audit/filter.js";
import { saveBaselineSafe, loadBaseline, checkRegression, formatRegressionSummary, extractPassedCheckIds, shouldUpdateBaseline } from "../core/audit/regression.js";
import { loadDefaults } from "../core/defaults.js";
import { AuditError } from "../core/audit/errors.js";
import { markCommandFailed } from "../utils/exitCode.js";

function printDiff(diff: AuditDiffResult, json: boolean, machineOutput: boolean): void {
  console.log(json ? formatDiffJson(diff) : formatDiffTerminal(diff));
  if (diff.regressions.length > 0 && machineOutput) {
    markCommandFailed();
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
  framework?: string;
  compliance?: string;
  fresh?: boolean;
  detail?: boolean;
  ci?: boolean;
}

/**
 * Wrapper: catches AuditError and sets exitCode = 1.
 * All early-return paths in auditCommandImpl throw AuditError instead.
 */
export async function auditCommand(
  serverName?: string,
  options: AuditCommandOptions = {},
): Promise<void> {
  try {
    await auditCommandImpl(serverName, options);
  } catch (err) {
    if (err instanceof AuditError) {
      logger.error(err.message);
      markCommandFailed();
      return;
    }
    throw err;
  }
}

/**
 * Execute the audit command.
 * Flow: resolveServer (or parse --host) -> runAudit -> select formatter -> output -> threshold check
 */
async function auditCommandImpl(
  serverName?: string,
  options: AuditCommandOptions = {},
): Promise<void> {
  if (options.ci) {
    options.json = true;
  }
  const machineOutput = options.json === true || options.ci === true;
  const logDiagnostic = (severity: "info" | "warning" | "success", message: string): void => {
    if (machineOutput) {
      process.stderr.write(`${message}\n`);
    } else if (severity === "warning") {
      logger.warning(message);
    } else if (severity === "success") {
      logger.success(message);
    } else {
      logger.info(message);
    }
  };

  // --list-checks: static catalog display — no SSH connection needed
  if (options.listChecks) {
    const filter: { category?: string; severity?: Severity } = {};
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

  if (options.threshold === undefined || options.compliance === undefined) {
    const userDefaults = loadDefaults();
    if (options.threshold === undefined && userDefaults.threshold !== undefined) {
      options.threshold = String(userDefaults.threshold);
    }
    if (options.compliance === undefined && userDefaults.framework !== undefined) {
      options.compliance = userDefaults.framework;
    }
  }

  // --ci mode: validate threshold requirement early (before server resolution)
  if (options.ci && options.threshold === undefined) {
    throw new AuditError("--ci requires --threshold (e.g. --ci --threshold 70)");
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
      throw new AuditError("--diff requires format: before:after (e.g. pre-upgrade:latest)");
    }
    const [beforeRef, afterRef] = parts;
    const beforeSnap = await resolveSnapshotRef(ip, beforeRef);
    const afterSnap = await resolveSnapshotRef(ip, afterRef);
    if (!beforeSnap) { throw new AuditError(`Snapshot not found: ${beforeRef}`); }
    if (!afterSnap) { throw new AuditError(`Snapshot not found: ${afterRef}`); }
    const diff = diffAudits(beforeSnap.audit, afterSnap.audit, {
      before: beforeSnap.name ?? beforeRef,
      after: afterSnap.name ?? afterRef,
    });
    printDiff(diff, options.json ?? false, machineOutput);
    return;
  }

  // --compare mode: compare two servers
  if (options.compare) {
    const parts = options.compare.split(":");
    if (parts.length !== 2) {
      throw new AuditError("--compare requires format: server1:server2");
    }
    const [serverARef, serverBRef] = parts;
    const servers = getServers();
    const serverA = servers.find((s) => s.name === serverARef || s.ip === serverARef);
    const serverB = servers.find((s) => s.name === serverBRef || s.ip === serverBRef);
    if (!serverA) { throw new AuditError(`Server not found: ${serverARef}`); }
    if (!serverB) { throw new AuditError(`Server not found: ${serverBRef}`); }

    const spinner = createSpinner("Comparing servers...");
    spinner.start();
    const pairResult = await resolveAuditPair(serverA, serverB, !!options.fresh);
    spinner.stop();
    if (!pairResult.success) { throw new AuditError(pairResult.error ?? "Compare failed"); }
    const { auditA, auditB } = pairResult.data!;

    if (options.detail) {
      const diff = diffAudits(auditA, auditB, { before: serverA.name, after: serverB.name });
      console.log(options.json ? formatDiffJson(diff) : formatDiffTerminal(diff));
    } else {
      const summary = buildCategorySummary(auditA, auditB, { before: serverA.name, after: serverB.name });
      console.log(options.json ? formatCompareSummaryJson(summary) : formatCompareSummaryTerminal(summary));
    }
    return;
  }

  // --watch mode: delegate to watchAudit and return
  if (options.watch !== undefined) {
    const interval = options.watch ? parseInt(options.watch, 10) : undefined;
    if (interval !== undefined && (isNaN(interval) || interval < 1)) {
      throw new AuditError("Watch interval must be a positive number (seconds)");
    }
    const formatter = await selectFormatter(options);
    logger.info(`Starting watch mode for ${name} (interval: ${interval ?? 300}s)`);
    await watchAudit(ip, name, platform, {
      interval,
      formatter,
    });
    return;
  }

  const spinner = machineOutput ? null : createSpinner(`Running security audit on ${name}...`);
  spinner?.start();

  const result = await runAudit(ip, name, platform);

  if (!result.success || !result.data) {
    spinner?.fail(result.error ?? "Audit failed");
    if (result.hint) {
      logDiagnostic("info", result.hint);
    }
    return;
  }

  spinner?.succeed(`Audit complete for ${name}`);

  const auditResult = result.data;

  // Detect trend from history (load BEFORE save so we compare against previous)
  const history = loadAuditHistory(auditResult.serverIp);
  const trend = detectTrend(auditResult.overallScore, auditResult.auditVersion, history);

  // Save to history (after trend detection)
  await saveAuditHistory(auditResult);
  if (trend === "methodology-change") {
    logDiagnostic("warning", "Score methodology updated. New baseline established.");
  } else if (trend !== "first audit") {
    logDiagnostic("info", `Trend: ${trend}`);
  }

  const baseline = loadBaseline(auditResult.serverIp);
  const passedIds = extractPassedCheckIds(auditResult);

  let regression: RegressionResult | null = null;
  if (baseline) {
    regression = checkRegression(baseline, auditResult, passedIds);
  }

  if (shouldUpdateBaseline(regression, false)) {
    await saveBaselineSafe(auditResult, baseline, passedIds);
  }

  if (regression) {
    for (const line of formatRegressionSummary(regression)) {
      logDiagnostic(line.severity, line.text);
    }
  }

  // --compliance: detailed Framework>Control>Check grouped report
  if (options.compliance) {
    const frameworks = options.compliance
      .split(",")
      .map((f) => FRAMEWORK_KEY_MAP[f.trim().toLowerCase()])
      .filter((f): f is FrameworkKey => !!f);
    if (frameworks.length === 0) {
      throw new AuditError("Invalid framework. Use: cis, pci-dss, hipaa");
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

  // --framework: filtered audit view by single compliance framework
  if (options.framework) {
    const validFrameworks = ["cis-level1", "cis-level2", "pci-dss", "hipaa"] as const;
    if (!validFrameworks.includes(options.framework as typeof validFrameworks[number])) {
      throw new AuditError(`Invalid framework: ${options.framework}. Valid: ${validFrameworks.join(", ")}`);
    }
    const fw = FRAMEWORK_KEY_MAP[options.framework];
    const filteredResult = filterByProfile(auditResult, options.framework as ProfileName);
    const detail = calculateComplianceDetail(auditResult.categories);
    const fwScore = detail.find((d) => d.framework === fw);
    if (options.json) {
      const fwDetail = detail.filter((d) => d.framework === fw);
      console.log(JSON.stringify({ overallScore: auditResult.overallScore, compliance: fwDetail }, null, 2));
    } else {
      const formatter = await selectFormatter(options);
      console.log(formatter(filteredResult));
      if (fwScore) {
        logger.info(
          `Framework ${options.framework}: ${fwScore.passedControls}/${fwScore.totalControls} controls (${fwScore.passRate}%)`,
        );
      }
    }
    return;
  }

  // --profile: filtered audit view by compliance framework
  if (options.profile) {
    const validProfiles: readonly string[] = ["cis-level1", "cis-level2", "pci-dss", "hipaa"] satisfies ProfileName[];
    if (!validProfiles.includes(options.profile)) {
      throw new AuditError(`Invalid profile. Use: ${validProfiles.join(", ")}`);
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
      const profileLine = `Profile ${options.profile}: ${profileScore.passedControls}/${profileScore.totalControls} controls (${profileScore.passRate}%)`;
      logDiagnostic("info", profileLine);
    }
    return;
  }

  // --snapshot: save point-in-time snapshot
  if (options.snapshot !== undefined) {
    const snapshotName = typeof options.snapshot === "string" ? options.snapshot : undefined;
    await saveSnapshot(auditResult, snapshotName);
    logDiagnostic("success", `Snapshot saved for ${name}`);
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
        const affectedCats = extractAffectedCategories(fixResult.applied, auditResult.categories);

        const postFixResult = await runPostFixReAudit(ip, platform, auditResult, affectedCats);
        const newScore = postFixResult?.overallScore ?? null;
        if (newScore !== null) {
          const delta = newScore - auditResult.overallScore;
          const sign = delta >= 0 ? "+" : "";
          logger.success(`Score: ${auditResult.overallScore} → ${newScore} (${sign}${delta})`);
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
        throw new AuditError("--threshold must be a number");
      }
      if (auditResult.overallScore < threshold) {
        markCommandFailed();
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
  if (filterAnnotation && !machineOutput) {
    logger.info(`Score: ${auditResult.overallScore}/100${filterAnnotation}`);
  }

  // Show quick wins in terminal output
  if (auditResult.quickWins.length > 0 && !machineOutput && !options.badge && !options.report) {
    const lastWin = auditResult.quickWins[auditResult.quickWins.length - 1];
    logger.info(
      `Quick wins: ${auditResult.quickWins.length} fix(es) to reach ${lastWin.projectedScore}/100`,
    );
  }

  // Threshold check
  if (options.threshold) {
    const threshold = parseInt(options.threshold, 10);
    if (isNaN(threshold)) {
      throw new AuditError("--threshold must be a number");
    }
    if (auditResult.overallScore < threshold) {
      markCommandFailed();
      return;
    }
  }
}
