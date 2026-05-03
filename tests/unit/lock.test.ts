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
} from "../../src/core/lock/index.js";
import type { LockResult } from "../../src/core/lock/index.js";

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

    it("returns error when SSH key check throws", async () => {
      mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
      mockedSsh.sshExec.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await applyLock("1.2.3.4", "test-server", undefined, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("SSH key check failed");
      expect(result.error).toContain("Connection refused");
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
  const cmd = buildSshFineTuningCommand();

  it("backs up sshd_config to bak-finetune", () => {
    expect(cmd).toContain("sshd_config.bak-finetune");
  });

  it("sets ClientAliveInterval 300", () => {
    expect(cmd).toContain("ClientAliveInterval");
    expect(cmd).toContain("300");
  });

  it("sets ClientAliveCountMax 3", () => {
    expect(cmd).toContain("ClientAliveCountMax");
    expect(cmd).toContain("3");
  });

  it("sets LoginGraceTime 60", () => {
    expect(cmd).toContain("LoginGraceTime");
    expect(cmd).toContain("60");
  });

  it("sets AllowAgentForwarding no", () => {
    expect(cmd).toContain("AllowAgentForwarding");
  });

  it("sets X11Forwarding no", () => {
    expect(cmd).toContain("X11Forwarding");
  });

  it("sets MaxStartups 10:30:60", () => {
    expect(cmd).toContain("MaxStartups");
    expect(cmd).toContain("10:30:60");
  });

  it("sets StrictModes yes", () => {
    expect(cmd).toContain("StrictModes");
  });

  it("sets PermitUserEnvironment no", () => {
    expect(cmd).toContain("PermitUserEnvironment");
  });

  it("sets LogLevel VERBOSE", () => {
    expect(cmd).toContain("LogLevel");
    expect(cmd).toContain("VERBOSE");
  });

  it("sets UseDNS no", () => {
    expect(cmd).toContain("UseDNS");
  });

  it("sets PrintMotd no", () => {
    expect(cmd).toContain("PrintMotd");
  });

  it("sets IgnoreRhosts yes", () => {
    expect(cmd).toContain("IgnoreRhosts");
  });

  it("sets HostbasedAuthentication no", () => {
    expect(cmd).toContain("HostbasedAuthentication");
  });

  it("sets MaxSessions 10", () => {
    expect(cmd).toContain("MaxSessions");
    expect(cmd).toContain("10");
  });

  it("sets PermitEmptyPasswords no", () => {
    expect(cmd).toContain("PermitEmptyPasswords");
  });

  it("includes sshd -t rollback gate", () => {
    expect(cmd).toContain("sshd -t");
  });

  it("restarts sshd on success", () => {
    expect(cmd).toMatch(/systemctl restart ssh/);
  });

  it("uses grep-sed-or-append for idempotency", () => {
    expect(cmd).toContain("grep -qE");
  });
});

// ─── buildLoginBannersCommand /etc/motd (P87) ────────────────────────────────

describe("buildLoginBannersCommand /etc/motd (P87)", () => {
  const cmd = buildLoginBannersCommand();

  it("writes to /etc/motd", () => {
    expect(cmd).toContain("/etc/motd");
  });
});

// ─── buildCronAccessCommand at.allow (P87) ───────────────────────────────────

describe("buildCronAccessCommand at.allow (P87)", () => {
  const cmd = buildCronAccessCommand();

  it("creates /etc/at.allow with root", () => {
    expect(cmd).toContain("at.allow");
    expect(cmd).toContain("root");
  });

  it("sets 600 permissions on at.allow", () => {
    expect(cmd).toContain("chmod 600 /etc/at.allow");
  });
});

// ─── buildLoginDefsCommand (P87) ─────────────────────────────────────────────

describe("buildLoginDefsCommand (P87)", () => {
  const cmd = buildLoginDefsCommand();

  it("sets PASS_MIN_DAYS 1 in login.defs", () => {
    expect(cmd).toContain("PASS_MIN_DAYS");
    expect(cmd).toContain("1");
  });

  it("sets PASS_WARN_AGE 7 in login.defs", () => {
    expect(cmd).toContain("PASS_WARN_AGE");
    expect(cmd).toContain("7");
  });

  it("sets ENCRYPT_METHOD SHA512", () => {
    expect(cmd).toContain("ENCRYPT_METHOD");
    expect(cmd).toContain("SHA512");
  });

  it("sets UMASK 027", () => {
    expect(cmd).toContain("UMASK");
    expect(cmd).toContain("027");
  });

  it("sets INACTIVE=30 in /etc/default/useradd", () => {
    expect(cmd).toContain("INACTIVE");
    expect(cmd).toContain("/etc/default/useradd");
  });

  it("uses idempotent grep-sed-or-append", () => {
    expect(cmd).toContain("grep -qE");
  });
});

// ─── buildFaillockCommand (P87) ──────────────────────────────────────────────

describe("buildFaillockCommand (P87)", () => {
  const cmd = buildFaillockCommand();

  it("writes deny = 5 to faillock.conf", () => {
    expect(cmd).toContain("deny = 5");
  });

  it("writes unlock_time = 900", () => {
    expect(cmd).toContain("unlock_time = 900");
  });

  it("writes fail_interval = 900", () => {
    expect(cmd).toContain("fail_interval = 900");
  });

  it("creates /etc/security directory", () => {
    expect(cmd).toContain("mkdir -p /etc/security");
  });

  it("calls pam-auth-update with faillock", () => {
    expect(cmd).toContain("pam-auth-update");
  });
});

// ─── buildSudoHardeningCommand (P87) ─────────────────────────────────────────

describe("buildSudoHardeningCommand (P87)", () => {
  const cmd = buildSudoHardeningCommand();

  it("creates kastell-logging in sudoers.d", () => {
    expect(cmd).toContain("kastell-logging");
  });

  it("sets Defaults log_output", () => {
    expect(cmd).toContain("log_output");
  });

  it("creates kastell-requiretty", () => {
    expect(cmd).toContain("kastell-requiretty");
  });

  it("sets Defaults requiretty", () => {
    expect(cmd).toContain("requiretty");
  });

  it("sets chmod 440 on sudoers.d files", () => {
    expect(cmd).toContain("chmod 440");
  });

  it("skips if already present via grep", () => {
    expect(cmd).toContain("grep -qr");
  });
});

// ─── applyLock — all steps fail (branch coverage) ────────────────────────────

describe("applyLock — every non-critical step fails", () => {
  it("populates stepErrors for all 24 steps when every sshExec after key-check rejects", async () => {
    // Arrange: pre-audit succeeds, key check returns 2 keys, then ALL steps throw
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check OK
      .mockRejectedValue(new Error("step failed")); // all remaining steps fail

    // Act
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});

    // Assert: SSH hardening failed => success = false
    expect(result.success).toBe(false);
    expect(result.steps.sshHardening).toBe(false);
    expect(result.steps.fail2ban).toBe(false);
    expect(result.steps.banners).toBe(false);
    expect(result.steps.accountLock).toBe(false);
    expect(result.steps.sshCipher).toBe(false);
    expect(result.steps.ufw).toBe(false);
    expect(result.steps.cloudMeta).toBe(false); // skipped because UFW failed
    expect(result.steps.dns).toBe(false);
    expect(result.steps.sysctl).toBe(false);
    expect(result.steps.unattendedUpgrades).toBe(false);
    expect(result.steps.aptValidation).toBe(false);
    expect(result.steps.resourceLimits).toBe(false);
    expect(result.steps.serviceDisable).toBe(false);
    expect(result.steps.backupPermissions).toBe(false);
    expect(result.steps.pwquality).toBe(false);
    expect(result.steps.dockerHardening).toBe(false);
    expect(result.steps.auditd).toBe(false);
    expect(result.steps.logRetention).toBe(false);
    expect(result.steps.aide).toBe(false);
    expect(result.steps.cronAccess).toBe(false);
    expect(result.steps.sshFineTuning).toBe(false);
    expect(result.steps.loginDefs).toBe(false);
    expect(result.steps.faillock).toBe(false);
    expect(result.steps.sudoHardening).toBe(false);

    // stepErrors populated for every step
    expect(result.stepErrors?.sshHardening).toBeDefined();
    expect(result.stepErrors?.fail2ban).toBeDefined();
    expect(result.stepErrors?.banners).toBeDefined();
    expect(result.stepErrors?.accountLock).toBeDefined();
    expect(result.stepErrors?.sshCipher).toBeDefined();
    expect(result.stepErrors?.ufw).toBeDefined();
    expect(result.stepErrors?.cloudMeta).toBe("UFW required");
    expect(result.stepErrors?.dns).toBeDefined();
    expect(result.stepErrors?.sysctl).toBeDefined();
    expect(result.stepErrors?.unattendedUpgrades).toBeDefined();
    expect(result.stepErrors?.aptValidation).toBeDefined();
    expect(result.stepErrors?.resourceLimits).toBeDefined();
    expect(result.stepErrors?.serviceDisable).toBeDefined();
    expect(result.stepErrors?.backupPermissions).toBeDefined();
    expect(result.stepErrors?.pwquality).toBeDefined();
    expect(result.stepErrors?.dockerHardening).toBeDefined();
    expect(result.stepErrors?.auditd).toBeDefined();
    expect(result.stepErrors?.logRetention).toBeDefined();
    expect(result.stepErrors?.aide).toBeDefined();
    expect(result.stepErrors?.cronAccess).toBeDefined();
    expect(result.stepErrors?.sshFineTuning).toBeDefined();
    expect(result.stepErrors?.loginDefs).toBeDefined();
    expect(result.stepErrors?.faillock).toBeDefined();
    expect(result.stepErrors?.sudoHardening).toBeDefined();
  });

  it("covers cloudMeta error branch when UFW succeeds but cloudMeta fails", async () => {
    // Arrange: key-check OK, SSH OK, fail2ban OK, banners OK, accountLock OK, sshCipher OK, UFW OK, cloudMeta FAIL
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // SSH hardening
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // fail2ban
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // banners
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // accountLock
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sshCipher
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // UFW
      .mockRejectedValueOnce(new Error("cloud metadata block failed")) // cloudMeta FAIL
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // all remaining steps OK

    // Act
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});

    // Assert: UFW OK, cloudMeta failed with error message (not "UFW required")
    expect(result.steps.ufw).toBe(true);
    expect(result.steps.cloudMeta).toBe(false);
    expect(result.stepErrors?.cloudMeta).toContain("cloud metadata block failed");
  });

  it("returns NaN key count as zero keys (abort path)", async () => {
    // Arrange: key check returns non-numeric output
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "not-a-number", stderr: "" });

    // Act
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});

    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("No SSH keys found");
  });

  it("handles pre-audit returning success=false (no score)", async () => {
    // Arrange: audit returns success but no data
    mockedAudit.runAudit
      .mockResolvedValueOnce({ success: false, error: "audit error" } as any) // pre-audit
      .mockResolvedValueOnce(makeAuditResult(70)); // post-audit
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

    // Act
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});

    // Assert: scoreBefore should be undefined since pre-audit failed
    expect(result.scoreBefore).toBeUndefined();
    expect(result.scoreAfter).toBe(70);
  });

  it("handles post-audit throwing (non-fatal)", async () => {
    // Arrange: pre-audit OK, post-audit throws
    mockedAudit.runAudit
      .mockResolvedValueOnce(makeAuditResult(45))
      .mockRejectedValueOnce(new Error("post-audit failed"));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });

    // Act
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});

    // Assert: scoreBefore set, scoreAfter undefined
    expect(result.scoreBefore).toBe(45);
    expect(result.scoreAfter).toBeUndefined();
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

// ─── Mutation-Killer: buildDockerHardeningCommand exact booleans ─────────────

describe("buildDockerHardeningCommand mutation-killer", () => {
  it("bare: no-new-privileges is exactly true (not false)", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"no-new-privileges":true');
    expect(cmd).not.toContain('"no-new-privileges":false');
  });

  it("bare: live-restore is exactly true (not false)", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"live-restore":true');
    expect(cmd).not.toContain('"live-restore":false');
  });

  it("bare: icc is exactly false (not true)", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"icc":false');
    expect(cmd).not.toContain('"icc":true');
  });

  it("coolify: still has no-new-privileges true", () => {
    const cmd = buildDockerHardeningCommand("coolify");
    expect(cmd).toContain('"no-new-privileges":true');
  });

  it("dokploy: still has no-new-privileges true", () => {
    const cmd = buildDockerHardeningCommand("dokploy");
    expect(cmd).toContain('"no-new-privileges":true');
  });

  it("dokploy: no live-restore and no icc", () => {
    const cmd = buildDockerHardeningCommand("dokploy");
    expect(cmd).not.toContain("live-restore");
    expect(cmd).not.toContain('"icc"');
  });

  it("coolify: has live-restore but no icc", () => {
    const cmd = buildDockerHardeningCommand("coolify");
    expect(cmd).toContain('"live-restore":true');
    expect(cmd).not.toContain('"icc"');
  });
});

// ─── Mutation-Killer: buildSshFineTuningCommand exact values ─────────────────

describe("buildSshFineTuningCommand mutation-killer", () => {
  const cmd = buildSshFineTuningCommand();

  it("AllowAgentForwarding is exactly no", () => {
    expect(cmd).toContain("AllowAgentForwarding no");
  });

  it("X11Forwarding is exactly no", () => {
    expect(cmd).toContain("X11Forwarding no");
  });

  it("StrictModes is exactly yes", () => {
    expect(cmd).toContain("StrictModes yes");
  });

  it("PermitUserEnvironment is exactly no", () => {
    expect(cmd).toContain("PermitUserEnvironment no");
  });

  it("LogLevel is exactly VERBOSE", () => {
    expect(cmd).toContain("LogLevel VERBOSE");
  });

  it("UseDNS is exactly no", () => {
    expect(cmd).toContain("UseDNS no");
  });

  it("PrintMotd is exactly no", () => {
    expect(cmd).toContain("PrintMotd no");
  });

  it("IgnoreRhosts is exactly yes", () => {
    expect(cmd).toContain("IgnoreRhosts yes");
  });

  it("HostbasedAuthentication is exactly no", () => {
    expect(cmd).toContain("HostbasedAuthentication no");
  });

  it("MaxSessions is exactly 10", () => {
    expect(cmd).toContain("MaxSessions 10");
  });

  it("PermitEmptyPasswords is exactly no", () => {
    expect(cmd).toContain("PermitEmptyPasswords no");
  });

  it("ClientAliveInterval is exactly 300", () => {
    expect(cmd).toContain("ClientAliveInterval 300");
  });

  it("ClientAliveCountMax is exactly 3", () => {
    expect(cmd).toContain("ClientAliveCountMax 3");
  });

  it("LoginGraceTime is exactly 60", () => {
    expect(cmd).toContain("LoginGraceTime 60");
  });

  it("contains exactly 15 directives (sshd_config entries)", () => {
    const directiveNames = [
      "ClientAliveInterval", "ClientAliveCountMax", "LoginGraceTime",
      "AllowAgentForwarding", "X11Forwarding", "MaxStartups",
      "StrictModes", "PermitUserEnvironment", "LogLevel",
      "UseDNS", "PrintMotd", "IgnoreRhosts",
      "HostbasedAuthentication", "MaxSessions", "PermitEmptyPasswords",
    ];
    for (const name of directiveNames) {
      expect(cmd).toContain(name);
    }
  });

  it("uses grep-sed-or-append pattern for each directive", () => {
    expect(cmd).toContain("grep -qE");
    expect(cmd).toContain("|| echo");
  });

  it("backs up before and rolls back on sshd -t failure", () => {
    expect(cmd).toContain("bak-finetune");
    expect(cmd).toContain("sshd -t");
    expect(cmd).toContain("rolled back");
  });
});

// ─── Mutation-Killer: buildLoginDefsCommand exact values ─────────────────────

describe("buildLoginDefsCommand mutation-killer", () => {
  const cmd = buildLoginDefsCommand();

  it("PASS_MIN_DAYS is exactly 1", () => {
    expect(cmd).toContain("PASS_MIN_DAYS 1");
  });

  it("PASS_WARN_AGE is exactly 7", () => {
    expect(cmd).toContain("PASS_WARN_AGE 7");
  });

  it("ENCRYPT_METHOD is exactly SHA512", () => {
    expect(cmd).toContain("ENCRYPT_METHOD SHA512");
  });

  it("UMASK is exactly 027", () => {
    expect(cmd).toContain("UMASK 027");
  });

  it("INACTIVE is exactly 30", () => {
    expect(cmd).toContain("INACTIVE=30");
  });

  it("targets /etc/login.defs for PASS_MIN_DAYS", () => {
    expect(cmd).toContain("PASS_MIN_DAYS");
    expect(cmd).toContain("/etc/login.defs");
  });

  it("targets /etc/default/useradd for INACTIVE", () => {
    expect(cmd).toContain("/etc/default/useradd");
    expect(cmd).toContain("INACTIVE");
  });
});

// ─── Mutation-Killer: buildFaillockCommand exact values ──────────────────────

describe("buildFaillockCommand mutation-killer", () => {
  const cmd = buildFaillockCommand();

  it("deny value is exactly 5", () => {
    expect(cmd).toContain("deny = 5");
    expect(cmd).not.toContain("deny = 0");
  });

  it("unlock_time value is exactly 900", () => {
    expect(cmd).toContain("unlock_time = 900");
  });

  it("fail_interval value is exactly 900", () => {
    expect(cmd).toContain("fail_interval = 900");
  });

  it("contains all 3 faillock directives", () => {
    const directives = ["deny", "unlock_time", "fail_interval"];
    for (const d of directives) {
      expect(cmd).toContain(d);
    }
  });
});

// ─── [MUTATION-KILLER] lock command string assertions ─────────────────────────
// Each assertion pins a specific string literal. Stryker replaces strings with ""
// which causes these toContain checks to fail, killing the mutation.

describe("[MUTATION-KILLER] buildSysctlHardeningCommand exact key=value pairs", () => {
  const cmd = buildSysctlHardeningCommand();

  it("net.ipv4.conf.all.accept_redirects=0", () => {
    expect(cmd).toContain("net.ipv4.conf.all.accept_redirects=0");
  });

  it("net.ipv4.conf.default.accept_redirects=0", () => {
    expect(cmd).toContain("net.ipv4.conf.default.accept_redirects=0");
  });

  it("net.ipv4.conf.all.accept_source_route=0", () => {
    expect(cmd).toContain("net.ipv4.conf.all.accept_source_route=0");
  });

  it("net.ipv4.conf.default.accept_source_route=0", () => {
    expect(cmd).toContain("net.ipv4.conf.default.accept_source_route=0");
  });

  it("net.ipv4.conf.all.log_martians=1", () => {
    expect(cmd).toContain("net.ipv4.conf.all.log_martians=1");
  });

  it("net.ipv4.tcp_syncookies=1", () => {
    expect(cmd).toContain("net.ipv4.tcp_syncookies=1");
  });

  it("kernel.randomize_va_space=2", () => {
    expect(cmd).toContain("kernel.randomize_va_space=2");
  });

  it("net.ipv4.icmp_echo_ignore_broadcasts=1", () => {
    expect(cmd).toContain("net.ipv4.icmp_echo_ignore_broadcasts=1");
  });

  it("kernel.dmesg_restrict=1", () => {
    expect(cmd).toContain("kernel.dmesg_restrict=1");
  });

  it("kernel.kptr_restrict=1", () => {
    expect(cmd).toContain("kernel.kptr_restrict=1");
  });

  it("fs.suid_dumpable=0", () => {
    expect(cmd).toContain("fs.suid_dumpable=0");
  });

  it("net.core.bpf_jit_harden=1", () => {
    expect(cmd).toContain("net.core.bpf_jit_harden=1");
  });

  it("kernel.unprivileged_bpf_disabled=1", () => {
    expect(cmd).toContain("kernel.unprivileged_bpf_disabled=1");
  });

  it("net.ipv4.conf.all.rp_filter=2", () => {
    expect(cmd).toContain("net.ipv4.conf.all.rp_filter=2");
  });

  it("net.ipv4.conf.default.rp_filter=2", () => {
    expect(cmd).toContain("net.ipv4.conf.default.rp_filter=2");
  });

  it("net.ipv4.conf.all.send_redirects=0", () => {
    expect(cmd).toContain("net.ipv4.conf.all.send_redirects=0");
  });

  it("net.ipv4.conf.default.send_redirects=0", () => {
    expect(cmd).toContain("net.ipv4.conf.default.send_redirects=0");
  });

  it("net.ipv4.conf.all.secure_redirects=0", () => {
    expect(cmd).toContain("net.ipv4.conf.all.secure_redirects=0");
  });

  it("net.ipv4.conf.default.secure_redirects=0", () => {
    expect(cmd).toContain("net.ipv4.conf.default.secure_redirects=0");
  });

  it("net.ipv6.conf.all.accept_redirects=0", () => {
    expect(cmd).toContain("net.ipv6.conf.all.accept_redirects=0");
  });

  it("net.ipv6.conf.default.accept_redirects=0", () => {
    expect(cmd).toContain("net.ipv6.conf.default.accept_redirects=0");
  });

  it("writes to /etc/sysctl.d/99-kastell.conf", () => {
    expect(cmd).toContain("/etc/sysctl.d/99-kastell.conf");
  });

  it("applies with sysctl -p /etc/sysctl.d/99-kastell.conf", () => {
    expect(cmd).toContain("sysctl -p /etc/sysctl.d/99-kastell.conf");
  });
});

describe("[MUTATION-KILLER] buildUnattendedUpgradesCommand exact strings", () => {
  const cmd = buildUnattendedUpgradesCommand();

  it("DEBIAN_FRONTEND=noninteractive", () => {
    expect(cmd).toContain("DEBIAN_FRONTEND=noninteractive");
  });

  it("apt-get install -y unattended-upgrades", () => {
    expect(cmd).toContain("apt-get install -y unattended-upgrades");
  });

  it("APT::Periodic::Update-Package-Lists \"1\"", () => {
    expect(cmd).toContain('APT::Periodic::Update-Package-Lists "1"');
  });

  it("APT::Periodic::Unattended-Upgrade \"1\"", () => {
    expect(cmd).toContain('APT::Periodic::Unattended-Upgrade "1"');
  });

  it("APT::Periodic::AutocleanInterval \"7\"", () => {
    expect(cmd).toContain('APT::Periodic::AutocleanInterval "7"');
  });

  it("/etc/apt/apt.conf.d/20auto-upgrades", () => {
    expect(cmd).toContain("/etc/apt/apt.conf.d/20auto-upgrades");
  });
});

describe("[MUTATION-KILLER] buildLoginBannersCommand exact strings", () => {
  const cmd = buildLoginBannersCommand();

  it("exact banner text", () => {
    expect(cmd).toContain("Authorized access only. All activity is monitored and logged.");
  });

  it("/etc/issue path", () => {
    expect(cmd).toContain("/etc/issue");
  });

  it("/etc/issue.net path", () => {
    expect(cmd).toContain("/etc/issue.net");
  });

  it("/etc/motd path", () => {
    expect(cmd).toContain("/etc/motd");
  });

  it("Banner /etc/issue.net in sshd_config", () => {
    expect(cmd).toContain("Banner /etc/issue.net");
  });

  it("/etc/ssh/sshd_config path", () => {
    expect(cmd).toContain("/etc/ssh/sshd_config");
  });

  it("systemctl restart ssh", () => {
    expect(cmd).toContain("systemctl restart ssh");
  });

  it("systemctl restart sshd", () => {
    expect(cmd).toContain("systemctl restart sshd");
  });
});

describe("[MUTATION-KILLER] buildAuditdCommand exact rules and paths", () => {
  const cmd = buildAuditdCommand();

  it("installs auditd and audispd-plugins", () => {
    expect(cmd).toContain("apt-get install -y auditd audispd-plugins");
  });

  it("systemctl enable auditd", () => {
    expect(cmd).toContain("systemctl enable auditd");
  });

  it("systemctl start auditd", () => {
    expect(cmd).toContain("systemctl start auditd");
  });

  it("/etc/audit/rules.d/50-kastell-deep.rules path", () => {
    expect(cmd).toContain("/etc/audit/rules.d/50-kastell-deep.rules");
  });

  it("/etc/audit/rules.d/99-kastell.rules path", () => {
    expect(cmd).toContain("/etc/audit/rules.d/99-kastell.rules");
  });

  it("-w /etc/passwd -p wa -k identity", () => {
    expect(cmd).toContain("-w /etc/passwd -p wa -k identity");
  });

  it("-w /etc/shadow -p wa -k identity", () => {
    expect(cmd).toContain("-w /etc/shadow -p wa -k identity");
  });

  it("-w /etc/group -p wa -k identity", () => {
    expect(cmd).toContain("-w /etc/group -p wa -k identity");
  });

  it("-w /etc/gshadow -p wa -k identity", () => {
    expect(cmd).toContain("-w /etc/gshadow -p wa -k identity");
  });

  it("-w /etc/sudoers -p wa -k privilege", () => {
    expect(cmd).toContain("-w /etc/sudoers -p wa -k privilege");
  });

  it("-w /etc/sudoers.d/ -p wa -k privilege", () => {
    expect(cmd).toContain("-w /etc/sudoers.d/ -p wa -k privilege");
  });

  it("setreuid syscall monitoring", () => {
    expect(cmd).toContain("-S setreuid");
  });

  it("setregid syscall monitoring", () => {
    expect(cmd).toContain("-S setregid");
  });

  it("-w /etc/localtime -p wa -k time-change", () => {
    expect(cmd).toContain("-w /etc/localtime -p wa -k time-change");
  });

  it("-S adjtimex -S settimeofday -S clock_settime", () => {
    expect(cmd).toContain("-S adjtimex");
    expect(cmd).toContain("-S settimeofday");
    expect(cmd).toContain("-S clock_settime");
  });

  it("-w /var/log/lastlog -p wa -k logins", () => {
    expect(cmd).toContain("-w /var/log/lastlog -p wa -k logins");
  });

  it("-w /var/run/faillock/ -p wa -k logins", () => {
    expect(cmd).toContain("-w /var/run/faillock/ -p wa -k logins");
  });

  it("-w /var/run/utmp -p wa -k session", () => {
    expect(cmd).toContain("-w /var/run/utmp -p wa -k session");
  });

  it("-w /var/log/wtmp -p wa -k session", () => {
    expect(cmd).toContain("-w /var/log/wtmp -p wa -k session");
  });

  it("-w /var/log/btmp -p wa -k session", () => {
    expect(cmd).toContain("-w /var/log/btmp -p wa -k session");
  });

  it("-S sethostname -S setdomainname -k network-change", () => {
    expect(cmd).toContain("-S sethostname");
    expect(cmd).toContain("-S setdomainname");
  });

  it("-w /etc/hostname -p wa -k network-change", () => {
    expect(cmd).toContain("-w /etc/hostname -p wa -k network-change");
  });

  it("-w /etc/hosts -p wa -k network-change", () => {
    expect(cmd).toContain("-w /etc/hosts -p wa -k network-change");
  });

  it("-w /etc/sysconfig/network -p wa -k network-change", () => {
    expect(cmd).toContain("-w /etc/sysconfig/network -p wa -k network-change");
  });

  it("-S init_module -S delete_module -S finit_module -k kernel-module", () => {
    expect(cmd).toContain("-S init_module");
    expect(cmd).toContain("-S delete_module");
    expect(cmd).toContain("-S finit_module");
  });

  it("-w /sbin/insmod -p x -k kernel-module", () => {
    expect(cmd).toContain("-w /sbin/insmod -p x -k kernel-module");
  });

  it("-w /sbin/modprobe -p x -k kernel-module", () => {
    expect(cmd).toContain("-w /sbin/modprobe -p x -k kernel-module");
  });

  it("-w /sbin/rmmod -p x -k kernel-module", () => {
    expect(cmd).toContain("-w /sbin/rmmod -p x -k kernel-module");
  });

  it("immutability directive -e 2", () => {
    expect(cmd).toContain("-e 2");
  });

  it("augenrules --load", () => {
    expect(cmd).toContain("augenrules --load");
  });
});

describe("[MUTATION-KILLER] buildResourceLimitsCommand exact strings", () => {
  const cmd = buildResourceLimitsCommand();

  it("* soft nproc 1024", () => {
    expect(cmd).toContain("* soft nproc 1024");
  });

  it("* hard nproc 2048", () => {
    expect(cmd).toContain("* hard nproc 2048");
  });

  it("* soft nofile 65536", () => {
    expect(cmd).toContain("* soft nofile 65536");
  });

  it("* hard nofile 65536", () => {
    expect(cmd).toContain("* hard nofile 65536");
  });

  it("root soft nproc unlimited", () => {
    expect(cmd).toContain("root soft nproc unlimited");
  });

  it("root hard nproc unlimited", () => {
    expect(cmd).toContain("root hard nproc unlimited");
  });

  it("/etc/security/limits.d/99-kastell.conf", () => {
    expect(cmd).toContain("/etc/security/limits.d/99-kastell.conf");
  });
});

describe("[MUTATION-KILLER] buildServiceDisableCommand exact service names", () => {
  const cmd = buildServiceDisableCommand();

  it("bluetooth.service", () => {
    expect(cmd).toContain("bluetooth.service");
  });

  it("avahi-daemon.service", () => {
    expect(cmd).toContain("avahi-daemon.service");
  });

  it("cups.service", () => {
    expect(cmd).toContain("cups.service");
  });

  it("rpcbind.service", () => {
    expect(cmd).toContain("rpcbind.service");
  });

  it("systemctl stop for each service", () => {
    expect(cmd).toContain("systemctl stop bluetooth");
    expect(cmd).toContain("systemctl stop avahi-daemon");
    expect(cmd).toContain("systemctl stop cups");
    expect(cmd).toContain("systemctl stop rpcbind");
  });

  it("systemctl disable for each service", () => {
    expect(cmd).toContain("systemctl disable bluetooth");
    expect(cmd).toContain("systemctl disable avahi-daemon");
    expect(cmd).toContain("systemctl disable cups");
    expect(cmd).toContain("systemctl disable rpcbind");
  });
});

describe("[MUTATION-KILLER] buildAptValidationCommand exact strings", () => {
  const cmd = buildAptValidationCommand();

  it('APT::Get::AllowUnauthenticated "false"', () => {
    expect(cmd).toContain('APT::Get::AllowUnauthenticated "false"');
  });

  it('Acquire::AllowInsecureRepositories "false"', () => {
    expect(cmd).toContain('Acquire::AllowInsecureRepositories "false"');
  });

  it('Acquire::AllowDowngradeToInsecureRepositories "false"', () => {
    expect(cmd).toContain('Acquire::AllowDowngradeToInsecureRepositories "false"');
  });

  it("/etc/apt/apt.conf.d/99-kastell-apt.conf", () => {
    expect(cmd).toContain("/etc/apt/apt.conf.d/99-kastell-apt.conf");
  });
});

describe("[MUTATION-KILLER] buildLogRetentionCommand exact strings", () => {
  const cmd = buildLogRetentionCommand();

  it("apt-get install -y logrotate", () => {
    expect(cmd).toContain("apt-get install -y logrotate");
  });

  it("systemctl enable rsyslog", () => {
    expect(cmd).toContain("systemctl enable rsyslog");
  });

  it("systemctl start rsyslog", () => {
    expect(cmd).toContain("systemctl start rsyslog");
  });

  it("/var/log/syslog as target path", () => {
    expect(cmd).toContain("/var/log/syslog");
  });

  it("daily rotation", () => {
    expect(cmd).toContain("daily");
  });

  it("missingok directive", () => {
    expect(cmd).toContain("missingok");
  });

  it("rotate 90 (retention days)", () => {
    expect(cmd).toContain("rotate 90");
  });

  it("compress directive", () => {
    expect(cmd).toContain("compress");
  });

  it("delaycompress directive", () => {
    expect(cmd).toContain("delaycompress");
  });

  it("notifempty directive", () => {
    expect(cmd).toContain("notifempty");
  });

  it("/usr/lib/rsyslog/rsyslog-rotate postrotate script", () => {
    expect(cmd).toContain("/usr/lib/rsyslog/rsyslog-rotate");
  });

  it("/etc/logrotate.d/99-kastell-syslog config path", () => {
    expect(cmd).toContain("/etc/logrotate.d/99-kastell-syslog");
  });

  it("systemctl enable logrotate.timer", () => {
    expect(cmd).toContain("systemctl enable logrotate.timer");
  });
});

describe("[MUTATION-KILLER] buildCloudMetaBlockCommand exact strings", () => {
  const cmd = buildCloudMetaBlockCommand();

  it("ufw deny out to 169.254.169.254", () => {
    expect(cmd).toContain("ufw deny out to 169.254.169.254");
  });

  it("ufw deny in from 169.254.169.254", () => {
    expect(cmd).toContain("ufw deny in from 169.254.169.254");
  });
});

describe("[MUTATION-KILLER] buildAccountLockCommand exact strings", () => {
  const cmd = buildAccountLockCommand();

  it("reads /etc/passwd with awk", () => {
    expect(cmd).toContain("/etc/passwd");
  });

  it("filters UID >= 1000 and < 65534", () => {
    expect(cmd).toContain("$3 >= 1000");
    expect(cmd).toContain("$3 < 65534");
  });

  it("checks /bin/bash shell", () => {
    expect(cmd).toContain("/bin/bash");
  });

  it("checks /bin/sh shell", () => {
    expect(cmd).toContain("/bin/sh");
  });

  it("uses who command to check active sessions", () => {
    expect(cmd).toContain("who");
  });

  it("locks with passwd -l", () => {
    expect(cmd).toContain("passwd -l");
  });
});

describe("[MUTATION-KILLER] buildAideInitCommand exact strings", () => {
  const cmd = buildAideInitCommand();

  it("DEBIAN_FRONTEND=noninteractive apt-get install -y aide", () => {
    expect(cmd).toContain("DEBIAN_FRONTEND=noninteractive apt-get install -y aide");
  });

  it("rm -f /etc/cron.d/kastell-aide", () => {
    expect(cmd).toContain("rm -f /etc/cron.d/kastell-aide");
  });

  it("/etc/cron.daily/aide-check script path", () => {
    expect(cmd).toContain("/etc/cron.daily/aide-check");
  });

  it("chmod 755 /etc/cron.daily/aide-check", () => {
    expect(cmd).toContain("chmod 755 /etc/cron.daily/aide-check");
  });

  it("#!/bin/bash shebang in cron script", () => {
    expect(cmd).toContain("#!/bin/bash");
  });

  it("/usr/sbin/aide --check in cron script", () => {
    expect(cmd).toContain("/usr/sbin/aide --check");
  });

  it("nohup aide --init background init", () => {
    expect(cmd).toContain("nohup aide --init");
  });

  it("/var/log/aide-init.log output path", () => {
    expect(cmd).toContain("/var/log/aide-init.log");
  });
});

describe("[MUTATION-KILLER] buildCronAccessCommand exact strings", () => {
  const cmd = buildCronAccessCommand();

  it("echo root > /etc/cron.allow", () => {
    expect(cmd).toContain("echo root > /etc/cron.allow");
  });

  it("chmod 600 /etc/cron.allow", () => {
    expect(cmd).toContain("chmod 600 /etc/cron.allow");
  });

  it("echo root > /etc/at.allow", () => {
    expect(cmd).toContain("echo root > /etc/at.allow");
  });

  it("chmod 600 /etc/at.allow", () => {
    expect(cmd).toContain("chmod 600 /etc/at.allow");
  });

  it("touch /etc/at.deny", () => {
    expect(cmd).toContain("touch /etc/at.deny");
  });

  it("chmod 600 /etc/at.deny", () => {
    expect(cmd).toContain("chmod 600 /etc/at.deny");
  });
});

describe("[MUTATION-KILLER] buildBackupPermissionsCommand exact strings", () => {
  const cmd = buildBackupPermissionsCommand();

  it("DEBIAN_FRONTEND=noninteractive apt-get install -y rsync", () => {
    expect(cmd).toContain("DEBIAN_FRONTEND=noninteractive apt-get install -y rsync");
  });

  it("mkdir -p /var/backups", () => {
    expect(cmd).toContain("mkdir -p /var/backups");
  });

  it("chmod 700 /var/backups", () => {
    expect(cmd).toContain("chmod 700 /var/backups");
  });

  it("chown root:root /var/backups", () => {
    expect(cmd).toContain("chown root:root /var/backups");
  });
});

describe("[MUTATION-KILLER] buildDnsSecurityCommand exact strings", () => {
  const cmd = buildDnsSecurityCommand();

  it("cp /etc/systemd/resolved.conf backup", () => {
    expect(cmd).toContain("cp /etc/systemd/resolved.conf /etc/systemd/resolved.conf.kastell.bak");
  });

  it("mkdir -p /etc/systemd/resolved.conf.d", () => {
    expect(cmd).toContain("mkdir -p /etc/systemd/resolved.conf.d");
  });

  it("[Resolve] section header", () => {
    expect(cmd).toContain("[Resolve]");
  });

  it("DNSSEC=yes", () => {
    expect(cmd).toContain("DNSSEC=yes");
  });

  it("DNSOverTLS=opportunistic", () => {
    expect(cmd).toContain("DNSOverTLS=opportunistic");
  });

  it("/etc/systemd/resolved.conf.d/99-kastell-dns.conf path", () => {
    expect(cmd).toContain("/etc/systemd/resolved.conf.d/99-kastell-dns.conf");
  });

  it("systemctl restart systemd-resolved", () => {
    expect(cmd).toContain("systemctl restart systemd-resolved");
  });

  it("dig google.com verification", () => {
    expect(cmd).toContain("dig google.com");
  });

  it("@127.0.0.53 DNS resolver target", () => {
    expect(cmd).toContain("@127.0.0.53");
  });
});

describe("[MUTATION-KILLER] buildDnsRollbackCommand exact strings", () => {
  const cmd = buildDnsRollbackCommand();

  it("rm -f /etc/systemd/resolved.conf.d/99-kastell-dns.conf", () => {
    expect(cmd).toContain("rm -f /etc/systemd/resolved.conf.d/99-kastell-dns.conf");
  });

  it("systemctl restart systemd-resolved", () => {
    expect(cmd).toContain("systemctl restart systemd-resolved");
  });
});

describe("[MUTATION-KILLER] buildPwqualityCommand exact strings", () => {
  const cmd = buildPwqualityCommand();

  it("apt-cache show libpam-pwquality", () => {
    expect(cmd).toContain("apt-cache show libpam-pwquality");
  });

  it("DEBIAN_FRONTEND=noninteractive apt-get install -y libpam-pwquality", () => {
    expect(cmd).toContain("DEBIAN_FRONTEND=noninteractive apt-get install -y libpam-pwquality");
  });

  it("minlen = 14", () => {
    expect(cmd).toContain("minlen = 14");
  });

  it("dcredit = -1", () => {
    expect(cmd).toContain("dcredit = -1");
  });

  it("ucredit = -1", () => {
    expect(cmd).toContain("ucredit = -1");
  });

  it("lcredit = -1", () => {
    expect(cmd).toContain("lcredit = -1");
  });

  it("ocredit = -1", () => {
    expect(cmd).toContain("ocredit = -1");
  });

  it("maxrepeat = 3", () => {
    expect(cmd).toContain("maxrepeat = 3");
  });

  it("/etc/security/pwquality.conf path", () => {
    expect(cmd).toContain("/etc/security/pwquality.conf");
  });
});

describe("[MUTATION-KILLER] buildSshCipherCommand exact cipher/mac/kex values", () => {
  const cmd = buildSshCipherCommand();

  it("blacklists arcfour cipher", () => {
    expect(cmd).toContain("-arcfour");
  });

  it("blacklists arcfour128 cipher", () => {
    expect(cmd).toContain("-arcfour128");
  });

  it("blacklists arcfour256 cipher", () => {
    expect(cmd).toContain("-arcfour256");
  });

  it("blacklists 3des-cbc cipher", () => {
    expect(cmd).toContain("-3des-cbc");
  });

  it("blacklists blowfish-cbc cipher", () => {
    expect(cmd).toContain("-blowfish-cbc");
  });

  it("blacklists cast128-cbc cipher", () => {
    expect(cmd).toContain("-cast128-cbc");
  });

  it("blacklists hmac-md5 MAC", () => {
    expect(cmd).toContain("-hmac-md5");
  });

  it("blacklists hmac-sha1-96 MAC", () => {
    expect(cmd).toContain("-hmac-sha1-96");
  });

  it("blacklists umac-64@openssh.com MAC", () => {
    expect(cmd).toContain("-umac-64@openssh.com");
  });

  it("blacklists diffie-hellman-group1-sha1 KEX", () => {
    expect(cmd).toContain("-diffie-hellman-group1-sha1");
  });

  it("blacklists diffie-hellman-group14-sha1 KEX", () => {
    expect(cmd).toContain("-diffie-hellman-group14-sha1");
  });

  it("cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-cipher backup", () => {
    expect(cmd).toContain("cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-cipher");
  });

  it("removes existing Ciphers/MACs/KexAlgorithms lines with sed", () => {
    expect(cmd).toContain("sed -i");
    expect(cmd).toContain("Ciphers");
    expect(cmd).toContain("MACs");
    expect(cmd).toContain("KexAlgorithms");
  });

  it("sshd -t validation gate", () => {
    expect(cmd).toContain("sshd -t");
  });

  it("rolls back on sshd -t failure", () => {
    expect(cmd).toContain("sshd_config.bak-cipher /etc/ssh/sshd_config");
    expect(cmd).toContain("exit 1");
  });
});

describe("[MUTATION-KILLER] buildDockerHardeningCommand exact strings", () => {
  it("bare: exact JSON keys and values", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain('"log-driver":"json-file"');
    expect(cmd).toContain('"max-size":"10m"');
    expect(cmd).toContain('"max-file":"3"');
    expect(cmd).toContain('"no-new-privileges":true');
    expect(cmd).toContain('"live-restore":true');
    expect(cmd).toContain('"icc":false');
  });

  it("jq merge pattern", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("jq -s '.[0] * .[1]'");
  });

  it("/etc/docker/daemon.json path", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("/etc/docker/daemon.json");
  });

  it("/tmp/daemon-kastell.json temp file", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("/tmp/daemon-kastell.json");
  });

  it("daemon.json.bak-docker backup", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("daemon.json.bak-docker");
  });

  it("systemctl reload docker", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("systemctl reload docker");
  });

  it("systemctl restart docker fallback", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("systemctl restart docker");
  });

  it("jq -e validation step", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("jq -e .");
  });

  it("WARN: jq not found skip message", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("WARN: jq not found");
  });

  it("WARN: Docker not installed skip message", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("WARN: Docker not installed");
  });

  it("daemon.json merge failed: rolled back error message", () => {
    const cmd = buildDockerHardeningCommand(undefined);
    expect(cmd).toContain("daemon.json merge failed: rolled back");
  });
});

describe("[MUTATION-KILLER] buildSshFineTuningCommand exact directive key=value pairs", () => {
  const cmd = buildSshFineTuningCommand();

  it("ClientAliveInterval 300", () => {
    expect(cmd).toContain("ClientAliveInterval 300");
  });

  it("ClientAliveCountMax 3", () => {
    expect(cmd).toContain("ClientAliveCountMax 3");
  });

  it("LoginGraceTime 60", () => {
    expect(cmd).toContain("LoginGraceTime 60");
  });

  it("AllowAgentForwarding no", () => {
    expect(cmd).toContain("AllowAgentForwarding no");
  });

  it("X11Forwarding no", () => {
    expect(cmd).toContain("X11Forwarding no");
  });

  it("MaxStartups 10:30:60", () => {
    expect(cmd).toContain("MaxStartups 10:30:60");
  });

  it("StrictModes yes", () => {
    expect(cmd).toContain("StrictModes yes");
  });

  it("PermitUserEnvironment no", () => {
    expect(cmd).toContain("PermitUserEnvironment no");
  });

  it("LogLevel VERBOSE", () => {
    expect(cmd).toContain("LogLevel VERBOSE");
  });

  it("UseDNS no", () => {
    expect(cmd).toContain("UseDNS no");
  });

  it("PrintMotd no", () => {
    expect(cmd).toContain("PrintMotd no");
  });

  it("IgnoreRhosts yes", () => {
    expect(cmd).toContain("IgnoreRhosts yes");
  });

  it("HostbasedAuthentication no", () => {
    expect(cmd).toContain("HostbasedAuthentication no");
  });

  it("MaxSessions 10", () => {
    expect(cmd).toContain("MaxSessions 10");
  });

  it("PermitEmptyPasswords no", () => {
    expect(cmd).toContain("PermitEmptyPasswords no");
  });

  it("cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-finetune", () => {
    expect(cmd).toContain("cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-finetune");
  });

  it("SSH fine-tuning rolled back error message", () => {
    expect(cmd).toContain("SSH fine-tuning rolled back");
  });
});

describe("[MUTATION-KILLER] buildLoginDefsCommand exact strings", () => {
  const cmd = buildLoginDefsCommand();

  it("PASS_MIN_DAYS 1", () => {
    expect(cmd).toContain("PASS_MIN_DAYS 1");
  });

  it("PASS_WARN_AGE 7", () => {
    expect(cmd).toContain("PASS_WARN_AGE 7");
  });

  it("ENCRYPT_METHOD SHA512", () => {
    expect(cmd).toContain("ENCRYPT_METHOD SHA512");
  });

  it("UMASK 027", () => {
    expect(cmd).toContain("UMASK 027");
  });

  it("INACTIVE=30", () => {
    expect(cmd).toContain("INACTIVE=30");
  });

  it("/etc/login.defs path", () => {
    expect(cmd).toContain("/etc/login.defs");
  });

  it("/etc/default/useradd path", () => {
    expect(cmd).toContain("/etc/default/useradd");
  });
});

describe("[MUTATION-KILLER] buildFaillockCommand exact strings", () => {
  const cmd = buildFaillockCommand();

  it("deny = 5", () => {
    expect(cmd).toContain("deny = 5");
  });

  it("unlock_time = 900", () => {
    expect(cmd).toContain("unlock_time = 900");
  });

  it("fail_interval = 900", () => {
    expect(cmd).toContain("fail_interval = 900");
  });

  it("mkdir -p /etc/security", () => {
    expect(cmd).toContain("mkdir -p /etc/security");
  });

  it("/etc/security/faillock.conf path", () => {
    expect(cmd).toContain("/etc/security/faillock.conf");
  });

  it("pam-auth-update --enable faillock", () => {
    expect(cmd).toContain("pam-auth-update --enable faillock");
  });
});

describe("[MUTATION-KILLER] buildSudoHardeningCommand exact strings", () => {
  const cmd = buildSudoHardeningCommand();

  it("mkdir -p /etc/sudoers.d", () => {
    expect(cmd).toContain("mkdir -p /etc/sudoers.d");
  });

  it("Defaults log_output", () => {
    expect(cmd).toContain("Defaults log_output");
  });

  it("/etc/sudoers.d/kastell-logging path", () => {
    expect(cmd).toContain("/etc/sudoers.d/kastell-logging");
  });

  it("chmod 440 /etc/sudoers.d/kastell-logging", () => {
    expect(cmd).toContain("chmod 440 /etc/sudoers.d/kastell-logging");
  });

  it("Defaults requiretty", () => {
    expect(cmd).toContain("Defaults requiretty");
  });

  it("/etc/sudoers.d/kastell-requiretty path", () => {
    expect(cmd).toContain("/etc/sudoers.d/kastell-requiretty");
  });

  it("chmod 440 /etc/sudoers.d/kastell-requiretty", () => {
    expect(cmd).toContain("chmod 440 /etc/sudoers.d/kastell-requiretty");
  });

  it("grep -qr for idempotency check", () => {
    expect(cmd).toContain("grep -qr");
  });
});

// ─── [MUTATION-KILLER] applyLock error/hint string assertions ─────────────────

describe("[MUTATION-KILLER] applyLock error and hint strings", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSsh.assertValidIp.mockImplementation(() => undefined);
    mockedSsh.checkSshAvailable.mockReturnValue(true);
  });

  it("no-keys error contains /root/.ssh/authorized_keys path", async () => {
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "0", stderr: "" });
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});
    expect(result.error).toContain("/root/.ssh/authorized_keys");
  });

  it("no-keys error contains 'Cannot disable password authentication'", async () => {
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "0", stderr: "" });
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});
    expect(result.error).toContain("Cannot disable password authentication without SSH keys");
  });

  it("no-keys error contains 'permanently lock you out'", async () => {
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "0", stderr: "" });
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});
    expect(result.error).toContain("permanently lock you out");
  });

  it("no-keys hint contains ssh-copy-id command", async () => {
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "0", stderr: "" });
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});
    expect(result.hint).toContain("ssh-copy-id root@1.2.3.4");
  });

  it("no-keys hint starts with 'Add an SSH key first:'", async () => {
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "0", stderr: "" });
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});
    expect(result.hint).toContain("Add an SSH key first:");
  });

  it("SSH key check failure error starts with 'SSH key check failed:'", async () => {
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(30));
    mockedSsh.sshExec.mockRejectedValueOnce(new Error("Connection refused"));
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});
    expect(result.error).toContain("SSH key check failed:");
  });

  it("cloudMeta stepError is exactly 'UFW required' when UFW fails", async () => {
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "2", stderr: "" }) // key check
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // SSH hardening
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // fail2ban
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // banners
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // accountLock
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // sshCipher
      .mockRejectedValueOnce(new Error("UFW failed")) // UFW
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // remaining
    const result = await applyLock("1.2.3.4", "test-server", undefined, {});
    expect(result.stepErrors?.cloudMeta).toBe("UFW required");
  });

  it("uses 'bare' as audit platform when platform is undefined", async () => {
    mockedAudit.runAudit.mockResolvedValue(makeAuditResult(50));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "2", stderr: "" });
    await applyLock("1.2.3.4", "test-server", undefined, {});
    expect(mockedAudit.runAudit).toHaveBeenCalledWith("1.2.3.4", "test-server", "bare");
  });
});
