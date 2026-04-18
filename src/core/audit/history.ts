/**
 * Audit history persistence and trend detection.
 * Stores audit results per server and detects score changes over time.
 * History entries are validated with Zod .strict() to prevent bloat.
 * detectTrend is version-aware: cross-methodology comparisons return "methodology-change".
 */

import {
  readFileSync,
  existsSync,
  renameSync,
} from "fs";
import { join } from "path";
import { z } from "zod";
import { KASTELL_DIR } from "../../utils/paths.js";
import { withFileLock } from "../../utils/fileLock.js";
import { secureWriteFileSync, secureMkdirSync } from "../../utils/secureWrite.js";
import type {
  AuditResult,
  AuditHistoryEntry,
  TrendEntry,
  TrendResult,
  TrendCauseLine,
} from "./types.js";

const HISTORY_FILENAME = "audit-history.json";

/** Get history file path lazily to support testing */
function getHistoryPath(): string {
  return join(KASTELL_DIR, HISTORY_FILENAME);
}

/** Max history entries per server to prevent unbounded growth */
const MAX_ENTRIES_PER_SERVER = 50;

/**
 * Zod schema for a single history entry.
 * Uses .strict() to reject extra fields (e.g. checks arrays) that bloat the history file.
 * auditVersion is optional for backward compat with legacy entries.
 */
const auditHistoryEntrySchema = z.object({
  serverIp: z.string(),
  serverName: z.string(),
  timestamp: z.string(),
  overallScore: z.number(),
  categoryScores: z.record(z.string(), z.number()),
  auditVersion: z.string().optional(),
}).strict();

const historyFileSchema = z.array(auditHistoryEntrySchema);

/**
 * Load audit history for a specific server IP.
 * Returns empty array if no history exists, file is corrupt, or any entry fails Zod .strict() validation.
 */
export function loadAuditHistory(serverIp: string): AuditHistoryEntry[] {
  try {
    const historyFile = getHistoryPath();
    if (!existsSync(historyFile)) {
      return [];
    }
    const data = readFileSync(historyFile, "utf-8");
    const result = historyFileSchema.safeParse(JSON.parse(data));
    if (!result.success) {
      return [];
    }
    return result.data.filter((e) => e.serverIp === serverIp);
  } catch {
    return [];
  }
}

/**
 * Save audit result to history file.
 * Appends to existing history, caps at MAX_ENTRIES_PER_SERVER per server.
 * Uses atomic write pattern (write then rename) for safety.
 * Wrapped in withFileLock to prevent concurrent write corruption.
 */
export async function saveAuditHistory(result: AuditResult): Promise<void> {
  const historyFile = getHistoryPath();

  await withFileLock(historyFile, () => {
    // Ensure config directory exists
    if (!existsSync(KASTELL_DIR)) {
      secureMkdirSync(KASTELL_DIR);
    }

    // Load existing history
    let entries: AuditHistoryEntry[] = [];
    try {
      if (existsSync(historyFile)) {
        const data = readFileSync(historyFile, "utf-8");
        const parsed = JSON.parse(data);
        const validated = historyFileSchema.safeParse(parsed);
        if (validated.success) {
          entries = validated.data;
        }
        // If validation fails, start fresh to avoid bloat propagation
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
      auditVersion: result.auditVersion,
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
    secureWriteFileSync(tmpFile, JSON.stringify(entries, null, 2), { encoding: "utf-8" });
    renameSync(tmpFile, historyFile);
  });
}

/**
 * Build cause list between two consecutive categoryScores maps.
 * Includes only categories whose score changed; sorted by abs(delta) descending.
 */
function buildCauseList(
  before: Record<string, number>,
  after: Record<string, number>,
): TrendCauseLine[] {
  const allCategories = new Set([...Object.keys(before), ...Object.keys(after)]);
  const causes: TrendCauseLine[] = [];

  for (const category of allCategories) {
    const scoreBefore = before[category] ?? 0;
    const scoreAfter = after[category] ?? 0;
    const delta = scoreAfter - scoreBefore;
    if (delta !== 0) {
      causes.push({ category, scoreBefore, scoreAfter, delta });
    }
  }

  causes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return causes;
}

/**
 * Compute trend from audit history entries.
 * Returns a TrendResult with chronological entries, score deltas, and cause attribution.
 * Pure function — no I/O.
 */
export function computeTrend(
  history: AuditHistoryEntry[],
  options?: { days?: number },
): TrendResult {
  if (history.length === 0) {
    return { serverIp: "", serverName: "", entries: [] };
  }

  // serverIp/serverName from the first element of the original array
  const { serverIp, serverName } = history[0];

  let filtered = [...history];

  // Apply days filter
  if (options?.days !== undefined) {
    const cutoff = new Date(Date.now() - options.days * 86_400_000).toISOString();
    filtered = filtered.filter((e) => e.timestamp >= cutoff);
  }

  if (filtered.length === 0) {
    return { serverIp, serverName, entries: [] };
  }

  // Sort chronologically oldest-first
  filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const entries: TrendEntry[] = filtered.map((entry, index) => {
    if (index === 0) {
      return {
        timestamp: entry.timestamp,
        score: entry.overallScore,
        delta: null,
        causeList: [],
      };
    }

    const prev = filtered[index - 1];
    const delta = entry.overallScore - prev.overallScore;
    const causeList = buildCauseList(prev.categoryScores, entry.categoryScores);

    return {
      timestamp: entry.timestamp,
      score: entry.overallScore,
      delta,
      causeList,
    };
  });

  return { serverIp, serverName, entries };
}

/**
 * Detect score trend compared to previous audit.
 * Version-aware: filters history to same auditVersion before comparing.
 * Returns "methodology-change" if no same-version history exists (cross-version comparison unsafe).
 * Legacy entries without auditVersion are treated as "1.0.0".
 */
export function detectTrend(
  currentScore: number,
  currentVersion: string,
  history: AuditHistoryEntry[],
): string {
  if (history.length === 0) {
    return "first audit";
  }

  // Filter to same audit version first, then find most recent
  const sameVersion = history.filter(
    (e) => (e.auditVersion ?? "1.0.0") === currentVersion,
  );

  if (sameVersion.length === 0) {
    return "methodology-change";
  }

  let latest = sameVersion[0];
  for (let i = 1; i < sameVersion.length; i++) {
    if (sameVersion[i].timestamp > latest.timestamp) {
      latest = sameVersion[i];
    }
  }

  const lastScore = latest.overallScore;
  const diff = currentScore - lastScore;

  if (diff > 0) {
    return `+${diff} improvement`;
  } else if (diff < 0) {
    return `${diff} regression`;
  }
  return "unchanged";
}
