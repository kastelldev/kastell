import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as ssh from "../../../src/utils/ssh.js";
import * as lockCore from "../../../src/core/lock/index.js";

const server = {
  id: "hcloud-1", name: "web-1", ip: "10.0.0.1",
  provider: "hetzner" as const, region: "fsn1" as const, size: "cx22" as const,
  mode: "bare" as const, sshPort: 22, sshUser: "root",
  createdAt: "2026-05-01T00:00:00Z", lastAuditAt: null, platformStatus: "running",
};

const mockLockResult = {
  success: true,
  steps: 24,
  scoreBefore: 45,
  scoreAfter: 92,
  stepErrors: {},
};

export const serverLockFixtures: ToolFixture = {
  fixtures: [
    {
      action: "lock",
      input: { action: "lock", server: "web-1", production: true, dryRun: true },
      setup: () => {
        const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findServerSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const sshSpy = jest.spyOn(ssh, "sshExec").mockResolvedValue({ stdout: "", stderr: "", code: 0 } as never);
        const lockSpy = jest.spyOn(lockCore, "applyLock").mockResolvedValue(mockLockResult as never);
        return () => { getServersSpy.mockRestore(); findServerSpy.mockRestore(); sshSpy.mockRestore(); lockSpy.mockRestore(); };
      },
    },
  ],
};