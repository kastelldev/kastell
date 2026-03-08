/**
 * Check registry — maps section indices to parser functions.
 * Routes batched SSH output to the correct category parser.
 */

import type { AuditCategory, CheckParser } from "../types.js";
import { SECTION_INDICES } from "../commands.js";
import { calculateCategoryScore } from "../scoring.js";
import { parseSSHChecks } from "./ssh.js";
import { parseFirewallChecks } from "./firewall.js";
import { parseUpdatesChecks } from "./updates.js";
import { parseAuthChecks } from "./auth.js";
import { parseDockerChecks } from "./docker.js";
import { parseNetworkChecks } from "./network.js";
import { parseFilesystemChecks } from "./filesystem.js";
import { parseLoggingChecks } from "./logging.js";
import { parseKernelChecks } from "./kernel.js";

export interface CategoryEntry {
  name: string;
  sectionIndex: number;
  parser: CheckParser;
}

/** Check registry — maps section indices to parser functions */
export const CHECK_REGISTRY: CategoryEntry[] = [
  { name: "SSH", sectionIndex: SECTION_INDICES.SSH, parser: parseSSHChecks },
  { name: "Firewall", sectionIndex: SECTION_INDICES.FIREWALL, parser: parseFirewallChecks },
  { name: "Updates", sectionIndex: SECTION_INDICES.UPDATES, parser: parseUpdatesChecks },
  { name: "Auth", sectionIndex: SECTION_INDICES.AUTH, parser: parseAuthChecks },
  { name: "Docker", sectionIndex: SECTION_INDICES.DOCKER, parser: parseDockerChecks },
  { name: "Network", sectionIndex: SECTION_INDICES.NETWORK, parser: parseNetworkChecks },
  { name: "Filesystem", sectionIndex: SECTION_INDICES.FILESYSTEM, parser: parseFilesystemChecks },
  { name: "Logging", sectionIndex: SECTION_INDICES.LOGGING, parser: parseLoggingChecks },
  { name: "Kernel", sectionIndex: SECTION_INDICES.KERNEL, parser: parseKernelChecks },
];

/** Number of sections in batch 1 */
const BATCH1_SECTION_COUNT = 4;

/** Separator used between sections in SSH batch output */
const SEPARATOR = "---SEPARATOR---";

/**
 * Parse all batch outputs into AuditCategory arrays.
 *
 * 1. Splits each batch output by ---SEPARATOR---
 * 2. Maps section indices to the correct parser function
 * 3. Calls each parser with its section output
 * 4. Wraps results into AuditCategory objects with calculateCategoryScore
 */
export function parseAllChecks(
  batchOutputs: string[],
  platform: string,
): AuditCategory[] {
  // Build section map from batch outputs
  const sections = new Map<number, string>();

  for (let batchIdx = 0; batchIdx < batchOutputs.length; batchIdx++) {
    const parts = batchOutputs[batchIdx].split(SEPARATOR);
    const baseIndex = batchIdx === 0 ? 0 : BATCH1_SECTION_COUNT;

    for (let i = 0; i < parts.length; i++) {
      sections.set(baseIndex + i, parts[i].trim());
    }
  }

  // Run each category parser against its section
  return CHECK_REGISTRY.map((entry) => {
    const sectionOutput = sections.get(entry.sectionIndex) ?? "";
    const checks = entry.parser(sectionOutput, platform);
    const { score, maxScore } = calculateCategoryScore(checks);

    return {
      name: entry.name,
      checks,
      score,
      maxScore,
    };
  });
}
