import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";

const makeServer = (name: string, ip: string, platformStatus = "running") => ({
  id: name, name, provider: "hetzner", ip, region: "fsn1", size: "cx22",
  createdAt: "2024-01-01T00:00:00Z", mode: "bare" as const, sshPort: 22, sshUser: "root", lastAuditAt: null, platformStatus,
});

const servers = [
  makeServer("web-prod-1", "185.234.1.1", "running"),
  makeServer("db-prod-1", "185.234.1.2", "stopped"),
];

const listSetup = () => {
  const spy = jest.spyOn(configUtils, "getServers").mockReturnValue(servers);
  return () => spy.mockRestore();
};

const statusSetup = () => {
  const spy = jest.spyOn(configUtils, "getServers").mockReturnValue([servers[0]]);
  return () => spy.mockRestore();
};

export const serverInfoFixtures: ToolFixture = {
  fixtures: [
    { action: "list",   input: { action: "list" },   setup: listSetup },
    { action: "status", input: { action: "status", serverName: "web-prod-1" }, setup: statusSetup },
    // "sizes" omitted: requires provider API mock — P138 fixture expansion scope
  ],
};