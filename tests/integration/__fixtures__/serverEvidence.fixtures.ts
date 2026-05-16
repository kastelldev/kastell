import type { ToolFixture } from "./index.js";

export const serverEvidenceFixtures: ToolFixture = {
  fixtures: [
    { action: "collect", input: { action: "collect", serverName: "test-server" } },
    { action: "list", input: { action: "list", serverName: "test-server" } },
  ],
};