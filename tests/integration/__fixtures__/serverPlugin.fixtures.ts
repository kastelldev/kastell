import type { ToolFixture } from "./index.js";

export const serverPluginFixtures: ToolFixture = {
  fixtures: [
    { action: "list", input: { action: "list" } },
    { action: "validate", input: { action: "validate", pluginName: "kastell" } },
  ],
};