/**
 * Audit snapshot persistence module.
 * Save, load, and list point-in-time audit result snapshots.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { z } from "zod";
import { CONFIG_DIR } from "../../utils/config.js";
import { withFileLock } from "../../utils/fileLock.js";
import type { AuditResult, SnapshotFile, SnapshotListEntry } from "./types.js";

const SCHEMA_VERSION = 1;

const complianceRefSchema = z.object({
  framework: z.string(),
  controlId: z.string(),
  version: z.string(),
  description: z.string(),
  coverage: z.enum(["full", "partial"]),
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
});

const categorySchema = z.object({
  name: z.string(),
  checks: z.array(auditCheckSchema),
  score: z.number(),
  maxScore: z.number(),
});

const quickWinSchema = z.object({
  commands: z.array(z.string()),
  currentScore: z.number(),
  projectedScore: z.number(),
  description: z.string(),
});

const snapshotFileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().optional(),
  savedAt: z.string(),
  audit: z.object({
    serverName: z.string(),
    serverIp: z.string(),
    platform: z.enum(["coolify", "dokploy", "bare"]),
    timestamp: z.string(),
    overallScore: z.number(),
    categories: z.array(categorySchema),
    quickWins: z.array(quickWinSchema),
  }),
});

/** Get the snapshot directory for a server IP (dots replaced with hyphens) */
function getSnapshotDir(serverIp: string): string {
  const safeIp = serverIp.replace(/\./g, "-");
  return join(CONFIG_DIR, "snapshots", safeIp);
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
    mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });

    const snapshotFile: SnapshotFile = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      audit: result,
    };
    if (sanitizedName !== undefined) {
      snapshotFile.name = sanitizedName;
    }

    const tmpFile = filePath + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(snapshotFile, null, 2), "utf-8");
    renameSync(tmpFile, filePath);
  });
}

/**
 * Load and validate a snapshot file.
 * Returns null for missing files, corrupt JSON, or unknown schema versions.
 */
export async function loadSnapshot(
  serverIp: string,
  filename: string,
): Promise<SnapshotFile | null> {
  const filePath = join(getSnapshotDir(serverIp), filename);

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const result = snapshotFileSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return result.data as SnapshotFile;
  } catch {
    return null;
  }
}

/**
 * List all snapshots for a server IP, sorted chronologically (oldest first).
 * Handles corrupt files gracefully by marking them with corrupt: true.
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
      const parsed = JSON.parse(raw) as unknown;
      const result = snapshotFileSchema.safeParse(parsed);
      if (!result.success) {
        return { filename, savedAt: "", overallScore: 0, corrupt: true };
      }
      const data = result.data;
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
