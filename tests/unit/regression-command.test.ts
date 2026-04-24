import { listBaselines, formatBaselineStatus, deleteBaseline, getBaselinePath, formatRelativeTime } from "../../src/core/audit/regression.js";
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

describe("formatRelativeTime", () => {
  it("returns 'today' for current date", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("today");
  });

  it("returns '1 day ago' for yesterday", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(formatRelativeTime(yesterday)).toBe("1 day ago");
  });

  it("returns 'N days ago' for older dates", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect(formatRelativeTime(fiveDaysAgo)).toBe("5 days ago");
  });

  it("accepts Date objects", () => {
    const now = new Date();
    expect(formatRelativeTime(now)).toBe("today");
  });
});

describe("listBaselines edge cases", () => {
  it("skips corrupt JSON files", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([
      { name: "1-2-3-4.json", isFile: () => true },
      { name: "corrupt.json", isFile: () => true },
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    mockFs.readFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
      const p = String(filePath);
      if (p.includes("corrupt")) return "NOT VALID JSON{{{";
      return JSON.stringify({
        version: 1,
        serverIp: "1.2.3.4",
        lastUpdated: "2026-04-20T14:30:00Z",
        bestScore: 78,
        passedChecks: ["CHECK"],
      });
    });

    const result = listBaselines();
    expect(result).toHaveLength(1);
    expect(result[0].serverIp).toBe("1.2.3.4");
  });

  it("skips non-.json files", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([
      { name: "1-2-3-4.json", isFile: () => true },
      { name: "readme.txt", isFile: () => true },
      { name: "subdir", isFile: () => false },
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      version: 1,
      serverIp: "1.2.3.4",
      lastUpdated: "2026-04-20T14:30:00Z",
      bestScore: 78,
      passedChecks: ["CHECK"],
    }));

    const result = listBaselines();
    expect(result).toHaveLength(1);
  });

  it("skips files with wrong version", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([
      { name: "1-2-3-4.json", isFile: () => true },
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      version: 99,
      serverIp: "1.2.3.4",
      lastUpdated: "2026-04-20T14:30:00Z",
      bestScore: 78,
      passedChecks: ["CHECK"],
    }));

    const result = listBaselines();
    expect(result).toHaveLength(0);
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

  it("re-throws non-ENOENT errors", () => {
    mockFs.unlinkSync.mockImplementation(() => {
      const err = new Error("EPERM") as Error & { code: string };
      err.code = "EPERM";
      throw err;
    });
    expect(() => deleteBaseline("1.2.3.4")).toThrow("EPERM");
  });
});