import { resolveServer } from "../utils/serverSelect.js";
import { logger, createSpinner } from "../utils/logger.js";
import { runServerDoctor } from "../core/doctor.js";
import { runDoctorFix } from "../core/doctor-fix.js";
import { runDoctorChecks, checkProviderTokens } from "../core/doctor-local.js";
import type { DoctorFinding, DoctorResult } from "../core/doctor.js";

// ─── Server mode display helpers ──────────────────────────────────────────────

const SEVERITY_LABEL: Record<string, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  info: "INFO",
};

function displayFindings(result: DoctorResult): void {
  logger.title(`Doctor Report: ${result.serverName} (${result.serverIp})`);

  if (result.findings.length === 0) {
    logger.success("No issues detected");
  } else {
    const bySeverity = {
      critical: result.findings.filter((f) => f.severity === "critical"),
      warning: result.findings.filter((f) => f.severity === "warning"),
      info: result.findings.filter((f) => f.severity === "info"),
    };

    for (const [severity, findings] of Object.entries(bySeverity) as [string, DoctorFinding[]][]) {
      if (findings.length === 0) continue;
      const label = SEVERITY_LABEL[severity] ?? severity.toUpperCase();
      console.log(`\n  ${label} (${findings.length})`);
      for (const finding of findings) {
        logger.warning(`  ${finding.description}`);
        logger.step(`  Run: ${finding.command}`);
      }
    }

    const critical = bySeverity.critical.length;
    const warnings = bySeverity.warning.length;
    const info = bySeverity.info.length;
    const total = result.findings.length;

    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} critical`);
    if (warnings > 0) parts.push(`${warnings} warnings`);
    if (info > 0) parts.push(`${info} info`);

    console.log();
    logger.info(`${total} finding${total === 1 ? "" : "s"} (${parts.join(", ")})`);
  }

  if (!result.usedFreshData) {
    logger.info("Using cached data. Run with --fresh for live analysis.");
  }
}

// ─── Main command ──────────────────────────────────────────────────────────────

export async function doctorCommand(
  server?: string,
  options?: {
    checkTokens?: boolean;
    fresh?: boolean;
    json?: boolean;
    fix?: boolean;
    force?: boolean;
    dryRun?: boolean;
    autoFix?: boolean;
  },
  version?: string,
): Promise<void> {
  // ── Guard: --fix requires a server argument ───────────────────────────────
  if (options?.fix && !server) {
    logger.error("--fix requires a server argument");
    return;
  }

  if (options?.autoFix && !server) {
    logger.error("--auto-fix requires a server argument");
    return;
  }

  // ── Server mode ──────────────────────────────────────────────────────────────
  if (server) {
    const resolved = await resolveServer(server, "Select a server for doctor analysis:");
    if (!resolved) return;

    // --fix / --auto-fix forces --fresh to get current server state before fixing
    const useFresh = options?.fix || options?.autoFix ? true : options?.fresh;
    if (options?.fix || options?.autoFix) {
      logger.info("Running with --fresh to get current server state before fixing.");
    }

    const spinner = createSpinner(`Running doctor analysis on ${resolved.name}...`);
    spinner.start();

    const result = await runServerDoctor(resolved.ip, resolved.name, { fresh: useFresh });

    spinner.stop();

    if (options?.json) {
      if (result.success && result.data) {
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.log(JSON.stringify({ error: result.error }, null, 2));
      }
      return;
    }

    if (!result.success) {
      logger.error(result.error ?? "Doctor analysis failed");
      return;
    }

    displayFindings(result.data!);

    if (options?.autoFix) {
      const findings = result.data!.findings;
      const fixable = findings.filter((f) => f.fixCommand);
      const manual = findings.filter((f) => !f.fixCommand);

      if (fixable.length === 0) {
        logger.info("No auto-fixable findings detected.");
        return;
      }

      if (options.dryRun) {
        console.log();
        logger.title("Auto-Fix Preview (--dry-run -- no SSH will be executed)");
        for (const f of fixable) {
          logger.step(`[${f.severity.toUpperCase()}] ${f.description}`);
          logger.info(`  Handler: ${f.fixCommand}`);
        }
        if (manual.length > 0) {
          console.log();
          logger.info(`${manual.length} finding(s) require manual remediation`);
        }
        return;
      }

      const fixResult = await runDoctorFix(resolved.ip, findings, {
        dryRun: false,
        force: options.force ?? false,
      });

      // Finding count delta summary (per D-03)
      console.log();
      logger.title("Auto-Fix Summary");
      logger.info(`Findings: ${findings.length} total (${fixable.length} auto-fixable, ${manual.length} manual)`);
      if (fixResult.applied.length > 0) {
        logger.success(`Applied: ${fixResult.applied.length}`);
      }
      if (fixResult.skipped.length > 0) {
        logger.info(`Skipped: ${fixResult.skipped.length}`);
      }
      if (fixResult.failed.length > 0) {
        logger.error(`Failed: ${fixResult.failed.length}`);
        for (const entry of fixResult.failed) {
          logger.error(`  ${entry}`);
        }
      }
      return;
    }

    if (!options?.fix) {
      return;
    }

    // ── Fix mode ──────────────────────────────────────────────────────────────
    const findings = result.data!.findings;

    if (options.dryRun) {
      console.log();
      logger.title("Fix Preview (--dry-run — no SSH will be executed)");
      for (const finding of findings) {
        if (finding.fixCommand) {
          logger.step(`[${finding.severity.toUpperCase()}] ${finding.description}`);
          logger.info(`  Command: ${finding.fixCommand}`);
        } else {
          logger.step(`[${finding.severity.toUpperCase()}] ${finding.description} -- manual fix required: ${finding.command}`);
        }
      }
      return;
    }

    const fixResult = await runDoctorFix(resolved.ip, findings, {
      dryRun: false,
      force: options.force ?? false,
    });

    console.log();
    if (fixResult.applied.length > 0) {
      logger.success(`Fixed: ${fixResult.applied.length} finding(s) applied`);
    }
    if (fixResult.skipped.length > 0) {
      logger.info(`Skipped: ${fixResult.skipped.length} finding(s)`);
    }
    if (fixResult.failed.length > 0) {
      logger.error(`Failed: ${fixResult.failed.length} finding(s)`);
      for (const entry of fixResult.failed) {
        logger.error(`  ${entry}`);
      }
    }
    return;
  }

  // ── Local mode ───────────────────────────────────────────────────────────────
  logger.title("Kastell Doctor");

  const results = runDoctorChecks(version);

  for (const result of results) {
    const colorFn =
      result.status === "pass"
        ? logger.success
        : result.status === "warn"
          ? logger.warning
          : logger.error;
    colorFn(`${result.name}: ${result.detail}`);
  }

  const failures = results.filter((r) => r.status === "fail");
  const warnings = results.filter((r) => r.status === "warn");

  console.log();
  if (failures.length > 0) {
    logger.error(`${failures.length} check(s) failed. Please fix the issues above.`);
  } else if (warnings.length > 0) {
    logger.warning(`All checks passed with ${warnings.length} warning(s).`);
  } else {
    logger.success("All checks passed! Your environment is ready.");
  }

  if (options?.checkTokens) {
    await checkProviderTokens();
  }
}
