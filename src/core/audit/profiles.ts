/**
 * Fix profiles module.
 * Defines 3 server profiles (web-server, database, mail-server) with
 * category sets used to filter audit checks before applying fixes.
 *
 * Category names MUST match CHECK_REGISTRY names exactly (see checks/index.ts).
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { CONFIG_DIR } from "../../utils/config.js";
import type { AuditCheck } from "./types.js";

export type ProfileName = "web-server" | "database" | "mail-server";

/**
 * 27 categories common to ALL profiles.
 * Excludes: WAF & Reverse Proxy, HTTP Security Headers, TLS Hardening, Backup Hygiene.
 */
export const COMMON_CATEGORIES: readonly string[] = [
  "SSH",
  "Firewall",
  "Kernel",
  "Auth",
  "Filesystem",
  "Logging",
  "Time",
  "DNS Security",
  "Crypto",
  "Updates",
  "Boot",
  "Memory",
  "Network",
  "Resource Limits",
  "Services",
  "Accounts",
  "MAC",
  "Secrets",
  "Scheduling",
  "Cloud Metadata",
  "File Integrity",
  "Incident Readiness",
  "Supply Chain",
  "Docker",
  "Malware",
  "DDoS Hardening",
  "Banners",
] as const;

/** Profile-specific categories added on top of COMMON_CATEGORIES */
export const PROFILES: Record<ProfileName, readonly string[]> = {
  "web-server": [
    ...COMMON_CATEGORIES,
    "WAF & Reverse Proxy",
    "HTTP Security Headers",
    "TLS Hardening",
  ],
  "database": [
    ...COMMON_CATEGORIES,
    "Backup Hygiene",
  ],
  "mail-server": [
    ...COMMON_CATEGORIES,
    "TLS Hardening",
  ],
};

const FIX_PROFILES_FILE = join(CONFIG_DIR, "fix-profiles.json");

const customProfileSchema = z.record(
  z.string(),
  z.object({ checks: z.array(z.string()) }),
);

export type CustomProfile = { checks: string[] };
export type CustomProfiles = Record<string, CustomProfile>;

export function loadCustomProfiles(): CustomProfiles {
  if (!existsSync(FIX_PROFILES_FILE)) return {};
  try {
    const data = readFileSync(FIX_PROFILES_FILE, "utf-8");
    const result = customProfileSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

/** Returns true if name is a valid built-in or custom profile */
export function isValidProfile(name: string): boolean {
  if (name in PROFILES) return true;
  const custom = loadCustomProfiles();
  return name in custom;
}

/**
 * Filters checks by profile. Built-in profiles filter by category,
 * custom profiles filter by check ID membership.
 */
export function filterChecksByProfile<T extends Pick<AuditCheck, "id" | "category">>(
  checks: T[],
  profile: ProfileName | string,
): T[] {
  if (profile in PROFILES) {
    const allowed = new Set(PROFILES[profile as ProfileName]);
    return checks.filter((c) => allowed.has(c.category));
  }
  const custom = loadCustomProfiles();
  const customProfile = custom[profile];
  if (!customProfile) return [];
  const allowedIds = new Set(customProfile.checks);
  return checks.filter((c) => allowedIds.has(c.id));
}
