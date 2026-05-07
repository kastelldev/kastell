import { jest } from "@jest/globals";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../../src/core/secure");
jest.mock("../../src/core/firewall");
jest.mock("../../src/core/domain");
jest.mock("../../src/adapters/factory", () => ({
  resolvePlatform: jest.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import * as secure from "../../src/core/secure";
import * as firewall from "../../src/core/firewall";
import * as domain from "../../src/core/domain";
import * as factory from "../../src/adapters/factory";

import {
  handleSecureSetup,
  handleSecureAudit,
  handleFirewallSetup,
  handleFirewallAdd,
  handleFirewallRemove,
  handleFirewallStatus,
  handleDomainSet,
  handleDomainRemove,
  handleDomainCheck,
  handleDomainInfo,
} from "../../src/mcp/tools/serverSecure.handlers";
import type { ServerRecord } from "../../src/types/index";

// ─── Type helpers ─────────────────────────────────────────────────────────────

const mockedSecure = secure as jest.Mocked<typeof secure>;
const mockedFirewall = firewall as jest.Mocked<typeof firewall>;
const mockedDomain = domain as jest.Mocked<typeof domain>;
const mockedFactory = factory as jest.Mocked<typeof factory>;

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const mockServer: ServerRecord = {
  id: "test-id",
  name: "test-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cx11",
  createdAt: "2024-01-01T00:00:00Z",
  mode: "coolify",
  platform: "coolify",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
});

// ─── handleSecureSetup ────────────────────────────────────────────────────────

describe("handleSecureSetup", () => {
  it("calls applySecureSetup with server ip and no options when port is undefined", async () => {
    mockedSecure.applySecureSetup.mockResolvedValue({
      success: true,
      sshHardening: true,
      fail2ban: true,
      sshKeyCount: 2,
    });

    await handleSecureSetup(mockServer, undefined);

    expect(mockedSecure.applySecureSetup).toHaveBeenCalledWith("1.2.3.4", undefined);
  });

  it("passes port option when provided", async () => {
    mockedSecure.applySecureSetup.mockResolvedValue({
      success: true,
      sshHardening: true,
      fail2ban: true,
      sshKeyCount: 1,
    });

    await handleSecureSetup(mockServer, 2222);

    expect(mockedSecure.applySecureSetup).toHaveBeenCalledWith("1.2.3.4", { port: 2222 });
  });

  it("returns McpResponse with success data when setup succeeds", async () => {
    mockedSecure.applySecureSetup.mockResolvedValue({
      success: true,
      sshHardening: true,
      fail2ban: true,
      sshKeyCount: 2,
    });

    const result = await handleSecureSetup(mockServer, undefined);

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.server).toBe("test-server");
    expect(payload.ip).toBe("1.2.3.4");
  });

  it("returns error response when applySecureSetup fails", async () => {
    mockedSecure.applySecureSetup.mockResolvedValue({
      success: false,
      error: "SSH connection failed",
      sshHardening: false,
      fail2ban: false,
      sshKeyCount: 0,
    });

    const result = await handleSecureSetup(mockServer, undefined);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("SSH connection failed");
  });

  it("returns partial success when fail2ban fails", async () => {
    mockedSecure.applySecureSetup.mockResolvedValue({
      success: true,
      sshHardening: true,
      fail2ban: false,
      sshKeyCount: 1,
    });

    const result = await handleSecureSetup(mockServer, undefined);

    // fail2ban=false sets isError
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.sshHardening).toBe(true);
  });
});

// ─── handleSecureAudit ────────────────────────────────────────────────────────

describe("handleSecureAudit", () => {
  it("calls runSecureAudit with server ip", async () => {
    mockedSecure.runSecureAudit.mockResolvedValue({
      score: 85,
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "no", status: "secure" },
        rootLogin: { key: "PermitRootLogin", value: "no", status: "secure" },
        fail2ban: { installed: true, active: true },
        sshPort: 22,
      },
    });

    await handleSecureAudit(mockServer);

    expect(mockedSecure.runSecureAudit).toHaveBeenCalledWith("1.2.3.4");
  });

  it("returns formatted audit result on success", async () => {
    mockedSecure.runSecureAudit.mockResolvedValue({
      score: 100,
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "no", status: "secure" },
        rootLogin: { key: "PermitRootLogin", value: "no", status: "secure" },
        fail2ban: { installed: true, active: true },
        sshPort: 22,
      },
    });

    const result = await handleSecureAudit(mockServer);

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.score).toBe(100);
    expect(payload.server).toBe("test-server");
    expect(payload.checks).toBeDefined();
  });

  it("returns error when runSecureAudit returns error field", async () => {
    mockedSecure.runSecureAudit.mockResolvedValue({
      error: "Cannot connect to server",
      score: 0,
      audit: {
        passwordAuth: { key: "PasswordAuthentication", value: "", status: "missing" },
        rootLogin: { key: "PermitRootLogin", value: "", status: "missing" },
        fail2ban: { installed: false, active: false },
        sshPort: 22,
      },
    });

    const result = await handleSecureAudit(mockServer);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("Cannot connect to server");
  });
});

// ─── handleFirewallSetup ──────────────────────────────────────────────────────

describe("handleFirewallSetup", () => {
  it("calls setupFirewall with server ip and platform", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedFirewall.setupFirewall.mockResolvedValue({ success: true });
    mockedFirewall.getPortsForPlatform.mockReturnValue([80, 443, 8000]);

    await handleFirewallSetup(mockServer);

    expect(mockedFirewall.setupFirewall).toHaveBeenCalledWith("1.2.3.4", "coolify");
  });

  it("returns mcpSuccess with port info when setup succeeds", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedFirewall.setupFirewall.mockResolvedValue({ success: true });
    mockedFirewall.getPortsForPlatform.mockReturnValue([80, 443, 8000]);

    const result = await handleFirewallSetup(mockServer);

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.server).toBe("test-server");
  });

  it("returns error when setupFirewall fails", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedFirewall.setupFirewall.mockResolvedValue({ success: false, error: "UFW not available" });
    mockedFirewall.getPortsForPlatform.mockReturnValue([80, 443]);

    const result = await handleFirewallSetup(mockServer);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("UFW not available");
  });
});

// ─── handleFirewallAdd ────────────────────────────────────────────────────────

describe("handleFirewallAdd", () => {
  it("returns error when port is undefined", async () => {
    const result = await handleFirewallAdd(mockServer, undefined, "tcp");

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/port/i);
  });

  it("calls addFirewallRule with correct params", async () => {
    mockedFirewall.addFirewallRule.mockResolvedValue({ success: true });

    await handleFirewallAdd(mockServer, 8080, "tcp");

    expect(mockedFirewall.addFirewallRule).toHaveBeenCalledWith("1.2.3.4", 8080, "tcp");
  });

  it("returns mcpSuccess when rule is added", async () => {
    mockedFirewall.addFirewallRule.mockResolvedValue({ success: true });

    const result = await handleFirewallAdd(mockServer, 443, "tcp");

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.server).toBe("test-server");
  });

  it("returns error when addFirewallRule fails", async () => {
    mockedFirewall.addFirewallRule.mockResolvedValue({ success: false, error: "Rule already exists" });

    const result = await handleFirewallAdd(mockServer, 80, "tcp");

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("Rule already exists");
  });
});

// ─── handleFirewallRemove ─────────────────────────────────────────────────────

describe("handleFirewallRemove", () => {
  it("returns error when port is undefined", async () => {
    const result = await handleFirewallRemove(mockServer, undefined, "tcp");

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/port/i);
  });

  it("calls removeFirewallRule with server ip, port, protocol and platform", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedFirewall.removeFirewallRule.mockResolvedValue({ success: true });

    await handleFirewallRemove(mockServer, 8080, "tcp");

    expect(mockedFirewall.removeFirewallRule).toHaveBeenCalledWith("1.2.3.4", 8080, "tcp", "coolify");
  });

  it("returns mcpSuccess when rule removed", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedFirewall.removeFirewallRule.mockResolvedValue({ success: true });

    const result = await handleFirewallRemove(mockServer, 8080, "tcp");

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
  });
});

// ─── handleFirewallStatus ─────────────────────────────────────────────────────

describe("handleFirewallStatus", () => {
  it("calls getFirewallStatus with server ip", async () => {
    mockedFirewall.getFirewallStatus.mockResolvedValue({
      status: { active: true, rules: [] },
    });

    await handleFirewallStatus(mockServer);

    expect(mockedFirewall.getFirewallStatus).toHaveBeenCalledWith("1.2.3.4");
  });

  it("returns active status and rule count", async () => {
    mockedFirewall.getFirewallStatus.mockResolvedValue({
      status: {
        active: true,
        rules: [{ port: 22, protocol: "tcp", action: "ALLOW", from: "Anywhere" }],
      },
    });

    const result = await handleFirewallStatus(mockServer);

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.active).toBe(true);
    expect(payload.ruleCount).toBe(1);
  });

  it("returns error when getFirewallStatus returns error", async () => {
    mockedFirewall.getFirewallStatus.mockResolvedValue({
      error: "Cannot connect",
      status: { active: false, rules: [] },
    });

    const result = await handleFirewallStatus(mockServer);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("Cannot connect");
  });
});

// ─── handleDomainSet ──────────────────────────────────────────────────────────

describe("handleDomainSet", () => {
  it("returns error when domain is undefined", async () => {
    const result = await handleDomainSet(mockServer, undefined, true);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/domain/i);
  });

  it("calls setDomain with server ip, domain, ssl and platform", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.setDomain.mockResolvedValue({ success: true });

    await handleDomainSet(mockServer, "coolify.example.com", true);

    expect(mockedDomain.setDomain).toHaveBeenCalledWith("1.2.3.4", "coolify.example.com", true, "coolify");
  });

  it("returns success with https url when ssl is true", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.setDomain.mockResolvedValue({ success: true });

    const result = await handleDomainSet(mockServer, "coolify.example.com", true);

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.url).toBe("https://coolify.example.com");
  });

  it("returns http url when ssl is false", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.setDomain.mockResolvedValue({ success: true });

    const result = await handleDomainSet(mockServer, "coolify.example.com", false);

    const payload = JSON.parse(result.content[0].text);
    expect(payload.url).toBe("http://coolify.example.com");
  });

  it("returns error when setDomain fails", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.setDomain.mockResolvedValue({ success: false, error: "Domain invalid" });

    const result = await handleDomainSet(mockServer, "bad-domain", true);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("Domain invalid");
  });
});

// ─── handleDomainRemove ───────────────────────────────────────────────────────

describe("handleDomainRemove", () => {
  it("calls removeDomain with server ip and platform", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.removeDomain.mockResolvedValue({ success: true });

    await handleDomainRemove(mockServer);

    expect(mockedDomain.removeDomain).toHaveBeenCalledWith("1.2.3.4", "coolify");
  });

  it("returns mcpSuccess when domain removed", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.removeDomain.mockResolvedValue({ success: true });

    const result = await handleDomainRemove(mockServer);

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
  });

  it("returns error when removeDomain fails", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.removeDomain.mockResolvedValue({ success: false, error: "Failed to remove" });

    const result = await handleDomainRemove(mockServer);

    expect(result.isError).toBe(true);
  });
});

// ─── handleDomainCheck ────────────────────────────────────────────────────────

describe("handleDomainCheck", () => {
  it("returns error when domain is undefined", async () => {
    const result = await handleDomainCheck(mockServer, undefined);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/domain/i);
  });

  it("calls checkDns with server ip and domain", async () => {
    mockedDomain.checkDns.mockResolvedValue({ resolvedIp: "1.2.3.4", match: true });

    await handleDomainCheck(mockServer, "coolify.example.com");

    expect(mockedDomain.checkDns).toHaveBeenCalledWith("1.2.3.4", "coolify.example.com");
  });

  it("returns dns check result with match status", async () => {
    mockedDomain.checkDns.mockResolvedValue({ resolvedIp: "1.2.3.4", match: true });

    const result = await handleDomainCheck(mockServer, "coolify.example.com");

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.match).toBe(true);
    expect(payload.resolvedIp).toBe("1.2.3.4");
  });

  it("returns error when checkDns fails", async () => {
    mockedDomain.checkDns.mockResolvedValue({ error: "DNS lookup failed", resolvedIp: "", match: false });

    const result = await handleDomainCheck(mockServer, "bad.example.com");

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("DNS lookup failed");
  });
});

// ─── handleDomainInfo ─────────────────────────────────────────────────────────

describe("handleDomainInfo", () => {
  it("calls getDomain with server ip and platform", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.getDomain.mockResolvedValue({ fqdn: "coolify.example.com" });

    await handleDomainInfo(mockServer);

    expect(mockedDomain.getDomain).toHaveBeenCalledWith("1.2.3.4", "coolify");
  });

  it("returns current fqdn", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.getDomain.mockResolvedValue({ fqdn: "coolify.example.com" });

    const result = await handleDomainInfo(mockServer);

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.fqdn).toBe("coolify.example.com");
  });

  it("returns error when getDomain fails", async () => {
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedDomain.getDomain.mockResolvedValue({ error: "Platform unreachable", fqdn: null });

    const result = await handleDomainInfo(mockServer);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("Platform unreachable");
  });
});
