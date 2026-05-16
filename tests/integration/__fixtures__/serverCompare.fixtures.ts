import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as auditDiff from "../../../src/core/audit/diff.js";
import * as auditIndex from "../../../src/core/audit/index.js";
import * as snapshot from "../../../src/core/audit/snapshot.js";

const servers = [
  {
    id: "hcloud-1", name: "web-1", ip: "10.0.0.1",
    provider: "hetzner" as const, region: "fsn1" as const, size: "cx22" as const,
    mode: "bare" as const, sshPort: 22, sshUser: "root",
    createdAt: "2026-05-01T00:00:00Z", lastAuditAt: null, platformStatus: "running",
  },
  {
    id: "hcloud-2", name: "db-1", ip: "10.0.0.2",
    provider: "hetzner" as const, region: "fsn1" as const, size: "cx22" as const,
    mode: "bare" as const, sshPort: 22, sshUser: "root",
    createdAt: "2026-05-01T00:00:00Z", lastAuditAt: null, platformStatus: "running",
  },
];

const mockAuditA = {
  success: true,
  data: {
    serverIp: "10.0.0.1", serverName: "web-1", overallScore: 75,
    categories: [{
      name: "Kernel", score: 10, checks: [
        { id: "KERN-SYNCOOKIES", name: "Sysctl net.ipv4.tcp_syncookies", passed: true, severity: "warning" as const },
      ],
    }],
    quickWins: [],
  },
};

const mockAuditB = {
  success: true,
  data: {
    serverIp: "10.0.0.2", serverName: "db-1", overallScore: 80,
    categories: [{
      name: "Kernel", score: 10, checks: [
        { id: "KERN-SYNCOOKIES", name: "Sysctl net.ipv4.tcp_syncookies", passed: true, severity: "warning" as const },
      ],
    }],
    quickWins: [],
  },
};

const mockCategorySummary = [
  { name: "Kernel", scoreA: 10, scoreB: 10, delta: 0 },
];

export const serverCompareFixtures: ToolFixture = {
  fixtures: [
    {
      action: "compare",
      input: { action: "compare", serverA: "web-1", serverB: "db-1" },
      setup: () => {
        const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue(servers);
        const findServerSpy = jest.spyOn(configUtils, "findServer").mockImplementation((query: string) => {
          return servers.find(s => s.name === query || s.ip === query);
        });
        const listSnapshotsSpy = jest.spyOn(snapshot, "listSnapshots").mockResolvedValue([]);
        const loadSnapshotSpy = jest.spyOn(snapshot, "loadSnapshot").mockResolvedValue(null);
        const runAuditSpy = jest.spyOn(auditIndex, "runAudit").mockImplementation(async (ip: string) => {
          if (ip === "10.0.0.1") return mockAuditA as never;
          if (ip === "10.0.0.2") return mockAuditB as never;
          return { success: false, error: "Unknown server" } as never;
        });
        const buildCategorySummarySpy = jest.spyOn(auditDiff, "buildCategorySummary").mockReturnValue(mockCategorySummary as never);
        return () => { getServersSpy.mockRestore(); findServerSpy.mockRestore(); listSnapshotsSpy.mockRestore(); loadSnapshotSpy.mockRestore(); runAuditSpy.mockRestore(); buildCategorySummarySpy.mockRestore(); };
      },
    },
  ],
};