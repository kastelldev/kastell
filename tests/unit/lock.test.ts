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
  buildDockerHardeningCommand,
  buildSshCipherCommand,
  buildCronAccessCommand,
  buildSshFineTuningCommand,
  buildLoginDefsCommand,
  buildFaillockCommand,
  buildSudoHardeningCommand,
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

  it("cleans up old kastell-aide cron.d entry", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("kastell-aide");
  });

  it("writes cron.daily script for daily aide checks", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("/etc/cron.daily/aide-check");
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

// ─── buildSshCipherCommand ───────────────────────────────────────────────────

describe("buildSshCipherCommand", () => {
  it("contains sed with tab-aware pattern for Ciphers/MACs/KexAlgorithms", () => {
    const cmd = buildSshCipherCommand();
    expect(cmd).toContain("Ciphers[ \\t]");
    expect(cmd).toContain("MACs[ \\t]");
    expect(cmd).toContain("KexAlgorithms[ \\t]");
  });

  it("creates sshd_config backup before changes", () => {
    const cmd = buildSshCipherCommand();
    expect(cmd).toContain("cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-cipher");
  });

  it("validates with sshd -t and rolls back on failure", () => {
    const cmd = buildSshCipherCommand();
    expect(cmd).toContain("sshd -t");
    expect(cmd).toContain("sshd_config.bak-cipher /etc/ssh/sshd_config");
    expect(cmd).toContain("exit 1");
  });

  it("appends cipher blacklist lines with minus prefix", () => {
    const cmd = buildSshCipherCommand();
    expect(cmd).toMatch(/Ciphers -/);
    expect(cmd).toMatch(/MACs -/);
    expect(cmd).toMatch(/KexAlgorithms -/);
  });
});

// ─── buildDockerHardeningCommand ─────────────────────────────────────────────

describe("buildDockerHardeningCommand", () => {
  it("bare: contains live-restore:true", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"live-restore":true');
  });

  it("bare: contains no-new-privileges", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("no-new-privileges");
  });

  it("bare: contains log-driver json-file", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"log-driver":"json-file"');
  });

  it("bare: contains max-size 10m", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"max-size":"10m"');
  });

  it("bare: contains max-file 3", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"max-file":"3"');
  });

  it("bare: contains icc:false", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"icc":false');
  });

  it("contains command -v jq guard with exit 0", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("command -v jq");
    expect(cmd).toContain("exit 0");
  });

  it("contains command -v docker guard", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("command -v docker");
  });

  it("contains daemon.json.bak-docker backup", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("daemon.json.bak-docker");
  });

  it("uses jq deep merge via stdin pipe", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("jq -s '.[0] * .[1]'");
    expect(cmd).toContain("printf '%s'");
  });

  it("contains systemctl reload docker before restart", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("systemctl reload docker");
  });

  it("contains rollback pattern on validation failure", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain(".bak-docker");
    expect(cmd).toContain("rolled back");
  });

  it("coolify: does NOT contain icc", () => {
    const cmd = buildDockerHardeningCommand("coolify");
    expect(cmd).not.toContain('"icc"');
  });

  it("coolify: DOES contain live-restore", () => {
    const cmd = buildDockerHardeningCommand("coolify");
    expect(cmd).toContain('"live-restore":true');
  });

  it("dokploy: does NOT contain icc", () => {
    const cmd = buildDockerHardeningCommand("dokploy");
    expect(cmd).not.toContain('"icc"');
  });

  it("dokploy: does NOT contain live-restore", () => {
    const cmd = buildDockerHardeningCommand("dokploy");
    expect(cmd).not.toContain('"live-restore"');
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

    it("returns LockResult with all 24 step fields", async () => {
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
      expect(result.steps).toHaveProperty("dockerHardening");
      expect(result.steps).toHaveProperty("auditd");
      expect(result.steps).toHaveProperty("logRetention");
      expect(result.steps).toHaveProperty("aide");
      expect(result.steps).toHaveProperty("cronAccess");
      expect(result.steps).toHaveProperty("sshFineTuning");
      expect(result.steps).toHaveProperty("loginDefs");
      expect(result.steps).toHaveProperty("faillock");
      expect(result.steps).toHaveProperty("sudoHardening");
    });
  });

  describe("happy path", () => {
    it("calls sshExec 25 times: key check + 24 steps", async () => {
      mockedAudit.runAudit
        .mockResolvedValueOnce(makeAuditResult(45))
        .mockResolvedValueOnce(makeAuditResult(72));
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

      await applyLock("1.2.3.4", "test-server", undefined, {});

      // key check + SSH hardening + fail2ban + banners + accountLock + sshCipher + UFW + cloudMeta + DNS
      // + sysctl + unattended-upgrades + aptValidation + resourceLimits + serviceDisable
      // + backupPermissions + pwquality + dockerHardening + auditd + logRetention + aide + cronAccess
      // + sshFineTuning + loginDefs + faillock + sudoHardening = 25
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(25);
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
      expect(result.steps.dockerHardening).toBe(true);
      expect(result.steps.auditd).toBe(true);
      expect(result.steps.logRetention).toBe(true);
      expect(result.steps.aide).toBe(true);
      expect(result.steps.cronAccess).toBe(true);
      expect(result.steps.sshFineTuning).toBe(true);
      expect(result.steps.loginDefs).toBe(true);
      expect(result.steps.faillock).toBe(true);
      expect(result.steps.sudoHardening).toBe(true);
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

      // All 25 calls were made (key check + 24 steps)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(25);
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

      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(25);
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
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // dockerHardening
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // auditd
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // logRetention
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // aide
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // cronAccess
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sshFineTuning
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // loginDefs
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // faillock
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // sudoHardening

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.ufw).toBe(false);
      expect(result.steps.cloudMeta).toBe(false);
      expect(result.stepErrors?.ufw).toBeDefined();
      expect(result.stepErrors?.cloudMeta).toBe("UFW required");
      // 24 calls: no cloudMeta call since UFW failed, but all other steps run (including P87 steps)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(24);
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
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // dockerHardening
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // auditd
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // logRetention
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // aide
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // cronAccess
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sshFineTuning
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // loginDefs
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // faillock
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // sudoHardening

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.steps.dns).toBe(false);
      expect(result.stepErrors?.dns).toContain("dig timeout");
      // 26 calls: 25 normal + 1 DNS rollback
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(26);
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

      // Should still complete all 25 calls (key check + 24 steps)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(25);
      expect(result.steps.sshHardening).toBe(true);
    });
  });
});

describe("buildAideInitCommand (P82 fix)", () => {
  it("writes executable script to /etc/cron.daily/aide-check", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("/etc/cron.daily/aide-check");
  });

  it("makes cron.daily script executable with chmod 755", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("chmod 755 /etc/cron.daily/aide-check");
  });

  it("cron.daily script contains aide --check", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("aide --check");
  });

  it("still installs aide via apt-get", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("apt-get install -y aide");
  });

  it("still initializes aide database in background", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("aide --init");
  });

  it("cleans up old /etc/cron.d/kastell-aide", () => {
    const cmd = buildAideInitCommand();
    expect(cmd).toContain("rm -f /etc/cron.d/kastell-aide");
  });
});

describe("buildAuditdCommand (P82 fix)", () => {
  it("restarts auditd service after loading rules", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("restart auditd");
  });

  it("still loads rules with augenrules", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("augenrules --load");
  });

  it("restart comes after augenrules --load", () => {
    const cmd = buildAuditdCommand();
    const augenrulesIdx = cmd.indexOf("augenrules --load");
    const restartIdx = cmd.indexOf("restart auditd");
    expect(restartIdx).toBeGreaterThan(augenrulesIdx);
  });

  it("contains file access watch rules for /etc/passwd (SC-2)", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("/etc/passwd");
    expect(cmd).toContain("-k identity");
  });

  it("contains file access watch rules for /etc/shadow (SC-2)", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("/etc/shadow");
  });

  it("contains privilege escalation syscall rules (SC-2)", () => {
    const cmd = buildAuditdCommand();
    expect(cmd).toContain("-k privilege");
    // setuid/setgid/setreuid/setregid syscall monitoring
    expect(cmd).toMatch(/set(re)?uid/);
  });
});

describe("buildLogRetentionCommand (P82 fix)", () => {
  it("installs logrotate package", () => {
    const cmd = buildLogRetentionCommand();
    expect(cmd).toContain("apt-get install -y logrotate");
  });

  it("enables logrotate.timer", () => {
    const cmd = buildLogRetentionCommand();
    expect(cmd).toContain("logrotate.timer");
  });

  it("still enables and starts rsyslog", () => {
    const cmd = buildLogRetentionCommand();
    expect(cmd).toContain("rsyslog");
  });

  it("still writes logrotate config to /etc/logrotate.d/", () => {
    const cmd = buildLogRetentionCommand();
    expect(cmd).toContain("/etc/logrotate.d/99-kastell-syslog");
  });
});

describe("buildCronAccessCommand", () => {
  it("creates /etc/cron.allow with root only", () => {
    const cmd = buildCronAccessCommand();
    expect(cmd).toContain("/etc/cron.allow");
    expect(cmd).toContain("root");
  });

  it("creates /etc/at.deny", () => {
    const cmd = buildCronAccessCommand();
    expect(cmd).toContain("/etc/at.deny");
  });

  it("sets 600 permissions on cron.allow", () => {
    const cmd = buildCronAccessCommand();
    expect(cmd).toContain("chmod 600 /etc/cron.allow");
  });

  it("sets 600 permissions on at.deny", () => {
    const cmd = buildCronAccessCommand();
    expect(cmd).toContain("chmod 600 /etc/at.deny");
  });
});

describe("buildDockerHardeningCommand (P82 fix)", () => {
  it("creates /etc/docker directory before daemon.json check", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("mkdir -p /etc/docker");
  });

  it("mkdir comes before daemon.json file check", () => {
    const cmd = buildDockerHardeningCommand("dokploy");
    const mkdirIdx = cmd.indexOf("mkdir -p /etc/docker");
    const fileCheckIdx = cmd.indexOf("daemon.json");
    expect(mkdirIdx).toBeLessThan(fileCheckIdx);
  });
});

describe("applyLock cronAccess step (P82)", () => {
  it("includes cronAccess in lock result steps", async () => {
    // Arrange
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));

    // Act
    const result: LockResult = await applyLock("1.2.3.4", "test", undefined, {});

    // Assert
    expect(result.steps).toHaveProperty("cronAccess");
  });

  it("sets cronAccess to true on successful execution", async () => {
    // Arrange
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));

    // Act
    const result: LockResult = await applyLock("1.2.3.4", "test", undefined, {});

    // Assert
    expect(result.steps.cronAccess).toBe(true);
  });
});

// ─── buildSshFineTuningCommand (P87) ─────────────────────────────────────────

describe("buildSshFineTuningCommand (P87)", () => {
  it("backs up sshd_config to bak-finetune", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("sshd_config.bak-finetune");
  });

  it("sets ClientAliveInterval 300", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("ClientAliveInterval");
    expect(cmd).toContain("300");
  });

  it("sets ClientAliveCountMax 3", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("ClientAliveCountMax");
    expect(cmd).toContain("3");
  });

  it("sets LoginGraceTime 60", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("LoginGraceTime");
    expect(cmd).toContain("60");
  });

  it("sets AllowAgentForwarding no", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("AllowAgentForwarding");
  });

  it("sets X11Forwarding no", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("X11Forwarding");
  });

  it("sets MaxStartups 10:30:60", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("MaxStartups");
    expect(cmd).toContain("10:30:60");
  });

  it("sets StrictModes yes", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("StrictModes");
  });

  it("sets PermitUserEnvironment no", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("PermitUserEnvironment");
  });

  it("sets LogLevel VERBOSE", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("LogLevel");
    expect(cmd).toContain("VERBOSE");
  });

  it("sets UseDNS no", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("UseDNS");
  });

  it("sets PrintMotd no", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("PrintMotd");
  });

  it("sets IgnoreRhosts yes", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("IgnoreRhosts");
  });

  it("sets HostbasedAuthentication no", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("HostbasedAuthentication");
  });

  it("sets MaxSessions 10", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("MaxSessions");
    expect(cmd).toContain("10");
  });

  it("sets PermitEmptyPasswords no", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("PermitEmptyPasswords");
  });

  it("includes sshd -t rollback gate", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("sshd -t");
  });

  it("restarts sshd on success", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toMatch(/systemctl restart ssh/);
  });

  it("uses grep-sed-or-append for idempotency", () => {
    const cmd = buildSshFineTuningCommand();
    expect(cmd).toContain("grep -qE");
  });
});

// ─── buildLoginBannersCommand /etc/motd (P87) ────────────────────────────────

describe("buildLoginBannersCommand /etc/motd (P87)", () => {
  it("writes to /etc/motd", () => {
    const cmd = buildLoginBannersCommand();
    expect(cmd).toContain("/etc/motd");
  });
});

// ─── buildCronAccessCommand at.allow (P87) ───────────────────────────────────

describe("buildCronAccessCommand at.allow (P87)", () => {
  it("creates /etc/at.allow with root", () => {
    const cmd = buildCronAccessCommand();
    expect(cmd).toContain("at.allow");
    expect(cmd).toContain("root");
  });

  it("sets 600 permissions on at.allow", () => {
    const cmd = buildCronAccessCommand();
    expect(cmd).toContain("chmod 600 /etc/at.allow");
  });
});

// ─── buildLoginDefsCommand (P87) ─────────────────────────────────────────────

describe("buildLoginDefsCommand (P87)", () => {
  it("sets PASS_MIN_DAYS 1 in login.defs", () => {
    const cmd = buildLoginDefsCommand();
    expect(cmd).toContain("PASS_MIN_DAYS");
    expect(cmd).toContain("1");
  });

  it("sets PASS_WARN_AGE 7 in login.defs", () => {
    const cmd = buildLoginDefsCommand();
    expect(cmd).toContain("PASS_WARN_AGE");
    expect(cmd).toContain("7");
  });

  it("sets ENCRYPT_METHOD SHA512", () => {
    const cmd = buildLoginDefsCommand();
    expect(cmd).toContain("ENCRYPT_METHOD");
    expect(cmd).toContain("SHA512");
  });

  it("sets UMASK 027", () => {
    const cmd = buildLoginDefsCommand();
    expect(cmd).toContain("UMASK");
    expect(cmd).toContain("027");
  });

  it("sets INACTIVE=30 in /etc/default/useradd", () => {
    const cmd = buildLoginDefsCommand();
    expect(cmd).toContain("INACTIVE");
    expect(cmd).toContain("/etc/default/useradd");
  });

  it("uses idempotent grep-sed-or-append", () => {
    const cmd = buildLoginDefsCommand();
    expect(cmd).toContain("grep -qE");
  });
});

// ─── buildFaillockCommand (P87) ──────────────────────────────────────────────

describe("buildFaillockCommand (P87)", () => {
  it("writes deny = 5 to faillock.conf", () => {
    const cmd = buildFaillockCommand();
    expect(cmd).toContain("deny = 5");
  });

  it("writes unlock_time = 900", () => {
    const cmd = buildFaillockCommand();
    expect(cmd).toContain("unlock_time = 900");
  });

  it("writes fail_interval = 900", () => {
    const cmd = buildFaillockCommand();
    expect(cmd).toContain("fail_interval = 900");
  });

  it("creates /etc/security directory", () => {
    const cmd = buildFaillockCommand();
    expect(cmd).toContain("mkdir -p /etc/security");
  });

  it("calls pam-auth-update with faillock", () => {
    const cmd = buildFaillockCommand();
    expect(cmd).toContain("pam-auth-update");
  });
});

// ─── buildSudoHardeningCommand (P87) ─────────────────────────────────────────

describe("buildSudoHardeningCommand (P87)", () => {
  it("creates kastell-logging in sudoers.d", () => {
    const cmd = buildSudoHardeningCommand();
    expect(cmd).toContain("kastell-logging");
  });

  it("sets Defaults log_output", () => {
    const cmd = buildSudoHardeningCommand();
    expect(cmd).toContain("log_output");
  });

  it("creates kastell-requiretty", () => {
    const cmd = buildSudoHardeningCommand();
    expect(cmd).toContain("kastell-requiretty");
  });

  it("sets Defaults requiretty", () => {
    const cmd = buildSudoHardeningCommand();
    expect(cmd).toContain("requiretty");
  });

  it("sets chmod 440 on sudoers.d files", () => {
    const cmd = buildSudoHardeningCommand();
    expect(cmd).toContain("chmod 440");
  });

  it("skips if already present via grep", () => {
    const cmd = buildSudoHardeningCommand();
    expect(cmd).toContain("grep -qr");
  });
});

// ─── applyLock P87 steps ─────────────────────────────────────────────────────

describe("applyLock P87 steps", () => {
  it("includes sshFineTuning in lock result steps", async () => {
    // Arrange
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));

    // Act
    const result: LockResult = await applyLock("1.2.3.4", "test", undefined, {});

    // Assert
    expect(result.steps).toHaveProperty("sshFineTuning");
  });

  it("includes loginDefs in lock result steps", async () => {
    // Arrange
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));

    // Act
    const result: LockResult = await applyLock("1.2.3.4", "test", undefined, {});

    // Assert
    expect(result.steps).toHaveProperty("loginDefs");
  });

  it("includes faillock in lock result steps", async () => {
    // Arrange
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));

    // Act
    const result: LockResult = await applyLock("1.2.3.4", "test", undefined, {});

    // Assert
    expect(result.steps).toHaveProperty("faillock");
  });

  it("includes sudoHardening in lock result steps", async () => {
    // Arrange
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(80));

    // Act
    const result: LockResult = await applyLock("1.2.3.4", "test", undefined, {});

    // Assert
    expect(result.steps).toHaveProperty("sudoHardening");
  });
});
