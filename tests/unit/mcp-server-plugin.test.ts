import { handleServerPlugin } from "../../src/mcp/tools/serverPlugin.js";
import { listPlugins, validatePlugins } from "../../src/core/plugin.js";

jest.mock("../../src/core/plugin.js", () => ({
  listPlugins: jest.fn(),
  validatePlugins: jest.fn(),
}));

const mockedListPlugins = listPlugins as jest.MockedFunction<typeof listPlugins>;
const mockedValidatePlugins = validatePlugins as jest.MockedFunction<typeof validatePlugins>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("server_plugin MCP tool", () => {
  describe("list action", () => {
    it("returns empty list when no plugins", async () => {
      mockedListPlugins.mockReturnValue([]);
      const result = await handleServerPlugin({ action: "list" });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.plugins).toEqual([]);
      expect(data.count).toBe(0);
    });

    it("returns plugin list with check counts", async () => {
      mockedListPlugins.mockReturnValue([
        { name: "kastell-plugin-wordpress", version: "1.0.0", prefix: "WP", checks: 2, status: "loaded" },
      ]);
      const result = await handleServerPlugin({ action: "list" });
      const data = JSON.parse(result.content[0].text);
      expect(data.plugins).toHaveLength(1);
      expect(data.plugins[0].name).toBe("kastell-plugin-wordpress");
      expect(data.plugins[0].checks).toBe(2);
      expect(data.count).toBe(1);
    });
  });

  describe("validate action", () => {
    it("returns validation results", async () => {
      mockedValidatePlugins.mockReturnValue([
        { name: "kastell-plugin-test", valid: true },
      ]);
      const result = await handleServerPlugin({ action: "validate" });
      const data = JSON.parse(result.content[0].text);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].valid).toBe(true);
    });

    it("validates specific plugin by name", async () => {
      mockedValidatePlugins.mockReturnValue([
        { name: "kastell-plugin-missing", valid: false, reason: "Plugin not found in registry" },
      ]);
      const result = await handleServerPlugin({ action: "validate", name: "kastell-plugin-missing" });
      const data = JSON.parse(result.content[0].text);
      expect(data.results[0].valid).toBe(false);
      expect(data.results[0].reason).toContain("not found");
    });
  });

  describe("unknown action", () => {
    it("returns error for unexpected action", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing runtime guard
      const result = await handleServerPlugin({ action: "destroy" } as any);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unexpected action");
    });
  });
});
