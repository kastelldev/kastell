import * as auditIndex from "../../../src/core/audit/index";
import * as snapshotModule from "../../../src/core/audit/snapshot";
import * as ssh from "../../../src/utils/ssh";
import { resolveAuditPair } from "../../../src/core/audit/diff";

jest.mock("../../../src/core/audit/index");
jest.mock("../../../src/core/audit/snapshot");
jest.mock("../../../src/utils/ssh");

const mockedAudit = auditIndex as jest.Mocked<typeof auditIndex>;
const mockedSnapshot = snapshotModule as jest.Mocked<typeof snapshotModule>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;

function makeServer(name: string, ip: string) {
  return {
    id: `srv-${name}`,
    name,
    provider: "hetzner" as const,
    ip,
    region: "nbg1",
    size: "cax11",
    createdAt: "2026-01-01",
    mode: "bare" as const,
  };
}

function makeAudit(name: string, score = 80) {
  return {
    serverName: name,
    serverIp: "1.2.3.4",
    platform: "bare" as const,
    timestamp: new Date().toISOString(),
    auditVersion: "2.0.0",
    categories: [],
    overallScore: score,
    quickWins: [],
  };
}

const serverA = makeServer("server-a", "1.1.1.1");
const serverB = makeServer("server-b", "2.2.2.2");

beforeEach(() => {
  jest.clearAllMocks();
  mockedSsh.assertValidIp.mockImplementation(() => {});
  mockedSnapshot.listSnapshots.mockResolvedValue([]);
  mockedSnapshot.loadSnapshot.mockResolvedValue(null);
});

describe("resolveAuditPair", () => {
  describe("fresh=true", () => {
    it("runs live audit for both servers in parallel", async () => {
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-a") });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-b") });

      const result = await resolveAuditPair(serverA, serverB, true);

      expect(result.success).toBe(true);
      expect(result.data!.auditA.serverName).toBe("server-a");
      expect(result.data!.auditB.serverName).toBe("server-b");
      expect(mockedAudit.runAudit).toHaveBeenCalledTimes(2);
      expect(mockedSsh.assertValidIp).toHaveBeenCalledTimes(2);
    });

    it("returns error when serverA audit fails", async () => {
      mockedAudit.runAudit.mockResolvedValueOnce({ success: false, error: "SSH timeout" });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-b") });

      const result = await resolveAuditPair(serverA, serverB, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("server-a");
    });

    it("returns error when serverB audit fails", async () => {
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-a") });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: false, error: "Connection refused" });

      const result = await resolveAuditPair(serverA, serverB, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("server-b");
    });

    it("returns first error when both audits fail", async () => {
      mockedAudit.runAudit.mockResolvedValueOnce({ success: false, error: "Timeout A" });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: false, error: "Timeout B" });

      const result = await resolveAuditPair(serverA, serverB, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("server-a");
    });
  });

  describe("fresh=false", () => {
    it("uses snapshots when both are available", async () => {
      const auditA = makeAudit("server-a");
      const auditB = makeAudit("server-b");
      mockedSnapshot.listSnapshots.mockImplementation(async (ip) => {
        return [{ filename: `${ip}-snap.json`, name: "latest", savedAt: "2026-01-01", overallScore: 80 }];
      });
      mockedSnapshot.loadSnapshot.mockImplementation(async (ip) => {
        const audit = ip === "1.1.1.1" ? auditA : auditB;
        return { schemaVersion: 1, savedAt: "2026-01-01", audit };
      });

      const result = await resolveAuditPair(serverA, serverB, false);

      expect(result.success).toBe(true);
      expect(result.data!.auditA.serverName).toBe("server-a");
      expect(result.data!.auditB.serverName).toBe("server-b");
      expect(mockedAudit.runAudit).not.toHaveBeenCalled();
      expect(mockedSsh.assertValidIp).not.toHaveBeenCalled();
    });

    it("falls back to live audit for serverA when its snapshot is missing", async () => {
      mockedSnapshot.listSnapshots.mockImplementation(async (ip) => {
        if (ip === "1.1.1.1") return [];
        return [{ filename: "snap.json", name: "latest", savedAt: "2026-01-01", overallScore: 80 }];
      });
      mockedSnapshot.loadSnapshot.mockImplementation(async (ip) => {
        if (ip === "1.1.1.1") return null;
        return { schemaVersion: 1, savedAt: "2026-01-01", audit: makeAudit("server-b") };
      });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-a") });

      const result = await resolveAuditPair(serverA, serverB, false);

      expect(result.success).toBe(true);
      expect(mockedAudit.runAudit).toHaveBeenCalledTimes(1);
      expect(mockedAudit.runAudit).toHaveBeenCalledWith("1.1.1.1", "server-a", "bare");
    });

    it("falls back to live audit for serverB when its snapshot is missing", async () => {
      mockedSnapshot.listSnapshots.mockImplementation(async (ip) => {
        if (ip === "2.2.2.2") return [];
        return [{ filename: "snap.json", name: "latest", savedAt: "2026-01-01", overallScore: 80 }];
      });
      mockedSnapshot.loadSnapshot.mockImplementation(async (ip) => {
        if (ip === "2.2.2.2") return null;
        return { schemaVersion: 1, savedAt: "2026-01-01", audit: makeAudit("server-a") };
      });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-b") });

      const result = await resolveAuditPair(serverA, serverB, false);

      expect(result.success).toBe(true);
      expect(mockedAudit.runAudit).toHaveBeenCalledTimes(1);
      expect(mockedAudit.runAudit).toHaveBeenCalledWith("2.2.2.2", "server-b", "bare");
    });

    it("runs live audit for both when neither has snapshots", async () => {
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-a") });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-b") });

      const result = await resolveAuditPair(serverA, serverB, false);

      expect(result.success).toBe(true);
      expect(mockedAudit.runAudit).toHaveBeenCalledTimes(2);
    });

    it("returns error when fallback live audit fails for serverA", async () => {
      mockedAudit.runAudit.mockResolvedValueOnce({ success: false, error: "SSH timeout" });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-b") });

      const result = await resolveAuditPair(serverA, serverB, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("server-a");
    });

    it("returns error when both fallback live audits fail (reports first)", async () => {
      mockedAudit.runAudit.mockResolvedValueOnce({ success: false, error: "SSH timeout A" });
      mockedAudit.runAudit.mockResolvedValueOnce({ success: false, error: "SSH timeout B" });

      const result = await resolveAuditPair(serverA, serverB, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("server-a");
    });
  });
});
