import { handleServerAudit } from "../../src/mcp/tools/serverAudit.js";

// Mock core dependencies
jest.mock("../../src/utils/config.js", () => ({
  getServers: jest.fn(() => [
    { id: "s1", name: "test-srv", provider: "hetzner", ip: "1.2.3.4", region: "nbg1", size: "cax11", mode: "bare", createdAt: "2026-01-01" },
  ]),
}));

jest.mock("../../src/core/audit/index.js", () => ({
  runAudit: jest.fn(() => Promise.resolve({
    success: true,
    data: {
      serverName: "test-srv",
      serverIp: "1.2.3.4",
      platform: "bare",
      overallScore: 65,
      timestamp: "2026-04-19T10:00:00Z",
      categories: [
        {
          name: "SSH",
          score: 8,
          maxScore: 10,
          checks: [
            { id: "SSH-001", name: "SSH key only", passed: true, severity: "critical", category: "SSH" },
            { id: "SSH-002", name: "Root login disabled", passed: false, severity: "critical", category: "SSH", explain: "Root login is enabled" },
          ],
        },
        {
          name: "Firewall",
          score: 5,
          maxScore: 10,
          checks: [
            { id: "FW-001", name: "UFW enabled", passed: true, severity: "warning", category: "Firewall" },
            { id: "FW-002", name: "Default deny", passed: false, severity: "warning", category: "Firewall", explain: "No default deny policy" },
          ],
        },
      ],
      quickWins: [],
    },
  })),
}));

jest.mock("../../src/core/audit/snapshot.js", () => ({
  saveSnapshot: jest.fn(() => Promise.resolve()),
  listSnapshots: jest.fn(() => Promise.resolve([])),
}));

jest.mock("../../src/core/audit/diff.js", () => ({
  resolveSnapshotRef: jest.fn(),
  diffAudits: jest.fn(),
  formatDiffJson: jest.fn(() => "{}"),
}));

describe("MCP server_audit parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("category filter", () => {
    it("filters audit result to specified category", async () => {
      const result = await handleServerAudit({ category: "SSH", format: "json" });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.categories).toHaveLength(1);
      expect(data.categories[0].name).toBe("SSH");
    });

    it("returns all categories when no category filter", async () => {
      const result = await handleServerAudit({ format: "json" });
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.categories).toHaveLength(2);
    });
  });

  describe("severity filter", () => {
    it("filters checks to specified severity", async () => {
      const result = await handleServerAudit({ severity: "critical", format: "json" });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      const allChecks = data.categories.flatMap((c: { checks: unknown[] }) => c.checks);
      expect(allChecks.every((ch: { severity: string }) => ch.severity === "critical")).toBe(true);
    });
  });

  describe("snapshot", () => {
    it("saves snapshot when snapshot param is true", async () => {
      const { saveSnapshot } = await import("../../src/core/audit/snapshot.js");
      await handleServerAudit({ snapshot: true });
      expect(saveSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ serverName: "test-srv" }),
        undefined,
      );
    });

    it("saves snapshot with custom name when snapshot is string", async () => {
      const { saveSnapshot } = await import("../../src/core/audit/snapshot.js");
      await handleServerAudit({ snapshot: "pre-upgrade" });
      expect(saveSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ serverName: "test-srv" }),
        "pre-upgrade",
      );
    });

    it("does not save snapshot when param is not provided", async () => {
      const { saveSnapshot } = await import("../../src/core/audit/snapshot.js");
      await handleServerAudit({});
      expect(saveSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("compare", () => {
    it("returns diff between two snapshots", async () => {
      const { resolveSnapshotRef, diffAudits, formatDiffJson } = await import("../../src/core/audit/diff.js");
      const mockAudit = { overallScore: 50, categories: [] };
      (resolveSnapshotRef as jest.Mock)
        .mockResolvedValueOnce({ audit: mockAudit })
        .mockResolvedValueOnce({ audit: { ...mockAudit, overallScore: 70 } });
      (diffAudits as jest.Mock).mockReturnValue({
        scoreDelta: 20,
        regressions: [],
        improvements: [],
        before: { label: "before" },
        after: { label: "after" },
      });
      (formatDiffJson as jest.Mock).mockReturnValue(JSON.stringify({ scoreDelta: 20 }));

      const result = await handleServerAudit({ compare: "before:after", format: "json" });
      expect(result.isError).toBeFalsy();
      expect(resolveSnapshotRef).toHaveBeenCalledTimes(2);
      expect(diffAudits).toHaveBeenCalled();
    });

    it("returns error for invalid compare format", async () => {
      const result = await handleServerAudit({ compare: "invalid" });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("before:after");
    });

    it("returns error when snapshot not found", async () => {
      const { resolveSnapshotRef } = await import("../../src/core/audit/diff.js");
      (resolveSnapshotRef as jest.Mock).mockResolvedValue(null);

      const result = await handleServerAudit({ compare: "snap1:snap2" });
      expect(result.isError).toBe(true);
    });
  });

  describe("threshold", () => {
    it("returns error when score is below threshold", async () => {
      const result = await handleServerAudit({ threshold: 80 });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("below threshold");
    });

    it("returns success when score meets threshold", async () => {
      const result = await handleServerAudit({ threshold: 50 });
      expect(result.isError).toBeFalsy();
    });
  });

  describe("profile", () => {
    it("filters checks by profile", async () => {
      const result = await handleServerAudit({ profile: "web-server", format: "json" });
      expect(result.isError).toBeFalsy();
    });

    it("returns error for invalid profile", async () => {
      const result = await handleServerAudit({ profile: "nonexistent-profile" });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("Invalid profile");
    });
  });
});
