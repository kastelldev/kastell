/**
 * Audit system type contracts.
 * All audit modules build against these interfaces.
 */

export type Severity = "critical" | "warning" | "info";

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
