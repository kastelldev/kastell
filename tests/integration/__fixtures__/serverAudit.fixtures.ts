import type { ToolFixture } from "./index.js";

export const serverAuditFixtures: ToolFixture = {
  fixtures: [
    { action: "run", input: { action: "run", serverName: "test-server" } },
    { action: "list", input: { action: "list" } },
  ],
};