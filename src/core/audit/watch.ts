/**
 * Watch mode for audit — re-runs audit at interval, shows only changes.
 * Bridge to future guard command.
 */

import type { AuditResult } from "./types.js";
import { runAudit } from "./index.js";
import { saveAuditHistory } from "./history.js";

/** Default interval in seconds (5 minutes) */
const DEFAULT_INTERVAL = 300;

export interface WatchOptions {
  /** Interval in seconds between audit runs */
  interval?: number;
  /** Formatter for first-run full output */
  formatter: (result: AuditResult) => string;
  /** Output function (defaults to console.log) */
  output?: (line: string) => void;
}

/**
 * Watch mode: run audit periodically, show full output on first run,
 * then only score deltas on subsequent runs.
 */
export async function watchAudit(
  ip: string,
  serverName: string,
  platform: string,
  options: WatchOptions,
): Promise<void> {
  const interval = (options.interval ?? DEFAULT_INTERVAL) * 1000;
  const log = options.output ?? console.log;
  let previousScore: number | undefined;
  let previousFailedIds: Set<string> = new Set();
  let timer: ReturnType<typeof setInterval> | undefined;

  const runOnce = async (): Promise<void> => {
    const result = await runAudit(ip, serverName, platform);

    if (!result.success || !result.data) {
      const timestamp = new Date().toLocaleTimeString("en-GB");
      log(`[${timestamp}] Audit failed: ${result.error ?? "Unknown error"}`);
      return;
    }

    const auditResult = result.data;

    // Save to history
    saveAuditHistory(auditResult);

    if (previousScore === undefined) {
      // First run: full output + populate previousFailedIds for correct delta on next run
      log(options.formatter(auditResult));
      for (const cat of auditResult.categories) {
        for (const check of cat.checks) {
          if (!check.passed) {
            previousFailedIds.add(check.id);
          }
        }
      }
    } else {
      // Subsequent runs: delta only
      const diff = auditResult.overallScore - previousScore;
      const diffStr =
        diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : "unchanged";
      const timestamp = new Date().toLocaleTimeString("en-GB");

      // Find new failures
      const currentFailedIds = new Set<string>();
      for (const cat of auditResult.categories) {
        for (const check of cat.checks) {
          if (!check.passed) {
            currentFailedIds.add(check.id);
          }
        }
      }

      const newFailures: string[] = [];
      for (const id of currentFailedIds) {
        if (!previousFailedIds.has(id)) {
          // Find severity
          let severity = "";
          for (const cat of auditResult.categories) {
            const check = cat.checks.find((c) => c.id === id);
            if (check) {
              severity = ` (${check.severity})`;
              break;
            }
          }
          newFailures.push(`${id}${severity}`);
        }
      }

      const issueStr =
        newFailures.length > 0
          ? `New issues: ${newFailures.join(", ")}`
          : "New issues: 0";

      log(
        `[${timestamp}] Score: ${auditResult.overallScore}/100 (${diffStr}) | ${issueStr}`,
      );

      previousFailedIds = currentFailedIds;
    }

    previousScore = auditResult.overallScore;
  };

  return new Promise<void>((resolve) => {
    const cleanup = (): void => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      process.removeListener("SIGINT", onSigint);
      resolve();
    };

    const onSigint = (): void => {
      log("\nWatch mode stopped.");
      cleanup();
    };

    process.on("SIGINT", onSigint);

    // Run immediately
    runOnce().then(() => {
      timer = setInterval(() => {
        runOnce().catch((err: unknown) => {
          log(`[Error] Watch audit failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, interval);
    }).catch((err: unknown) => {
      log(`[Error] Initial audit failed: ${err instanceof Error ? err.message : String(err)}`);
      cleanup();
    });
  });
}
