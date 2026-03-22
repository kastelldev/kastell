import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import * as secure from "../../src/core/secure";
import * as firewall from "../../src/core/firewall";
import * as domain from "../../src/core/domain";
import { handleServerSecure } from "../../src/mcp/tools/serverSecure";
import {
  parseSshdConfig,
  parseAuditResult,
  buildHardeningCommand,
  buildFail2banCommand,
  buildAuditCommand,
  buildKeyCheckCommand,
  calculateSecurityScore,
} from "../../src/core/secure";
import {
  isValidPort,
  isProtectedPort,
  parseUfwStatus,
  buildFirewallSetupCommand,
  buildUfwRuleCommand,
  buildUfwStatusCommand,
} from "../../src/core/firewall";
import {
  isValidDomain,
  sanitizeDomain,
  escapePsqlString,
  buildSetFqdnCommand,
  buildGetFqdnCommand,
  buildCoolifyCheckCommand,
  buildDnsCheckCommand,
  parseDnsResult,
  parseFqdn,
} from "../../src/core/domain";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/adapters/factory", () => ({
  resolvePlatform: jest.fn().mockReturnValue("coolify"),
  getAdapter: jest.fn().mockReturnValue({
    healthCheck: jest.fn().mockResolvedValue({ status: "running" }),
  }),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

const sampleServer2 = {
  id: "456",
  name: "coolify-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-02-21T00:00:00Z",
  mode: "coolify" as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedSsh.assertValidIp.mockImplementation(() => {});
});

// ─── Core: secure.ts ────────────────────────────────────────────────────────

describe("core/secure — parseSshdConfig", () => {
  it("should parse all secure settings", () => {
    const content = [
      "PasswordAuthentication no",
      "PermitRootLogin prohibit-password",
      "PubkeyAuthentication yes",
      "MaxAuthTries 3",
    ].join("\n");
    const settings = parseSshdConfig(content);
    expect(settings).toHaveLength(4);
    expect(settings.every((s) => s.status === "secure")).toBe(true);
  });

  it("should detect insecure settings", () => {
    const content = [
      "PasswordAuthentication yes",
      "PermitRootLogin yes",
      "PubkeyAuthentication no",
      "MaxAuthTries 10",
    ].join("\n");
    const settings = parseSshdConfig(content);
    expect(settings).toHaveLength(4);
    expect(settings.every((s) => s.status === "insecure")).toBe(true);
  });

  it("should handle missing settings", () => {
    const settings = parseSshdConfig("");
    expect(settings).toHaveLength(4);
    expect(settings.every((s) => s.status === "missing")).toBe(true);
  });
});

describe("core/secure — parseAuditResult", () => {
  it("should parse full audit with fail2ban active", () => {
    const stdout = "PasswordAuthentication no\nPort 2222\n---SEPARATOR---\nactive (running)";
    const result = parseAuditResult(stdout);
    expect(result.passwordAuth.status).toBe("secure");
    expect(result.fail2ban.active).toBe(true);
    expect(result.sshPort).toBe(2222);
  });

  it("should handle empty output", () => {
    const result = parseAuditResult("");
    expect(result.passwordAuth.status).toBe("missing");
    expect(result.fail2ban.installed).toBe(false);
    expect(result.fail2ban.active).toBe(false);
    expect(result.sshPort).toBe(22);
  });
});

describe("core/secure — build commands", () => {
  it("should build hardening command without custom port", () => {
    const cmd = buildHardeningCommand();
    expect(cmd).toContain("PasswordAuthentication no");
    expect(cmd).toContain("systemctl restart sshd");
    expect(cmd).not.toContain("Port");
  });

  it("should build hardening command with custom port", () => {
    const cmd = buildHardeningCommand({ port: 2222 });
    expect(cmd).toContain("Port 2222");
  });

  it("should build fail2ban command", () => {
    const cmd = buildFail2banCommand();
    expect(cmd).toContain("fail2ban");
    expect(cmd).toContain("jail.local");
  });

  it("should build audit command", () => {
    const cmd = buildAuditCommand();
    expect(cmd).toContain("sshd_config");
    expect(cmd).toContain("---SEPARATOR---");
    expect(cmd).toContain("fail2ban");
  });

  it("should build key check command", () => {
    const cmd = buildKeyCheckCommand();
    expect(cmd).toContain("authorized_keys");
  });
});

describe("core/secure — calculateSecurityScore", () => {
  it("should return 100 for full security", () => {
    const score = calculateSecurityScore({
      passwordAuth: { key: "PasswordAuthentication", value: "no", status: "secure" },
      rootLogin: { key: "PermitRootLogin", value: "prohibit-password", status: "secure" },
      fail2ban: { installed: true, active: true },
      sshPort: 2222,
    });
    expect(score).toBe(100);
  });

  it("should return 0 for no security", () => {
    const score = calculateSecurityScore({
      passwordAuth: { key: "PasswordAuthentication", value: "yes", status: "insecure" },
      rootLogin: { key: "PermitRootLogin", value: "yes", status: "insecure" },
      fail2ban: { installed: false, active: false },
      sshPort: 22,
    });
    expect(score).toBe(0);
  });

  it("should return 50 for partial security", () => {
    const score = calculateSecurityScore({
      passwordAuth: { key: "PasswordAuthentication", value: "no", status: "secure" },
      rootLogin: { key: "PermitRootLogin", value: "prohibit-password", status: "secure" },
      fail2ban: { installed: false, active: false },
      sshPort: 22,
    });
    expect(score).toBe(50);
  });
});

describe("core/secure — applySecureSetup", () => {
  it("should abort if no SSH keys found", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "0\n", stderr: "" });

    const result = await secure.applySecureSetup("1.2.3.4");
    expect(result.success).toBe(false);
    expect(result.sshKeyCount).toBe(0);
    expect(result.error).toContain("No SSH keys found");
    expect(result.hint).toContain("ssh-copy-id");
  });

  it("should succeed with full setup", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "2\n", stderr: "" }) // key check
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // hardening
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // fail2ban

    const result = await secure.applySecureSetup("1.2.3.4");
    expect(result.success).toBe(true);
    expect(result.sshHardening).toBe(true);
    expect(result.fail2ban).toBe(true);
    expect(result.sshKeyCount).toBe(2);
  });

  it("should return partial success if fail2ban fails", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "1\n", stderr: "" }) // key check
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // hardening
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "apt error" }); // fail2ban

    const result = await secure.applySecureSetup("1.2.3.4");
    expect(result.success).toBe(true);
    expect(result.sshHardening).toBe(true);
    expect(result.fail2ban).toBe(false);
    expect(result.hint).toContain("Fail2ban");
  });

  it("should fail if hardening fails", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "1\n", stderr: "" }) // key check
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "error" }); // hardening

    const result = await secure.applySecureSetup("1.2.3.4");
    expect(result.success).toBe(false);
    expect(result.sshHardening).toBe(false);
  });

  it("should handle SSH error", async () => {
    mockedSsh.sshExec.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await secure.applySecureSetup("1.2.3.4");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });
});

describe("core/secure — runSecureAudit", () => {
  it("should return full score audit", async () => {
    const stdout = "PasswordAuthentication no\nPermitRootLogin prohibit-password\nPort 2222\n---SEPARATOR---\nactive (running)";
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout, stderr: "" });

    const result = await secure.runSecureAudit("1.2.3.4");
    expect(result.score).toBe(100);
    expect(result.error).toBeUndefined();
  });

  it("should return low score audit", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "\n---SEPARATOR---\n", stderr: "" });

    const result = await secure.runSecureAudit("1.2.3.4");
    expect(result.score).toBe(0);
  });

  it("should handle SSH error", async () => {
    mockedSsh.sshExec.mockRejectedValueOnce(new Error("Connection timed out"));

    const result = await secure.runSecureAudit("1.2.3.4");
    expect(result.error).toContain("Connection timed out");
    expect(result.score).toBe(0);
  });
});

// ─── Core: firewall.ts ──────────────────────────────────────────────────────

describe("core/firewall — isValidPort", () => {
  it("should accept valid ports", () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it("should reject invalid ports", () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(1.5)).toBe(false);
  });
});

describe("core/firewall — isProtectedPort", () => {
  it("should protect port 22", () => {
    expect(isProtectedPort(22)).toBe(true);
  });

  it("should not protect other ports", () => {
    expect(isProtectedPort(80)).toBe(false);
    expect(isProtectedPort(443)).toBe(false);
  });
});

describe("core/firewall — parseUfwStatus", () => {
  it("should parse active status with rules", () => {
    const stdout = `Status: active\n\n     To                         Action      From\n     --                         ------      ----\n[ 1] 22/tcp                     ALLOW IN    Anywhere\n[ 2] 80/tcp                     ALLOW IN    Anywhere\n`;
    const status = parseUfwStatus(stdout);
    expect(status.active).toBe(true);
    expect(status.rules).toHaveLength(2);
    expect(status.rules[0].port).toBe(22);
    expect(status.rules[1].port).toBe(80);
  });

  it("should parse inactive status", () => {
    const status = parseUfwStatus("Status: inactive\n");
    expect(status.active).toBe(false);
    expect(status.rules).toHaveLength(0);
  });

  it("should handle empty output", () => {
    const status = parseUfwStatus("");
    expect(status.active).toBe(false);
    expect(status.rules).toHaveLength(0);
  });
});

describe("core/firewall — build commands", () => {
  it("should build setup command with Coolify ports", () => {
    const cmd = buildFirewallSetupCommand();
    expect(cmd).toContain("ufw allow 80/tcp");
    expect(cmd).toContain("ufw allow 443/tcp");
    expect(cmd).toContain("ufw allow 8000/tcp");
    expect(cmd).toContain("ufw allow 22/tcp");
    expect(cmd).toContain("ufw enable");
  });

  it("should build allow rule command", () => {
    expect(buildUfwRuleCommand("allow", 3000, "tcp")).toBe("ufw allow 3000/tcp");
  });

  it("should build delete rule command", () => {
    expect(buildUfwRuleCommand("delete allow", 3000, "udp")).toBe("ufw delete allow 3000/udp");
  });

  it("should build status command", () => {
    expect(buildUfwStatusCommand()).toBe("ufw status numbered");
  });
});

describe("core/firewall — setupFirewall", () => {
  it("should succeed", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await firewall.setupFirewall("1.2.3.4");
    expect(result.success).toBe(true);
  });

  it("should handle failure", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "error" });
    const result = await firewall.setupFirewall("1.2.3.4");
    expect(result.success).toBe(false);
  });
});

describe("core/firewall — addFirewallRule", () => {
  it("should add rule successfully", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await firewall.addFirewallRule("1.2.3.4", 3000);
    expect(result.success).toBe(true);
  });

  it("should reject invalid port", async () => {
    const result = await firewall.addFirewallRule("1.2.3.4", 0);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid port");
  });

  it("should handle SSH error", async () => {
    mockedSsh.sshExec.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await firewall.addFirewallRule("1.2.3.4", 3000);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });
});

describe("core/firewall — removeFirewallRule", () => {
  it("should remove rule successfully", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await firewall.removeFirewallRule("1.2.3.4", 9000);
    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("should reject protected port", async () => {
    const result = await firewall.removeFirewallRule("1.2.3.4", 22);
    expect(result.success).toBe(false);
    expect(result.error).toContain("protected");
  });

  it("should warn for Coolify port but still remove", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await firewall.removeFirewallRule("1.2.3.4", 8000, "tcp", "coolify");
    expect(result.success).toBe(true);
    expect(result.warning).toContain("Coolify");
  });

  it("should warn for Dokploy port when platform is dokploy", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await firewall.removeFirewallRule("1.2.3.4", 3000, "tcp", "dokploy");
    expect(result.success).toBe(true);
    expect(result.warning).toContain("Dokploy");
  });

  it("should not warn for non-platform port on coolify", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await firewall.removeFirewallRule("1.2.3.4", 3000, "tcp", "coolify");
    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("should give generic warning when no platform specified", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await firewall.removeFirewallRule("1.2.3.4", 8000);
    expect(result.success).toBe(true);
    expect(result.warning).toContain("platform services");
  });
});

describe("core/firewall — getFirewallStatus", () => {
  it("should return active status", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "Status: active\n[ 1] 22/tcp                     ALLOW IN    Anywhere\n",
      stderr: "",
    });
    const result = await firewall.getFirewallStatus("1.2.3.4");
    expect(result.status.active).toBe(true);
    expect(result.status.rules).toHaveLength(1);
  });

  it("should handle SSH error", async () => {
    mockedSsh.sshExec.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await firewall.getFirewallStatus("1.2.3.4");
    expect(result.error).toContain("Connection refused");
  });
});

// ─── Core: domain.ts ────────────────────────────────────────────────────────

describe("core/domain — isValidDomain", () => {
  it("should accept valid domains", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("coolify.example.com")).toBe(true);
    expect(isValidDomain("my-server.example.co.uk")).toBe(true);
  });

  it("should reject invalid domains", () => {
    expect(isValidDomain("")).toBe(false);
    expect(isValidDomain("localhost")).toBe(false);
    expect(isValidDomain("1.2.3.4")).toBe(false);
    expect(isValidDomain("-invalid.com")).toBe(false);
  });
});

describe("core/domain — sanitizeDomain", () => {
  it("should strip protocol", () => {
    expect(sanitizeDomain("https://example.com")).toBe("example.com");
    expect(sanitizeDomain("http://example.com")).toBe("example.com");
  });

  it("should strip trailing slash and port", () => {
    expect(sanitizeDomain("example.com/")).toBe("example.com");
    expect(sanitizeDomain("example.com:8080")).toBe("example.com");
  });

  it("should trim whitespace", () => {
    expect(sanitizeDomain("  example.com  ")).toBe("example.com");
  });
});

describe("core/domain — escapePsqlString", () => {
  it("should escape single quotes", () => {
    expect(escapePsqlString("test'value")).toBe("test''value");
  });
});

describe("core/domain — build commands", () => {
  it("should build FQDN set command with SSL", () => {
    const cmd = buildSetFqdnCommand("example.com", true);
    expect(cmd).toContain("https://example.com");
    expect(cmd).toContain("coolify-db");
    expect(cmd).toContain("restart coolify");
  });

  it("should build FQDN set command without SSL", () => {
    const cmd = buildSetFqdnCommand("example.com", false);
    expect(cmd).toContain("http://example.com");
  });

  it("should reject invalid domain characters", () => {
    expect(() => buildSetFqdnCommand("test; rm -rf /", true)).toThrow("Invalid domain");
  });

  it("should build get FQDN command", () => {
    const cmd = buildGetFqdnCommand();
    expect(cmd).toContain("SELECT fqdn");
  });

  it("should build Coolify check command", () => {
    const cmd = buildCoolifyCheckCommand();
    expect(cmd).toContain("coolify-db");
    expect(cmd).toContain("docker ps");
  });

  it("should build DNS check command with safe chars", () => {
    const cmd = buildDnsCheckCommand("example.com");
    expect(cmd).toContain("dig +short A example.com");
  });
});

describe("core/domain — parseDnsResult", () => {
  it("should parse IP from dig output", () => {
    expect(parseDnsResult("1.2.3.4\n")).toBe("1.2.3.4");
  });

  it("should return null for no result", () => {
    expect(parseDnsResult("")).toBeNull();
    expect(parseDnsResult("no result")).toBeNull();
  });
});

describe("core/domain — parseFqdn", () => {
  it("should parse FQDN from psql output", () => {
    expect(parseFqdn("  https://coolify.example.com  ")).toBe("https://coolify.example.com");
  });

  it("should return null for empty", () => {
    expect(parseFqdn("")).toBeNull();
    expect(parseFqdn("   ")).toBeNull();
  });
});

describe("core/domain — setDomain", () => {
  it("should set domain successfully", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "coolify-db\n", stderr: "" }) // container check
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // set FQDN

    const result = await domain.setDomain("1.2.3.4", "coolify.example.com");
    expect(result.success).toBe(true);
  });

  it("should reject invalid domain", async () => {
    const result = await domain.setDomain("1.2.3.4", "invalid");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid domain");
  });

  it("should fail if DB container not found", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await domain.setDomain("1.2.3.4", "example.com");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Coolify database container");
  });
});

describe("core/domain — removeDomain", () => {
  it("should remove domain and reset to IP:8000", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "coolify-db\n", stderr: "" }) // container check
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // set FQDN

    const result = await domain.removeDomain("1.2.3.4");
    expect(result.success).toBe(true);
    // Verify the command was called with IP:8000
    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
    const setCmd = mockedSsh.sshExec.mock.calls[1][1];
    expect(setCmd).toContain("http://1.2.3.4:8000");
  });

  it("should fail if DB container not found", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await domain.removeDomain("1.2.3.4");
    expect(result.success).toBe(false);
  });
});

describe("core/domain — getDomain", () => {
  it("should return current FQDN", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: " https://coolify.example.com \n", stderr: "" });
    const result = await domain.getDomain("1.2.3.4");
    expect(result.fqdn).toBe("https://coolify.example.com");
  });

  it("should return null for empty FQDN", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "  \n", stderr: "" });
    const result = await domain.getDomain("1.2.3.4");
    expect(result.fqdn).toBeNull();
  });
});

describe("core/domain — checkDns", () => {
  it("should return match when IPs match", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "1.2.3.4\n", stderr: "" });
    const result = await domain.checkDns("1.2.3.4", "example.com");
    expect(result.match).toBe(true);
    expect(result.resolvedIp).toBe("1.2.3.4");
  });

  it("should return mismatch when IPs differ", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "9.9.9.9\n", stderr: "" });
    const result = await domain.checkDns("1.2.3.4", "example.com");
    expect(result.match).toBe(false);
    expect(result.hint).toContain("mismatch");
  });

  it("should handle no DNS record", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    const result = await domain.checkDns("1.2.3.4", "example.com");
    expect(result.match).toBe(false);
    expect(result.resolvedIp).toBeNull();
    expect(result.hint).toContain("No A record");
  });

  it("should reject invalid domain", async () => {
    const result = await domain.checkDns("1.2.3.4", "invalid");
    expect(result.error).toContain("Invalid domain");
  });

  it("should handle SSH error", async () => {
    mockedSsh.sshExec.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await domain.checkDns("1.2.3.4", "example.com");
    expect(result.error).toContain("Connection refused");
  });
});

// ─── Handler: serverSecure.ts ───────────────────────────────────────────────

describe("handleServerSecure — common", () => {
  it("should error when no servers exist", async () => {
    mockedConfig.getServers.mockReturnValue([]);
    const result = await handleServerSecure({ action: "secure-audit" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No servers found");
  });

  it("should error when server not found", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined);
    const result = await handleServerSecure({ action: "secure-audit", server: "nonexistent" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Server not found");
  });

  it("should error when multiple servers and none specified", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
    const result = await handleServerSecure({ action: "secure-audit" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Multiple servers");
  });

  it("should auto-select single server", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    jest.spyOn(secure, "runSecureAudit").mockResolvedValueOnce({
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "no", status: "secure" },
        rootLogin: { key: "PermitRootLogin", value: "prohibit-password", status: "secure" },
        fail2ban: { installed: true, active: true },
        sshPort: 2222,
      },
      score: 100,
    });

    const result = await handleServerSecure({ action: "secure-audit" });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.server).toBe("coolify-test");
  });

  it("should handle catch-all error", async () => {
    mockedConfig.getServers.mockImplementation(() => { throw new Error("config broken"); });
    const result = await handleServerSecure({ action: "secure-audit" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("config broken");
  });
});

describe("handleServerSecure — secure-setup", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should return success on full setup", async () => {
    jest.spyOn(secure, "applySecureSetup").mockResolvedValueOnce({
      success: true, sshHardening: true, fail2ban: true, sshKeyCount: 2,
    });
    const result = await handleServerSecure({ action: "secure-setup" });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.message).toContain("complete");
  });

  it("should return isError on partial success (fail2ban failed)", async () => {
    jest.spyOn(secure, "applySecureSetup").mockResolvedValueOnce({
      success: true, sshHardening: true, fail2ban: false, sshKeyCount: 1,
      hint: "Fail2ban installation failed. Retry with secure-setup.",
    });
    const result = await handleServerSecure({ action: "secure-setup" });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.message).toContain("partially");
  });

  it("should return isError when no SSH keys (abort)", async () => {
    jest.spyOn(secure, "applySecureSetup").mockResolvedValueOnce({
      success: false, sshHardening: false, fail2ban: false, sshKeyCount: 0,
      error: "No SSH keys found",
      hint: "Add an SSH key first: ssh-copy-id root@1.2.3.4",
    });
    const result = await handleServerSecure({ action: "secure-setup" });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain("No SSH keys");
  });

  it("should pass port option", async () => {
    const spy = jest.spyOn(secure, "applySecureSetup").mockResolvedValueOnce({
      success: true, sshHardening: true, fail2ban: true, sshKeyCount: 1,
    });
    await handleServerSecure({ action: "secure-setup", port: 2222 });
    expect(spy).toHaveBeenCalledWith("1.2.3.4", { port: 2222 });
  });
});

describe("handleServerSecure — secure-audit", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should return audit with score", async () => {
    jest.spyOn(secure, "runSecureAudit").mockResolvedValueOnce({
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "no", status: "secure" },
        rootLogin: { key: "PermitRootLogin", value: "yes", status: "insecure" },
        fail2ban: { installed: true, active: true },
        sshPort: 22,
      },
      score: 50,
    });
    const result = await handleServerSecure({ action: "secure-audit" });
    const data = JSON.parse(result.content[0].text);
    expect(data.score).toBe(50);
    expect(data.maxScore).toBe(100);
    expect(data.suggested_actions[0].command).toContain("secure-setup");
  });

  it("should return isError on audit failure", async () => {
    jest.spyOn(secure, "runSecureAudit").mockResolvedValueOnce({
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "", status: "missing" },
        rootLogin: { key: "PermitRootLogin", value: "", status: "missing" },
        fail2ban: { installed: false, active: false },
        sshPort: 22,
      },
      score: 0,
      error: "SSH error",
    });
    const result = await handleServerSecure({ action: "secure-audit" });
    expect(result.isError).toBe(true);
  });
});

describe("handleServerSecure — firewall-setup", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should return success", async () => {
    jest.spyOn(firewall, "setupFirewall").mockResolvedValueOnce({ success: true });
    const result = await handleServerSecure({ action: "firewall-setup" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.message).toContain("ports");
    expect(data.message).toContain("SSH (22)");
  });

  it("should return isError on failure", async () => {
    jest.spyOn(firewall, "setupFirewall").mockResolvedValueOnce({ success: false, error: "SSH error" });
    const result = await handleServerSecure({ action: "firewall-setup" });
    expect(result.isError).toBe(true);
  });
});

describe("handleServerSecure — firewall-add", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should add port rule", async () => {
    jest.spyOn(firewall, "addFirewallRule").mockResolvedValueOnce({ success: true });
    const result = await handleServerSecure({ action: "firewall-add", port: 3000 });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.message).toContain("3000");
  });

  it("should error when port missing", async () => {
    const result = await handleServerSecure({ action: "firewall-add" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Port is required");
  });
});

describe("handleServerSecure — firewall-remove", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should remove port rule", async () => {
    jest.spyOn(firewall, "removeFirewallRule").mockResolvedValueOnce({ success: true });
    const result = await handleServerSecure({ action: "firewall-remove", port: 3000 });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
  });

  it("should error when port missing", async () => {
    const result = await handleServerSecure({ action: "firewall-remove" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Port is required");
  });

  it("should include warning for Coolify port", async () => {
    jest.spyOn(firewall, "removeFirewallRule").mockResolvedValueOnce({
      success: true, warning: "Port 8000 is used by Coolify. Removing it may break Coolify access.",
    });
    const result = await handleServerSecure({ action: "firewall-remove", port: 8000 });
    const data = JSON.parse(result.content[0].text);
    expect(data.warning).toContain("Coolify");
  });

  it("should return isError when removing protected port 22", async () => {
    jest.spyOn(firewall, "removeFirewallRule").mockResolvedValueOnce({
      success: false, error: "Port 22 is protected (SSH access). Cannot remove.",
    });
    const result = await handleServerSecure({ action: "firewall-remove", port: 22 });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain("protected");
  });
});

describe("handleServerSecure — firewall-status", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should return active status with rules", async () => {
    jest.spyOn(firewall, "getFirewallStatus").mockResolvedValueOnce({
      status: {
        active: true,
        rules: [{ port: 22, protocol: "tcp", action: "ALLOW", from: "Anywhere" }],
      },
    });
    const result = await handleServerSecure({ action: "firewall-status" });
    const data = JSON.parse(result.content[0].text);
    expect(data.active).toBe(true);
    expect(data.ruleCount).toBe(1);
  });
});

describe("handleServerSecure — domain-set", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should set domain with SSL", async () => {
    jest.spyOn(domain, "setDomain").mockResolvedValueOnce({ success: true });
    const result = await handleServerSecure({ action: "domain-set", domain: "coolify.example.com" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.url).toBe("https://coolify.example.com");
  });

  it("should error when domain missing", async () => {
    const result = await handleServerSecure({ action: "domain-set" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Domain is required");
  });

  it("should return isError on failure", async () => {
    jest.spyOn(domain, "setDomain").mockResolvedValueOnce({ success: false, error: "DB not found" });
    const result = await handleServerSecure({ action: "domain-set", domain: "example.com" });
    expect(result.isError).toBe(true);
  });

  it("should return isError for invalid domain", async () => {
    jest.spyOn(domain, "setDomain").mockResolvedValueOnce({
      success: false, error: "Invalid domain: localhost",
    });
    const result = await handleServerSecure({ action: "domain-set", domain: "localhost" });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain("Invalid domain");
  });
});

describe("handleServerSecure — domain-remove", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should remove domain", async () => {
    jest.spyOn(domain, "removeDomain").mockResolvedValueOnce({ success: true });
    const result = await handleServerSecure({ action: "domain-remove" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.url).toContain("http://1.2.3.4:8000");
  });

  it("should return isError on failure", async () => {
    jest.spyOn(domain, "removeDomain").mockResolvedValueOnce({ success: false, error: "Failed" });
    const result = await handleServerSecure({ action: "domain-remove" });
    expect(result.isError).toBe(true);
  });
});

describe("handleServerSecure — domain-check", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should return match", async () => {
    jest.spyOn(domain, "checkDns").mockResolvedValueOnce({ resolvedIp: "1.2.3.4", match: true });
    const result = await handleServerSecure({ action: "domain-check", domain: "example.com" });
    const data = JSON.parse(result.content[0].text);
    expect(data.match).toBe(true);
  });

  it("should return mismatch", async () => {
    jest.spyOn(domain, "checkDns").mockResolvedValueOnce({
      resolvedIp: "9.9.9.9", match: false, hint: "DNS mismatch",
    });
    const result = await handleServerSecure({ action: "domain-check", domain: "example.com" });
    const data = JSON.parse(result.content[0].text);
    expect(data.match).toBe(false);
    expect(data.hint).toContain("mismatch");
  });

  it("should error when domain missing", async () => {
    const result = await handleServerSecure({ action: "domain-check" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Domain is required");
  });
});

describe("handleServerSecure — domain-info", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
  });

  it("should return current FQDN", async () => {
    jest.spyOn(domain, "getDomain").mockResolvedValueOnce({ fqdn: "https://coolify.example.com" });
    const result = await handleServerSecure({ action: "domain-info" });
    const data = JSON.parse(result.content[0].text);
    expect(data.fqdn).toBe("https://coolify.example.com");
  });

  it("should return null fqdn when no custom domain", async () => {
    jest.spyOn(domain, "getDomain").mockResolvedValueOnce({ fqdn: null });
    const result = await handleServerSecure({ action: "domain-info" });
    const data = JSON.parse(result.content[0].text);
    expect(data.fqdn).toBeNull();
    expect(data.message).toContain("No custom domain");
  });

  it("should return isError on failure", async () => {
    jest.spyOn(domain, "getDomain").mockResolvedValueOnce({ fqdn: null, error: "SSH error" });
    const result = await handleServerSecure({ action: "domain-info" });
    expect(result.isError).toBe(true);
  });
});

// ─── handleServerSecure: shared utils integration ─────────────────────────────

describe("handleServerSecure — shared utils integration", () => {
  it("returns error with isError=true when no servers found (via mcpError)", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerSecure({ action: "secure-audit" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("No servers found");
    // mcpError wraps in standard shape (no suggested_actions key unless provided)
    expect(data.suggested_actions).toBeDefined();
  });

  it("returns hint with available servers when server not found by name", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined);

    const result = await handleServerSecure({ action: "secure-audit", server: "nonexistent" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server not found: nonexistent");
    expect(data.hint).toContain("coolify-test");
  });
});

// ─── handleServerSecure: malformed params ─────────────────────────────────────

describe("handleServerSecure — malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSsh.assertValidIp.mockImplementation(() => {});
  });

  it("returns mcpError when server param is empty string", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerSecure({ action: "secure-audit", server: "" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when server param is null (as unknown)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerSecure({ action: "secure-audit", server: null as unknown as string });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when action param is invalid (as unknown)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);

    // Act
    const result = await handleServerSecure({ action: "nonexistent" as unknown as Parameters<typeof handleServerSecure>[0]["action"] });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when SSH connection fails (secure-audit)", async () => {
    // Arrange — spy on runSecureAudit to simulate SSH error result (same pattern as existing tests)
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    // Use single server so auto-select works (no findServer needed)
    jest.spyOn(secure, "runSecureAudit").mockResolvedValueOnce({
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "", status: "missing" as const },
        rootLogin: { key: "PermitRootLogin", value: "", status: "missing" as const },
        fail2ban: { installed: false, active: false },
        sshPort: 22,
      },
      score: 0,
      error: "SSH operation timed out after 30000ms",
    });

    // Act
    const result = await handleServerSecure({ action: "secure-audit" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });
});
