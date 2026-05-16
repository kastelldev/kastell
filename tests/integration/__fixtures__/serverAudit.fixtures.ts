import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as auditIndex from "../../../src/core/audit/index.js";

const server = {
  id: "hcloud-1", name: "web-1", ip: "10.0.0.1",
  provider: "hetzner" as const, region: "fsn1" as const, size: "cx22" as const,
  mode: "bare" as const, sshPort: 22, sshUser: "root",
  createdAt: "2026-05-01T00:00:00Z", lastAuditAt: null, platformStatus: "running",
};

const mockAuditResult = {
  success: true,
  data: {
    serverIp: "10.0.0.1", serverName: "web-1", overallScore: 85,
    categories: [{
      name: "Kernel", score: 10, checks: [
        { id: "KERN-SYNCOOKIES", name: "Sysctl net.ipv4.tcp_syncookies", passed: true, severity: "warning" as const },
      ],
    }],
    quickWins: [],
  },
};

export const serverAuditFixtures: ToolFixture = {
  fixtures: [
    {
      action: "run",
      input: { action: "run", server: "web-1" },
      setup: () => {
        const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findServerSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const auditSpy = jest.spyOn(auditIndex, "runAudit").mockResolvedValue(mockAuditResult as never);
        return () => { getServersSpy.mockRestore(); findServerSpy.mockRestore(); auditSpy.mockRestore(); };
      },
    },
  ],
};