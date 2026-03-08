/**
 * Audit history persistence and trend detection.
 * Stores audit results per server and detects score changes over time.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join } from "path";
import { CONFIG_DIR } from "../../utils/config.js";
import type { AuditResult, AuditHistoryEntry } from "./types.js";

const HISTORY_FILENAME = "audit-history.json";

/** Get history file path lazily to support testing */
function getHistoryPath(): string {
  return join(CONFIG_DIR, HISTORY_FILENAME);
}

/** Max history entries per server to prevent unbounded growth */
const MAX_ENTRIES_PER_SERVER = 50;

/**
 * Load audit history for a specific server IP.
 * Returns empty array if no history exists or file is corrupt.
 */
export function loadAuditHistory(serverIp: string): AuditHistoryEntry[] {
  try {
    const historyFile = getHistoryPath();
    if (!existsSync(historyFile)) {
      return [];
    }
    const data = readFileSync(historyFile, "utf-8");
    const entries: AuditHistoryEntry[] = JSON.parse(data);
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries.filter((e) => e.serverIp === serverIp);
  } catch {
    return [];
  }
}

/**
 * Save audit result to history file.
 * Appends to existing history, caps at MAX_ENTRIES_PER_SERVER per server.
 * Uses atomic write pattern (write then rename) for safety.
 */
export function saveAuditHistory(result: AuditResult): void {
  const historyFile = getHistoryPath();

  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Load existing history
  let entries: AuditHistoryEntry[] = [];
  try {
    if (existsSync(historyFile)) {
      const data = readFileSync(historyFile, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        entries = parsed;
      }
    }
  } catch {
    // Start fresh if corrupt
    entries = [];
  }

  // Build new entry from result
  const categoryScores: Record<string, number> = {};
  for (const cat of result.categories) {
    categoryScores[cat.name] = cat.score;
  }

  const newEntry: AuditHistoryEntry = {
    serverIp: result.serverIp,
    serverName: result.serverName,
    timestamp: result.timestamp,
    overallScore: result.overallScore,
    categoryScores,
  };

  entries.push(newEntry);

  // Cap per server: keep most recent MAX_ENTRIES_PER_SERVER
  const serverEntries = entries.filter((e) => e.serverIp === result.serverIp);
  if (serverEntries.length > MAX_ENTRIES_PER_SERVER) {
    // Sort by timestamp ascending, remove oldest
    serverEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const toRemove = new Set(
      serverEntries.slice(0, serverEntries.length - MAX_ENTRIES_PER_SERVER),
    );
    entries = entries.filter(
      (e) => e.serverIp !== result.serverIp || !toRemove.has(e),
    );
  }

  // Write atomically via temp file + rename
  const tmpFile = historyFile + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(entries, null, 2), "utf-8");
  renameSync(tmpFile, historyFile);
}

/**
 * Detect score trend compared to previous audit.
 * Compares against the most recent history entry.
 */
export function detectTrend(
  currentScore: number,
  history: AuditHistoryEntry[],
): string {
  if (history.length === 0) {
    return "first audit";
  }

  // Find most recent entry
  const sorted = [...history].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  );
  const lastScore = sorted[0].overallScore;
  const diff = currentScore - lastScore;

  if (diff > 0) {
    return `+${diff} improvement`;
  } else if (diff < 0) {
    return `${diff} regression`;
  }
  return "unchanged";
}
