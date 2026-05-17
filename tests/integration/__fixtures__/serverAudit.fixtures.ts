import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as auditIndex from "../../../src/core/audit/index.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1" });

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