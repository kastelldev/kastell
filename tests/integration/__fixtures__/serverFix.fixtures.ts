import type { ToolFixture } from "./index.js";

export const serverFixFixtures: ToolFixture = {
  fixtures: [
    // IMPORTANT: Wave B changed the schema — mode "dry-run" replaces dryRun boolean
    { action: "apply", input: { action: "apply", serverName: "test-server", mode: "dry-run" } },
  ],
};