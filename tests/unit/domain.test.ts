import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import {
  domainCommand,
  isValidDomain,
  sanitizeDomain,
  escapePsqlString,
  buildSetFqdnCommand,
  buildGetFqdnCommand,
  buildCoolifyCheckCommand,
  buildDnsCheckCommand,
  parseDnsResult,
  parseFqdn,
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

describe("domain", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Pure function tests
  describe("isValidDomain", () => {
    it("should return true for valid domains", () => {
      expect(isValidDomain("example.com")).toBe(true);
      expect(isValidDomain("sub.example.com")).toBe(true);
      expect(isValidDomain("deep.sub.example.com")).toBe(true);
      expect(isValidDomain("my-site.co.uk")).toBe(true);
    });

    it("should return false for invalid domains", () => {
      expect(isValidDomain("")).toBe(false);
      expect(isValidDomain("localhost")).toBe(false);
      expect(isValidDomain("-example.com")).toBe(false);
      expect(isValidDomain("example-.com")).toBe(false);
      expect(isValidDomain("http://example.com")).toBe(false);
      expect(isValidDomain("example.com/")).toBe(false);
    });
  });

  describe("sanitizeDomain", () => {
    it("should strip https:// prefix", () => {
      expect(sanitizeDomain("https://example.com")).toBe("example.com");
    });

    it("should strip http:// prefix", () => {
      expect(sanitizeDomain("http://example.com")).toBe("example.com");
    });

    it("should strip trailing slash", () => {
      expect(sanitizeDomain("example.com/")).toBe("example.com");
    });

    it("should strip port", () => {
      expect(sanitizeDomain("example.com:8000")).toBe("example.com");
    });

    it("should trim whitespace", () => {
      expect(sanitizeDomain("  example.com  ")).toBe("example.com");
    });

    it("should handle combined cleanup", () => {
      expect(sanitizeDomain("https://example.com:8000/")).toBe("example.com");
    });
  });

  describe("escapePsqlString", () => {
    it("should return normal string unchanged", () => {
      expect(escapePsqlString("https://example.com")).toBe("https://example.com");
    });

    it("should escape single quotes", () => {
      expect(escapePsqlString("it's")).toBe("it''s");
    });

    it("should escape multiple single quotes", () => {
      expect(escapePsqlString("it's a 'test'")).toBe("it''s a ''test''");
    });

    it("should handle empty string", () => {
      expect(escapePsqlString("")).toBe("");
    });

    it("should handle string with only quotes", () => {
      expect(escapePsqlString("'''")).toBe("''''''");
    });
  });

  describe("buildSetFqdnCommand", () => {
    it("should build HTTPS psql update + restart command", () => {
      const cmd = buildSetFqdnCommand("example.com", true);
      expect(cmd).toContain("UPDATE instance_settings SET fqdn='https://example.com'");
      expect(cmd).toContain("docker exec coolify-db psql");
      expect(cmd).toContain(
        "docker compose -f docker-compose.yml -f docker-compose.prod.yml restart coolify",
      );
    });

    it("should build HTTP psql update command", () => {
      const cmd = buildSetFqdnCommand("example.com", false);
      expect(cmd).toContain("fqdn='http://example.com'");
    });

    it("should chain commands with &&", () => {
      const cmd = buildSetFqdnCommand("example.com", true);
      expect(cmd).toContain(" && ");
    });

    it("should throw error for invalid domain characters", () => {
      expect(() => buildSetFqdnCommand("exam'ple.com", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should throw for semicolon injection", () => {
      expect(() => buildSetFqdnCommand("example.com; rm -rf /", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should throw for pipe injection", () => {
      expect(() => buildSetFqdnCommand("example.com | cat /etc/passwd", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should throw for backtick injection", () => {
      expect(() => buildSetFqdnCommand("example.com`whoami`", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });

    it("should throw for dollar sign injection", () => {
      expect(() => buildSetFqdnCommand("example.com$(id)", true)).toThrow(
        "Invalid domain for FQDN command",
      );
    });
  });

  describe("buildGetFqdnCommand", () => {
    it("should query instance_settings via psql", () => {
      const cmd = buildGetFqdnCommand();
      expect(cmd).toContain("docker exec coolify-db psql");
      expect(cmd).toContain("SELECT fqdn FROM instance_settings");
      expect(cmd).toContain("-t"); // tuple-only mode
    });
  });

  describe("buildCoolifyCheckCommand", () => {
    it("should check for coolify-db container", () => {
      const cmd = buildCoolifyCheckCommand();
      expect(cmd).toContain("docker ps");
      expect(cmd).toContain("coolify-db");
    });
  });

  describe("buildDnsCheckCommand", () => {
    it("should use dig with getent fallback", () => {
      const cmd = buildDnsCheckCommand("example.com");
      expect(cmd).toContain("dig");
      expect(cmd).toContain("getent ahosts");
      expect(cmd).toContain("example.com");
    });

    it("should strip special characters from domain", () => {
      const cmd = buildDnsCheckCommand("example.com;rm -rf /");
      expect(cmd).toContain("example.comrm-rf");
      expect(cmd).not.toContain(";");
    });

    it("should preserve valid domain characters", () => {
      const cmd = buildDnsCheckCommand("sub.example.com");
      expect(cmd).toContain("sub.example.com");
    });
  });

  describe("parseDnsResult", () => {
    it("should parse IP from dig output", () => {
      expect(parseDnsResult("1.2.3.4\n")).toBe("1.2.3.4");
    });

    it("should parse IP from getent ahosts output", () => {
      expect(parseDnsResult("1.2.3.4       STREAM example.com")).toBe("1.2.3.4");
    });

    it("should parse IP from host output", () => {
      expect(parseDnsResult("example.com has address 1.2.3.4")).toBe("1.2.3.4");
    });

    it("should return null for no IP", () => {
      expect(parseDnsResult("")).toBeNull();
      expect(parseDnsResult("no record found")).toBeNull();
    });
  });

  describe("parseFqdn", () => {
    it("should parse psql output with leading whitespace", () => {
      expect(parseFqdn(" https://example.com\n")).toBe("https://example.com");
    });

    it("should parse clean psql output", () => {
      expect(parseFqdn("https://example.com")).toBe("https://example.com");
    });

    it("should return null for empty output", () => {
      expect(parseFqdn("")).toBeNull();
      expect(parseFqdn("   ")).toBeNull();
      expect(parseFqdn("\n")).toBeNull();
    });
  });

  // Command tests
  describe("domainCommand", () => {
    it("should show error when SSH not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);
      await domainCommand();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should show error for invalid subcommand", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      await domainCommand("invalid");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid subcommand");
    });

    it("should return when no server found", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([]);
      await domainCommand("list", "nonexistent");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Server not found");
    });

    // add subcommand
    it("should error on missing domain for add", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("add", "1.2.3.4", {});

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Missing --domain");
    });

    it("should error on invalid domain", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("add", "1.2.3.4", { domain: "-invalid" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid domain");
    });

    it("should add domain successfully", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" }) // container check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // psql update + restart

      await domainCommand("add", "1.2.3.4", { domain: "example.com" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("https://example.com");
    });

    it("should error when Coolify DB container not found", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      await domainCommand("add", "1.2.3.4", { domain: "example.com" });

      // spinner.fail - container not found, sshExec called once (only check)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    });

    it("should show dry-run for add", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("add", "1.2.3.4", { domain: "example.com", dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(output).toContain("No changes applied");
    });

    it("should handle add failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "error" });

      await domainCommand("add", "1.2.3.4", { domain: "example.com" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
    });

    it("should handle add exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" })
        .mockRejectedValueOnce(new Error("fail"));

      await domainCommand("add", "1.2.3.4", { domain: "example.com" });
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should show SSH hint on add exception with connection timed out", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" })
        .mockRejectedValueOnce(new Error("Connection timed out"));

      await domainCommand("add", "1.2.3.4", { domain: "example.com" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH connection timed out");
    });

    it("should sanitize domain before adding", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      await domainCommand("add", "1.2.3.4", { domain: "https://example.com/" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("https://example.com");
    });

    it("should add domain with SSL disabled", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "coolify-db", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      await domainCommand("add", "1.2.3.4", { domain: "example.com", ssl: false });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("http://example.com");
    });

    // remove subcommand
    it("should remove domain successfully", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await domainCommand("remove", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("http://1.2.3.4:8000");
    });

    it("should show dry-run for remove", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("remove", "1.2.3.4", { dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
    });

    it("should handle remove failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await domainCommand("remove", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle remove exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await domainCommand("remove", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    // check subcommand
    it("should error on missing domain for check", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("check", "1.2.3.4", {});

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Missing --domain");
    });

    it("should error on invalid domain for check", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await domainCommand("check", "1.2.3.4", { domain: "not valid" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid domain");
    });

    it("should show DNS match", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "1.2.3.4\n", stderr: "" });

      await domainCommand("check", "1.2.3.4", { domain: "example.com" });
      // spinner.succeed called - DNS OK
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should show DNS mismatch", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "5.6.7.8\n", stderr: "" });

      await domainCommand("check", "1.2.3.4", { domain: "example.com" });
      // spinner.warn called - DNS mismatch
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should show no DNS record", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await domainCommand("check", "1.2.3.4", { domain: "example.com" });
      // spinner.fail - no record
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle check exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await domainCommand("check", "1.2.3.4", { domain: "example.com" });
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    // list subcommand
    it("should list current domain from psql", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: " https://example.com\n",
        stderr: "",
      });

      await domainCommand("list", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("https://example.com");
    });

    it("should show default when no domain set", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "  \n",
        stderr: "",
      });

      await domainCommand("list", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("http://1.2.3.4:8000");
    });

    it("should handle list failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await domainCommand("list", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle list exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await domainCommand("list", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should default to list subcommand", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: " https://example.com\n",
        stderr: "",
      });

      await domainCommand(undefined, "1.2.3.4");

      expect(mockedSsh.sshExec).toHaveBeenCalledWith(
        "1.2.3.4",
        expect.stringContaining("SELECT fqdn"),
      );
    });

    // info subcommand
    it("should show domain info with FQDN and SSL enabled", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: " https://example.com\n",
        stderr: "",
      });

      await domainCommand("info", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("coolify-test");
      expect(output).toContain("https://example.com");
      expect(output).toContain("SSL: enabled");
    });

    it("should show domain info without FQDN (uses IP)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "   \n",
        stderr: "",
      });

      await domainCommand("info", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("not set");
      expect(output).toContain("http://1.2.3.4:8000");
    });

    it("should show domain info with HTTP FQDN (SSL disabled)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: " http://example.com\n",
        stderr: "",
      });

      await domainCommand("info", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSL: disabled");
    });

    it("should handle info failure (non-zero code)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await domainCommand("info", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle info exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("Connection refused"));

      await domainCommand("info", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH connection refused");
    });

    // ---- BARE-06 mode guard: domain is blocked on bare servers ----

    it("should reject bare-mode server with requireCoolifyMode error (BARE-06)", async () => {
      const bareServer = { ...sampleServer, mode: "bare" as const };
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);

      await domainCommand("list", "1.2.3.4");

      // domain command should NOT proceed to SSH — bare guard fires before switch
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("domain");
    });
  });
});
