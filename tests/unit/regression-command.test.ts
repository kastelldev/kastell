import { listBaselines, formatBaselineStatus, deleteBaseline, getBaselinePath } from "../../src/core/audit/regression.js";
import * as fs from "fs";

jest.mock("fs");

const mockFs = fs as jest.Mocked<typeof fs>;

describe("listBaselines", () => {
  it("returns empty array when regression dir does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(listBaselines()).toEqual([]);
  });

  it("lists all baseline files", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([
      { name: "1-2-3-4.json", isFile: () => true },
      { name: "10-0-0-5.json", isFile: () => true },
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    mockFs.readFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
      const p = String(filePath);
      if (p.includes("1-2-3-4")) {
        return JSON.stringify({
          version: 1,
          serverIp: "1.2.3.4",
          lastUpdated: "2026-04-20T14:30:00Z",
          bestScore: 78,
          passedChecks: Array(312).fill("CHECK"),
        });
      }
      return JSON.stringify({
        version: 1,
        serverIp: "10.0.0.5",
        lastUpdated: "2026-04-24T10:00:00Z",
        bestScore: 85,
        passedChecks: Array(340).fill("CHECK"),
      });
    });

    const result = listBaselines();
    expect(result).toHaveLength(2);
    expect(result[0].serverIp).toBe("1.2.3.4");
    expect(result[0].bestScore).toBe(78);
    expect(result[1].serverIp).toBe("10.0.0.5");
  });
});

describe("formatBaselineStatus", () => {
  it("formats single server status", () => {
    const baseline = {
      version: 1 as const,
      serverIp: "1.2.3.4",
      lastUpdated: "2026-04-20T14:30:00Z",
      bestScore: 78,
      passedChecks: Array(312).fill("CHECK"),
    };
    const output = formatBaselineStatus(baseline);
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("78");
    expect(output).toContain("312");
  });
});

describe("deleteBaseline", () => {
  it("deletes baseline file for given server", () => {
    mockFs.unlinkSync.mockImplementation(() => {});
    deleteBaseline("1.2.3.4");
    expect(mockFs.unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("1-2-3-4.json")
    );
  });

  it("throws when baseline does not exist", () => {
    mockFs.unlinkSync.mockImplementation(() => {
      const err = new Error("ENOENT") as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    });
    expect(() => deleteBaseline("1.2.3.4")).toThrow("No baseline found for 1.2.3.4");
  });
});