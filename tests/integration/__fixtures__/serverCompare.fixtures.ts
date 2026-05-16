import type { ToolFixture } from "./index.js";

export const serverCompareFixtures: ToolFixture = {
  fixtures: [
    { action: "compare", input: { action: "compare", serverA: "server-a", serverB: "server-b" } },
  ],
};