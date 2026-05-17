import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as auditIndex from "../../../src/core/audit/index.js";
import * as fix from "../../../src/core/audit/fix.js";
import * as fixHistory from "../../../src/core/audit/fix-history.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1" });

const mockAuditResult = {
  success: true,
  data: {
    serverIp: "10.0.0.1", serverName: "web-1", overallScore: 85,
    categories: [{
      name: "Kernel", score: 10, checks: [
        { id: "KERN-SYNCOOKIES", name: "Sysctl net.ipv4.tcp_syncookies", passed: false, severity: "warning" as const, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1" },
      ],
    }],
    quickWins: [],
  },
};

const mockSafePlan = {
  safePlan: {
    groups: [{ severity: "warning", checks: [] }],
  },
  guardedCount: 0,
  forbiddenCount: 0,
  guardedIds: [],
};

// Mock the full handler response for dry-run mode
const mockDryRunResponse = {
  action: "apply" as const,
  dryRun: true,
  preview: { groups: [{ severity: "warning", checks: [{ id: "KERN-SYNCOOKIES", name: "Sysctl", category: "Kernel", severity: "warning" }] }] },
  rejectedChecks: [] as { id: string; reason: string }[],
  guardedCount: 0,
  forbiddenCount: 0,
  scoreBefore: 85,
};

export const serverFixFixtures: ToolFixture = {
  fixtures: [
    {
      action: "apply",
      input: { action: "apply", mode: "dry-run", server: "web-1" },
      setup: () => {
        const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findServerSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const auditSpy = jest.spyOn(auditIndex, "runAudit").mockResolvedValue(mockAuditResult as never);
        const fixSpy = jest.spyOn(fix, "previewSafeFixes").mockReturnValue(mockSafePlan as never);
        const historySpy = jest.spyOn(fixHistory, "loadFixHistory").mockReturnValue([]);
        return () => { getServersSpy.mockRestore(); findServerSpy.mockRestore(); auditSpy.mockRestore(); fixSpy.mockRestore(); historySpy.mockRestore(); };
      },
    },
    {
      action: "history",
      input: { action: "history", server: "web-1" },
      setup: () => {
        const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findServerSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const historySpy = jest.spyOn(fixHistory, "loadFixHistory").mockReturnValue([]);
        return () => { getServersSpy.mockRestore(); findServerSpy.mockRestore(); historySpy.mockRestore(); };
      },
    },
  ],
};