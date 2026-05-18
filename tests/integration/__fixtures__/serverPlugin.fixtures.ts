import type { ToolFixture } from "./index.js";
import type { PluginListEntry, PluginValidationResult } from "../../../src/core/plugin.js";
import * as pluginCore from "../../../src/core/plugin.js";

const mockPlugins: PluginListEntry[] = [
  { name: "auditor", version: "1.0.0", prefix: "AUD", checks: 0, status: "loaded" },
  { name: "remediator", version: "1.0.0", prefix: "REM", checks: 0, status: "loaded" },
];

const mockValidationResults: PluginValidationResult[] = [
  { name: "auditor", valid: true },
  { name: "remediator", valid: true },
];

export const serverPluginFixtures: ToolFixture = {
  fixtures: [
    {
      action: "list",
      input: { action: "list" },
      setup: () => {
        const spy = jest.spyOn(pluginCore, "listPlugins").mockReturnValue(mockPlugins);
        return () => spy.mockRestore();
      },
    },
    {
      action: "validate",
      input: { action: "validate" },
      setup: () => {
        const spy = jest.spyOn(pluginCore, "validatePlugins").mockReturnValue(mockValidationResults);
        return () => spy.mockRestore();
      },
    },
  ],
};
