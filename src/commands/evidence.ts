/**
 * Evidence command — thin wrapper for `kastell evidence [server-name]`.
 * Delegates to core/evidence.collectEvidence.
 */

import { readFileSync } from "fs";
import chalk from "chalk";
import { resolveServer } from "../utils/serverSelect.js";
import { logger, createSpinner } from "../utils/logger.js";
import { collectEvidence } from "../core/evidence.js";
import type { EvidenceOptions } from "../core/evidence.js";

/**
 * Execute the evidence collection command.
 * Flow: resolveServer -> spinner -> collectEvidence -> summary table -> warning
 */
interface EvidenceCommandOptions {
  name?: string;
  output?: string;
  lines?: string;
  docker?: boolean;
  sysinfo?: boolean;
  force?: boolean;
  json?: boolean;
  quiet?: boolean;
}

export async function evidenceCommand(
  serverArg: string | undefined,
  options: EvidenceCommandOptions,
): Promise<void> {
  const server = await resolveServer(serverArg, "Select a server to collect evidence from:");
  if (!server) return;

  const { name, ip } = server;
  const platform = (server.platform ?? server.mode ?? "bare") as string;

  const evidenceOpts: EvidenceOptions = {
    name: options.name,
    output: options.output,
    lines: parseInt(String(options.lines ?? "500"), 10) || 500,
    noDocker: options.docker === false,
    noSysinfo: options.sysinfo === false,
    force: options.force === true,
    json: options.json === true,
    quiet: options.quiet === true,
  };

  const spinner =
    !evidenceOpts.quiet
      ? createSpinner(`Collecting evidence from ${name}...`)
      : null;

  spinner?.start();

  const result = await collectEvidence(name, ip, platform, evidenceOpts);

  if (!result.success || !result.data) {
    spinner?.fail(result.error ?? "Evidence collection failed");
    process.exitCode = 1;
    return;
  }

  spinner?.succeed("Evidence collected");

  const { evidenceDir, totalFiles, skippedFiles, collectedAt, manifestPath } = result.data;

  // Summary table
  console.log("");
  console.log(chalk.bold("  Evidence Summary"));
  console.log(chalk.dim("  ─────────────────────────────────────────────"));
  console.log(`  ${chalk.cyan("Directory")}   ${evidenceDir}`);
  console.log(`  ${chalk.cyan("Files")}       ${totalFiles} collected, ${skippedFiles} skipped`);
  console.log(`  ${chalk.cyan("Platform")}    ${platform}`);
  console.log(`  ${chalk.cyan("Collected")}   ${collectedAt}`);
  console.log("");

  if (skippedFiles > 0) {
    process.exitCode = 2;
  }

  if (evidenceOpts.json) {
    const manifest = readFileSync(manifestPath, "utf-8");
    console.log(manifest);
  }

  logger.warning("Evidence directory may contain sensitive server data.");
}
