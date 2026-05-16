import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as fleetCore from "../../../src/core/fleet.js";

const servers = [
  { id: "web-1", name: "web-1", provider: "hetzner" as const, ip: "10.0.0.1", region: "fsn1", size: "cx22", createdAt: "2024-01-01T00:00:00Z", mode: "bare" as const, sshPort: 22, sshUser: "root", lastAuditAt: null, platformStatus: "running" },
  { id: "db-1", name: "db-1", provider: "hetzner" as const, ip: "10.0.0.2", region: "fsn1", size: "cx22", createdAt: "2024-01-01T00:00:00Z", mode: "bare" as const, sshPort: 22, sshUser: "root", lastAuditAt: null, platformStatus: "stopped" },
];

const fleetRows = [
  { name: "web-1", ip: "10.0.0.1", provider: "hetzner", status: "ONLINE" as const, auditScore: 85, responseTime: 120, errorReason: null },
  { name: "db-1", ip: "10.0.0.2", provider: "hetzner", status: "OFFLINE" as const, auditScore: null, responseTime: null, errorReason: null },
];

export const serverFleetFixtures: ToolFixture = {
  fixtures: [
    {
      action: "status",
      input: {},
      setup: () => {
        const list = jest.spyOn(configUtils, "getServers").mockReturnValue(servers);
        const fleet = jest.spyOn(fleetCore, "runFleet").mockResolvedValue(fleetRows);
        return () => {
          list.mockRestore();
          fleet.mockRestore();
        };
      },
    },
  ],
};
