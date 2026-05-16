import type { ToolFixture } from "./index.js";

export const serverLogsFixtures: ToolFixture = {
  fixtures: [
    { action: "logs", input: { action: "logs", serverName: "test-server", service: "coolify" } },
    { action: "monitor", input: { action: "monitor", serverName: "test-server" } },
  ],
};