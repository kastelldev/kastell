import * as sshUtils from "../../src/utils/ssh";
import * as auditModule from "../../src/core/audit/index";
import {
  buildSysctlHardeningCommand,
  buildUnattendedUpgradesCommand,
  applyLock,
} from "../../src/core/lock";
import type { LockResult } from "../../src/core/lock";

jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/audit/index");

const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedAudit = auditModule as jest.Mocked<typeof auditModule>;

const makeAuditResult = (score: number) => ({
  success: true,
  data: {
    serverName: "test",
    serverIp: "1.2.3.4",
    platform: "bare" as const,
    timestamp: new Date().toISOString(),
    categories: [],
    overallScore: score,
    quickWins: [],
  },
});

beforeEach(() => {
  jest.resetAllMocks();
  mockedSsh.assertValidIp.mockImplementation(() => undefined);
  mockedSsh.checkSshAvailable.mockReturnValue(true);
});

// ─── buildSysctlHardeningCommand ────────────────────────────────────────────

describe("buildSysctlHardeningCommand", () => {
  it("writes to /etc/sysctl.d/99-kastell.conf", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("99-kastell.conf");
  });

  it("contains net.ipv4.conf.all.accept_redirects=0", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("accept_redirects");
  });

  it("contains net.ipv4.conf.all.accept_source_route=0", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("accept_source_route");
  });

  it("contains net.ipv4.tcp_syncookies=1", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("tcp_syncookies");
  });

  it("contains kernel.randomize_va_space=2", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("randomize_va_space");
  });

  it("applies settings with sysctl -p", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("sysctl -p");
  });

  it("includes all 8 sysctl settings", () => {
    const cmd = buildSysctlHardeningCommand();
    const settingCount = (cmd.match(/net\.|kernel\./g) || []).length;
    expect(settingCount).toBeGreaterThanOrEqual(8);
  });

  it("is idempotent - uses printf write to overwrite file", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toMatch(/printf|tee/);
    expect(cmd).toContain("99-kastell.conf");
  });
});

// ─── buildUnattendedUpgradesCommand ─────────────────────────────────────────

describe("buildUnattendedUpgradesCommand", () => {
  it("installs unattended-upgrades via apt-get", () => {
    const cmd = buildUnattendedUpgradesCommand();
    expect(cmd).toContain("apt-get install -y unattended-upgrades");
  });

  it("writes periodic config to /etc/apt/apt.conf.d/20auto-upgrades", () => {
    const cmd = buildUnattendedUpgradesCommand();
    expect(cmd).toContain("20auto-upgrades");
  });

  it("includes APT::Periodic::Update-Package-Lists", () => {
    const cmd = buildUnattendedUpgradesCommand();
    expect(cmd).toContain("Update-Package-Lists");
  });

  it("includes APT::Periodic::Unattended-Upgrade", () => {
    const cmd = buildUnattendedUpgradesCommand();
    expect(cmd).toContain("Unattended-Upgrade");
  });
});

// ─── applyLock ───────────────────────────────────────────────────────────────

describe("applyLock", () => {
  describe("dryRun=true", () => {
    it("returns success=true without calling sshExec", async () => {
      const result = await applyLock("1.2.3.4", "test-server", undefined, { dryRun: true });
      expect(result.success).toBe(true);
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("returns LockResult with steps structure", async () => {
      const result = await applyLock("1.2.3.4", "test-server", undefined, { dryRun: true });
      expect(result).toHaveProperty("steps");
      expect(result.steps).toHaveProperty("sshHardening");
      expect(result.steps).toHaveProperty("fail2ban");
      expect(result.steps).toHaveProperty("ufw");
      expect(result.steps).toHaveProperty("sysctl");
      expect(result.steps).toHaveProperty("unattendedUpgrades");
    });
  });

  describe("happy path", () => {
    it("calls sshExec 6 times: key check + 5 steps", async () => {
      mockedAudit.runAudit
        .mockResolvedValueOnce(makeAuditResult(45))
        .mockResolvedValueOnce(makeAuditResult(72));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await applyLock("1.2.3.4", "test-server", undefined, {});

      // key check + SSH hardening + fail2ban + UFW + sysctl + unattended-upgrades = 6
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(6);
    });

    it("captures scoreBefore=45 and scoreAfter=72 from runAudit", async () => {
      mockedAudit.runAudit
        .mockResolvedValueOnce(makeAuditResult(45))
        .mockResolvedValueOnce(makeAuditResult(72));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.scoreBefore).toBe(45);
      expect(result.scoreAfter).toBe(72);
    });

    it("marks all steps as true on full success", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.sshHardening).toBe(true);
      expect(result.steps.fail2ban).toBe(true);
      expect(result.steps.ufw).toBe(true);
      expect(result.steps.sysctl).toBe(true);
      expect(result.steps.unattendedUpgrades).toBe(true);
    });

    it("returns success=true on full success", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.success).toBe(true);
    });
  });

  describe("SSH key check failure", () => {
    it("returns error when key count is 0", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "0", stderr: "" });

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("No SSH keys found");
    });

    it("does not call further sshExec after key check failure", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "0", stderr: "" });

      await applyLock("1.2.3.4", "test-server", undefined, {});

      // Only key check called (1 call)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    });
  });

  describe("platform awareness", () => {
    it("passes platform=coolify to buildFirewallSetupCommand (includes port 8000)", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await applyLock("1.2.3.4", "test-server", "coolify", {});

      // UFW call should include 8000 (Coolify port)
      const calls = mockedSsh.sshExec.mock.calls.map((c) => c[1]);
      const ufwCall = calls.find((cmd) => cmd.includes("ufw"));
      expect(ufwCall).toContain("8000");
    });

    it("passes platform=dokploy to buildFirewallSetupCommand (includes port 3000)", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await applyLock("1.2.3.4", "test-server", "dokploy", {});

      const calls = mockedSsh.sshExec.mock.calls.map((c) => c[1]);
      const ufwCall = calls.find((cmd) => cmd.includes("ufw"));
      expect(ufwCall).toContain("3000");
    });
  });

  describe("partial failure - non-critical step throws", () => {
    it("marks fail2ban=false but continues, overall success=true (SSH hardening succeeded)", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // SSH hardening
        .mockRejectedValueOnce(new Error("fail2ban install failed")) // fail2ban
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // UFW
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sysctl
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // unattended-upgrades

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.fail2ban).toBe(false);
      expect(result.steps.sshHardening).toBe(true);
      expect(result.steps.ufw).toBe(true);
      expect(result.steps.sysctl).toBe(true);
      expect(result.steps.unattendedUpgrades).toBe(true);
      expect(result.success).toBe(true);
    });

    it("runs all remaining steps even when a non-critical step fails", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // SSH hardening
        .mockRejectedValueOnce(new Error("fail2ban failed")) // fail2ban (non-fatal)
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // UFW
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sysctl
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // unattended-upgrades

      await applyLock("1.2.3.4", "test-server", undefined, {});

      // All 6 calls were made (key check + 5 steps)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(6);
    });
  });

  describe("SSH hardening failure (critical step)", () => {
    it("returns overall success=false when SSH hardening throws", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockRejectedValueOnce(new Error("SSH hardening failed")); // SSH hardening (critical)

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.sshHardening).toBe(false);
      expect(result.success).toBe(false);
    });

    it("continues non-critical steps even after SSH hardening failure", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockRejectedValueOnce(new Error("SSH hardening failed")) // SSH hardening
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // fail2ban
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // UFW
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sysctl
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // unattended-upgrades

      await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(6);
    });
  });

  describe("runAudit integration", () => {
    it("calls runAudit twice: before and after hardening", async () => {
      mockedAudit.runAudit
        .mockResolvedValueOnce(makeAuditResult(45))
        .mockResolvedValueOnce(makeAuditResult(72));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await applyLock("1.2.3.4", "test-server", "coolify", {});

      expect(mockedAudit.runAudit).toHaveBeenCalledTimes(2);
    });

    it("passes platform to runAudit", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await applyLock("1.2.3.4", "test-server", "coolify", {});

      expect(mockedAudit.runAudit).toHaveBeenCalledWith("1.2.3.4", "test-server", "coolify");
    });

    it("uses 'bare' platform for runAudit when platform is undefined", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(mockedAudit.runAudit).toHaveBeenCalledWith("1.2.3.4", "test-server", "bare");
    });

    it("continues if runAudit fails (non-fatal)", async () => {
      mockedAudit.runAudit.mockRejectedValue(new Error("Audit failed"));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      // Should still complete all steps
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(6);
      expect(result.steps.sshHardening).toBe(true);
    });
  });
});
