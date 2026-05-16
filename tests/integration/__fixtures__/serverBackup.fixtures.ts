import type { ToolFixture } from "./index.js";

export const serverBackupFixtures: ToolFixture = {
  fixtures: [
    { action: "backup-list", input: { action: "backup-list", serverName: "test-server" } },
    { action: "backup-now", input: { action: "backup-now", serverName: "test-server" } },
  ],
};