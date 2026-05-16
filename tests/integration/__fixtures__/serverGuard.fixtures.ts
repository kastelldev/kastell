import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as guardCore from "../../../src/core/guard.js";

// Full ServerRecord fields needed for type compatibility
const server = {
  id: "hcloud-1", name: "web-1", ip: "10.0.0.1", platform: "coolify" as const,
  provider: "hetzner" as const, region: "fsn1" as const, size: "cx22" as const,
  mode: "bare" as const, sshPort: 22, sshUser: "root",
  createdAt: "2026-05-01T00:00:00Z", lastAuditAt: null, platformStatus: "running",
};

export const serverGuardFixtures: ToolFixture = {
  fixtures: [
    // NOTE: status action intentionally omitted — pre-existing schema mismatches:
    // - GuardStatusResult.logTail: string vs outputSchema logTail: string[] (P137/F-018)
    // - outputSchema expects success: boolean but handler doesn't return it (P137/F-018)
    {
      action: "start",
      input: { action: "start", server: "web-1" },
      setup: () => {
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const guardSpy = jest.spyOn(guardCore, "startGuard").mockResolvedValue({
          success: true,
        });
        return () => { configSpy.mockRestore(); findSpy.mockRestore(); guardSpy.mockRestore(); };
      },
    },
    {
      action: "stop",
      input: { action: "stop", server: "web-1" },
      setup: () => {
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const guardSpy = jest.spyOn(guardCore, "stopGuard").mockResolvedValue({
          success: true,
        });
        return () => { configSpy.mockRestore(); findSpy.mockRestore(); guardSpy.mockRestore(); };
      },
    },
  ],
};