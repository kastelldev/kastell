/**
 * Audit system type contracts.
 * All audit modules build against these interfaces.
 */

export type Severity = "critical" | "warning" | "info";

export type ComplianceCoverage = "full" | "partial";

export interface ComplianceRef {
  framework: string;    // e.g. "CIS", "PCI-DSS", "HIPAA"
  controlId: string;    // e.g. "5.2.1"
  version: string;      // Framework version, e.g. "1.0"
  description: string;  // Human-readable control description
  coverage: ComplianceCoverage;
}

export interface AuditCheck {
  id: string;                    // e.g. "SSH-01"
  category: string;              // e.g. "SSH"
  name: string;                  // e.g. "Password Authentication"
  severity: Severity;
  passed: boolean;
  currentValue: string;          // What was found
  expectedValue: string;         // What should be
  fixCommand?: string;           // Shell command to fix
  explain?: string;              // Why this matters
  complianceRefs?: ComplianceRef[];  // Compliance framework references (Phase 50)
  tags?: string[];               // Searchable tags e.g. ["ssh", "authentication"]
}

export interface AuditCategory {
  name: string;
  checks: AuditCheck[];
  score: number;                 // 0-100 for this category
  maxScore: number;
}

export interface AuditResult {
  serverName: string;
  serverIp: string;
  platform: "coolify" | "dokploy" | "bare";
  timestamp: string;
  categories: AuditCategory[];
  overallScore: number;          // Weighted average 0-100
  quickWins: QuickWin[];
}

export interface QuickWin {
  commands: string[];
  currentScore: number;
  projectedScore: number;
  description: string;
}

export interface AuditHistoryEntry {
  serverIp: string;
  serverName: string;
  timestamp: string;
  overallScore: number;
  categoryScores: Record<string, number>;
}

/** Check parser function signature — each category module exports this */
export type CheckParser = (sectionOutput: string, platform: string) => AuditCheck[];

/** Snapshot file envelope stored on disk */
export interface SnapshotFile {
  schemaVersion: number;
  name?: string;
  savedAt: string;
  audit: AuditResult;
}

/** Entry returned by listSnapshots */
export interface SnapshotListEntry {
  filename: string;
  savedAt: string;
  name?: string;
  overallScore: number;
  corrupt?: boolean;
}

// ─── Trend types ─────────────────────────────────────────────────────────────

export interface TrendCauseLine {
  category: string;
  scoreBefore: number;
  scoreAfter: number;
  delta: number;
}

export interface TrendEntry {
  timestamp: string;
  score: number;
  delta: number | null;         // null for the first entry
  causeList: TrendCauseLine[];  // empty when delta is null
}

export interface TrendResult {
  serverIp: string;
  serverName: string;
  entries: TrendEntry[];        // chronological, oldest first
}

// ─── Diff types ───────────────────────────────────────────────────────────────

export type CheckDiffStatus = "improved" | "regressed" | "unchanged" | "added" | "removed";

export interface CheckDiffEntry {
  id: string;
  name: string;
  category: string;
  severity: Severity;
  status: CheckDiffStatus;
  /** null when check did not exist in this snapshot */
  before: boolean | null;
  after: boolean | null;
}

export interface AuditDiffResult {
  beforeLabel: string;
  afterLabel: string;
  scoreBefore: number;
  scoreAfter: number;
  scoreDelta: number;
  improvements: CheckDiffEntry[];
  regressions: CheckDiffEntry[];
  unchanged: CheckDiffEntry[];
  added: CheckDiffEntry[];
  removed: CheckDiffEntry[];
}
