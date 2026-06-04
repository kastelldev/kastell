import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import * as fs from "fs";

jest.mock("fs");

const mockedFs = fs as jest.Mocked<typeof fs>;

const asStats = (obj: object) => obj as unknown as import("fs").Stats;
const jsonString = (data: unknown) => JSON.stringify(data) as unknown as string;

describe("loadLatestAudit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns most recent audit for given IP", async () => {
    await jest.isolateModules(async () => {
      const historyEntry = {
        serverIp: "1.2.3.4",
        serverName: "test-server",
        timestamp: "2026-01-01T10:00:00.000Z",
        overallScore: 85,
        categoryScores: { SSH: 90, FIREWALL: 80 },
        auditVersion: "1.0.0",
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 1704067200000 }));
      mockedFs.readFileSync.mockReturnValue(jsonString([historyEntry]));

      const { loadLatestAudit, clearAuditCache } = await import("../../../src/core/audit/history.js");
      clearAuditCache();

      const result = loadLatestAudit("1.2.3.4");

      expect(result).not.toBeNull();
      expect(result?.serverIp).toBe("1.2.3.4");
      expect(result?.overallScore).toBe(85);
    });
  });

  it("returns null when no audit history exists", async () => {
    await jest.isolateModules(async () => {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      mockedFs.statSync.mockImplementation(() => { throw err; });

      const { loadLatestAudit, clearAuditCache } = await import("../../../src/core/audit/history.js");
      clearAuditCache();

      const result = loadLatestAudit("1.2.3.4");

      expect(result).toBeNull();
    });
  });

  it("uses single statSync (not existsSync + statSync) for file existence check", async () => {
    await jest.isolateModules(async () => {
      // statSync throws ENOENT — should be caught and return null
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      mockedFs.statSync.mockImplementation(() => { throw err; });

      const { loadLatestAudit, clearAuditCache } = await import("../../../src/core/audit/history.js");
      clearAuditCache();

      const result = loadLatestAudit("1.2.3.4");

      expect(result).toBeNull();
      expect(mockedFs.existsSync).not.toHaveBeenCalled();
    });
  });

  it("uses mtime cache when called twice", async () => {
    await jest.isolateModules(async () => {
      const historyEntry = {
        serverIp: "1.2.3.4",
        serverName: "test-server",
        timestamp: "2026-01-01T10:00:00.000Z",
        overallScore: 85,
        categoryScores: { SSH: 90 },
        auditVersion: "1.0.0",
      };

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 1704067200000 }));
      mockedFs.readFileSync.mockReturnValue(jsonString([historyEntry]));

      const { loadLatestAudit, clearAuditCache } = await import("../../../src/core/audit/history.js");
      clearAuditCache();

      loadLatestAudit("1.2.3.4");
      loadLatestAudit("1.2.3.4");

      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  it("parses only the last entry on cache miss (not full history)", async () => {
    await jest.isolateModules(async () => {
      // 100 entries for 1.2.3.4 + 100 for 5.6.7.8 — only last one is needed
      const entries = [
        ...Array.from({ length: 100 }, (_, i) => ({
          serverIp: "5.6.7.8",
          serverName: "other",
          timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
          overallScore: 50,
          categoryScores: {},
        })),
        {
          serverIp: "1.2.3.4",
          serverName: "test-server",
          timestamp: "2026-04-01T10:00:00.000Z",
          overallScore: 99,
          categoryScores: { SSH: 100 },
          auditVersion: "1.0.0",
        },
      ];

      mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 1704067200000 }));
      mockedFs.readFileSync.mockReturnValue(jsonString(entries));

      const { loadLatestAudit, clearAuditCache } = await import("../../../src/core/audit/history.js");
      clearAuditCache();

      const result = loadLatestAudit("1.2.3.4");

      expect(result?.serverIp).toBe("1.2.3.4");
      expect(result?.overallScore).toBe(99);
      // readFileSync called once, statSync called once — that's the contract
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
      expect(mockedFs.statSync).toHaveBeenCalledTimes(1);
    });
  });
});