import type { ToolFixture } from "./index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as firewallCore from "../../../src/core/firewall.js";

const server = {
  id: "hcloud-1", name: "web-1", ip: "10.0.0.1",
  provider: "hetzner" as const, region: "fsn1" as const, size: "cx22" as const,
  mode: "bare" as const, sshPort: 22, sshUser: "root",
  createdAt: "2026-05-01T00:00:00Z", lastAuditAt: null, platformStatus: "running",
};

const mockFirewallStatus = {
  error: null,
  status: {
    active: true,
    rules: ["22/tcp ALLOW", "80/tcp ALLOW", "443/tcp ALLOW"],
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