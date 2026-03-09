import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import {
  domainCommand,
  isValidDomain,
  sanitizeDomain,
  buildSetFqdnCommand,
  buildDnsCheckCommand,
} from "../../src/commands/domain";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

describe("security-domain E2E", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("buildSetFqdnCommand - shell injection protection", () => {
    it("should reject semicolon injection attempts", () => {
      expect(() => buildSetFqdnCommand("example.com; rm -rf /", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject pipe injection attempts", () => {
      expect(() => buildSetFqdnCommand("example.com | cat /etc/passwd", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject backtick injection attempts", () => {
      expect(() => buildSetFqdnCommand("example.com`whoami`", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject $() command substitution attempts", () => {
      expect(() => buildSetFqdnCommand("example.com$(id)", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject ${} variable expansion attempts", () => {
      expect(() => buildSetFqdnCommand("example.com${HOME}", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject newline injection attempts", () => {
      expect(() => buildSetFqdnCommand("example.com\ncat /etc/passwd", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject ampersand injection attempts", () => {
      expect(() => buildSetFqdnCommand("example.com & whoami", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject quote injection attempts", () => {
      expect(() => buildSetFqdnCommand("example.com'; DROP TABLE users; --", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject double quote injection attempts", () => {
      expect(() => buildSetFqdnCommand('example.com" && rm -rf /', true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should reject redirect injection attempts", () => {
      expect(() => buildSetFqdnCommand("example.com > /etc/passwd", true)).toThrow(
        "Invalid domain for FQDN command",
      );
      expect(() => buildSetFqdnCommand("example.com < /dev/urandom", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should accept valid domains with allowed characters", () => {
      expect(() => buildSetFqdnCommand("example.com", true)).not.toThrow();
      expect(() => buildSetFqdnCommand("sub.example.com", true)).not.toThrow();
      expect(() => buildSetFqdnCommand("my-site.example.com", true)).not.toThrow();
      expect(() => buildSetFqdnCommand("site123.example.com", true)).not.toThrow();
    });

    it("should accept IP:port format for domain removal", () => {
      expect(() => buildSetFqdnCommand("1.2.3.4:8000", false)).not.toThrow();
    });

    it("should accept underscores in domain (common in internal domains)", () => {
      expect(() => buildSetFqdnCommand("internal_server.local", true)).not.toThrow();
    });
  });

  describe("buildDnsCheckCommand - input sanitization", () => {
    it("should strip semicolons from domain", () => {
      const cmd = buildDnsCheckCommand("example.com;rm -rf /");
      expect(cmd).not.toContain(";");
      expect(cmd).toContain("example.comrm-rf");
    });

    it("should strip pipe characters from the domain part of the command", () => {
      const cmd = buildDnsCheckCommand("example.com|cat /etc/passwd");
      // The command template contains | for fallback (dig || getent)
      // But the DOMAIN part should have | stripped
      expect(cmd).toContain("example.comcatetcpasswd");
      expect(cmd).not.toContain("example.com|cat");
    });

    it("should strip backticks from the domain part of the command", () => {
      const cmd = buildDnsCheckCommand("example.com`whoami`");
      // Backticks should be stripped from the domain
      expect(cmd).toContain("example.comwhoami");
      expect(cmd).not.toContain("`");
    });

    it("should strip $() from the domain part of the command", () => {
      const cmd = buildDnsCheckCommand("example.com$(id)");
      // $() should be stripped from the domain, leaving just the text
      expect(cmd).toContain("example.comid");
      expect(cmd).not.toContain("$(");
    });

    it("should strip spaces from domain", () => {
      const cmd = buildDnsCheckCommand("example.com rm -rf");
      expect(cmd).toContain("example.comrm-rf");
    });

    it("should preserve valid domain characters", () => {
      const cmd = buildDnsCheckCommand("sub.example.com");
      expect(cmd).toContain("sub.example.com");
    });

    it("should preserve hyphens in domain", () => {
      const cmd = buildDnsCheckCommand("my-cool-site.example.com");
      expect(cmd).toContain("my-cool-site.example.com");
    });
  });

  describe("isValidDomain - domain validation", () => {
    it("should accept valid top-level domains", () => {
      expect(isValidDomain("example.com")).toBe(true);
      expect(isValidDomain("example.org")).toBe(true);
      expect(isValidDomain("example.co.uk")).toBe(true);
    });

    it("should accept valid subdomains", () => {
      expect(isValidDomain("sub.example.com")).toBe(true);
      expect(isValidDomain("deep.sub.example.com")).toBe(true);
    });

    it("should accept domains with hyphens", () => {
      expect(isValidDomain("my-site.com")).toBe(true);
      expect(isValidDomain("my-cool-site.example.com")).toBe(true);
    });

    it("should reject empty string", () => {
      expect(isValidDomain("")).toBe(false);
    });

    it("should reject localhost", () => {
      expect(isValidDomain("localhost")).toBe(false);
    });

    it("should reject domains starting with hyphen", () => {
      expect(isValidDomain("-example.com")).toBe(false);
    });

    it("should reject domains ending with hyphen", () => {
      expect(isValidDomain("example-.com")).toBe(false);
    });

    it("should reject domains with protocol prefix", () => {
      expect(isValidDomain("http://example.com")).toBe(false);
      expect(isValidDomain("https://example.com")).toBe(false);
    });

    it("should reject domains with path", () => {
      expect(isValidDomain("example.com/")).toBe(false);
      expect(isValidDomain("example.com/path")).toBe(false);
    });

    it("should reject IP addresses", () => {
      expect(isValidDomain("1.2.3.4")).toBe(false);
    });
  });

  describe("sanitizeDomain - protocol/path stripping", () => {
    it("should strip https:// prefix", () => {
      expect(sanitizeDomain("https://example.com")).toBe("example.com");
    });

    it("should strip http:// prefix", () => {
      expect(sanitizeDomain("http://example.com")).toBe("example.com");
    });

    it("should strip trailing slash", () => {
      expect(sanitizeDomain("example.com/")).toBe("example.com");
      expect(sanitizeDomain("example.com///")).toBe("example.com");
    });

    it("should strip port number", () => {
      expect(sanitizeDomain("example.com:8000")).toBe("example.com");
      expect(sanitizeDomain("example.com:443")).toBe("example.com");
    });

    it("should trim whitespace", () => {
      expect(sanitizeDomain("  example.com  ")).toBe("example.com");
    });

    it("should handle combined cleanup", () => {
      expect(sanitizeDomain("https://example.com:8000/")).toBe("example.com");
    });
  });

  describe("domainCommand - full flow security", () => {
    it("should reject invalid domain before SSH connection", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("add", "1.2.3.4", { domain: "-invalid" });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid domain");
    });

    it("should sanitize domain before processing", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      await domainCommand("add", "1.2.3.4", { domain: "https://example.com:443/" });

      expect(mockedSsh.sshExec).toHaveBeenCalled();
      const sshCall = mockedSsh.sshExec.mock.calls[1];
      // The FQDN should be https://example.com (port stripped, protocol added by SSL flag)
      expect(sshCall[1]).toContain("https://example.com");
      // Port should be stripped from the domain
      expect(sshCall[1]).not.toContain(":443");
    });

    it("should not execute SSH for shell injection attempts", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("add", "1.2.3.4", { domain: "example.com; rm -rf /" });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid domain");
    });

    it("should require SSH availability before proceeding", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      await domainCommand("add", "1.2.3.4", { domain: "example.com" });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should require server to exist before proceeding", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([]);

      await domainCommand("add", "nonexistent", { domain: "example.com" });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Server not found");
    });

    it("should validate subcommand before processing", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);

      await domainCommand("inject; whoami");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid subcommand");
    });
  });

  describe("domain check - DNS validation security", () => {
    it("should sanitize domain for DNS check", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "1.2.3.4\n", stderr: "" });

      await domainCommand("check", "1.2.3.4", { domain: "example.com" });

      const sshCall = mockedSsh.sshExec.mock.calls[0];
      expect(sshCall[1]).toContain("example.com");
      expect(sshCall[1]).toContain("dig");
    });

    it("should reject invalid domain for DNS check", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("check", "1.2.3.4", { domain: "-invalid" });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid domain");
    });
  });

  describe("dry-run mode - no actual changes", () => {
    it("should not execute SSH commands in dry-run mode for add", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("add", "1.2.3.4", { domain: "example.com", dryRun: true });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(output).toContain("No changes applied");
    });

    it("should not execute SSH commands in dry-run mode for remove", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("remove", "1.2.3.4", { dryRun: true });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
    });
  });

  describe("SSL settings", () => {
    it("should default to SSL enabled (https)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      await domainCommand("add", "1.2.3.4", { domain: "example.com" });

      const sshCall = mockedSsh.sshExec.mock.calls[1];
      expect(sshCall[1]).toContain("https://example.com");
    });

    it("should allow SSL to be disabled (http)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      await domainCommand("add", "1.2.3.4", { domain: "example.com", ssl: false });

      const sshCall = mockedSsh.sshExec.mock.calls[1];
      expect(sshCall[1]).toContain("http://example.com");
      expect(sshCall[1]).not.toContain("https://");
    });
  });
});
