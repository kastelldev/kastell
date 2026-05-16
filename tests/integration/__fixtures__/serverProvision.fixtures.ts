import type { ToolFixture } from "./index.js";

export const serverProvisionFixtures: ToolFixture = {
  fixtures: [
    { action: "create", input: { action: "create", provider: "hetzner", region: "fsn1", serverType: "cx22" } },
    { action: "destroy", input: { action: "destroy", serverName: "test-server" } },
  ],
};