import type { ToolFixture } from "./index.js";

export const serverMaintainFixtures: ToolFixture = {
  fixtures: [
    { action: "status", input: { action: "status", serverName: "test-server" } },
    { action: "update", input: { action: "update", serverName: "test-server" } },
    { action: "restart", input: { action: "restart", serverName: "test-server" } },
  ],
};