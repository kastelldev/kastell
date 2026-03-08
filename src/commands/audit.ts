/**
 * Audit command — thin wrapper for `kastell audit [server-name]`.
 * Delegates to core/audit/runAudit + formatters.
 */

import { resolveServer } from "../utils/serverSelect.js";
import { assertValidIp } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { runAudit } from "../core/audit/index.js";
import { selectFormatter } from "../core/audit/formatters/index.js";
import type { AuditCliOptions } from "../core/audit/formatters/index.js";

export interface AuditCommandOptions extends AuditCliOptions {
  host?: string;
  threshold?: string;
  fix?: boolean;
  dryRun?: boolean;
  watch?: string;
  category?: string;
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

  // Threshold check
  if (options.threshold) {
    const threshold = parseInt(options.threshold, 10);
    if (auditResult.overallScore < threshold) {
      logger.error(`Score ${auditResult.overallScore} is below threshold ${threshold}`);
      process.exit(1);
    }
  }
}
