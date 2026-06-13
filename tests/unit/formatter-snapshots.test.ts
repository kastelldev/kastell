/**
 * Snapshot tests for audit formatters.
 * Protects formatTerminal, formatSummary, and formatJson from silent regressions.
 * Any change to formatter output will cause a test failure.
 *
 * Fixture uses a fixed timestamp to ensure deterministic snapshots.
 * chalk is mocked to identity via jest.config.cjs moduleNameMapper.
 */

import type { AuditResult } from "../../src/core/audit/types";
import { formatTerminal } from "../../src/core/audit/formatters/terminal";
import { formatSummary } from "../../src/core/audit/formatters/summary";
import { formatJson } from "../../src/core/audit/formatters/json";

const FIXED_AUDIT_RESULT: AuditResult = {
  serverName: "snapshot-server",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-01-01T00:00:00.000Z",
  auditVersion: "1.0.0",
  overallScore: 42,
  categories: [
    {
      name: "SSH",
      score: 0,
      maxScore: 100,
      checks: [
        {
          id: "SSH-PASSWORD-AUTH",
          category: "SSH",
          name: "Password Authentication",
          severity: "critical",
          passed: false,
          currentValue: "yes",
          expectedValue: "no",
          fixCommand: "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
          explain: "Password authentication allows brute-force attacks. Use SSH keys instead.",
        },
      ],
    },
    {
      name: "Firewall",
      score: 100,
      maxScore: 100,
      checks: [
        {
          id: "FW-UFW-ACTIVE",
          category: "Firewall",
          name: "UFW Active",
          severity: "critical",
          passed: true,
          currentValue: "active",
          expectedValue: "active",
        },
      ],
    },
  ],
  quickWins: [
    {
      commands: [
        "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config",
        "systemctl restart sshd",
      ],
      currentScore: 42,
      projectedScore: 75,
      description: "Disable SSH password authentication",
    } as unknown as import("../../src/core/audit/types.js").QuickWin,
  ],
};

describe("formatter snapshots", () => {
  it("formatTerminal output matches snapshot", () => {
    const output = formatTerminal(FIXED_AUDIT_RESULT);
    expect(output).toMatchSnapshot();
  });

  it("formatSummary output matches snapshot", () => {
    const output = formatSummary(FIXED_AUDIT_RESULT);
    expect(output).toMatchSnapshot();
  });

  it("formatJson output matches snapshot", () => {
    const output = formatJson(FIXED_AUDIT_RESULT);
    expect(output).toMatchSnapshot();
  });
});
