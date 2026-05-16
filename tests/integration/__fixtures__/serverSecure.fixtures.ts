import type { ToolFixture } from "./index.js";

export const serverSecureFixtures: ToolFixture = {
  fixtures: [
    { action: "firewall-status", input: { action: "firewall-status", serverName: "test-server" } },
    { action: "firewall-setup", input: { action: "firewall-setup", serverName: "test-server" } },
  ],
};