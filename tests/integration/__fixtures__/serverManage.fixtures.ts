import type { ToolFixture } from "./index.js";

export const serverManageFixtures: ToolFixture = {
  fixtures: [
    { action: "list", input: { action: "list" } },
    { action: "add", input: { action: "add", serverName: "test-server", ip: "1.2.3.4", mode: "coolify" } },
    { action: "remove", input: { action: "remove", serverName: "test-server" } },
  ],
};