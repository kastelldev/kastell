import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as backupCore from "../../../src/core/backup.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1" });

export const serverBackupFixtures: ToolFixture = {
  fixtures: [
    {
      action: "backup-list",
      input: { action: "backup-list", server: "web-1" },
      setup: () => {
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const listSpy = jest.spyOn(backupCore, "listBackups").mockReturnValue(["2026-05-15-001", "2026-05-14-001"]);
        const loadSpy = jest.spyOn(backupCore, "loadManifest").mockReturnValue({
          serverName: "web-1",
          provider: "hetzner",
          timestamp: "2026-05-15T12:00:00Z",
          coolifyVersion: "v4.0.0",
          files: 12 as unknown as string[],
        });
        return () => { configSpy.mockRestore(); findSpy.mockRestore(); listSpy.mockRestore(); loadSpy.mockRestore(); };
      },
    },
  ],
};