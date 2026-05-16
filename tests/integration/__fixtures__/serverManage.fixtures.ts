import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";

export const serverManageFixtures: ToolFixture = {
  fixtures: [
    {
      action: "list",
      input: { action: "list" },
      setup: () => {
        const spy = jest.spyOn(configUtils, "getServers").mockReturnValue([]);
        return () => spy.mockRestore();
      },
    },
  ],
};