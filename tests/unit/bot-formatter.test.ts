import {
  formatAuditMessage,
  formatStatusMessage,
  formatHealthMessage,
  formatDoctorMessage,
} from "../../src/core/bot/formatter";
import type { SnapshotFile, SnapshotListEntry, AuditCategory } from "../../src/core/audit/types";
import type { ServerRecord } from "../../src/types/index";
import type { GuardStateEntry } from "../../src/core/guard";
import type { DoctorFinding } from "../../src/core/doctor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCategory(name: string, score: number, maxScore: number): AuditCategory {
  return { name, score, maxScore, checks: [] };
}

function makeSnapshot(overrides?: Partial<SnapshotFile["audit"]>): SnapshotFile {
  return {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    audit: {
      serverName: "test-server",
      serverIp: "1.2.3.4",
      platform: "bare",
      timestamp: new Date().toISOString(),
      auditVersion: "1.14.0",
      overallScore: 72,
      categories: [
        makeCategory("SSH", 60, 100),
        makeCategory("Firewall", 80, 100),
        makeCategory("Docker", 50, 100),
        makeCategory("Kernel", 90, 100),
        makeCategory("Auth", 40, 100),
        makeCategory("Network", 70, 100),
        makeCategory("Logging", 85, 100),
      ],
      quickWins: [],
      ...overrides,
    },
  };
}

function makeServer(overrides?: Partial<ServerRecord>): ServerRecord {
  return {
    id: "srv-1",
    name: "test-server",
    provider: "hetzner",
    ip: "1.2.3.4",
    region: "eu-central",
    size: "cx11",
    createdAt: "2026-01-01T00:00:00Z",
    mode: "bare",
    ...overrides,
  };
}

// ─── formatAuditMessage ───────────────────────────────────────────────────────

describe("formatAuditMessage", () => {
  it("includes server name and overall score", () => {
    const msg = formatAuditMessage(makeSnapshot(), 5);
    expect(msg).toContain("test-server");
    expect(msg).toContain("72/100");
  });

  it("shows worst 5 categories sorted by score ratio", () => {
    const msg = formatAuditMessage(makeSnapshot(), 5);
    const authIdx = msg.indexOf("Auth:");
    const dockerIdx = msg.indexOf("Docker:");
    const sshIdx = msg.indexOf("SSH:");
    expect(authIdx).toBeLessThan(dockerIdx);
    expect(dockerIdx).toBeLessThan(sshIdx);
  });

  it("includes age in hours", () => {
    const msg = formatAuditMessage(makeSnapshot(), 12);
    expect(msg).toContain("12h ago");
  });

  it("adds stale warning when age > 24h", () => {
    const msg = formatAuditMessage(makeSnapshot(), 48);
    expect(msg).toContain("stale");
    expect(msg).toContain("kastell audit");
  });

  it("does NOT add stale warning when age <= 24h", () => {
    const msg = formatAuditMessage(makeSnapshot(), 12);
    expect(msg).not.toContain("stale");
  });

  it("truncates to max 4000 chars", () => {
    const longCategories = Array.from({ length: 100 }, (_, i) =>
      makeCategory("A".repeat(80) + String(i), 10, 100),
    );
    const snapshot = makeSnapshot({ categories: longCategories });
    const msg = formatAuditMessage(snapshot, 5);
    expect(msg.length).toBeLessThanOrEqual(4004);
  });
});

// ─── formatStatusMessage ──────────────────────────────────────────────────────

describe("formatStatusMessage", () => {
  it("shows server name, IP, platform, and guard status", () => {
    const guard: GuardStateEntry = {
      installedAt: "2026-03-20T10:00:00Z",
      cronExpr: "*/5 * * * *",
    };
    const snap: SnapshotListEntry = {
      filename: "2026-03-27.json",
      savedAt: new Date().toISOString(),
      overallScore: 75,
    };
    const msg = formatStatusMessage(makeServer(), guard, snap);
    expect(msg).toContain("test-server");
    expect(msg).toContain("1.2.3.4");
    expect(msg).toContain("bare");
    expect(msg).toContain("Guard: active");
  });

  it("shows 'not installed' when no guard state", () => {
    const msg = formatStatusMessage(makeServer(), undefined, undefined);
    expect(msg).toContain("Guard: not installed");
  });

  it("shows 'no snapshot' when no snapshot", () => {
    const msg = formatStatusMessage(makeServer(), undefined, undefined);
    expect(msg).toContain("Audit: no snapshot");
  });
});

// ─── formatHealthMessage ──────────────────────────────────────────────────────

describe("formatHealthMessage", () => {
  it("shows all servers in table format", () => {
    const servers = [
      makeServer({ name: "srv-a", ip: "1.1.1.1" }),
      makeServer({ name: "srv-b", ip: "2.2.2.2" }),
    ];
    const guards: Record<string, GuardStateEntry> = {
      "srv-a": { installedAt: "2026-01-01", cronExpr: "*/5 * * * *" },
    };
    const snaps = new Map<string, SnapshotListEntry>();
    snaps.set("1.1.1.1", { filename: "a.json", savedAt: "2026-03-27", overallScore: 80 });

    const msg = formatHealthMessage(servers, guards, snaps);
    expect(msg).toContain("2 servers");
    expect(msg).toContain("srv-a");
    expect(msg).toContain("srv-b");
    expect(msg).toContain("Score: 80");
    expect(msg).toContain("Score: -");
  });

  it("shows empty message when no servers", () => {
    const msg = formatHealthMessage([], {}, new Map());
    expect(msg).toContain("No servers registered");
  });
});

// ─── formatDoctorMessage ──────────────────────────────────────────────────────

describe("formatDoctorMessage", () => {
  it("shows findings grouped by severity (critical first)", () => {
    const findings: DoctorFinding[] = [
      { id: "RAM-WARN", severity: "warning", description: "RAM 82%", command: "free -h" },
      { id: "DISK-HIGH", severity: "critical", description: "Disk 95%", command: "df -h" },
      { id: "CPU-INFO", severity: "info", description: "CPU normal", command: "uptime" },
    ];
    const msg = formatDoctorMessage("my-server", findings);
    expect(msg).toContain("3 finding");
    const diskIdx = msg.indexOf("Disk 95%");
    const ramIdx = msg.indexOf("RAM 82%");
    expect(diskIdx).toBeLessThan(ramIdx);
  });

  it("shows no-data message when findings is empty", () => {
    const msg = formatDoctorMessage("my-server", []);
    expect(msg).toContain("No doctor data");
    expect(msg).toContain("kastell doctor my-server");
  });
});
