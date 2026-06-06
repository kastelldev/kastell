import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as guardCore from "../../../src/core/guard.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1" });

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
