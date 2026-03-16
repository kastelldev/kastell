/**
 * Check registry — maps section names to parser functions.
 * Routes batched SSH output to the correct category parser by named separator.
 */

import type { AuditCategory, CheckParser, ComplianceRef } from "../types.js";
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
import { parseAccountsChecks } from "./accounts.js";
import { parseServicesChecks } from "./services.js";
import { parseBootChecks } from "./boot.js";
import { parseSchedulingChecks } from "./scheduling.js";
import { parseTimeChecks } from "./time.js";
import { parseBannersChecks } from "./banners.js";
import { parseCryptoChecks } from "./crypto.js";
import { parseFileIntegrityChecks } from "./fileintegrity.js";
import { parseMalwareChecks } from "./malware.js";
import { parseMACChecks } from "./mac.js";
import { parseMemoryChecks } from "./memory.js";
import { parseSecretsChecks } from "./secrets.js";
import { parseCloudMetaChecks } from "./cloudmeta.js";
import { parseSupplyChainChecks } from "./supplychain.js";
import { parseBackupChecks } from "./backup.js";
import { parseResourceLimitsChecks } from "./resourcelimits.js";
import { parseIncidentReadyChecks } from "./incidentready.js";
import { parseDnsChecks } from "./dns.js";

export interface CategoryEntry {
  name: string;
  sectionName: string;
  parser: CheckParser;
}

/** Check registry — maps section names to parser functions */
export const CHECK_REGISTRY: CategoryEntry[] = [
  { name: "SSH", sectionName: "SSH", parser: parseSSHChecks },
  { name: "Firewall", sectionName: "FIREWALL", parser: parseFirewallChecks },
  { name: "Updates", sectionName: "UPDATES", parser: parseUpdatesChecks },
  { name: "Auth", sectionName: "AUTH", parser: parseAuthChecks },
  { name: "Docker", sectionName: "DOCKER", parser: parseDockerChecks },
  { name: "Network", sectionName: "NETWORK", parser: parseNetworkChecks },
  { name: "Filesystem", sectionName: "FILESYSTEM", parser: parseFilesystemChecks },
  { name: "Logging", sectionName: "LOGGING", parser: parseLoggingChecks },
  { name: "Kernel", sectionName: "KERNEL", parser: parseKernelChecks },
  { name: "Accounts", sectionName: "ACCOUNTS", parser: parseAccountsChecks },
  { name: "Services", sectionName: "SERVICES", parser: parseServicesChecks },
  { name: "Boot", sectionName: "BOOT", parser: parseBootChecks },
  { name: "Scheduling", sectionName: "SCHEDULING", parser: parseSchedulingChecks },
  { name: "Time", sectionName: "TIME", parser: parseTimeChecks },
  { name: "Banners", sectionName: "BANNERS", parser: parseBannersChecks },
  { name: "Crypto", sectionName: "CRYPTO", parser: parseCryptoChecks },
  { name: "File Integrity", sectionName: "FILEINTEGRITY", parser: parseFileIntegrityChecks },
  { name: "Malware", sectionName: "MALWARE", parser: parseMalwareChecks },
  { name: "MAC", sectionName: "MAC", parser: parseMACChecks },
  { name: "Memory", sectionName: "MEMORY", parser: parseMemoryChecks },
  { name: "Secrets", sectionName: "SECRETS", parser: parseSecretsChecks },
  { name: "Cloud Metadata", sectionName: "CLOUDMETA", parser: parseCloudMetaChecks },
  { name: "Supply Chain", sectionName: "SUPPLYCHAIN", parser: parseSupplyChainChecks },
  { name: "Backup Hygiene", sectionName: "BACKUP", parser: parseBackupChecks },
  { name: "Resource Limits", sectionName: "RESOURCELIMITS", parser: parseResourceLimitsChecks },
  { name: "Incident Readiness", sectionName: "INCIDENTREADY", parser: parseIncidentReadyChecks },
  { name: "DNS Security", sectionName: "DNS", parser: parseDnsChecks },
];

/** Named separator pattern used between sections in SSH batch output */
const SECTION_PATTERN = /---SECTION:([A-Z_]+)---/;

/**
 * Build a map of section name → section content from a batch output string.
 * Splits on named separators using a capturing group so names and content alternate.
 */
function buildSectionMap(batchOutput: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = batchOutput.split(SECTION_PATTERN);

  // parts: [ text-before-first-sep, NAME1, content1, NAME2, content2, ... ]
  // With capturing group split: index 0 is pre-separator text, then name/content pairs
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const sectionName = parts[i];
    const sectionContent = parts[i + 1].trim();
    map.set(sectionName, sectionContent);
  }

  return map;
}

/**
 * Parse all batch outputs into AuditCategory arrays.
 *
 * 1. Concatenates all batch outputs into a unified section map
 * 2. Routes by section name (---SECTION:NAME---) to the correct parser
 * 3. Calls each parser with its section output (empty string if section absent)
 * 4. Wraps results into AuditCategory objects with calculateCategoryScore
 */
export function parseAllChecks(
  batchOutputs: string[],
  platform: string,
): AuditCategory[] {
  // Build unified section map from all batches
  const sections = new Map<string, string>();

  for (const output of batchOutputs) {
    const batchMap = buildSectionMap(output);
    for (const [name, content] of batchMap) {
      sections.set(name, content);
    }
  }

  // Run each category parser against its named section
  return CHECK_REGISTRY.map((entry) => {
    const sectionOutput = sections.get(entry.sectionName) ?? "";
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

/**
 * Inject compliance references into parsed audit categories.
 * Called after parseAllChecks() — returns new objects, never mutates originals.
 */
export function mergeComplianceRefs(
  categories: AuditCategory[],
  map: Record<string, ComplianceRef[]>,
): AuditCategory[] {
  return categories.map((cat) => ({
    ...cat,
    checks: cat.checks.map((check) => {
      const refs = map[check.id];
      if (!refs || refs.length === 0) return check;
      return { ...check, complianceRefs: refs };
    }),
  }));
}
