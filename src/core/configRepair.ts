import { readFileSync, existsSync, copyFileSync, readdirSync, unlinkSync, renameSync } from "fs";
import { dirname, basename } from "path";
import { secureWriteFileSync } from "../utils/secureWrite.js";
import { SUPPORTED_PROVIDERS } from "../constants.js";

// mode is NOT required — legacy entries without mode are auto-fixed to "coolify" (matching getServers() behavior)
const REQUIRED_FIELDS = ["id", "name", "provider", "ip", "region", "size", "createdAt"] as const;
const AUTO_FIX_DEFAULTS: Record<string, string> = { mode: "coolify" };
const MAX_BACKUPS = 3;

export interface ConfigIssue {
  type: "invalid_json" | "not_array" | "missing_fields" | "unknown_provider" | "auto_fixable";
  message: string;
  index?: number;
}

export interface DiagnoseResult {
  status: "healthy" | "degraded" | "corrupt" | "missing";
  issues: ConfigIssue[];
  validCount: number;
  invalidCount: number;
  autoFixableCount: number;
  totalCount: number;
}

export interface RepairResult {
  backupPath: string;
  recoveredCount: number;
  droppedCount: number;
  autoFixedCount: number;
}

export function diagnoseConfig(filePath: string): DiagnoseResult {
  if (!existsSync(filePath)) {
    return { status: "missing", issues: [], validCount: 0, invalidCount: 0, autoFixableCount: 0, totalCount: 0 };
  }

  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "corrupt",
      issues: [{ type: "invalid_json", message: "File contains invalid JSON" }],
      validCount: 0, invalidCount: 0, autoFixableCount: 0, totalCount: 0,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      status: "corrupt",
      issues: [{ type: "not_array", message: "Root element is not an array" }],
      validCount: 0, invalidCount: 0, autoFixableCount: 0, totalCount: 0,
    };
  }

  const validProviders = new Set(SUPPORTED_PROVIDERS as readonly string[]);
  const issues: ConfigIssue[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let autoFixableCount = 0;

  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as Record<string, unknown>;
    const missing = REQUIRED_FIELDS.filter((f) => !entry[f]);
    if (missing.length > 0) {
      issues.push({
        type: "missing_fields",
        message: `Entry ${i} ("${entry.name || "unknown"}") missing: ${missing.join(", ")}`,
        index: i,
      });
      invalidCount++;
      continue;
    }

    if (entry.provider && !validProviders.has(entry.provider as string)) {
      issues.push({
        type: "unknown_provider",
        message: `Entry ${i} ("${entry.name}") has unknown provider "${entry.provider}"`,
        index: i,
      });
      invalidCount++;
      continue;
    }

    // Check auto-fixable fields (e.g. missing mode)
    const fixable = Object.keys(AUTO_FIX_DEFAULTS).filter((f) => !entry[f]);
    if (fixable.length > 0) {
      issues.push({
        type: "auto_fixable",
        message: `Entry ${i} ("${entry.name}") missing ${fixable.join(", ")} — will be auto-fixed`,
        index: i,
      });
      autoFixableCount++;
    } else {
      validCount++;
    }
  }

  const status = invalidCount > 0 ? "degraded" : autoFixableCount > 0 ? "degraded" : issues.length === 0 ? "healthy" : "degraded";
  return { status, issues, validCount, invalidCount, autoFixableCount, totalCount: parsed.length };
}

export function repairConfig(filePath: string): RepairResult {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = filePath + `.backup-${timestamp}`;
  copyFileSync(filePath, backupPath);

  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    atomicWrite(filePath, "[]");
    pruneBackups(filePath);
    return { backupPath, recoveredCount: 0, droppedCount: 0, autoFixedCount: 0 };
  }

  if (!Array.isArray(parsed)) {
    atomicWrite(filePath, "[]");
    pruneBackups(filePath);
    return { backupPath, recoveredCount: 0, droppedCount: 0, autoFixedCount: 0 };
  }

  const validProviders = new Set(SUPPORTED_PROVIDERS as readonly string[]);
  const recovered: Record<string, unknown>[] = [];
  let droppedCount = 0;
  let autoFixedCount = 0;

  for (const entry of parsed as Record<string, unknown>[]) {
    const missing = REQUIRED_FIELDS.filter((f) => !entry[f]);
    if (missing.length > 0) {
      droppedCount++;
      continue;
    }
    if (entry.provider && !validProviders.has(entry.provider as string)) {
      droppedCount++;
      continue;
    }
    // Auto-fix defaults (e.g. mode)
    for (const [field, defaultVal] of Object.entries(AUTO_FIX_DEFAULTS)) {
      if (!entry[field]) {
        entry[field] = defaultVal;
        autoFixedCount++;
      }
    }
    recovered.push(entry);
  }

  atomicWrite(filePath, JSON.stringify(recovered, null, 2));
  pruneBackups(filePath);
  return { backupPath, recoveredCount: recovered.length, droppedCount, autoFixedCount };
}

function atomicWrite(filePath: string, content: string): void {
  const tmpFile = filePath + ".tmp";
  secureWriteFileSync(tmpFile, content);
  renameSync(tmpFile, filePath);
}

function pruneBackups(filePath: string): void {
  const dir = dirname(filePath);
  const base = basename(filePath);
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(base + ".backup-"))
    .sort();
  while (backups.length > MAX_BACKUPS) {
    const oldest = backups.shift()!;
    try { unlinkSync(`${dir}/${oldest}`); } catch { /* best-effort */ }
  }
}
