import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as manageCore from "../../../src/core/manage.js";
import { makeServerRecord } from "./_helpers.js";

const serverRecord = makeServerRecord({ id: "web-prod-1", name: "web-prod-1", ip: "185.234.1.1" });

export const serverManageFixtures: ToolFixture = {
  fixtures: [
    {
      action: "add",
      input: {
        action: "add",
        provider: "hetzner",
        ip: "185.234.1.2",
        name: "web-stage-1",
        skipVerify: true,
        mode: "coolify",
      },
      setup: () => {
        const add = jest.spyOn(manageCore, "addServerRecord").mockResolvedValue({
          success: true,
          server: makeServerRecord({
            id: "manual-web-stage-1",
            name: "web-stage-1",
            ip: "185.234.1.2",
          }),
          platformStatus: "skipped",
        });
        return () => add.mockRestore();
      },
    },
    {
      action: "remove",
      input: { action: "remove", server: "web-prod-1" },
      setup: () => {
        const safe = jest.spyOn(manageCore, "isSafeMode").mockReturnValue(false);
        const list = jest.spyOn(configUtils, "getServers").mockReturnValue([serverRecord]);
        const remove = jest.spyOn(manageCore, "removeServerRecord").mockResolvedValue({
          success: true,
          server: serverRecord,
        });
        return () => {
          safe.mockRestore();
          list.mockRestore();
          remove.mockRestore();
        };
      },
    },
    {
      action: "destroy",
      input: { action: "destroy", server: "web-prod-1" },
      setup: () => {
        const safe = jest.spyOn(manageCore, "isSafeMode").mockReturnValue(false);
        const destroy = jest.spyOn(manageCore, "destroyCloudServer").mockResolvedValue({
          success: true,
          server: serverRecord,
          cloudDeleted: true,
          localRemoved: true,
        });
        return () => {
          safe.mockRestore();
          destroy.mockRestore();
        };
      },
    },
  ],
};
