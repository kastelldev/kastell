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
      mockedFs.existsSync.mockReturnValue(false);

      const { loadLatestAudit, clearAuditCache } = await import("../../../src/core/audit/history.js");
      clearAuditCache();

      const result = loadLatestAudit("1.2.3.4");

      expect(result).toBeNull();
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
});