import type { ToolFixture } from "./index.js";
import * as ssh from "../../../src/utils/ssh.js";
import * as configUtils from "../../../src/utils/config.js";
import * as manageUtils from "../../../src/core/manage.js";
import * as provisionCore from "../../../src/core/provision.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1" });

export const serverProvisionFixtures: ToolFixture = {
  fixtures: [
    {
      action: "create",
      input: { action: "create", provider: "hetzner", region: "fsn1", size: "cx22", name: "web-1", mode: "bare" },
      setup: () => {
        const safeModeSpy = jest.spyOn(manageUtils, "isSafeMode").mockReturnValue(false);
        const sshSpy = jest.spyOn(ssh, "sshExec").mockResolvedValue({ stdout: "", stderr: "", code: 0 } as never);
        const configSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const provisionSpy = jest.spyOn(provisionCore, "provisionServer").mockResolvedValue({
          success: true,
          server: { id: "hcloud-1", name: "web-1", provider: "hetzner", ip: "10.0.0.1", region: "fsn1", size: "cx22", createdAt: "2026-05-01T00:00:00Z", mode: "bare" as const },
        });
        return () => { safeModeSpy.mockRestore(); sshSpy.mockRestore(); configSpy.mockRestore(); provisionSpy.mockRestore(); };
      },
    },
  ],
};