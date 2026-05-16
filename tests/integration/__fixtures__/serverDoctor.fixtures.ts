import type { ToolFixture } from "./index.js";

export const serverDoctorFixtures: ToolFixture = {
  fixtures: [
    { action: "diagnose", input: { action: "diagnose", serverName: "test-server" } },
    { action: "fix", input: { action: "fix", serverName: "test-server", findingId: "test-finding" } },
  ],
};