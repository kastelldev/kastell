/**
 * Shared test fixtures for audit-related test files.
 * Contains factory functions for AuditResult, server records, and SSH output formatters.
 */

import type { AuditResult } from "../../src/core/audit/types";
import type { ServerRecord } from "../../src/types";

/**
 * Factory: create an AuditResult object for use in mock return values.
 * Used by compare.test.ts and audit-flags.test.ts.
 */
export function makeAuditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "coolify",
    timestamp: new Date().toISOString(),
    auditVersion: "1.0.0",
    categories: [
      {
        name: "SSH",
        score: 8,
        maxScore: 10,
        weight: 1,
        checks: [
          {
            id: "SSH-001",
            name: "SSH check",
            passed: true,
            severity: "medium",
          },
        ],
      },
    ],
    overallScore: 75,
    quickWins: [],
    skippedCategories: [],
    ...overrides,
  };
}

/**
 * Factory: create a minimal server record for mock return values.
 * Used by compare.test.ts and MCP integration tests.
 */
export function makeServerRecord(
  name: string,
  ip: string,
  overrides: Partial<ServerRecord> = {},
): ServerRecord {
  return {
    id: `test-${name}`,
    name,
    provider: "hetzner",
    ip,
    region: "nbg1",
    size: "cax11",
    createdAt: "2026-03-01T00:00:00Z",
    mode: "coolify",
    ...overrides,
  };
}

/**
 * Format SSH batch command output sections into the separator-delimited string
 * expected by the evidence handler parser.
 */
export function makeSshOutput(sections: string[]): string {
  return sections.join("\n---SEPARATOR---\n");
}