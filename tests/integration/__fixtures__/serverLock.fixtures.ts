import type { ToolFixture } from "./index.js";

export const serverLockFixtures: ToolFixture = {
  fixtures: [
    { action: "lock", input: { action: "lock", serverName: "test-server", production: true, dryRun: true } },
    { action: "unlock", input: { action: "unlock", serverName: "test-server", dryRun: true } },
  ],
};