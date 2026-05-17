import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as logsCore from "../../../src/core/logs.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1" });

export const serverLogsFixtures: ToolFixture = {
  fixtures: [
    {
      action: "logs",
      input: { action: "logs", server: "web-1", lines: 20 },
      setup: () => {
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const logsSpy = jest.spyOn(logsCore, "fetchServerLogs").mockResolvedValue({
          logs: "May 16 00:00:01 web-1 docker[1234]: Application started\nMay 16 00:00:02 web-1 systemd[1]: Started Daily Cleanup",
          service: "coolify" as const,
          lines: 20,
        });
        return () => { configSpy.mockRestore(); findSpy.mockRestore(); logsSpy.mockRestore(); };
      },
    },
    // NOTE: monitor action intentionally omitted — pre-existing schema mismatch
    // (SystemMetrics.cpu: string vs outputSchema cpu: {percent: number}). P137/F-018.
  ],
};