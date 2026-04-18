/**
 * Audit snapshot persistence module.
 * Save, load, and list point-in-time audit result snapshots.
 * Schema v2 adds auditVersion to the audit envelope.
 * V1 snapshots are auto-migrated on load (auditVersion defaults to "1.0.0").
 */

import {
  readFileSync,
  existsSync,
  renameSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { secureMkdirSync, secureWriteFileSync } from "../../utils/secureWrite.js";
import { z } from "zod";
import { KASTELL_DIR } from "../../utils/paths.js";
import { withFileLock } from "../../utils/fileLock.js";
import type { AuditResult, SnapshotFile, SnapshotListEntry } from "./types.js";

const SCHEMA_VERSION = 2;

const complianceRefSchema = z.object({
  framework: z.string(),
  controlId: z.string(),
  version: z.string(),
  description: z.string(),
  coverage: z.enum(["full", "partial"]),
  level: z.enum(["L1", "L2"]).optional(),
});

const auditCheckSchema = z.object({
  id: z.string(),
  category: z.string(),
  name: z.string(),
  severity: z.enum(["critical", "warning", "info"]),
  passed: z.boolean(),
  currentValue: z.string(),
  expectedValue: z.string(),
  fixCommand: z.string().optional(),
  explain: z.string().optional(),
  complianceRefs: z.array(complianceRefSchema).optional(),
  tags: z.array(z.string()).optional(),
  vpsIrrelevant: z.boolean().optional(),
});

const categorySchema = z.object({
  name: z.string(),
  checks: z.array(auditCheckSchema),
  score: z.number(),
  maxScore: z.number(),
  connectionError: z.boolean().optional(),
});

const quickWinSchema = z.object({
  commands: z.array(z.string()),
  currentScore: z.number(),
  projectedScore: z.number(),
  description: z.string(),
});

/** Shared audit fields across schema versions */
const baseAuditSchema = z.object({
  serverName: z.string(),
  serverIp: z.string(),
  platform: z.enum(["coolify", "dokploy", "bare"]),
  timestamp: z.string(),
  overallScore: z.number(),
  categories: z.array(categorySchema),
  quickWins: z.array(quickWinSchema),
  skippedCategories: z.array(z.string()).optional(),
  vpsType: z.string().optional(),
  vpsAdjustedCount: z.number().optional(),
  warnings: z.array(z.string()).optional(),
});

const snapshotEnvelopeBase = {
  name: z.string().optional(),
  savedAt: z.string(),
};

/** Schema v1 — legacy format, no auditVersion field */
const snapshotFileV1Schema = z.object({
  schemaVersion: z.literal(1),
  ...snapshotEnvelopeBase,
  audit: baseAuditSchema,
});

/** Schema v2 — includes auditVersion in audit object */
const snapshotFileV2Schema = z.object({
  schemaVersion: z.literal(2),
  ...snapshotEnvelopeBase,
  audit: baseAuditSchema.extend({ auditVersion: z.string() }),
});

/** Get the snapshot directory for a server IP (dots replaced with hyphens) */
function getSnapshotDir(serverIp: string): string {
  const safeIp = serverIp.replace(/\./g, "-");
  return join(KASTELL_DIR, "snapshots", safeIp);
}

/** Sanitize a snapshot name: only [a-zA-Z0-9_-], max 64 chars */
function sanitizeSnapshotName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/** Build a filename from a timestamp (replace colons and dots with hyphens) */
function buildFilename(timestamp: string, name?: string): string {
  const safeTs = timestamp.replace(/[:.]/g, "-");
  if (name) {
    return `${safeTs}_${name}.json`;
  }
  return `${safeTs}.json`;
}

/**
 * Parse a raw snapshot JSON string, trying v2 first, then v1 with migration.
 * V1 snapshots are migrated to v2 (schemaVersion bumped, auditVersion defaults to "1.0.0").
 * Returns null for unknown schema versions or invalid data.
 */
function parseSnapshotFile(raw: string): SnapshotFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion === 2) {
    const v2 = snapshotFileV2Schema.safeParse(parsed);
    return v2.success ? (v2.data as SnapshotFile) : null;
  }
  if (obj.schemaVersion === 1) {
    const v1 = snapshotFileV1Schema.safeParse(parsed);
    if (v1.success) {
      return {
        ...v1.data,
        schemaVersion: 2,
        audit: { ...v1.data.audit, auditVersion: "1.0.0" },
      } as SnapshotFile;
    }
  }
  return null;
}

/**
 * Save an audit result as a snapshot.
 * Uses withFileLock + atomic write (tmp + rename) for safety.
 * Directory created with mode 0o700 if it doesn't exist.
 */
export async function saveSnapshot(
  result: AuditResult,
  name?: string,
): Promise<void> {
  const snapshotDir = getSnapshotDir(result.serverIp);
  const sanitizedName = name !== undefined ? sanitizeSnapshotName(name) : undefined;
  const filename = buildFilename(result.timestamp, sanitizedName);
  const filePath = join(snapshotDir, filename);

  await withFileLock(filePath, () => {
    secureMkdirSync(snapshotDir, { recursive: true });

    const snapshotFile: SnapshotFile = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      audit: result,
    };
    if (sanitizedName !== undefined) {
      snapshotFile.name = sanitizedName;
    }

    const tmpFile = filePath + ".tmp";
    secureWriteFileSync(tmpFile, JSON.stringify(snapshotFile, null, 2), { encoding: "utf-8" });
    renameSync(tmpFile, filePath);
  });
}

/**
 * Load and validate a snapshot file.
 * Supports schema v2 (native) and v1 (auto-migrated to v2).
 * Returns null for missing files, corrupt JSON, or unknown schema versions.
 */
export async function loadSnapshot(
  serverIp: string,
  filename: string,
): Promise<SnapshotFile | null> {
  const filePath = join(getSnapshotDir(serverIp), filename);

  try {
    const raw = readFileSync(filePath, "utf-8");
    return parseSnapshotFile(raw);
  } catch {
    return null;
  }
}

/**
 * List all snapshots for a server IP, sorted chronologically (oldest first).
 * Handles corrupt files gracefully by marking them with corrupt: true.
 * Supports both v1 (migrated) and v2 snapshot formats.
 * Returns empty array if no snapshots directory exists.
 */
export async function listSnapshots(serverIp: string): Promise<SnapshotListEntry[]> {
  const snapshotDir = getSnapshotDir(serverIp);

  if (!existsSync(snapshotDir)) {
    return [];
  }

  const files = readdirSync(snapshotDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  const entries: SnapshotListEntry[] = jsonFiles.map((filename) => {
    try {
      const raw = readFileSync(join(snapshotDir, filename), "utf-8");
      const data = parseSnapshotFile(raw);
      if (!data) {
        return { filename, savedAt: "", overallScore: 0, corrupt: true };
      }
      return {
        filename,
        savedAt: data.savedAt,
        overallScore: data.audit.overallScore,
        ...(data.name !== undefined ? { name: data.name } : {}),
      };
    } catch {
      return { filename, savedAt: "", overallScore: 0, corrupt: true };
    }
  });

  entries.sort((a, b) => a.savedAt.localeCompare(b.savedAt));

  return entries;
}
