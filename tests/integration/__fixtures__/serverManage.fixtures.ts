import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as safeModeUtils from "../../../src/utils/safeMode.js";
import * as manageCore from "../../../src/core/manage.js";
import { makeServerRecord } from "./_helpers.js";

const serverRecord = makeServerRecord({ id: "web-prod-1", name: "web-prod-1", ip: "185.234.1.1" });

export const serverManageFixtures: ToolFixture = {
  fixtures: [
    {
      action: "remove",
      input: { action: "remove", server: "web-prod-1" },
      setup: () => {
        const safe = jest.spyOn(safeModeUtils, "isSafeMode").mockReturnValue(false);
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
  ],
};
