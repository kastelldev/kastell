/**
 * Tests for MCP server_audit framework parameter and compliance response.
 * Verifies that the optional `framework` param returns compliance detail,
 * and that skippedCategories appear in the JSON response when present.
 */

import * as config from "../../src/utils/config";
import * as auditRunner from "../../src/core/audit/index";
import { handleServerAudit, serverAuditSchema } from "../../src/mcp/tools/serverAudit";
import type { AuditResult } from "../../src/core/audit/types";
import type { ComplianceRef } from "../../src/core/audit/types";
import { z } from "zod";
import { CHECK_IDS } from "../../src/core/audit/checkIds.js";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/audit/index");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedAuditRunner = auditRunner as jest.Mocked<typeof auditRunner>;

const sampleServer = {
  id: "srv1",
  name: "test-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-03-16T00:00:00Z",
};

// CIS compliance ref for test checks
const cisL1Ref: ComplianceRef = {
  framework: "CIS",
  controlId: "5.2.1",
  version: "CIS Ubuntu 22.04 v2.0.0",
  description: "Ensure SSH access is limited",
  coverage: "full",
  level: "L1",
};

const pciRef: ComplianceRef = {
  framework: "PCI-DSS",
  controlId: "2.2.7",
  version: "PCI-DSS v4.0",
  description: "All non-console administrative access is encrypted",
  coverage: "full",
};

// AuditResult with compliance refs so calculateComplianceDetail works
const sampleAuditResult: AuditResult = {
  serverName: "test-server",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-16T00:00:00Z",
  auditVersion: "1.10.0",
  categories: [
    {
      name: "SSH",
      checks: [
        {
          id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
          category: "SSH",
          name: "Password Authentication",
          severity: "critical",
          passed: true,
          currentValue: "no",
          expectedValue: "no",
          complianceRefs: [cisL1Ref, pciRef],
        },
        {
          id: CHECK_IDS.SSH.SSH_ROOT_LOGIN,
          category: "SSH",
          name: "Root Login",
          severity: "critical",
          passed: false,
          currentValue: "yes",
          expectedValue: "prohibit-password",
          complianceRefs: [{ ...cisL1Ref, controlId: "5.2.5", description: "Ensure SSH root login is disabled" }],
        },
      ],
      score: 50,
      maxScore: 100,
    },
  ],
  overallScore: 50,
  quickWins: [],
};

// AuditResult with skippedCategories
const auditResultWithSkipped: AuditResult = {
  ...sampleAuditResult,
  skippedCategories: ["Docker"],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("MCP server_audit framework parameter", () => {
  it("serverAuditSchema accepts framework parameter and validates enum values", () => {
    const schema = z.object(serverAuditSchema);
    const validResult = schema.safeParse({ framework: "cis-level1" });
    expect(validResult.success).toBe(true);
    const invalidResult = schema.safeParse({ framework: "invalid-framework" });
    expect(invalidResult.success).toBe(false);
  });

  it("serverAuditSchema accepts all valid framework values", () => {
    const schema = z.object(serverAuditSchema);
    const frameworks = ["cis-level1", "cis-level2", "pci-dss", "hipaa"];
    for (const fw of frameworks) {
      expect(schema.safeParse({ framework: fw }).success).toBe(true);
    }
  });

  it("without framework param, returns standard summary without complianceDetail", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: sampleAuditResult });

    const result = await handleServerAudit({ server: "test-server", format: "summary" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.complianceDetail).toBeUndefined();
  });

  it("with framework='cis-level1' and format='json', response includes complianceDetail array", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: sampleAuditResult });

    const result = await handleServerAudit({ server: "test-server", format: "json", framework: "cis-level1" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.complianceDetail).toBeDefined();
    expect(Array.isArray(parsed.complianceDetail)).toBe(true);
    // Should contain CIS framework data
    const cisDetail = parsed.complianceDetail.find((d: { framework: string }) => d.framework === "CIS");
    expect(cisDetail).toBeDefined();
    expect(cisDetail.controls).toBeDefined();
  });

  it("with framework='pci-dss' and format='summary', summary includes Compliance section", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: sampleAuditResult });

    const result = await handleServerAudit({ server: "test-server", format: "summary", framework: "pci-dss" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary).toContain("Compliance");
    expect(parsed.summary).toContain("PCI-DSS");
  });

  it("JSON response includes skippedCategories when audit result has them", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: auditResultWithSkipped });

    const result = await handleServerAudit({ server: "test-server", format: "json" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skippedCategories).toBeDefined();
    expect(parsed.skippedCategories).toContain("Docker");
  });

  it("summary response includes skippedCategories when audit result has them", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: auditResultWithSkipped });

    const result = await handleServerAudit({ server: "test-server", format: "summary" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skippedCategories).toBeDefined();
    expect(parsed.skippedCategories).toContain("Docker");
  });

  it("summary response does NOT include skippedCategories when none present", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: sampleAuditResult });

    const result = await handleServerAudit({ server: "test-server", format: "summary" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.skippedCategories).toBeUndefined();
  });
});
