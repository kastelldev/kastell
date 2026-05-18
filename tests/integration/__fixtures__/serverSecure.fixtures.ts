import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as firewallCore from "../../../src/core/firewall.js";
import { makeServerRecord } from "./_helpers.js";

const server = makeServerRecord({ id: "hcloud-1", name: "web-1", ip: "10.0.0.1" });

const mockFirewallStatus = {
  error: null,
  status: {
    active: true,
    rules: [
      { port: "22", proto: "tcp", action: "ALLOW", from: "Anywhere" },
      { port: "80", proto: "tcp", action: "ALLOW", from: "Anywhere" },
      { port: "443", proto: "tcp", action: "ALLOW", from: "Anywhere" },
    ],
  },
};

export const serverSecureFixtures: ToolFixture = {
  fixtures: [
    {
      action: "firewall-status",
      input: { action: "firewall-status", server: "web-1" },
      setup: () => {
        const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([server]);
        const findServerSpy = jest.spyOn(configUtils, "findServer").mockReturnValue(server);
        const firewallSpy = jest.spyOn(firewallCore, "getFirewallStatus").mockResolvedValue(mockFirewallStatus as never);
        return () => { getServersSpy.mockRestore(); findServerSpy.mockRestore(); firewallSpy.mockRestore(); };
      },
    },
  ],
};
