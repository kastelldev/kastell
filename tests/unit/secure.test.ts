import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import inquirer from "inquirer";
import {
  secureCommand,
  secureSetup,
  parseSshdConfig,
  parseAuditResult,
  buildHardeningCommand,
  buildFail2banCommand,
  buildAuditCommand,
  buildKeyCheckCommand,
} from "../../src/commands/secure";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

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

const sampleSshdConfig = `# SSH daemon config
Port 22
PasswordAuthentication yes
PermitRootLogin yes
PubkeyAuthentication yes
MaxAuthTries 6`;

const sampleSecureSshdConfig = `Port 2222
PasswordAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3`;

describe("secure", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Pure function tests
  describe("parseSshdConfig", () => {
    it("should parse insecure settings", () => {
      const settings = parseSshdConfig(sampleSshdConfig);

      const passAuth = settings.find((s) => s.key === "PasswordAuthentication");
      expect(passAuth?.value).toBe("yes");
      expect(passAuth?.status).toBe("insecure");

      const rootLogin = settings.find((s) => s.key === "PermitRootLogin");
      expect(rootLogin?.value).toBe("yes");
      expect(rootLogin?.status).toBe("insecure");
    });

    it("should parse secure settings", () => {
      const settings = parseSshdConfig(sampleSecureSshdConfig);

      const passAuth = settings.find((s) => s.key === "PasswordAuthentication");
      expect(passAuth?.value).toBe("no");
      expect(passAuth?.status).toBe("secure");

      const rootLogin = settings.find((s) => s.key === "PermitRootLogin");
      expect(rootLogin?.value).toBe("prohibit-password");
      expect(rootLogin?.status).toBe("secure");

      const maxAuth = settings.find((s) => s.key === "MaxAuthTries");
      expect(maxAuth?.value).toBe("3");
      expect(maxAuth?.status).toBe("secure");
    });

    it("should handle missing settings", () => {
      const settings = parseSshdConfig("# empty config");

      for (const setting of settings) {
        expect(setting.status).toBe("missing");
        expect(setting.value).toBe("");
      }
    });

    it("should parse PubkeyAuthentication", () => {
      const settings = parseSshdConfig(sampleSshdConfig);
      const pubkey = settings.find((s) => s.key === "PubkeyAuthentication");
      expect(pubkey?.value).toBe("yes");
      expect(pubkey?.status).toBe("secure");
    });

    it("should parse lowercase sshd -T output (BUGF-03)", () => {
      const sshdTOutput = `passwordauthentication no
permitrootlogin prohibit-password
pubkeyauthentication yes
maxauthtries 3
port 2222`;
      const settings = parseSshdConfig(sshdTOutput);

      const passAuth = settings.find((s) => s.key === "PasswordAuthentication");
      expect(passAuth?.value).toBe("no");
      expect(passAuth?.status).toBe("secure");

      const rootLogin = settings.find((s) => s.key === "PermitRootLogin");
      expect(rootLogin?.value).toBe("prohibit-password");
      expect(rootLogin?.status).toBe("secure");

      const pubkey = settings.find((s) => s.key === "PubkeyAuthentication");
      expect(pubkey?.value).toBe("yes");
      expect(pubkey?.status).toBe("secure");

      const maxAuth = settings.find((s) => s.key === "MaxAuthTries");
      expect(maxAuth?.value).toBe("3");
      expect(maxAuth?.status).toBe("secure");
    });

    it("should still parse mixed-case cat output (backward compat, BUGF-03)", () => {
      const settings = parseSshdConfig(sampleSecureSshdConfig);
      const passAuth = settings.find((s) => s.key === "PasswordAuthentication");
      expect(passAuth?.value).toBe("no");
      expect(passAuth?.status).toBe("secure");
    });
  });

  describe("parseAuditResult", () => {
    it("should parse full audit output", () => {
      const stdout = `${sampleSshdConfig}\n---SEPARATOR---\n● fail2ban.service - Fail2Ban Service\n   Active: active (running)`;
      const result = parseAuditResult(stdout);

      expect(result.passwordAuth.value).toBe("yes");
      expect(result.passwordAuth.status).toBe("insecure");
      expect(result.rootLogin.value).toBe("yes");
      expect(result.fail2ban.installed).toBe(true);
      expect(result.fail2ban.active).toBe(true);
      expect(result.sshPort).toBe(22);
    });

    it("should detect non-default SSH port", () => {
      const stdout = `${sampleSecureSshdConfig}\n---SEPARATOR---\nUnit fail2ban.service could not be found.`;
      const result = parseAuditResult(stdout);

      expect(result.sshPort).toBe(2222);
      expect(result.fail2ban.installed).toBe(false);
      expect(result.fail2ban.active).toBe(false);
    });

    it("should handle empty output", () => {
      const result = parseAuditResult("");
      expect(result.sshPort).toBe(22);
      expect(result.passwordAuth.status).toBe("missing");
      expect(result.fail2ban.installed).toBe(false);
    });

    it("should parse lowercase port from sshd -T output (BUGF-03)", () => {
      const stdout = `passwordauthentication no\npermitrootlogin prohibit-password\nport 2222\n---SEPARATOR---\nUnit fail2ban.service could not be found.`;
      const result = parseAuditResult(stdout);
      expect(result.sshPort).toBe(2222);
    });

    it("should still parse mixed-case Port from cat output (backward compat, BUGF-03)", () => {
      const stdout = `${sampleSecureSshdConfig}\n---SEPARATOR---\nUnit fail2ban.service could not be found.`;
      const result = parseAuditResult(stdout);
      expect(result.sshPort).toBe(2222);
    });

    it("should detect inactive fail2ban", () => {
      const stdout = `${sampleSshdConfig}\n---SEPARATOR---\n● fail2ban.service - Fail2Ban Service\n   Active: inactive (dead)`;
      const result = parseAuditResult(stdout);

      expect(result.fail2ban.installed).toBe(true);
      expect(result.fail2ban.active).toBe(false);
    });
  });

  describe("buildHardeningCommand", () => {
    it("should include backup step", () => {
      const cmd = buildHardeningCommand();
      expect(cmd).toContain("sshd_config.bak");
    });

    it("should disable password auth", () => {
      const cmd = buildHardeningCommand();
      expect(cmd).toContain("PasswordAuthentication no");
    });

    it("should set root login to prohibit-password", () => {
      const cmd = buildHardeningCommand();
      expect(cmd).toContain("PermitRootLogin prohibit-password");
    });

    it("should enable pubkey auth", () => {
      const cmd = buildHardeningCommand();
      expect(cmd).toContain("PubkeyAuthentication yes");
    });

    it("should set max auth tries", () => {
      const cmd = buildHardeningCommand();
      expect(cmd).toContain("MaxAuthTries 3");
    });

    it("should restart sshd", () => {
      const cmd = buildHardeningCommand();
      expect(cmd).toContain("systemctl restart sshd");
    });

    it("should change SSH port when specified", () => {
      const cmd = buildHardeningCommand({ port: 2222 });
      expect(cmd).toContain("Port 2222");
    });

    it("should not change port when not specified", () => {
      const cmd = buildHardeningCommand();
      expect(cmd).not.toContain("Port");
    });

    it("should not change port when port is 22", () => {
      const cmd = buildHardeningCommand({ port: 22 });
      expect(cmd).not.toContain("Port 22");
    });
  });

  describe("buildFail2banCommand", () => {
    it("should install fail2ban", () => {
      const cmd = buildFail2banCommand();
      expect(cmd).toContain("apt-get install -y fail2ban");
    });

    it("should create jail config", () => {
      const cmd = buildFail2banCommand();
      expect(cmd).toContain("[sshd]");
      expect(cmd).toContain("enabled = true");
    });

    it("should enable and restart", () => {
      const cmd = buildFail2banCommand();
      expect(cmd).toContain("systemctl enable fail2ban");
      expect(cmd).toContain("systemctl restart fail2ban");
    });
  });

  describe("buildAuditCommand", () => {
    it("should use sshd -T with cat fallback and check fail2ban (BUGF-03)", () => {
      const cmd = buildAuditCommand();
      expect(cmd).toContain("sshd -T");
      expect(cmd).toContain("cat /etc/ssh/sshd_config");
      expect(cmd).toContain("fail2ban");
    });
  });

  describe("buildKeyCheckCommand", () => {
    it("should check authorized_keys", () => {
      const cmd = buildKeyCheckCommand();
      expect(cmd).toContain("authorized_keys");
    });
  });

  // Command tests
  describe("secureCommand", () => {
    it("should show error when SSH not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);
      await secureCommand();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should show error for invalid subcommand", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      await secureCommand("invalid");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid subcommand");
    });

    it("should return when no server found", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([]);
      await secureCommand("status", "nonexistent");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Server not found");
    });

    // setup subcommand
    it("should reject setup when no SSH keys found", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "0", stderr: "" });

      await secureCommand("setup", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No SSH keys found");
    });

    it("should show dry-run for setup", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await secureCommand("setup", "1.2.3.4", { dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(output).toContain("No changes applied");
    });

    it("should cancel setup when first confirm is false", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
      mockedInquirer.prompt = jest.fn().mockResolvedValue({ confirm: false }) as any;

      await secureCommand("setup", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("cancelled");
    });

    it("should cancel setup when name does not match", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "wrong-name" }) as any;

      await secureCommand("setup", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("does not match");
    });

    it("should run full setup when confirmed", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // hardening
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // fail2ban
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;

      await secureCommand("setup", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Security setup complete");
    });

    it("should handle hardening failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "error" });
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;

      await secureCommand("setup", "1.2.3.4");
      // Should not continue to fail2ban
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
    });

    it("should handle hardening exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" })
        .mockRejectedValueOnce(new Error("fail"));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;

      await secureCommand("setup", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
    });

    it("should show SSH hint on hardening exception with permission denied", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" })
        .mockRejectedValueOnce(new Error("Permission denied"));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;

      await secureCommand("setup", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH authentication failed");
    });

    it("should show partially complete when fail2ban fails (non-zero code)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "apt error" });
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;

      await secureCommand("setup", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("partially complete");
      expect(output).toContain("fail2ban is not active");
    });

    it("should show partially complete when fail2ban throws exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockRejectedValueOnce(new Error("fail"));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;

      await secureCommand("setup", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("partially complete");
      expect(output).toContain("fail2ban is not active");
    });

    it("should error on invalid port", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await secureCommand("setup", "1.2.3.4", { port: "abc" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid --port");
    });

    it("should warn about port change", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;

      await secureCommand("setup", "1.2.3.4", { port: "2222" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH port changed to 2222");
    });

    // status subcommand
    it("should show security status", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: `${sampleSshdConfig}\n---SEPARATOR---\n● fail2ban.service\n   Active: active (running)`,
        stderr: "",
      });

      await secureCommand("status", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Password Auth");
      expect(output).toContain("Root Login");
      expect(output).toContain("Fail2ban");
      expect(output).toContain("SSH Port");
    });

    it("should handle status failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await secureCommand("status", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle status exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await secureCommand("status", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    // audit subcommand
    it("should show security audit with score", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: `${sampleSecureSshdConfig}\n---SEPARATOR---\n● fail2ban.service\n   Active: active (running)`,
        stderr: "",
      });

      await secureCommand("audit", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Security Score");
    });

    it("should show improvement suggestions for low score", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: `${sampleSshdConfig}\n---SEPARATOR---\nUnit fail2ban.service could not be found.`,
        stderr: "",
      });

      await secureCommand("audit", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("kastell secure setup");
    });

    it("should handle audit failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await secureCommand("audit", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle audit exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await secureCommand("audit", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should skip prompts when force=true (via secureSetup)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // hardening
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // fail2ban

      await secureSetup("1.2.3.4", "coolify-test", undefined, false, true);

      // inquirer.prompt should NOT have been called
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Security setup complete");
    });

    // ---- BARE-04 regression: secure works on bare servers ----

    it("should run secure status for bare-mode server without mode-related errors (BARE-04 regression)", async () => {
      const bareServer = { ...sampleServer, mode: "bare" as const };
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: `Port 22\nPasswordAuthentication no\n---SEPARATOR---\nUnit fail2ban.service could not be found.`,
        stderr: "",
      });

      await secureCommand("status", "1.2.3.4");

      // Should proceed to SSH command (no mode-related errors)
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should default to status subcommand", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: `${sampleSshdConfig}\n---SEPARATOR---\n`,
        stderr: "",
      });

      await secureCommand(undefined, "1.2.3.4");

      expect(mockedSsh.sshExec).toHaveBeenCalledWith(
        "1.2.3.4",
        expect.stringContaining("sshd_config"),
      );
    });
  });
});
