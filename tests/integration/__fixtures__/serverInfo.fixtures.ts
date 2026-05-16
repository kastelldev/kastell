import type { ToolFixture } from "./index.js";

export const serverInfoFixtures: ToolFixture = {
  fixtures: [
    { action: "list", input: { action: "list" } },
    { action: "status", input: { action: "status", serverName: "test-server" } },
    { action: "health", input: { action: "health", serverName: "test-server" } },
    { action: "sizes", input: { action: "sizes", provider: "hetzner", region: "fsn1" } },
  ],
};