import {
  loadBaseline,
  saveBaseline,
  checkRegression,
  getBaselinePath,
} from "../../src/core/audit/regression.js";
import type { AuditResult } from "../../src/core/audit/types.js";
import * as fs from "fs";

jest.mock("fs");
jest.mock("../../src/utils/paths.js", () => ({
  KASTELL_DIR: "/home/user/.kastell",
}));
jest.mock("../../src/utils/secureWrite", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
  clearCache: jest.fn(),
}));
jest.mock("../../src/utils/fileLock", () => ({
  withFileLock: jest.fn((_path: string, fn: () => unknown) => fn()),
}));

const mockedSecureWrite = require("../../src/utils/secureWrite") as {
  secureMkdirSync: jest.Mock;
  secureWriteFileSync: jest.Mock;
};

function makeAuditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-04-21T10:00:00.000Z",
    auditVersion: "1.0.0",
    categories: [
      {
        name: "SSH",
        checks: [
          { id: "SSH-001", name: "Root login disabled", severity: "critical", passed: true, category: "SSH", currentValue: "", expectedValue: "" },
          { id: "SSH-002", name: "Password auth disabled", severity: "critical", passed: true, category: "SSH", currentValue: "", expectedValue: "" },
          { id: "SSH-003", name: "Protocol version", severity: "warning", passed: false, category: "SSH", currentValue: "", expectedValue: "" },
        ],
        score: 66,
        maxScore: 100,
      },
    ],
    overallScore: 66,
    quickWins: [],
    ...overrides,
  };
}

describe("regression suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getBaselinePath", () => {
    it("should return path with safe IP", () => {
      const path = getBaselinePath("1.2.3.4");
      expect(path).toContain("regression");
      expect(path).toContain("1-2-3-4.json");
    });
  });

  describe("loadBaseline", () => {
    it("should return null when file does not exist", () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(loadBaseline("1.2.3.4")).toBeNull();
    });

    it("should parse valid baseline file", () => {
      const baseline = {
        version: 1,
        serverIp: "1.2.3.4",
        lastUpdated: "2026-04-20T10:00:00Z",
        bestScore: 70,
        passedChecks: ["SSH-001", "SSH-002"],
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(baseline));

      const result = loadBaseline("1.2.3.4");
      expect(result).toEqual(baseline);
    });

    it("should return null for corrupt file", () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue("not json");

      expect(loadBaseline("1.2.3.4")).toBeNull();
    });
  });

  describe("saveBaseline", () => {
    it("should extract passed check IDs from audit result", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await saveBaseline(makeAuditResult());

      expect(mockedSecureWrite.secureWriteFileSync).toHaveBeenCalled();
      const written = JSON.parse(
        mockedSecureWrite.secureWriteFileSync.mock.calls[0][1] as string
      );
      expect(written.passedChecks).toEqual(["SSH-001", "SSH-002"]);
      expect(written.bestScore).toBe(66);
      expect(written.serverIp).toBe("1.2.3.4");
    });

    it("should preserve bestScore if current is lower", async () => {
      const existingBaseline = {
        version: 1,
        serverIp: "1.2.3.4",
        lastUpdated: "2026-04-20T10:00:00Z",
        bestScore: 80,
        passedChecks: ["SSH-001", "SSH-002", "SSH-003"],
      };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(existingBaseline));

      await saveBaseline(makeAuditResult({ overallScore: 66 }));

      const written = JSON.parse(
        mockedSecureWrite.secureWriteFileSync.mock.calls[0][1] as string
      );
      expect(written.bestScore).toBe(80);
    });
  });

  describe("checkRegression", () => {
    it("should detect regressed checks", () => {
      const baseline = {
        version: 1 as const,
        serverIp: "1.2.3.4",
        lastUpdated: "2026-04-20T10:00:00Z",
        bestScore: 80,
        passedChecks: ["SSH-001", "SSH-002", "SSH-003"],
      };
      const audit = makeAuditResult(); // SSH-003 fails

      const result = checkRegression(baseline, audit);
      expect(result.regressions).toEqual(["SSH-003"]);
      expect(result.newPasses).toEqual([]);
      expect(result.baselineScore).toBe(80);
      expect(result.currentScore).toBe(66);
    });

    it("should detect new passes", () => {
      const baseline = {
        version: 1 as const,
        serverIp: "1.2.3.4",
        lastUpdated: "2026-04-20T10:00:00Z",
        bestScore: 50,
        passedChecks: ["SSH-001"],
      };
      const audit = makeAuditResult(); // SSH-001 + SSH-002 pass

      const result = checkRegression(baseline, audit);
      expect(result.regressions).toEqual([]);
      expect(result.newPasses).toEqual(["SSH-002"]);
    });

    it("should return empty arrays when no changes", () => {
      const baseline = {
        version: 1 as const,
        serverIp: "1.2.3.4",
        lastUpdated: "2026-04-20T10:00:00Z",
        bestScore: 66,
        passedChecks: ["SSH-001", "SSH-002"],
      };
      const audit = makeAuditResult();

      const result = checkRegression(baseline, audit);
      expect(result.regressions).toEqual([]);
      expect(result.newPasses).toEqual([]);
    });
  });
});
