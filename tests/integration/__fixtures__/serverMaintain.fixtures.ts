import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as ssh from "../../../src/utils/ssh.js";
import * as manageUtils from "../../../src/core/manage.js";
import * as maintainCore from "../../../src/core/maintain.js";
import * as updateCore from "../../../src/core/update.js";
import * as tokensCore from "../../../src/core/tokens.js";
import * as factory from "../../../src/adapters/factory.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1", mode: "coolify" });

const mockPlatform = { name: "coolify", version: "v4.0.0", baseUrl: "https://10.0.0.1" } as never;

export const serverMaintainFixtures: ToolFixture = {
  fixtures: [
    {
      action: "update",
      input: { action: "update", server: "web-1" },
      setup: () => {
        const safeModeSpy = jest.spyOn(manageUtils, "isSafeMode").mockReturnValue(false);
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const tokenSpy = jest.spyOn(tokensCore, "getProviderToken").mockReturnValue("fake-token");
        const factorySpy = jest.spyOn(factory, "resolvePlatform").mockReturnValue(mockPlatform);
        const updateSpy = jest.spyOn(updateCore, "updateServer").mockResolvedValue({
          success: true, displayName: "Coolify",
        });
        return () => { safeModeSpy.mockRestore(); configSpy.mockRestore(); findSpy.mockRestore(); tokenSpy.mockRestore(); factorySpy.mockRestore(); updateSpy.mockRestore(); };
      },
    },
    {
      action: "restart",
      input: { action: "restart", server: "web-1" },
      setup: () => {
        const safeModeSpy = jest.spyOn(manageUtils, "isSafeMode").mockReturnValue(false);
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const tokenSpy = jest.spyOn(tokensCore, "getProviderToken").mockReturnValue("fake-token");
        const restartSpy = jest.spyOn(maintainCore, "rebootAndWait").mockResolvedValue({
          success: true, finalStatus: "running",
        });
        return () => { safeModeSpy.mockRestore(); configSpy.mockRestore(); findSpy.mockRestore(); tokenSpy.mockRestore(); restartSpy.mockRestore(); };
      },
    },
    {
      action: "maintain",
      input: { action: "maintain", server: "web-1" },
      setup: () => {
        const safeModeSpy = jest.spyOn(manageUtils, "isSafeMode").mockReturnValue(false);
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const tokenSpy = jest.spyOn(tokensCore, "getProviderToken").mockReturnValue("fake-token");
        const maintainSpy = jest.spyOn(maintainCore, "maintainServer").mockResolvedValue({
          success: true,
          server: "web-1",
          ip: "10.0.0.1",
          provider: "hetzner",
          steps: [
            { step: 1, name: "status", status: "success", detail: "OK" },
            { step: 2, name: "update", status: "success", detail: "Updated" },
            { step: 3, name: "health", status: "success", detail: "Healthy" },
            { step: 4, name: "reboot", status: "success" },
            { step: 5, name: "final", status: "success", detail: "Ready" },
          ],
        } as never);
        return () => { safeModeSpy.mockRestore(); configSpy.mockRestore(); findSpy.mockRestore(); tokenSpy.mockRestore(); maintainSpy.mockRestore(); };
      },
    },
  ],
};
