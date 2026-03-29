/**
 * Fix profiles module.
 * Defines 3 server profiles (web-server, database, mail-server) with
 * category sets used to filter audit checks before applying fixes.
 *
 * Category names MUST match CHECK_REGISTRY names exactly (see checks/index.ts).
 */

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

/** Type guard: returns true if name is a valid ProfileName */
export function isValidProfile(name: string): name is ProfileName {
  return name === "web-server" || name === "database" || name === "mail-server";
}

/**
 * Filters checks to only those whose category is in the given profile.
 * Order: checks first, profile second (consistent with Plan 03 call sites).
 */
export function filterChecksByProfile<T extends Pick<AuditCheck, "category">>(
  checks: T[],
  profile: ProfileName,
): T[] {
  const allowed = new Set(PROFILES[profile]);
  return checks.filter((c) => allowed.has(c.category));
}
