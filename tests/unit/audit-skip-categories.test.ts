/**
 * Tests for opportunistic category skip detection and terminal display.
 * Verifies that categories where all checks have "not installed" currentValue
 * are flagged as skipped and shown in terminal output without affecting scores.
 */

import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import type { AuditCategory, AuditResult } from "../../src/core/audit/types";

// Helper: build a Docker "not installed" category (32 checks all with "Docker not installed")
function makeDockerSkippedCategory(): AuditCategory {
  const ids = [
    CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED, CHECK_IDS.DOCKER.DCK_VERSION_CURRENT,
    CHECK_IDS.DOCKER.DCK_USER_NAMESPACE, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK, CHECK_IDS.DOCKER.DCK_LOGGING_DRIVER,
    CHECK_IDS.DOCKER.DCK_LIVE_RESTORE, CHECK_IDS.DOCKER.DCK_NO_NEW_PRIVILEGES, CHECK_IDS.DOCKER.DCK_ICC_DISABLED,
    CHECK_IDS.DOCKER.DCK_TLS_VERIFY, CHECK_IDS.DOCKER.DCK_SOCKET_PERMS, CHECK_IDS.DOCKER.DCK_NO_ROOT_CONTAINERS,
    CHECK_IDS.DOCKER.DCK_READ_ONLY_ROOTFS, CHECK_IDS.DOCKER.DCK_LOG_MAX_SIZE, CHECK_IDS.DOCKER.DCK_DEFAULT_ULIMITS,
    CHECK_IDS.DOCKER.DCK_SECCOMP_ENABLED, CHECK_IDS.DOCKER.DCK_CONTENT_TRUST, CHECK_IDS.DOCKER.DCK_NO_SENSITIVE_MOUNTS,
    CHECK_IDS.DOCKER.DCK_APPARMOR_PROFILE, CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED_PORTS, CHECK_IDS.DOCKER.DCK_NETWORK_DISABLED,
    CHECK_IDS.DOCKER.DCK_LOG_DRIVER_CONFIGURED, CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE, CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK_INSPECT,
    CHECK_IDS.DOCKER.DCK_HEALTH_CHECK, CHECK_IDS.DOCKER.DCK_BRIDGE_NFCALL, CHECK_IDS.DOCKER.DCK_NO_INSECURE_REGISTRY,
    CHECK_IDS.DOCKER.DCK_NO_EXPERIMENTAL, CHECK_IDS.DOCKER.DCK_AUTH_PLUGIN, CHECK_IDS.DOCKER.DCK_REGISTRY_CERTS,
    CHECK_IDS.DOCKER.DCK_SWARM_INACTIVE, CHECK_IDS.DOCKER.DCK_PID_MODE,
  ];
  return {
    name: "Docker",
    checks: ids.map((id) => ({
      id,
      category: "Docker",
      name: id,
      severity: "info" as const,
      passed: true,
      currentValue: "Docker not installed",
      expectedValue: "Docker installed and configured securely",
    })),
    score: 100,
    maxScore: 100,
  };
}

function makeSshCategory(): AuditCategory {
  return {
    name: "SSH",
    checks: [
      {
        id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
        category: "SSH",
        name: "Password Auth",
        severity: "critical" as const,
        passed: true,
        currentValue: "no",
        expectedValue: "no",
      },
    ],
    score: 100,
    maxScore: 100,
  };
}

function makeBaseResult(extra: Partial<AuditResult> = {}): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-03-16T00:00:00.000Z",
    auditVersion: "1.10.0",
    categories: [makeSshCategory()],
    overallScore: 85,
    quickWins: [],
    ...extra,
  };
}

describe("detectSkippedCategories", () => {
  it("returns Docker in skipped list when all checks have 'Docker not installed' currentValue", async () => {
    const { detectSkippedCategories } = await import("../../src/core/audit/index");
    const categories = [makeSshCategory(), makeDockerSkippedCategory()];
    const skipped = detectSkippedCategories(categories);
    expect(skipped).toContain("Docker");
  });

  it("does NOT include SSH in skipped list when checks have real values", async () => {
    const { detectSkippedCategories } = await import("../../src/core/audit/index");
    const categories = [makeSshCategory(), makeDockerSkippedCategory()];
    const skipped = detectSkippedCategories(categories);
    expect(skipped).not.toContain("SSH");
  });

  it("does NOT include empty categories (0 checks) in skipped list", async () => {
    const { detectSkippedCategories } = await import("../../src/core/audit/index");
    const emptyCategory: AuditCategory = { name: "CloudMeta", checks: [], score: 0, maxScore: 0 };
    const categories = [emptyCategory, makeDockerSkippedCategory()];
    const skipped = detectSkippedCategories(categories);
    expect(skipped).not.toContain("CloudMeta");
    expect(skipped).toContain("Docker");
  });

  it("returns multiple skipped categories when multiple categories are skipped", async () => {
    const { detectSkippedCategories } = await import("../../src/core/audit/index");
    const malwareSkipped: AuditCategory = {
      name: "Malware",
      checks: [
        {
          id: "MLW-RKHUNTER",
          category: "Malware",
          name: "Rkhunter",
          severity: "info" as const,
          passed: true,
          currentValue: "rkhunter not installed",
          expectedValue: "rkhunter installed",
        },
      ],
      score: 100,
      maxScore: 100,
    };
    const categories = [makeSshCategory(), makeDockerSkippedCategory(), malwareSkipped];
    const skipped = detectSkippedCategories(categories);
    expect(skipped).toContain("Docker");
    expect(skipped).toContain("Malware");
    expect(skipped).not.toContain("SSH");
  });

  it("does NOT skip category when at least one check has a real (non-skip) value", async () => {
    const { detectSkippedCategories } = await import("../../src/core/audit/index");
    const mixedDockerCategory: AuditCategory = {
      name: "Docker",
      checks: [
        {
          id: CHECK_IDS.DOCKER.DCK_NO_TCP_SOCKET,
          category: "Docker",
          name: "No TCP Socket",
          severity: "info" as const,
          passed: true,
          currentValue: "Unix socket only",  // real value
          expectedValue: "No TCP socket",
        },
        {
          id: CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED,
          category: "Docker",
          name: "No Privileged",
          severity: "info" as const,
          passed: true,
          currentValue: "Docker not installed",
          expectedValue: "Docker installed",
        },
      ],
      score: 50,
      maxScore: 100,
    };
    const skipped = detectSkippedCategories([mixedDockerCategory]);
    expect(skipped).not.toContain("Docker");
  });

  it("detects 'N/A' currentValue as a skip signal", async () => {
    const { detectSkippedCategories } = await import("../../src/core/audit/index");
    const naCategory: AuditCategory = {
      name: "SomeCheck",
      checks: [
        {
          id: "SC-TEST",
          category: "SomeCheck",
          name: "Test",
          severity: "info" as const,
          passed: true,
          currentValue: "N/A",
          expectedValue: "installed",
        },
      ],
      score: 100,
      maxScore: 100,
    };
    const skipped = detectSkippedCategories([naCategory]);
    expect(skipped).toContain("SomeCheck");
  });
});

describe("formatTerminal with skippedCategories", () => {
  it("shows 'Skipped: Docker (not installed)' line when skippedCategories includes Docker", async () => {
    const { formatTerminal } = await import("../../src/core/audit/formatters/terminal");
    const result = makeBaseResult({ skippedCategories: ["Docker"] });
    const output = formatTerminal(result);
    expect(output).toContain("Skipped: Docker (not installed)");
  });

  it("does NOT show skipped line when skippedCategories is empty", async () => {
    const { formatTerminal } = await import("../../src/core/audit/formatters/terminal");
    const result = makeBaseResult({ skippedCategories: [] });
    const output = formatTerminal(result);
    expect(output).not.toContain("Skipped:");
  });

  it("does NOT show skipped line when skippedCategories is undefined", async () => {
    const { formatTerminal } = await import("../../src/core/audit/formatters/terminal");
    const result = makeBaseResult();  // no skippedCategories
    const output = formatTerminal(result);
    expect(output).not.toContain("Skipped:");
  });

  it("shows multiple skipped categories when present", async () => {
    const { formatTerminal } = await import("../../src/core/audit/formatters/terminal");
    const result = makeBaseResult({ skippedCategories: ["Docker", "Malware"] });
    const output = formatTerminal(result);
    expect(output).toContain("Skipped: Docker (not installed)");
    expect(output).toContain("Skipped: Malware (not installed)");
  });
});

describe("skippedCategories does not affect scoring", () => {
  it("overall score is identical with or without skippedCategories set", async () => {
    const { formatTerminal } = await import("../../src/core/audit/formatters/terminal");
    const withSkip = makeBaseResult({ skippedCategories: ["Docker"], overallScore: 85 });
    const withoutSkip = makeBaseResult({ overallScore: 85 });
    const outWith = formatTerminal(withSkip);
    const outWithout = formatTerminal(withoutSkip);
    // Both should show the same overall score
    expect(outWith).toContain("85");
    expect(outWithout).toContain("85");
  });
});
