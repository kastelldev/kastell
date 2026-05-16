import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";

const servers = [
  { id: "web-1", name: "web-1", provider: "hetzner", ip: "10.0.0.1", region: "fsn1", size: "cx22", createdAt: "2024-01-01T00:00:00Z", mode: "bare" as const, sshPort: 22, sshUser: "root", lastAuditAt: null, platformStatus: "running" },
  { id: "db-1", name: "db-1", provider: "hetzner", ip: "10.0.0.2", region: "fsn1", size: "cx22", createdAt: "2024-01-01T00:00:00Z", mode: "bare" as const, sshPort: 22, sshUser: "root", lastAuditAt: null, platformStatus: "stopped" },
];

export const serverFleetFixtures: ToolFixture = {
  fixtures: [
    {
      action: "status",
      input: { action: "status" },
      setup: () => {
        const spy = jest.spyOn(configUtils, "getServers").mockReturnValue(servers);
        return () => spy.mockRestore();
      },
    },
  ],
};