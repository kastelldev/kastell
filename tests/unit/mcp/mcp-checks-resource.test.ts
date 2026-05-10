jest.mock("../../../src/core/audit/explainCheck.js", () => ({
  getFullCheckCatalog: jest.fn(),
  findCheckById: jest.fn(),
}));

import { readCheckCatalog, readCheckDetail } from "../../../src/mcp/resources/checks.js";
import { getFullCheckCatalog, findCheckById } from "../../../src/core/audit/explainCheck.js";

const mockGetCatalog = getFullCheckCatalog as jest.MockedFunction<typeof getFullCheckCatalog>;
const mockFindCheck = findCheckById as jest.MockedFunction<typeof findCheckById>;

describe("MCP checks resource", () => {
  describe("readCheckCatalog", () => {
    it("returns catalog summary", () => {
      mockGetCatalog.mockReturnValue([
        { id: "SSH-01", name: "Root Login", category: "SSH", severity: "critical" },
      ] as never);

      const result = readCheckCatalog();
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.checks).toHaveLength(1);
      expect(data.totalCount).toBe(1);
    });
  });

  describe("readCheckDetail", () => {
    it("returns check detail when found with fixCommand", () => {
      mockFindCheck.mockReturnValue({
        match: { id: "SSH-01", name: "Root Login", category: "SSH", severity: "critical", explain: "x", fixCommand: "cmd", fixTier: "SAFE", complianceRefs: [] },
        suggestions: undefined,
      } as never);

      const result = readCheckDetail("SSH-01");
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.id).toBe("SSH-01");
      expect(data.fixCommand).toBe("cmd");
    });

    it("returns null fixCommand when check has no fix", () => {
      mockFindCheck.mockReturnValue({
        match: { id: "SSH-02", name: "No Fix", category: "SSH", severity: "info", explain: "y", fixCommand: undefined, fixTier: undefined, complianceRefs: [] },
        suggestions: undefined,
      } as never);

      const result = readCheckDetail("SSH-02");
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.fixCommand).toBeNull();
    });

    it("returns error with suggestions when check not found", () => {
      mockFindCheck.mockReturnValue({
        match: null,
        suggestions: ["SSH-01", "SSH-02"],
      } as never);

      const result = readCheckDetail("NONEXIST");
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.error).toContain("NONEXIST");
      expect(data.suggestions).toEqual(["SSH-01", "SSH-02"]);
    });

    it("returns empty array when not found and suggestions undefined", () => {
      mockFindCheck.mockReturnValue({
        match: null,
        suggestions: undefined,
      } as never);

      const result = readCheckDetail("NOPE");
      const data = JSON.parse((result.contents[0] as { text: string }).text);
      expect(data.suggestions).toEqual([]);
    });
  });
});
