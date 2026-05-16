import type { ToolFixture } from "./index.js";

export const serverGuardFixtures: ToolFixture = {
  fixtures: [
    { action: "status", input: { action: "status", serverName: "test-server" } },
    { action: "install", input: { action: "install", serverName: "test-server" } },
    { action: "uninstall", input: { action: "uninstall", serverName: "test-server" } },
  ],
};