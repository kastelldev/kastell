import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import inquirer from "inquirer";
import {
  isValidPort,
  isProtectedPort,
  buildUfwRuleCommand,
  buildFirewallSetupCommand,
  buildUfwStatusCommand,
  parseUfwStatus,
  PROTECTED_PORTS,
  BARE_PORTS,
  getPortsForPlatform,
} from "../../src/core/firewall";
import { firewallCommand } from "../../src/commands/firewall";
import type { Platform } from "../../src/types/index.js";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/adapters/factory.js", () => ({
  getAdapter: jest.fn((platform: string) => {
    if (platform === "coolify") return { name: "coolify", platformPorts: [80, 443, 8000, 6001, 6002] };
    if (platform === "dokploy") return { name: "dokploy", platformPorts: [80, 443, 3000] };
    return { name: "bare", platformPorts: [80, 443] };
  }),
  resolvePlatform: jest.fn((server: { mode?: string; platform?: string }) => {
    if (server.platform) return server.platform as "coolify" | "dokploy";
    if (server.mode === "bare") return undefined;
    return "coolify";
  }),
}));

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

describe("firewall", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Pure function tests
  describe("isValidPort", () => {
    it("should return true for valid ports", () => {
      expect(isValidPort(1)).toBe(true);
      expect(isValidPort(22)).toBe(true);
      expect(isValidPort(80)).toBe(true);
      expect(isValidPort(443)).toBe(true);
      expect(isValidPort(8000)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
    });

    it("should return false for invalid ports", () => {
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
      expect(isValidPort(1.5)).toBe(false);
      expect(isValidPort(NaN)).toBe(false);
    });
  });

  describe("isProtectedPort", () => {
    it("should return true for port 22", () => {
      expect(isProtectedPort(22)).toBe(true);
    });

    it("should return false for non-protected ports", () => {
      expect(isProtectedPort(80)).toBe(false);
      expect(isProtectedPort(443)).toBe(false);
      expect(isProtectedPort(8000)).toBe(false);
    });
  });

  describe("buildUfwRuleCommand", () => {
    it("should build allow command", () => {
      expect(buildUfwRuleCommand("allow", 80, "tcp")).toBe("ufw allow 80/tcp");
    });

    it("should build delete allow command", () => {
      expect(buildUfwRuleCommand("delete allow", 80, "tcp")).toBe("ufw delete allow 80/tcp");
    });

    it("should support udp protocol", () => {
      expect(buildUfwRuleCommand("allow", 53, "udp")).toBe("ufw allow 53/udp");
    });
  });

  describe("buildFirewallSetupCommand", () => {
    it("should include apt-get install", () => {
      const cmd = buildFirewallSetupCommand();
      expect(cmd).toContain("apt-get install -y ufw");
    });

    it("should include default deny incoming", () => {
      const cmd = buildFirewallSetupCommand();
      expect(cmd).toContain("ufw default deny incoming");
    });

    it("should include all Coolify ports", () => {
      const cmd = buildFirewallSetupCommand("coolify" as Platform);
      for (const port of [80, 443, 8000, 6001, 6002]) {
        expect(cmd).toContain(`ufw allow ${port}/tcp`);
      }
    });

    it("should include SSH port 22", () => {
      const cmd = buildFirewallSetupCommand();
      expect(cmd).toContain("ufw allow 22/tcp");
    });

    it("should enable UFW", () => {
      const cmd = buildFirewallSetupCommand();
      expect(cmd).toContain("ufw enable");
    });

    it("should return bare ports when called without platform", () => {
      const cmd = buildFirewallSetupCommand();
      expect(cmd).toContain("ufw allow 22/tcp");
      expect(cmd).toContain("ufw allow 80/tcp");
      expect(cmd).toContain("ufw allow 443/tcp");
      // Coolify-specific port'lar olmamalı
      expect(cmd).not.toContain("ufw allow 8000/tcp");
      expect(cmd).not.toContain("ufw allow 6001/tcp");
      expect(cmd).not.toContain("ufw allow 6002/tcp");
    });
  });

  describe("buildUfwStatusCommand", () => {
    it("should return ufw status numbered", () => {
      expect(buildUfwStatusCommand()).toBe("ufw status numbered");
    });
  });

  describe("parseUfwStatus", () => {
    it("should detect active status", () => {
      const stdout = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 80/tcp                     ALLOW IN    Anywhere`;

      const result = parseUfwStatus(stdout);
      expect(result.active).toBe(true);
      expect(result.rules).toHaveLength(2);
    });

    it("should detect inactive status", () => {
      const result = parseUfwStatus("Status: inactive");
      expect(result.active).toBe(false);
      expect(result.rules).toHaveLength(0);
    });

    it("should parse rules correctly", () => {
      const stdout = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 443/tcp                    DENY IN     Anywhere`;

      const result = parseUfwStatus(stdout);
      expect(result.rules[0]).toEqual({
        port: 22,
        protocol: "tcp",
        action: "ALLOW",
        from: "Anywhere",
      });
      expect(result.rules[1]).toEqual({
        port: 443,
        protocol: "tcp",
        action: "DENY",
        from: "Anywhere",
      });
    });

    it("should handle empty output", () => {
      const result = parseUfwStatus("");
      expect(result.active).toBe(false);
      expect(result.rules).toHaveLength(0);
    });

    it("should parse UDP rules", () => {
      const stdout = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 53/udp                     ALLOW IN    Anywhere`;

      const result = parseUfwStatus(stdout);
      expect(result.rules[0].protocol).toBe("udp");
    });
  });

  describe("PROTECTED_PORTS", () => {
    it("should include SSH port 22", () => {
      expect(PROTECTED_PORTS).toContain(22);
    });
  });

  describe("getPortsForPlatform", () => {
    it("should return coolify adapter ports for coolify platform", () => {
      const ports = getPortsForPlatform("coolify" as Platform);
      expect(ports).toEqual([80, 443, 8000, 6001, 6002]);
    });

    it("should return dokploy adapter ports for dokploy platform", () => {
      const ports = getPortsForPlatform("dokploy" as Platform);
      expect(ports).toEqual([80, 443, 3000]);
    });

    it("should return bare ports when no platform specified", () => {
      const ports = getPortsForPlatform(undefined);
      expect(ports).toEqual([80, 443]);
    });

    it("should return bare ports for bare platform", () => {
      const ports = getPortsForPlatform("bare" as Platform);
      expect(ports).toEqual([80, 443]);
    });
  });

  describe("BARE_PORTS", () => {
    it("should include only web ports (80, 443) — not Coolify-specific ports", () => {
      expect(BARE_PORTS).toEqual(expect.arrayContaining([80, 443]));
    });

    it("should NOT include Coolify-specific ports (8000, 6001, 6002)", () => {
      expect(BARE_PORTS).not.toContain(8000);
      expect(BARE_PORTS).not.toContain(6001);
      expect(BARE_PORTS).not.toContain(6002);
    });
  });

  // Command tests
  describe("firewallCommand", () => {
    it("should show error when SSH not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);
      await firewallCommand();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should show error for invalid subcommand", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      await firewallCommand("invalid");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid subcommand");
    });

    it("should return when no server found", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([]);
      await firewallCommand("status", "nonexistent");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Server not found");
    });

    // setup subcommand
    it("should setup firewall successfully", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("setup", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should show dry-run for setup", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("setup", "1.2.3.4", { dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(output).toContain("No changes applied");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle setup failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "permission denied" });

      await firewallCommand("setup", "1.2.3.4");
      // spinner.fail is called (ora mock)
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    // add subcommand
    it("should add port successfully", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("add", "1.2.3.4", { port: "3000", protocol: "tcp" });

      expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", "ufw allow 3000/tcp");
    });

    it("should error on missing port for add", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("add", "1.2.3.4", {});

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid or missing --port");
    });

    it("should error on invalid port for add", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("add", "1.2.3.4", { port: "99999" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid or missing --port");
    });

    it("should error on invalid protocol", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("add", "1.2.3.4", { port: "80", protocol: "icmp" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid --protocol");
    });

    it("should show dry-run for add", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("add", "1.2.3.4", { port: "3000", dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    // remove subcommand
    it("should block removing protected port 22", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("remove", "1.2.3.4", { port: "22" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("protected");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should warn when removing Coolify port", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt = jest.fn().mockResolvedValue({ confirm: false }) as unknown as typeof mockedInquirer.prompt;

      await firewallCommand("remove", "1.2.3.4", { port: "8000" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("cancelled");
    });

    it("should remove non-protected port", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("remove", "1.2.3.4", { port: "3000" });

      expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", "ufw delete allow 3000/tcp");
    });

    it("should error on missing port for remove", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("remove", "1.2.3.4", {});

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid or missing --port");
    });

    // list subcommand
    it("should list firewall rules", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 80/tcp                     ALLOW IN    Anywhere`,
        stderr: "",
      });

      await firewallCommand("list", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("22/tcp");
    });

    it("should show warning when UFW inactive on list", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "Status: inactive",
        stderr: "",
      });

      await firewallCommand("list", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("inactive");
    });

    // status subcommand
    it("should show active UFW status", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "Status: active",
        stderr: "",
      });

      await firewallCommand("status", "1.2.3.4");
      // spinner.succeed is called
      expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", "ufw status numbered");
    });

    it("should show inactive UFW status", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "Status: inactive",
        stderr: "",
      });

      await firewallCommand("status", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should show rules when UFW is active with rules", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 80/tcp                     ALLOW IN    Anywhere`,
        stderr: "",
      });

      await firewallCommand("status", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("22/tcp");
      expect(output).toContain("80/tcp");
      expect(output).toContain("2 rules");
    });

    it("should show no rules message when UFW is active but empty", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "Status: active\n\n     To                         Action      From\n     --                         ------      ----",
        stderr: "",
      });

      await firewallCommand("status", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No rules configured");
    });

    it("should handle setup exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("Connection timeout"));

      await firewallCommand("setup", "1.2.3.4");
      // Should not throw
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should show SSH hint on setup exception with connection refused", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("Connection refused"));

      await firewallCommand("setup", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH connection refused");
    });

    it("should handle add failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await firewallCommand("add", "1.2.3.4", { port: "3000" });
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle add exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await firewallCommand("add", "1.2.3.4", { port: "3000" });
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle remove failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await firewallCommand("remove", "1.2.3.4", { port: "3000" });
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle remove exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await firewallCommand("remove", "1.2.3.4", { port: "3000" });
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle list failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await firewallCommand("list", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle list exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await firewallCommand("list", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle status check failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

      await firewallCommand("status", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should handle status check exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockRejectedValue(new Error("fail"));

      await firewallCommand("status", "1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should show dry-run for remove", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("remove", "1.2.3.4", { port: "3000", dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should default protocol to tcp for remove", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("remove", "1.2.3.4", { port: "3000" });

      expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", "ufw delete allow 3000/tcp");
    });

    it("should error on invalid protocol for remove", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await firewallCommand("remove", "1.2.3.4", { port: "3000", protocol: "icmp" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid --protocol");
    });

    // ---- BARE-05 regression: firewall works on bare servers ----

    it("should run firewall status for bare-mode server without mode-related errors (BARE-05 regression)", async () => {
      const bareServer = { ...sampleServer, mode: "bare" as const };
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "Status: active",
        stderr: "",
      });

      await firewallCommand("status", "1.2.3.4");

      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should setup firewall for bare-mode server without mode-related errors (BARE-05 regression)", async () => {
      const bareServer = { ...sampleServer, mode: "bare" as const };
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("setup", "1.2.3.4");

      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should use bare firewall command (no Coolify ports) for bare-mode server (BUG-7)", async () => {
      const bareServer = { ...sampleServer, mode: "bare" as const };
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("setup", "1.2.3.4");

      const calledCommand = mockedSsh.sshExec.mock.calls[0][1] as string;
      // Should NOT contain Coolify-specific ports
      expect(calledCommand).not.toContain("8000");
      expect(calledCommand).not.toContain("6001");
      expect(calledCommand).not.toContain("6002");
      // Should contain basic web ports
      expect(calledCommand).toContain("80");
      expect(calledCommand).toContain("443");
    });

    it("should use Coolify firewall command for coolify-mode server (BUG-7 non-regression)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("setup", "1.2.3.4");

      const calledCommand = mockedSsh.sshExec.mock.calls[0][1] as string;
      // Should contain Coolify-specific ports
      expect(calledCommand).toContain("8000");
    });

    it("should show no rules message when list returns active but empty", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout:
          "Status: active\n\n     To                         Action      From\n     --                         ------      ----",
        stderr: "",
      });

      await firewallCommand("list", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No rules configured");
    });

    it("should remove Coolify port with --force (skip confirmation)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("remove", "1.2.3.4", { port: "8000", force: true });

      // inquirer.prompt should NOT have been called
      expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", "ufw delete allow 8000/tcp");
    });

    it("should show warning from remove result when present", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "Rule deleted (v4)\nRule deleted (v6)",
        stderr: "",
      });

      await firewallCommand("remove", "1.2.3.4", { port: "3000" });

      // Should succeed (port removed)
      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should show hint from add failure when present", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "permission denied" });

      await firewallCommand("add", "1.2.3.4", { port: "3000" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Failed to add rule");
    });

    it("should show hint from remove failure when present", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "permission denied" });

      await firewallCommand("remove", "1.2.3.4", { port: "3000" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Failed to remove rule");
    });

    it("should show hint from list failure when present", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "connection error" });

      await firewallCommand("list", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Failed to get firewall status");
    });

    it("should show hint from status check failure when present", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "timeout" });

      await firewallCommand("status", "1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Failed to get firewall status");
    });

    it("should remove Coolify port when confirmed", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt = jest.fn().mockResolvedValue({ confirm: true }) as unknown as typeof mockedInquirer.prompt;
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await firewallCommand("remove", "1.2.3.4", { port: "8000" });

      expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", "ufw delete allow 8000/tcp");
    });
  });
});
