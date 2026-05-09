import { readCheckCatalog, readCheckDetail } from "../../../src/mcp/resources/checks.js";
import { readServerList, readServerAudit } from "../../../src/mcp/resources/servers.js";

jest.mock("../../../src/core/audit/explainCheck.js", () => ({
  getFullCheckCatalog: jest.fn().mockReturnValue([
    {
      id: "SSH-PASSWORD-AUTH",
      name: "Password Authentication Disabled",
      category: "SSH",
      severity: "critical",
      explain: "Disables password auth",
      fixCommand: "sed -i 's/PasswordAuthentication yes/no/' /etc/ssh/sshd_config",
      fixTier: "SAFE",
      complianceRefs: [{ framework: "CIS", control: "5.2.10", title: "SSH PasswordAuth" }],
    },
    {
      id: "FW-UFW-ENABLED",
      name: "UFW Enabled",
      category: "Firewall",
      severity: "critical",
      explain: "UFW must be active",
      fixTier: "FORBIDDEN",
      complianceRefs: [],
    },
  ]),
  findCheckById: jest.fn().mockImplementation((id: string) => {
    if (id === "SSH-PASSWORD-AUTH") {
      return {
        match: {
          id: "SSH-PASSWORD-AUTH",
          name: "Password Authentication Disabled",
          category: "SSH",
          severity: "critical",
          explain: "Disables password auth",
          fixCommand: "sed -i ...",
          fixTier: "SAFE",
          complianceRefs: [{ framework: "CIS", control: "5.2.10", title: "SSH PasswordAuth" }],
        },
        suggestions: [],
      };
    }
    return { match: null, suggestions: ["SSH-PASSWORD-AUTH"] };
  }),
}));

jest.mock("../../../src/utils/config.js", () => ({
  getServers: jest.fn().mockReturnValue([
    { id: "1", name: "prod-1", provider: "hetzner", ip: "1.2.3.4", mode: "coolify", region: "nbg1", size: "cax11", createdAt: "2026-01-01" },
    { id: "2", name: "staging", provider: "digitalocean", ip: "5.6.7.8", mode: "bare", region: "fra1", size: "s-2vcpu", createdAt: "2026-02-01" },
  ]),
  findServer: jest.fn().mockImplementation((name: string) => {
    const servers = [
      { id: "1", name: "prod-1", provider: "hetzner", ip: "1.2.3.4", mode: "coolify", region: "nbg1", size: "cax11", createdAt: "2026-01-01" },
      { id: "2", name: "staging", provider: "digitalocean", ip: "5.6.7.8", mode: "bare", region: "fra1", size: "s-2vcpu", createdAt: "2026-02-01" },
    ];
    return servers.find((s) => s.name === name) ?? null;
  }),
}));

jest.mock("../../../src/core/audit/history.js", () => ({
  loadAuditHistory: jest.fn().mockImplementation((ip: string) => {
    if (ip === "1.2.3.4") {
      return [
        { serverIp: "1.2.3.4", serverName: "prod-1", timestamp: "2026-05-01T00:00:00Z", overallScore: 78, categoryScores: { SSH: 90, Firewall: 70 } },
        { serverIp: "1.2.3.4", serverName: "prod-1", timestamp: "2026-05-05T00:00:00Z", overallScore: 85, categoryScores: { SSH: 95, Firewall: 80 } },
      ];
    }
    return [];
  }),
}));

describe("readCheckCatalog", () => {
  it("returns all checks as JSON with id, name, category, severity", () => {
    const result = readCheckCatalog();
    expect(result.contents).toHaveLength(1);
    const content = result.contents[0] as { text: string };
    const data = JSON.parse(content.text);
    expect(data.checks).toHaveLength(2);
    expect(data.checks[0]).toHaveProperty("id", "SSH-PASSWORD-AUTH");
    expect(data.checks[0]).toHaveProperty("category", "SSH");
    expect(data.totalCount).toBe(2);
  });
});

describe("readCheckDetail", () => {
  it("returns check detail for valid id", () => {
    const result = readCheckDetail("SSH-PASSWORD-AUTH");
    const content = result.contents[0] as { text: string };
    const data = JSON.parse(content.text);
    expect(data.id).toBe("SSH-PASSWORD-AUTH");
    expect(data.fixTier).toBe("SAFE");
    expect(data.complianceRefs).toHaveLength(1);
  });

  it("returns error with suggestions for invalid id", () => {
    const result = readCheckDetail("INVALID-CHECK");
    const content = result.contents[0] as { text: string };
    const data = JSON.parse(content.text);
    expect(data.error).toContain("not found");
    expect(data.suggestions).toContain("SSH-PASSWORD-AUTH");
  });
});

describe("readServerList", () => {
  it("returns all servers with name, ip, provider, mode", () => {
    const result = readServerList();
    const content = result.contents[0] as { text: string };
    const data = JSON.parse(content.text);
    expect(data.servers).toHaveLength(2);
    expect(data.servers[0]).toEqual(expect.objectContaining({ name: "prod-1", ip: "1.2.3.4", provider: "hetzner", mode: "coolify" }));
  });
});

describe("readServerAudit", () => {
  it("returns latest audit score for known server", () => {
    const result = readServerAudit("prod-1");
    const content = result.contents[0] as { text: string };
    const data = JSON.parse(content.text);
    expect(data.serverName).toBe("prod-1");
    expect(data.latestScore).toBe(85);
    expect(data.latestTimestamp).toBe("2026-05-05T00:00:00Z");
    expect(data.historyCount).toBe(2);
  });

  it("returns null score for server with no audit history", () => {
    const result = readServerAudit("staging");
    const content = result.contents[0] as { text: string };
    const data = JSON.parse(content.text);
    expect(data.latestScore).toBeNull();
    expect(data.message).toContain("No audit");
  });

  it("returns error for unknown server name", () => {
    const result = readServerAudit("nonexistent");
    const content = result.contents[0] as { text: string };
    const data = JSON.parse(content.text);
    expect(data.error).toContain("not found");
  });
});
