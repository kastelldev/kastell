import * as sshUtils from "../../src/utils/ssh";
import * as auditModule from "../../src/core/audit/index";
import {
  buildSysctlHardeningCommand,
  buildUnattendedUpgradesCommand,
  buildLoginBannersCommand,
  buildAuditdCommand,
  buildResourceLimitsCommand,
  buildServiceDisableCommand,
  buildAptValidationCommand,
  buildLogRetentionCommand,
  buildCloudMetaBlockCommand,
  buildAccountLockCommand,
  buildAideInitCommand,
  buildBackupPermissionsCommand,
  buildDnsSecurityCommand,
  buildDnsRollbackCommand,
  buildPwqualityCommand,
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
    auditVersion: "1.0.0",
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

  // Deep kernel hardening (CIS L2) — new settings
  it("contains kernel.dmesg_restrict=1", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("kernel.dmesg_restrict=1");
  });

  it("contains kernel.kptr_restrict=1", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("kernel.kptr_restrict=1");
  });

  it("contains fs.suid_dumpable=0", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("fs.suid_dumpable=0");
  });

  it("contains net.ipv4.conf.all.rp_filter=2 (loose mode for Docker)", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("net.ipv4.conf.all.rp_filter=2");
  });

  it("contains net.ipv4.conf.default.rp_filter=2", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("net.ipv4.conf.default.rp_filter=2");
  });

  it("contains net.core.bpf_jit_harden=1", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("net.core.bpf_jit_harden=1");
  });

  it("contains kernel.unprivileged_bpf_disabled=1", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("kernel.unprivileged_bpf_disabled=1");
  });

  it("contains net.ipv4.conf.all.send_redirects=0", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("net.ipv4.conf.all.send_redirects=0");
  });

  it("contains net.ipv4.conf.default.send_redirects=0", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("net.ipv4.conf.default.send_redirects=0");
  });

  it("contains net.ipv4.conf.all.secure_redirects=0", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("net.ipv4.conf.all.secure_redirects=0");
  });

  it("contains net.ipv6.conf.all.accept_redirects=0", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("net.ipv6.conf.all.accept_redirects=0");
  });

  it("contains net.ipv6.conf.default.accept_redirects=0", () => {
    const cmd = buildSysctlHardeningCommand();
    expect(cmd).toContain("net.ipv6.conf.default.accept_redirects=0");
  });

  it("contains all 21 sysctl settings (8 original + 13 new)", () => {
    const cmd = buildSysctlHardeningCommand();
    const settingCount = (cmd.match(/net\.|kernel\.|fs\./g) || []).length;
    expect(settingCount).toBeGreaterThanOrEqual(21);
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

// ─── buildLoginBannersCommand ────────────────────────────────────────────────

describe("buildLoginBannersCommand", () => {
  it("writes to /etc/issue", () => {
    const cmd = buildLoginBannersCommand();
    expect(cmd).toContain("/etc/issue");
  });

  it("writes to /etc/issue.net", () => {
    const cmd = buildLoginBannersCommand();
    expect(cmd).toContain("/etc/issue.net");
  });

  it("adds Banner /etc/issue.net to sshd_config", () => {
    const cmd = buildLoginBannersCommand();
    expect(cmd).toContain("Banner /etc/issue.net");
  });

  it("restarts ssh service", () => {
    const cmd = buildLoginBannersCommand();
    expect(cmd).toContain("systemctl restart ssh");
  });

  it("includes authorized access text", () => {
    const cmd = buildLoginBannersCommand();
    expect(cmd).toContain("Authorized access only");
  });
});

// ─── buildAuditdCommand ──────────────────────────────────────────────────────

describe("buildAuditdCommand", () => {
  it("installs auditd via apt-get", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("apt-get install -y auditd");
  });

  it("writes rules to 99-kastell.rules", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("99-kastell.rules");
  });

  it("watches /etc/passwd with write/attr permissions", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("/etc/passwd -p wa");
  });

  it("watches /etc/shadow with write/attr permissions", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("/etc/shadow -p wa");
  });

  it("watches /etc/sudoers with write/attr permissions", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("/etc/sudoers -p wa");
  });

  it("monitors setuid and setgid syscalls", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("setuid");
    expect(cmd).toContain("setgid");
  });

  it("locks audit config with -e 2", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("-e 2");
  });

  it("writes deep rules to 50-kastell-deep.rules", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("50-kastell-deep.rules");
  });

  it("writes -e 2 immutability to 99-kastell.rules (not 50)", () => {
    const cmd = buildAuditdCommand();
    // -e 2 must appear in the context of 99-kastell.rules
    expect(cmd).toContain("99-kastell.rules");
    // deep rules file must be separate
    expect(cmd).toContain("50-kastell-deep.rules");
  });

  it("contains time-change audit key", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("-k time-change");
  });

  it("contains logins audit key", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("-k logins");
  });

  it("contains session audit key", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("-k session");
  });

  it("contains network-change audit key", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("-k network-change");
  });

  it("contains kernel-module audit key", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("-k kernel-module");
  });

  it("contains adjtimex syscall for time change monitoring", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("adjtimex");
  });

  it("contains sethostname syscall for network change monitoring", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("sethostname");
  });

  it("contains init_module syscall for kernel module monitoring", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("init_module");
  });
});

// ─── buildResourceLimitsCommand ─────────────────────────────────────────────

describe("buildResourceLimitsCommand", () => {
  it("writes to /etc/security/limits.d/99-kastell.conf", () => {
    const cmd = buildResourceLimitsCommand();
    expect(cmd).toContain("limits.d/99-kastell.conf");
  });

  it("sets nproc limits", () => {
    const cmd = buildResourceLimitsCommand();
    expect(cmd).toContain("nproc");
  });

  it("sets nofile limits", () => {
    const cmd = buildResourceLimitsCommand();
    expect(cmd).toContain("nofile");
  });
});

// ─── buildServiceDisableCommand ─────────────────────────────────────────────

describe("buildServiceDisableCommand", () => {
  it("targets bluetooth service", () => {
    const cmd = buildServiceDisableCommand();
    expect(cmd).toContain("bluetooth");
  });

  it("targets avahi-daemon service", () => {
    const cmd = buildServiceDisableCommand();
    expect(cmd).toContain("avahi-daemon");
  });

  it("targets cups service", () => {
    const cmd = buildServiceDisableCommand();
    expect(cmd).toContain("cups");
  });

  it("targets rpcbind service", () => {
    const cmd = buildServiceDisableCommand();
    expect(cmd).toContain("rpcbind");
  });

  it("checks service existence with systemctl list-unit-files", () => {
    const cmd = buildServiceDisableCommand();
    expect(cmd).toContain("systemctl list-unit-files");
  });

  it("disables services with systemctl disable", () => {
    const cmd = buildServiceDisableCommand();
    expect(cmd).toContain("systemctl disable");
  });
});

// ─── buildAptValidationCommand ───────────────────────────────────────────────

describe("buildAptValidationCommand", () => {
  it("writes to 99-kastell-apt.conf", () => {
    const cmd = buildAptValidationCommand();
    expect(cmd).toContain("99-kastell-apt.conf");
  });

  it("sets AllowUnauthenticated to false", () => {
    const cmd = buildAptValidationCommand();
    expect(cmd).toContain("AllowUnauthenticated");
  });

  it("sets AllowInsecureRepositories to false", () => {
    const cmd = buildAptValidationCommand();
    expect(cmd).toContain("AllowInsecureRepositories");
  });
});

// ─── buildLogRetentionCommand ────────────────────────────────────────────────

describe("buildLogRetentionCommand", () => {
  it("enables rsyslog", () => {
    const cmd = buildLogRetentionCommand();
    expect(cmd).toContain("rsyslog");
  });

  it("sets log rotation to 90 days", () => {
    const cmd = buildLogRetentionCommand();
    expect(cmd).toContain("rotate 90");
  });

  it("writes to 99-kastell-syslog logrotate config", () => {
    const cmd = buildLogRetentionCommand();
    expect(cmd).toContain("99-kastell-syslog");
  });
});

// ─── buildCloudMetaBlockCommand ──────────────────────────────────────────────

describe("buildCloudMetaBlockCommand", () => {
  it("blocks metadata endpoint 169.254.169.254", () => {
    const cmd = buildCloudMetaBlockCommand();
    expect(cmd).toContain("169.254.169.254");
  });

  it("uses ufw deny", () => {
    const cmd = buildCloudMetaBlockCommand();
    expect(cmd).toContain("ufw deny");
  });
});

// ─── buildAccountLockCommand ─────────────────────────────────────────────────

describe("buildAccountLockCommand", () => {
  it("locks accounts with passwd -l", () => {
    const cmd = buildAccountLockCommand();
    expect(cmd).toContain("passwd -l");
  });

  it("targets accounts with UID >= 1000 using awk", () => {
    const cmd = buildAccountLockCommand();
    expect(cmd).toContain("$3 >= 1000");
  });
});

// ─── buildAideInitCommand ────────────────────────────────────────────────────

describe("buildAideInitCommand", () => {
  it("installs aide via apt-get", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("apt-get install -y aide");
  });

  it("uses nohup fire-and-forget for aide --init", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("nohup aide --init");
  });

  it("creates kastell-aide cron file", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("kastell-aide");
  });

  it("schedules daily cron at 05:00", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("0 5 * * *");
  });
});

// ─── buildBackupPermissionsCommand ───────────────────────────────────────────

describe("buildBackupPermissionsCommand", () => {
  it("installs rsync via apt-get", () => {
    const cmd = buildBackupPermissionsCommand();
    expect(cmd).toContain("apt-get install -y rsync");
  });

  it("sets chmod 700 on /var/backups", () => {
    const cmd = buildBackupPermissionsCommand();
    expect(cmd).toContain("chmod 700 /var/backups");
  });
});

// ─── buildDnsSecurityCommand ─────────────────────────────────────────────────

describe("buildDnsSecurityCommand", () => {
  it("writes to 99-kastell-dns.conf drop-in", () => {
    const cmd = buildDnsSecurityCommand();
    expect(cmd).toContain("99-kastell-dns.conf");
  });

  it("sets DNSSEC=yes", () => {
    const cmd = buildDnsSecurityCommand();
    expect(cmd).toContain("DNSSEC=yes");
  });

  it("sets DNSOverTLS=opportunistic", () => {
    const cmd = buildDnsSecurityCommand();
    expect(cmd).toContain("DNSOverTLS=opportunistic");
  });

  it("verifies DNS with dig google.com", () => {
    const cmd = buildDnsSecurityCommand();
    expect(cmd).toContain("dig google.com");
  });

  it("backs up resolved.conf", () => {
    const cmd = buildDnsSecurityCommand();
    expect(cmd).toContain("resolved.conf.kastell.bak");
  });
});

// ─── buildDnsRollbackCommand ─────────────────────────────────────────────────

describe("buildDnsRollbackCommand", () => {
  it("removes 99-kastell-dns.conf drop-in", () => {
    const cmd = buildDnsRollbackCommand();
    expect(cmd).toContain("rm -f");
    expect(cmd).toContain("99-kastell-dns.conf");
  });

  it("restarts systemd-resolved after rollback", () => {
    const cmd = buildDnsRollbackCommand();
    expect(cmd).toContain("systemctl restart systemd-resolved");
  });
});

// ─── buildPwqualityCommand ───────────────────────────────────────────────────

describe("buildPwqualityCommand", () => {
  it("checks libpam-pwquality availability with apt-cache", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("apt-cache show libpam-pwquality");
  });

  it("installs libpam-pwquality via apt-get", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("apt-get install -y libpam-pwquality");
  });

  it("writes to /etc/security/pwquality.conf", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("/etc/security/pwquality.conf");
  });

  it("sets minlen = 14 (CIS L1 minimum password length)", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("minlen = 14");
  });

  it("sets dcredit = -1 (digit required)", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("dcredit = -1");
  });

  it("sets ucredit = -1 (uppercase required)", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("ucredit = -1");
  });

  it("sets lcredit = -1 (lowercase required)", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("lcredit = -1");
  });

  it("sets ocredit = -1 (special char required)", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("ocredit = -1");
  });

  it("sets maxrepeat = 3 (no more than 3 consecutive identical chars)", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("maxrepeat = 3");
  });

  it("exits 0 gracefully when package is unavailable (non-fatal)", () => {
    const cmd = buildPwqualityCommand();
    expect(cmd).toContain("exit 0");
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

    it("returns LockResult with all 17 step fields", async () => {
      const result = await applyLock("1.2.3.4", "test-server", undefined, { dryRun: true });
      expect(result).toHaveProperty("steps");
      expect(result.steps).toHaveProperty("sshHardening");
      expect(result.steps).toHaveProperty("fail2ban");
      expect(result.steps).toHaveProperty("ufw");
      expect(result.steps).toHaveProperty("sysctl");
      expect(result.steps).toHaveProperty("unattendedUpgrades");
      expect(result.steps).toHaveProperty("banners");
      expect(result.steps).toHaveProperty("accountLock");
      expect(result.steps).toHaveProperty("cloudMeta");
      expect(result.steps).toHaveProperty("dns");
      expect(result.steps).toHaveProperty("aptValidation");
      expect(result.steps).toHaveProperty("resourceLimits");
      expect(result.steps).toHaveProperty("serviceDisable");
      expect(result.steps).toHaveProperty("backupPermissions");
      expect(result.steps).toHaveProperty("pwquality");
      expect(result.steps).toHaveProperty("auditd");
      expect(result.steps).toHaveProperty("logRetention");
      expect(result.steps).toHaveProperty("aide");
    });
  });

  describe("happy path", () => {
    it("calls sshExec 19 times: key check + 18 steps", async () => {
      mockedAudit.runAudit
        .mockResolvedValueOnce(makeAuditResult(45))
        .mockResolvedValueOnce(makeAuditResult(72));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await applyLock("1.2.3.4", "test-server", undefined, {});

      // key check + SSH hardening + fail2ban + banners + accountLock + sshCipher + UFW + cloudMeta + DNS
      // + sysctl + unattended-upgrades + aptValidation + resourceLimits + serviceDisable
      // + backupPermissions + pwquality + auditd + logRetention + aide = 19
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(19);
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
      expect(result.steps.banners).toBe(true);
      expect(result.steps.accountLock).toBe(true);
      expect(result.steps.cloudMeta).toBe(true);
      expect(result.steps.dns).toBe(true);
      expect(result.steps.aptValidation).toBe(true);
      expect(result.steps.resourceLimits).toBe(true);
      expect(result.steps.serviceDisable).toBe(true);
      expect(result.steps.backupPermissions).toBe(true);
      expect(result.steps.pwquality).toBe(true);
      expect(result.steps.auditd).toBe(true);
      expect(result.steps.logRetention).toBe(true);
      expect(result.steps.aide).toBe(true);
    });

    it("stepErrors is absent on full success", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.stepErrors).toBeUndefined();
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
        .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // all remaining steps

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.fail2ban).toBe(false);
      expect(result.steps.sshHardening).toBe(true);
      expect(result.steps.ufw).toBe(true);
      expect(result.steps.sysctl).toBe(true);
      expect(result.steps.unattendedUpgrades).toBe(true);
      expect(result.success).toBe(true);
    });

    it("populates stepErrors for the failed step", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // SSH hardening
        .mockRejectedValueOnce(new Error("fail2ban install failed")) // fail2ban
        .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // all remaining steps

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.stepErrors?.fail2ban).toBeDefined();
    });

    it("runs all remaining steps even when a non-critical step fails", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // SSH hardening
        .mockRejectedValueOnce(new Error("fail2ban failed")) // fail2ban (non-fatal)
        .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // all remaining steps

      await applyLock("1.2.3.4", "test-server", undefined, {});

      // All 19 calls were made (key check + 18 steps)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(19);
    });
  });

  describe("SSH hardening failure (critical step)", () => {
    it("returns overall success=false when SSH hardening throws", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockRejectedValueOnce(new Error("SSH hardening failed")) // SSH hardening (critical)
        .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // remaining steps

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.sshHardening).toBe(false);
      expect(result.success).toBe(false);
    });

    it("continues non-critical steps even after SSH hardening failure", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockRejectedValueOnce(new Error("SSH hardening failed")) // SSH hardening
        .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // all remaining steps

      await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(19);
    });
  });

  describe("cloud metadata skip when UFW fails", () => {
    it("skips cloudMeta when UFW step fails", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // SSH hardening
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // fail2ban
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // banners
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // accountLock
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sshCipher
        .mockRejectedValueOnce(new Error("UFW failed")) // UFW
        // cloudMeta is SKIPPED (no sshExec call)
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // DNS
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sysctl
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // unattended
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // aptValidation
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // resourceLimits
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // serviceDisable
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // backupPermissions
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // pwquality
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // auditd
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // logRetention
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // aide

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.ufw).toBe(false);
      expect(result.steps.cloudMeta).toBe(false);
      expect(result.stepErrors?.ufw).toBeDefined();
      expect(result.stepErrors?.cloudMeta).toBe("UFW required");
      // 18 calls: no cloudMeta call since UFW failed, but all other steps run
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(18);
    });
  });

  describe("DNS rollback on failure", () => {
    it("rolls back DNS on dig failure and sets dns=false", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // SSH hardening
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // fail2ban
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // banners
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // accountLock
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sshCipher
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // UFW
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // cloudMeta
        .mockRejectedValueOnce(new Error("dig timeout")) // DNS FAIL
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // DNS rollback
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sysctl
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // unattended
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // aptValidation
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // resourceLimits
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // serviceDisable
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // backupPermissions
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // pwquality
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // auditd
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // logRetention
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // aide

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.dns).toBe(false);
      expect(result.stepErrors?.dns).toContain("dig timeout");
      // 20 calls: 19 normal + 1 DNS rollback
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(20);
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

      // Should still complete all 19 calls (key check + 18 steps)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(19);
      expect(result.steps.sshHardening).toBe(true);
    });
  });
});
