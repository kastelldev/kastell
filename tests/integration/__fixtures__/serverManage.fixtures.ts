import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as safeModeUtils from "../../../src/utils/safeMode.js";
import * as manageCore from "../../../src/core/manage.js";

const serverRecord = {
  id: "web-prod-1",
  name: "web-prod-1",
  provider: "hetzner" as const,
  ip: "185.234.1.1",
  region: "fsn1",
  size: "cx22",
  createdAt: "2024-01-01T00:00:00Z",
  mode: "bare" as const,
  sshPort: 22,
  sshUser: "root",
  lastAuditAt: null,
  platformStatus: "running",
};

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
