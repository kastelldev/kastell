import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as statusCore from "../../../src/core/status.js";
import * as tokenCore from "../../../src/core/tokens.js";
import { twoServerList } from "./_helpers.js";

const servers = twoServerList;

const statusResult = {
  server: servers[0],
  serverStatus: "running",
  platformStatus: "running",
};

const listSetup = () => {
  const spy = jest.spyOn(configUtils, "getServers").mockReturnValue(servers);
  return () => spy.mockRestore();
};

const statusSetup = () => {
  const list = jest.spyOn(configUtils, "getServers").mockReturnValue([servers[0]]);
  const find = jest.spyOn(configUtils, "findServer").mockReturnValue(servers[0]);
  const token = jest.spyOn(tokenCore, "getProviderToken").mockReturnValue("test-token");
  const status = jest.spyOn(statusCore, "checkServerStatus").mockResolvedValue(statusResult);
  return () => {
    list.mockRestore();
    find.mockRestore();
    token.mockRestore();
    status.mockRestore();
  };
};

export const serverInfoFixtures: ToolFixture = {
  fixtures: [
    { action: "list",   input: { action: "list" },   setup: listSetup },
    { action: "status", input: { action: "status", server: "web-prod-1" }, setup: statusSetup },
    // "sizes" omitted: requires provider API mock — P138 fixture expansion scope
  ],
};
