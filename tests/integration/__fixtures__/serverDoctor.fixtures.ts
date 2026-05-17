import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as doctorCore from "../../../src/core/doctor.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1", mode: "coolify" });

export const serverDoctorFixtures: ToolFixture = {
  fixtures: [
    {
      action: "diagnose",
      input: { action: "diagnose", server: "web-1" },
      setup: () => {
        const configSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const doctorSpy = jest.spyOn(doctorCore, "runServerDoctor").mockResolvedValue({
          success: true,
          data: {
            serverName: "web-1",
            serverIp: "10.0.0.1",
            findings: [
              { id: "d1", severity: "warning" as const, description: "Disk usage at 75%", command: "df -h", weight: 5 },
              { id: "d2", severity: "info" as const, description: "3 stale packages", command: "apt list --upgradable", weight: 1 },
            ],
            ranAt: "2026-05-16T00:00:00Z",
            usedFreshData: false,
            score: 91,
          },
        });
        return () => { configSpy.mockRestore(); findSpy.mockRestore(); doctorSpy.mockRestore(); };
      },
    },
  ],
};