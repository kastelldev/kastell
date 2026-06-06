import { buildAuditBatchCommands, BATCH_TIMEOUTS } from "../../src/core/audit/commands.js";
import type { BatchDef, BatchTier } from "../../src/core/audit/commands.js";

describe("buildAuditBatchCommands", () => {
  it("should return exactly 3 BatchDef objects", () => {
    const batches = buildAuditBatchCommands({ platform: "bare" });
    expect(batches).toHaveLength(3);
  });

  it("should give each BatchDef a valid tier property", () => {
    const batches = buildAuditBatchCommands({ platform: "bare" });
    const tiers = batches.map((b: BatchDef) => b.tier);
    expect(tiers).toEqual(["fast", "medium", "slow"]);
  });

  it("should contain named separators for SSH, FIREWALL, UPDATES, AUTH in batch 1 (fast)", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("---SECTION:SSH---");
    expect(fast.command).toContain("---SECTION:FIREWALL---");
    expect(fast.command).toContain("---SECTION:UPDATES---");
    expect(fast.command).toContain("---SECTION:AUTH---");
  });

  it("should contain named separators for DOCKER, NETWORK, LOGGING, KERNEL in batch 2 (medium)", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("---SECTION:DOCKER---");
    expect(medium.command).toContain("---SECTION:NETWORK---");
    expect(medium.command).toContain("---SECTION:LOGGING---");
    expect(medium.command).toContain("---SECTION:KERNEL---");
  });

  it("should contain named separator for FILESYSTEM in batch 3 (slow)", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("---SECTION:FILESYSTEM---");
  });

  it("BATCH_TIMEOUTS should have fast=30000, medium=60000, slow=120000", () => {
    expect(BATCH_TIMEOUTS.fast).toBe(30_000);
    expect(BATCH_TIMEOUTS.medium).toBe(60_000);
    expect(BATCH_TIMEOUTS.slow).toBe(120_000);
  });

  it("should not contain old ---SEPARATOR--- format in any batch", () => {
    const batches = buildAuditBatchCommands({ platform: "bare" });
    batches.forEach((b: BatchDef) => {
      expect(b.command).not.toContain("---SEPARATOR---");
    });
  });

  it("should not export SECTION_INDICES", async () => {
    const mod = await import("../../src/core/audit/commands.js");
    expect((mod as Record<string, unknown>)["SECTION_INDICES"]).toBeUndefined();
  });

  it("should include platform-specific sections for coolify in medium batch", () => {
    const [, mediumBare] = buildAuditBatchCommands({ platform: "bare" });
    const [, mediumCoolify] = buildAuditBatchCommands({ platform: "coolify" });
    expect(mediumCoolify.command.length).toBeGreaterThan(mediumBare.command.length);
  });

  it("should include platform-specific sections for dokploy in medium batch", () => {
    const [, mediumBare] = buildAuditBatchCommands({ platform: "bare" });
    const [, mediumDokploy] = buildAuditBatchCommands({ platform: "dokploy" });
    expect(mediumDokploy.command.length).toBeGreaterThan(mediumBare.command.length);
  });

  it("should use defensive patterns in commands", () => {
    const batches = buildAuditBatchCommands({ platform: "bare" });
    const allCommands = batches.map((b: BatchDef) => b.command).join("\n");
    expect(allCommands).toContain("2>/dev/null");
    expect(allCommands).toMatch(/\|\| echo ['"]N\/A['"]/);
  });
});

// ─── Tier field — exact value assertions ─────────────────────────────────────

describe("BatchDef tier — exact values", () => {
  it("first batch tier is exactly 'fast'", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.tier).toBe("fast");
  });

  it("second batch tier is exactly 'medium'", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.tier).toBe("medium");
  });

  it("third batch tier is exactly 'slow'", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.tier).toBe("slow");
  });

  it("tier values are not 'fast '/'medium '/'slow ' (no trailing space)", () => {
    const batches = buildAuditBatchCommands({ platform: "bare" });
    batches.forEach((b) => {
      expect(b.tier).not.toMatch(/\s/);
    });
  });
});

// ─── Section separators — exact NAMED_SEP format ─────────────────────────────

describe("Named section separators — exact format", () => {
  it("SSH section separator is exactly echo '---SECTION:SSH---'", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("echo '---SECTION:SSH---'");
  });

  it("FIREWALL section separator is exactly echo '---SECTION:FIREWALL---'", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("echo '---SECTION:FIREWALL---'");
  });

  it("DOCKER section separator is exactly echo '---SECTION:DOCKER---'", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("echo '---SECTION:DOCKER---'");
  });

  it("FILESYSTEM section separator is exactly echo '---SECTION:FILESYSTEM---'", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("echo '---SECTION:FILESYSTEM---'");
  });

  it("CRYPTO section is in slow batch", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("echo '---SECTION:CRYPTO---'");
  });

  it("MALWARE section is in slow batch", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("echo '---SECTION:MALWARE---'");
  });

  it("SECRETS section is in slow batch", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("echo '---SECTION:SECRETS---'");
  });

  it("SUPPLYCHAIN section is in slow batch", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("echo '---SECTION:SUPPLYCHAIN---'");
  });

  it("FILEINTEGRITY section is in slow batch", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("echo '---SECTION:FILEINTEGRITY---'");
  });

  it("ACCOUNTS section is in fast batch", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("echo '---SECTION:ACCOUNTS---'");
  });

  it("BOOT section is in fast batch", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("echo '---SECTION:BOOT---'");
  });

  it("SCHEDULING section is in fast batch", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("echo '---SECTION:SCHEDULING---'");
  });

  it("BANNERS section is in fast batch", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("echo '---SECTION:BANNERS---'");
  });

  it("TIME section is in medium batch", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("echo '---SECTION:TIME---'");
  });

  it("MAC section is in medium batch", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("echo '---SECTION:MAC---'");
  });

  it("MEMORY section is in medium batch", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("echo '---SECTION:MEMORY---'");
  });

  it("CLOUDMETA section is in medium batch", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("echo '---SECTION:CLOUDMETA---'");
  });

  it("SERVICES section is in medium batch", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("echo '---SECTION:SERVICES---'");
  });
});

// ─── Platform variation — coolify vs dokploy vs bare ─────────────────────────

describe("Platform variation — command content differences", () => {
  it("coolify medium batch includes /data/coolify path", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "coolify" });
    expect(medium.command).toContain("/data/coolify");
  });

  it("dokploy medium batch includes /etc/dokploy path", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "dokploy" });
    expect(medium.command).toContain("/etc/dokploy");
  });

  it("bare platform does NOT include coolify-specific path", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).not.toContain("/data/coolify");
  });

  it("bare platform does NOT include dokploy-specific path", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).not.toContain("/etc/dokploy");
  });

  it("coolify medium batch includes docker inspect coolify command", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "coolify" });
    expect(medium.command).toContain("docker inspect coolify");
  });

  it("dokploy medium batch includes docker inspect dokploy command", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "dokploy" });
    expect(medium.command).toContain("docker inspect dokploy");
  });

  it("fast batch is identical for all platforms", () => {
    const [fastBare] = buildAuditBatchCommands({ platform: "bare" });
    const [fastCoolify] = buildAuditBatchCommands({ platform: "coolify" });
    const [fastDokploy] = buildAuditBatchCommands({ platform: "dokploy" });
    expect(fastBare.command).toBe(fastCoolify.command);
    expect(fastBare.command).toBe(fastDokploy.command);
  });

  it("slow batch is identical for all platforms", () => {
    const [, , slowBare] = buildAuditBatchCommands({ platform: "bare" });
    const [, , slowCoolify] = buildAuditBatchCommands({ platform: "coolify" });
    const [, , slowDokploy] = buildAuditBatchCommands({ platform: "dokploy" });
    expect(slowBare.command).toBe(slowCoolify.command);
    expect(slowBare.command).toBe(slowDokploy.command);
  });
});

// ─── Command content — specific strings that kill mutations ──────────────────

describe("Command content — mutation-killing exact string assertions", () => {
  it("SSH section reads /etc/ssh/sshd_config", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("/etc/ssh/sshd_config");
  });

  it("FIREWALL section checks ufw status verbose", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("ufw status verbose");
  });

  it("UPDATES section checks for security updates via apt", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("apt list --upgradable");
  });

  it("UPDATES section checks for REBOOT_REQUIRED sentinel", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("REBOOT_REQUIRED");
  });

  it("AUTH section reads /etc/pam.d/common-auth", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("/etc/pam.d/common-auth");
  });

  it("KERNEL section checks randomize_va_space", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("randomize_va_space");
  });

  it("FILEINTEGRITY section checks for AIDE installation", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("aide");
  });

  it("MALWARE section checks for rkhunter", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("rkhunter");
  });

  it("SECRETS section checks for world-readable .env files", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain(".env");
  });

  it("DOCKER section checks daemon.json content", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("/etc/docker/daemon.json");
  });

  it("DOCKER section uses ---DAEMON_JSON--- sentinel", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("---DAEMON_JSON---");
  });

  it("DOCKER section uses ---END_DAEMON_JSON--- closing sentinel", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("---END_DAEMON_JSON---");
  });

  it("LOGGING section checks rsyslog is-active", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("rsyslog");
  });

  it("BOOT section checks grub.cfg permissions", () => {
    const [fast] = buildAuditBatchCommands({ platform: "bare" });
    expect(fast.command).toContain("grub.cfg");
  });

  it("CRYPTO section checks openssl version", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("openssl version");
  });

  it("SUPPLYCHAIN section checks apt-key list", () => {
    const [, , slow] = buildAuditBatchCommands({ platform: "bare" });
    expect(slow.command).toContain("apt-key list");
  });

  it("BACKUP section uses KASTELL_BACKUP_FOUND sentinel", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("KASTELL_BACKUP_FOUND");
  });

  it("BACKUP section uses KASTELL_BACKUP_MISSING sentinel", () => {
    const [, medium] = buildAuditBatchCommands({ platform: "bare" });
    expect(medium.command).toContain("KASTELL_BACKUP_MISSING");
  });
});

// ─── Idempotency — same platform same result ──────────────────────────────────

describe("Idempotency", () => {
  it("calling buildAuditBatchCommands twice with same platform returns identical results", () => {
    const first = buildAuditBatchCommands({ platform: "bare" });
    const second = buildAuditBatchCommands({ platform: "bare" });
    expect(first[0].command).toBe(second[0].command);
    expect(first[1].command).toBe(second[1].command);
    expect(first[2].command).toBe(second[2].command);
  });

  it("result has exactly 2 keys per BatchDef: tier and command", () => {
    const batches = buildAuditBatchCommands({ platform: "bare" });
    for (const b of batches) {
      const keys = Object.keys(b).sort();
      expect(keys).toEqual(["command", "tier"].sort());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION-KILLER: Exhaustive string assertions for every section function
// Each test targets a specific StringLiteral that Stryker would replace with ""
// ═══════════════════════════════════════════════════════════════════════════════

describe("[MUTATION-KILLER] sshSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] reads sshd_config with cat", () => {
    expect(fast.command).toContain("cat /etc/ssh/sshd_config 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] checks SSH listening with ss -tlnp and grep ssh", () => {
    expect(fast.command).toContain("ss -tlnp 2>/dev/null | grep ssh");
  });

  it("[MUTATION-KILLER] checks netstat fallback for SSH", () => {
    expect(fast.command).toContain("netstat -tlnp 2>/dev/null | grep ssh");
  });

  it("[MUTATION-KILLER] checks passwordauthentication in sshd -T", () => {
    expect(fast.command).toContain("passwordauthentication|permitrootlogin|permitemptypasswords|pubkeyauthentication|protocol|maxauthtries|x11forwarding");
  });

  it("[MUTATION-KILLER] checks clientaliveinterval in sshd -T", () => {
    expect(fast.command).toContain("clientaliveinterval|clientalivecountmax|logingracetime|maxsessions|allowusers|allowgroups|denyusers|denygroups");
  });

  it("[MUTATION-KILLER] checks hostbasedauthentication in sshd -T", () => {
    expect(fast.command).toContain("hostbasedauthentication|ignorerhosts|usedns|permituserenvironment|loglevel|banner");
  });

  it("[MUTATION-KILLER] checks ciphers|macs|kexalgorithms in sshd -T", () => {
    expect(fast.command).toContain("'^ciphers|^macs|^kexalgorithms'");
  });

  it("[MUTATION-KILLER] checks maxstartups|strictmodes|allowagentforwarding|printmotd", () => {
    expect(fast.command).toContain("maxstartups|strictmodes|allowagentforwarding|printmotd");
  });

  it("[MUTATION-KILLER] uses sshd -T command", () => {
    expect(fast.command).toContain("sshd -T 2>/dev/null");
  });
});

describe("[MUTATION-KILLER] firewallSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] checks ufw status verbose", () => {
    expect(fast.command).toContain("command -v ufw >/dev/null 2>&1 && ufw status verbose 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] has ---IPTABLES_COUNT--- sentinel", () => {
    expect(fast.command).toContain("---IPTABLES_COUNT---");
  });

  it("[MUTATION-KILLER] counts iptables rules with wc -l", () => {
    expect(fast.command).toContain("command -v iptables >/dev/null 2>&1 && iptables -L -n 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] checks fail2ban-client status", () => {
    expect(fast.command).toContain("command -v fail2ban-client >/dev/null 2>&1 && fail2ban-client status 2>/dev/null");
  });

  it("[MUTATION-KILLER] checks nftables with nft list ruleset", () => {
    expect(fast.command).toContain("command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | head -20");
  });

  it("[MUTATION-KILLER] checks iptables INPUT chain details", () => {
    expect(fast.command).toContain("iptables -L INPUT -n --line-numbers 2>/dev/null | head -20");
  });

  it("[MUTATION-KILLER] checks iptables INPUT default policy", () => {
    expect(fast.command).toContain("iptables -L INPUT -n 2>/dev/null | head -1");
  });

  it("[MUTATION-KILLER] checks iptables OUTPUT policy", () => {
    expect(fast.command).toContain("iptables -L OUTPUT -n 2>/dev/null | head -1");
  });

  it("[MUTATION-KILLER] checks rate limiting with grep limit", () => {
    expect(fast.command).toContain("iptables -L -n 2>/dev/null | grep -i 'limit' | head -5");
  });

  it("[MUTATION-KILLER] checks FORWARD chain policy", () => {
    expect(fast.command).toContain("iptables -L FORWARD -n 2>/dev/null | head -1");
  });

  it("[MUTATION-KILLER] has ---IPV6_RULE_COUNT--- sentinel", () => {
    expect(fast.command).toContain("---IPV6_RULE_COUNT---");
  });

  it("[MUTATION-KILLER] checks ip6tables INPUT rules", () => {
    expect(fast.command).toContain("ip6tables -L INPUT -n 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] has ---CONNTRACK_MAX--- sentinel", () => {
    expect(fast.command).toContain("---CONNTRACK_MAX---");
  });

  it("[MUTATION-KILLER] reads nf_conntrack_max", () => {
    expect(fast.command).toContain("cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null");
  });

  it("[MUTATION-KILLER] has ---LOG_RULE_COUNT--- sentinel", () => {
    expect(fast.command).toContain("---LOG_RULE_COUNT---");
  });

  it("[MUTATION-KILLER] counts LOG rules in iptables", () => {
    expect(fast.command).toContain("iptables -L -n 2>/dev/null | grep -c 'LOG'");
  });

  it("[MUTATION-KILLER] NONE fallback for rate limiting", () => {
    expect(fast.command).toContain("|| echo 'NONE'");
  });
});

describe("[MUTATION-KILLER] updatesSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] apt list --upgradable with security filter", () => {
    expect(fast.command).toContain("apt list --upgradable 2>/dev/null | grep -i security | wc -l");
  });

  it("[MUTATION-KILLER] checks unattended-upgrades package", () => {
    expect(fast.command).toContain("dpkg -l unattended-upgrades 2>/dev/null | grep '^ii'");
  });

  it("[MUTATION-KILLER] stat apt lists directory timestamp", () => {
    expect(fast.command).toContain("stat -c '%Y' /var/lib/apt/lists/ 2>/dev/null");
  });

  it("[MUTATION-KILLER] checks reboot-required with REBOOT_REQUIRED/NO_REBOOT sentinels", () => {
    expect(fast.command).toContain("test -f /var/run/reboot-required && echo 'REBOOT_REQUIRED' || echo 'NO_REBOOT'");
  });

  it("[MUTATION-KILLER] stat dpkg.log for last upgrade timestamp", () => {
    expect(fast.command).toContain("stat -c '%Y' /var/log/dpkg.log 2>/dev/null");
  });

  it("[MUTATION-KILLER] checks CVE scanner presence trivy/grype", () => {
    expect(fast.command).toContain("which trivy grype 2>/dev/null || echo 'NONE'");
  });

  it("[MUTATION-KILLER] dpkg --audit for half-installed packages", () => {
    expect(fast.command).toContain("dpkg --audit 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] checks uname -r for running kernel", () => {
    expect(fast.command).toContain("uname -r 2>/dev/null");
  });

  it("[MUTATION-KILLER] checks installed kernel version via dpkg", () => {
    expect(fast.command).toContain("dpkg -l 'linux-image-*' 2>/dev/null | grep '^ii' | tail -1 | awk '{print $3}'");
  });

  it("[MUTATION-KILLER] reads auto-upgrades config", () => {
    expect(fast.command).toContain("cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null");
  });

  it("[MUTATION-KILLER] checks security repository in sources.list", () => {
    expect(fast.command).toContain("grep -rE 'security' /etc/apt/sources.list /etc/apt/sources.list.d/");
  });
});

describe("[MUTATION-KILLER] authSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] reads /etc/pam.d/common-auth", () => {
    expect(fast.command).toContain("cat /etc/pam.d/common-auth 2>/dev/null | head -20");
  });

  it("[MUTATION-KILLER] checks sudo group", () => {
    expect(fast.command).toContain("getent group sudo 2>/dev/null");
  });

  it("[MUTATION-KILLER] reads PASS_MAX_DAYS/PASS_MIN_DAYS/PASS_WARN_AGE from login.defs", () => {
    expect(fast.command).toContain("grep -E '^PASS_MAX_DAYS|^PASS_MIN_DAYS|^PASS_WARN_AGE'");
  });

  it("[MUTATION-KILLER] checks empty/locked passwords in shadow", () => {
    expect(fast.command).toContain("awk -F: '($2 == \"\" || $2 == \"!\") {print $1}' /etc/shadow");
  });

  it("[MUTATION-KILLER] checks shadow file permissions", () => {
    expect(fast.command).toContain("stat -c '%a' /etc/shadow 2>/dev/null");
  });

  it("[MUTATION-KILLER] checks sudo logging config", () => {
    expect(fast.command).toContain("grep -E '^Defaults.*log_output|^Defaults.*syslog' /etc/sudoers /etc/sudoers.d/*");
  });

  it("[MUTATION-KILLER] checks sudo requiretty", () => {
    expect(fast.command).toContain("grep -E '^Defaults.*requiretty' /etc/sudoers /etc/sudoers.d/*");
  });

  it("[MUTATION-KILLER] checks UID 0 accounts", () => {
    expect(fast.command).toContain("awk -F: '($3 == 0) {print $1}' /etc/passwd");
  });

  it("[MUTATION-KILLER] checks faillock/pam_tally2", () => {
    expect(fast.command).toContain("grep -E 'pam_faillock|pam_tally2' /etc/pam.d/common-auth /etc/pam.d/system-auth");
  });

  it("[MUTATION-KILLER] checks MFA packages", () => {
    expect(fast.command).toContain("dpkg -l libpam-google-authenticator libpam-oath 2>/dev/null | grep '^ii'");
  });

  it("[MUTATION-KILLER] checks INACTIVE in /etc/default/useradd", () => {
    expect(fast.command).toContain("grep -E '^INACTIVE' /etc/default/useradd");
  });

  it("[MUTATION-KILLER] checks pam_wheel for su restriction", () => {
    expect(fast.command).toContain("grep -E '^auth.*pam_wheel' /etc/pam.d/su");
  });

  it("[MUTATION-KILLER] checks gshadow permissions", () => {
    expect(fast.command).toContain("stat -c '%a' /etc/gshadow 2>/dev/null");
  });

  it("[MUTATION-KILLER] checks password quality PAM modules", () => {
    expect(fast.command).toContain("grep -rE 'pam_pwquality|pam_cracklib' /etc/pam.d/");
  });

  it("[MUTATION-KILLER] checks login UMASK", () => {
    expect(fast.command).toContain("grep -E '^UMASK' /etc/login.defs");
  });

  it("[MUTATION-KILLER] checks ENCRYPT_METHOD in login.defs", () => {
    expect(fast.command).toContain("grep -E '^ENCRYPT_METHOD' /etc/login.defs");
  });

  it("[MUTATION-KILLER] checks pwquality.conf settings", () => {
    expect(fast.command).toContain("cat /etc/security/pwquality.conf 2>/dev/null | grep -E 'minlen|dcredit|ucredit|lcredit|ocredit'");
  });
});

describe("[MUTATION-KILLER] dockerSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] docker info --format json", () => {
    expect(medium.command).toContain("docker info --format '{{json .}}' 2>/dev/null");
  });

  it("[MUTATION-KILLER] ---DAEMON_JSON--- sentinel", () => {
    expect(medium.command).toContain("echo '---DAEMON_JSON---'");
  });

  it("[MUTATION-KILLER] reads /etc/docker/daemon.json", () => {
    expect(medium.command).toContain("cat /etc/docker/daemon.json 2>/dev/null || echo '{}'");
  });

  it("[MUTATION-KILLER] ---END_DAEMON_JSON--- sentinel", () => {
    expect(medium.command).toContain("echo '---END_DAEMON_JSON---'");
  });

  it("[MUTATION-KILLER] docker ps format Names Image Status", () => {
    expect(medium.command).toContain("docker ps --format '{{.Names}} {{.Image}} {{.Status}}'");
  });

  it("[MUTATION-KILLER] docker.sock permissions check", () => {
    expect(medium.command).toContain("ls -la /var/run/docker.sock 2>/dev/null");
  });

  it("[MUTATION-KILLER] docker inspect SecurityOpt/ReadonlyRootfs/User/Privileged", () => {
    expect(medium.command).toContain("SecurityOpt={{.HostConfig.SecurityOpt}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} User={{.Config.User}} Privileged={{.HostConfig.Privileged}}");
  });

  it("[MUTATION-KILLER] DOCKER_CONTENT_TRUST env check", () => {
    expect(medium.command).toContain("DOCKER_CONTENT_TRUST=");
  });

  it("[MUTATION-KILLER] docker.sock stat permissions detail", () => {
    expect(medium.command).toContain("stat -c '%a %U %G' /var/run/docker.sock 2>/dev/null");
  });

  it("[MUTATION-KILLER] docker network ls format", () => {
    expect(medium.command).toContain("docker network ls --format '{{.Name}} {{.Driver}}'");
  });

  it("[MUTATION-KILLER] docker volume ls format", () => {
    expect(medium.command).toContain("docker volume ls --format '{{.Name}} {{.Driver}}'");
  });

  it("[MUTATION-KILLER] docker info SecurityOptions", () => {
    expect(medium.command).toContain("docker info --format '{{.SecurityOptions}}'");
  });

  it("[MUTATION-KILLER] docker network inspect bridge options", () => {
    expect(medium.command).toContain("docker network inspect bridge --format '{{json .Options}}'");
  });

  it("[MUTATION-KILLER] docker Plugins.Authorization", () => {
    expect(medium.command).toContain("docker info --format '{{.Plugins.Authorization}}'");
  });

  it("[MUTATION-KILLER] /etc/docker/certs.d directory listing", () => {
    expect(medium.command).toContain("ls -la /etc/docker/certs.d/ 2>/dev/null || echo 'NO_CERTS_DIR'");
  });

  it("[MUTATION-KILLER] InsecureRegistryCIDRs check", () => {
    expect(medium.command).toContain("docker info --format '{{.RegistryConfig.InsecureRegistryCIDRs}}'");
  });

  it("[MUTATION-KILLER] Swarm LocalNodeState check", () => {
    expect(medium.command).toContain("docker system info --format '{{.Swarm.LocalNodeState}}'");
  });

  it("[MUTATION-KILLER] ExperimentalBuild check", () => {
    expect(medium.command).toContain("docker info --format '{{.ExperimentalBuild}}'");
  });

  it("[MUTATION-KILLER] coolify platform checks /data/coolify", () => {
    const mediumCoolify = buildAuditBatchCommands({ platform: "coolify" })[1];
    expect(mediumCoolify.command).toContain("test -d /data/coolify && ls -la /data/coolify/ 2>/dev/null");
  });

  it("[MUTATION-KILLER] coolify docker inspect restartpolicy", () => {
    const mediumCoolify = buildAuditBatchCommands({ platform: "coolify" })[1];
    expect(mediumCoolify.command).toContain("docker inspect coolify 2>/dev/null | grep -i 'restartpolicy'");
  });

  it("[MUTATION-KILLER] dokploy platform checks /etc/dokploy", () => {
    const mediumDokploy = buildAuditBatchCommands({ platform: "dokploy" })[1];
    expect(mediumDokploy.command).toContain("test -d /etc/dokploy && ls -la /etc/dokploy/ 2>/dev/null");
  });

  it("[MUTATION-KILLER] dokploy docker inspect restartpolicy", () => {
    const mediumDokploy = buildAuditBatchCommands({ platform: "dokploy" })[1];
    expect(mediumDokploy.command).toContain("docker inspect dokploy 2>/dev/null | grep -i 'restartpolicy'");
  });
});

describe("[MUTATION-KILLER] networkSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] TCP listeners ss -tlnp", () => {
    expect(medium.command).toContain("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] UDP listeners ss -ulnp", () => {
    expect(medium.command).toContain("ss -ulnp 2>/dev/null || netstat -ulnp 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] sysctl net.ipv4.ip_forward", () => {
    expect(medium.command).toContain("sysctl net.ipv4.ip_forward 2>/dev/null");
  });

  it("[MUTATION-KILLER] /etc/resolv.conf nameserver", () => {
    expect(medium.command).toContain("cat /etc/resolv.conf 2>/dev/null | grep nameserver");
  });

  it("[MUTATION-KILLER] timedatectl check", () => {
    expect(medium.command).toContain("timedatectl 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] /etc/hosts.allow check", () => {
    expect(medium.command).toContain("test -f /etc/hosts.allow && cat /etc/hosts.allow 2>/dev/null | head -10 || echo 'NO_HOSTS_ALLOW'");
  });

  it("[MUTATION-KILLER] /etc/hosts.deny check", () => {
    expect(medium.command).toContain("test -f /etc/hosts.deny && cat /etc/hosts.deny 2>/dev/null | head -10 || echo 'NO_HOSTS_DENY'");
  });

  it("[MUTATION-KILLER] sysctl ipv6 and send_redirects and rp_filter", () => {
    expect(medium.command).toContain("sysctl net.ipv6.conf.all.disable_ipv6 net.ipv4.conf.all.send_redirects net.ipv4.conf.all.secure_redirects net.ipv6.conf.all.accept_source_route net.ipv4.conf.all.rp_filter");
  });

  it("[MUTATION-KILLER] admin port exposure check", () => {
    expect(medium.command).toContain("ss -tlnp 2>/dev/null | grep -E ':8080 |:8443 |:9000 |:3000 ' | grep '0.0.0.0'");
  });

  it("[MUTATION-KILLER] mail service ports check", () => {
    expect(medium.command).toContain("ss -tlnp 2>/dev/null | grep -E ':25 |:110 |:143 '");
  });

  it("[MUTATION-KILLER] promiscuous interfaces check", () => {
    expect(medium.command).toContain("ip link show 2>/dev/null | grep -i 'PROMISC'");
  });

  it("[MUTATION-KILLER] ARP spoofing protection sysctl", () => {
    expect(medium.command).toContain("sysctl net.ipv4.conf.all.arp_announce net.ipv4.conf.all.arp_ignore");
  });

  it("[MUTATION-KILLER] TCP wrappers allow rules content", () => {
    expect(medium.command).toContain("cat /etc/hosts.allow 2>/dev/null | grep -v '^#' | grep -v '^\\s*$' | head -5 || echo 'EMPTY'");
  });

  it("[MUTATION-KILLER] total listening port count", () => {
    expect(medium.command).toContain("ss -tlnp 2>/dev/null | grep -c ':'");
  });
});

describe("[MUTATION-KILLER] loggingSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] rsyslog is-active", () => {
    expect(medium.command).toContain("systemctl is-active rsyslog 2>/dev/null");
  });

  it("[MUTATION-KILLER] systemd-journald is-active", () => {
    expect(medium.command).toContain("systemctl is-active systemd-journald 2>/dev/null");
  });

  it("[MUTATION-KILLER] logrotate.conf head", () => {
    expect(medium.command).toContain("cat /etc/logrotate.conf 2>/dev/null | head -10");
  });

  it("[MUTATION-KILLER] auth.log / secure existence", () => {
    expect(medium.command).toContain("test -f /var/log/auth.log && echo 'EXISTS' || test -f /var/log/secure && echo 'EXISTS' || echo 'MISSING'");
  });

  it("[MUTATION-KILLER] auditctl -l rules", () => {
    expect(medium.command).toContain("auditctl -l 2>/dev/null | head -50 || echo 'NO_RULES'");
  });

  it("[MUTATION-KILLER] auditd is-active status", () => {
    expect(medium.command).toContain("systemctl is-active auditd 2>/dev/null || echo 'inactive'");
  });

  it("[MUTATION-KILLER] /var/log permissions", () => {
    expect(medium.command).toContain("stat -c '%a' /var/log 2>/dev/null");
  });

  it("[MUTATION-KILLER] journald persistent storage config", () => {
    expect(medium.command).toContain("grep -E '^Storage' /etc/systemd/journald.conf 2>/dev/null");
  });

  it("[MUTATION-KILLER] centralized logging tools check", () => {
    expect(medium.command).toContain("which vector promtail fluent-bit 2>/dev/null || echo 'NONE'");
  });

  it("[MUTATION-KILLER] world-readable log files count", () => {
    expect(medium.command).toContain("find /var/log -maxdepth 1 -perm -o+r -type f 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] remote syslog forwarding", () => {
    expect(medium.command).toContain("grep -E '^\\s*@@?' /etc/rsyslog.conf /etc/rsyslog.d/*.conf 2>/dev/null | head -5 || echo 'NONE'");
  });

  it("[MUTATION-KILLER] logrotate timer or cron", () => {
    expect(medium.command).toContain("systemctl is-active logrotate.timer 2>/dev/null || ls /etc/cron.daily/logrotate 2>/dev/null || echo 'inactive'");
  });

  it("[MUTATION-KILLER] file watch rule count", () => {
    expect(medium.command).toContain("auditctl -l 2>/dev/null | grep -c 'watch'");
  });

  it("[MUTATION-KILLER] auditd retention config", () => {
    expect(medium.command).toContain("grep -rE '^max_log_file_action|^space_left_action' /etc/audit/auditd.conf");
  });
});

describe("[MUTATION-KILLER] kernelSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] sysctl -a with security parameters", () => {
    expect(medium.command).toContain("randomize_va_space|accept_redirects|accept_source_route|log_martians|syncookies");
  });

  it("[MUTATION-KILLER] sysctl kernel params dmesg_restrict, kptr_restrict, ptrace_scope", () => {
    expect(medium.command).toContain("dmesg_restrict|kptr_restrict|ptrace_scope|perf_event_paranoid");
  });

  it("[MUTATION-KILLER] sysctl tcp_timestamps, icmp, rp_filter, ip_forward", () => {
    expect(medium.command).toContain("tcp_timestamps|icmp_echo_ignore_broadcasts|rp_filter|ip_forward");
  });

  it("[MUTATION-KILLER] sysctl modules_disabled, unprivileged_bpf, send_redirects", () => {
    expect(medium.command).toContain("modules_disabled|unprivileged_bpf_disabled|send_redirects|secure_redirects");
  });

  it("[MUTATION-KILLER] sysctl sysrq, exec_shield, core_pattern, userns_clone", () => {
    expect(medium.command).toContain("sysrq|exec_shield|core_pattern|unprivileged_userns_clone");
  });

  it("[MUTATION-KILLER] sysctl panic_on_oops, nmi_watchdog, kernel.panic, bpf_jit_harden, suid_dumpable", () => {
    expect(medium.command).toContain("panic_on_oops|nmi_watchdog|kernel\\.panic\\b|bpf_jit_harden|suid_dumpable");
  });

  it("[MUTATION-KILLER] uname -r for kernel version", () => {
    expect(medium.command).toContain("uname -r 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] /sys/kernel/security/lsm for LSM", () => {
    expect(medium.command).toContain("cat /sys/kernel/security/lsm 2>/dev/null");
  });

  it("[MUTATION-KILLER] blacklisted filesystem modules lsmod", () => {
    expect(medium.command).toContain("lsmod 2>/dev/null | grep -cE 'cramfs|freevxfs|jffs2|hfs|hfsplus|udf'");
  });

  it("[MUTATION-KILLER] sysctl.d config count", () => {
    expect(medium.command).toContain("ls /etc/sysctl.d/*.conf 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] systemd coredump config", () => {
    expect(medium.command).toContain("cat /etc/systemd/coredump.conf 2>/dev/null | grep -E 'Storage|ProcessSizeMax'");
  });

  it("[MUTATION-KILLER] kernel lockdown mode", () => {
    expect(medium.command).toContain("cat /sys/kernel/security/lockdown 2>/dev/null");
  });
});

describe("[MUTATION-KILLER] accountsSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] passwd fields extraction", () => {
    expect(fast.command).toContain("awk -F: '{print $1\":\"$3\":\"$7}' /etc/passwd");
  });

  it("[MUTATION-KILLER] shadow hash extraction", () => {
    expect(fast.command).toContain("awk -F: '{print $1\":\"$2}' /etc/shadow");
  });

  it("[MUTATION-KILLER] home directories with owners", () => {
    expect(fast.command).toContain("find /home -maxdepth 1 -mindepth 1 -type d 2>/dev/null | xargs stat -c '%n %U'");
  });

  it("[MUTATION-KILLER] dangerous legacy files check", () => {
    expect(fast.command).toContain("ls -la /root/.rhosts /root/.netrc /root/.forward /etc/hosts.equiv");
  });

  it("[MUTATION-KILLER] system accounts with login shells", () => {
    expect(fast.command).toContain("/usr/sbin/nologin");
    expect(fast.command).toContain("/bin/false");
    expect(fast.command).toContain("/sbin/nologin");
  });

  it("[MUTATION-KILLER] root directory permissions", () => {
    expect(fast.command).toContain("stat -c '%a' /root 2>/dev/null");
  });

  it("[MUTATION-KILLER] login.defs PASS_MAX_DAYS/UMASK/INACTIVE", () => {
    expect(fast.command).toContain("cat /etc/login.defs 2>/dev/null | grep -E '^PASS_MAX_DAYS|^PASS_MIN_DAYS|^UMASK|^INACTIVE'");
  });

  it("[MUTATION-KILLER] duplicate UID detection", () => {
    expect(fast.command).toContain("awk -F: '{print $1\":\"$3}' /etc/passwd 2>/dev/null | sort -t: -k2 -n | uniq -d -f1");
  });

  it("[MUTATION-KILLER] inactive accounts with lastlog -b 90", () => {
    expect(fast.command).toContain("lastlog -b 90 2>/dev/null | tail +2 | head -20");
  });

  it("[MUTATION-KILLER] total account count", () => {
    expect(fast.command).toContain("grep -c '^' /etc/passwd 2>/dev/null");
  });

  it("[MUTATION-KILLER] UID/GID ranges from login.defs", () => {
    expect(fast.command).toContain("grep -E 'UID_MAX|UID_MIN|GID_MAX|GID_MIN' /etc/login.defs");
  });

  it("[MUTATION-KILLER] duplicate GIDs", () => {
    expect(fast.command).toContain("awk -F: '{print $3}' /etc/group 2>/dev/null | sort | uniq -d");
  });

  it("[MUTATION-KILLER] accounts with login shells count", () => {
    expect(fast.command).toContain("awk -F: '($7 != \"/usr/sbin/nologin\" && $7 != \"/bin/false\" && $7 != \"/sbin/nologin\") {print $1}' /etc/passwd 2>/dev/null | wc -l");
  });
});

describe("[MUTATION-KILLER] servicesSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] checks legacy insecure services", () => {
    expect(medium.command).toContain("systemctl is-active telnet rsh rlogin vsftpd ftp tftpd-hpa");
  });

  it("[MUTATION-KILLER] checks unnecessary network services", () => {
    expect(medium.command).toContain("systemctl is-active nfs-server rpcbind smbd nmbd avahi-daemon cups isc-dhcp-server named snmpd squid xinetd ypserv");
  });

  it("[MUTATION-KILLER] inetd.conf check", () => {
    expect(medium.command).toContain("test -f /etc/inetd.conf && grep -v '^#' /etc/inetd.conf 2>/dev/null || echo 'NONE'");
  });

  it("[MUTATION-KILLER] xinetd.conf check", () => {
    expect(medium.command).toContain("test -f /etc/xinetd.conf && cat /etc/xinetd.conf 2>/dev/null || echo 'NONE'");
  });

  it("[MUTATION-KILLER] running service count", () => {
    expect(medium.command).toContain("systemctl list-units --type=service --state=running --no-pager 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] wildcard listener count", () => {
    expect(medium.command).toContain("ss -tlnp 2>/dev/null | grep -c '0.0.0.0:'");
  });

  it("[MUTATION-KILLER] wildcard listener details", () => {
    expect(medium.command).toContain("ss -tlnp 2>/dev/null | grep '0.0.0.0:' | head -10 || echo 'NONE'");
  });

  it("[MUTATION-KILLER] xinetd service status", () => {
    expect(medium.command).toContain("systemctl is-active xinetd 2>/dev/null || echo 'inactive'");
  });

  it("[MUTATION-KILLER] world-readable service configs", () => {
    expect(medium.command).toContain("find /etc -maxdepth 2 -name '*.conf' -perm -o+r -path '*/systemd/*'");
  });
});

describe("[MUTATION-KILLER] bootSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] grub.cfg permissions stat", () => {
    expect(fast.command).toContain("stat -c '%a %U %G' /boot/grub/grub.cfg /boot/grub2/grub.cfg 2>/dev/null");
  });

  it("[MUTATION-KILLER] GRUB password set check", () => {
    expect(fast.command).toContain("grep -q 'set superusers' /boot/grub/grub.cfg");
  });

  it("[MUTATION-KILLER] GRUB_PW_SET / GRUB_NO_PW sentinels", () => {
    expect(fast.command).toContain("GRUB_PW_SET");
    expect(fast.command).toContain("GRUB_NO_PW");
  });

  it("[MUTATION-KILLER] Secure Boot mokutil check", () => {
    expect(fast.command).toContain("mokutil --sb-state 2>/dev/null");
  });

  it("[MUTATION-KILLER] /proc/cmdline check", () => {
    expect(fast.command).toContain("cat /proc/cmdline 2>/dev/null");
  });

  it("[MUTATION-KILLER] /etc/grub.d permissions", () => {
    expect(fast.command).toContain("stat -c '%a %U %G %n' /etc/grub.d 2>/dev/null");
  });

  it("[MUTATION-KILLER] /boot mount check", () => {
    expect(fast.command).toContain("grep '/boot' /proc/mounts 2>/dev/null");
  });

  it("[MUTATION-KILLER] sulogin in rescue/emergency services", () => {
    expect(fast.command).toContain("grep -l sulogin /usr/lib/systemd/system/rescue.service /usr/lib/systemd/system/emergency.service");
  });

  it("[MUTATION-KILLER] kernel.modules_disabled sysctl", () => {
    expect(fast.command).toContain("sysctl kernel.modules_disabled 2>/dev/null");
  });

  it("[MUTATION-KILLER] UEFI vs BIOS detection", () => {
    expect(fast.command).toContain("[ -d /sys/firmware/efi ] && echo 'UEFI' || echo 'BIOS'");
  });

  it("[MUTATION-KILLER] GRUB superuser/password_pbkdf2 authentication", () => {
    expect(fast.command).toContain("grep -rE 'set superusers|password_pbkdf2' /boot/grub/grub.cfg /etc/grub.d/");
  });
});

describe("[MUTATION-KILLER] schedulingSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] cron.allow existence", () => {
    expect(fast.command).toContain("test -f /etc/cron.allow && echo 'cron.allow EXISTS' || echo 'cron.allow MISSING'");
  });

  it("[MUTATION-KILLER] cron.deny existence", () => {
    expect(fast.command).toContain("test -f /etc/cron.deny && echo 'cron.deny EXISTS' || echo 'cron.deny MISSING'");
  });

  it("[MUTATION-KILLER] at.allow existence", () => {
    expect(fast.command).toContain("test -f /etc/at.allow && echo 'at.allow EXISTS' || echo 'at.allow MISSING'");
  });

  it("[MUTATION-KILLER] at.deny existence", () => {
    expect(fast.command).toContain("test -f /etc/at.deny && echo 'at.deny EXISTS' || echo 'at.deny MISSING'");
  });

  it("[MUTATION-KILLER] cron directory permissions", () => {
    expect(fast.command).toContain("stat -c '%a %U %G %n' /etc/cron.d /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /etc/cron.hourly");
  });

  it("[MUTATION-KILLER] crontab permissions", () => {
    expect(fast.command).toContain("stat -c '%a %U %G %n' /etc/crontab 2>/dev/null");
  });

  it("[MUTATION-KILLER] world-writable cron files", () => {
    expect(fast.command).toContain("find /etc/cron* -perm -o+w 2>/dev/null | head -10 || echo 'NONE'");
  });

  it("[MUTATION-KILLER] cron.d file count", () => {
    expect(fast.command).toContain("find /etc/cron.d/ -type f 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] world-readable user crontabs", () => {
    expect(fast.command).toContain("find /var/spool/cron/crontabs/ -type f -perm -o+r 2>/dev/null");
  });
});

describe("[MUTATION-KILLER] timeSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] timedatectl check", () => {
    expect(medium.command).toContain("timedatectl 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] NTP service checks", () => {
    expect(medium.command).toContain("systemctl is-active ntp chrony chronyd systemd-timesyncd");
  });

  it("[MUTATION-KILLER] chronyc tracking", () => {
    expect(medium.command).toContain("chronyc tracking 2>/dev/null | head -10");
  });

  it("[MUTATION-KILLER] /etc/timezone", () => {
    expect(medium.command).toContain("cat /etc/timezone 2>/dev/null");
  });

  it("[MUTATION-KILLER] hwclock --show", () => {
    expect(medium.command).toContain("hwclock --show 2>/dev/null | head -3");
  });

  it("[MUTATION-KILLER] ntpq -p peer status", () => {
    expect(medium.command).toContain("ntpq -p 2>/dev/null | head -5");
  });

  it("[MUTATION-KILLER] timedatectl show NTPSynchronized", () => {
    expect(medium.command).toContain("timedatectl show 2>/dev/null | grep -E 'NTPSynchronized|Timezone'");
  });
});

describe("[MUTATION-KILLER] bannersSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] /etc/issue check", () => {
    expect(fast.command).toContain("cat /etc/issue 2>/dev/null || echo 'MISSING'");
  });

  it("[MUTATION-KILLER] /etc/issue.net check", () => {
    expect(fast.command).toContain("cat /etc/issue.net 2>/dev/null || echo 'MISSING'");
  });

  it("[MUTATION-KILLER] /etc/motd check", () => {
    expect(fast.command).toContain("cat /etc/motd 2>/dev/null || echo 'MISSING'");
  });

  it("[MUTATION-KILLER] SSH banner config check", () => {
    expect(fast.command).toContain("grep -i '^Banner' /etc/ssh/sshd_config 2>/dev/null || sshd -T 2>/dev/null | grep -i '^banner'");
  });
});

describe("[MUTATION-KILLER] fileIntegritySection — all command strings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] AIDE installation check", () => {
    expect(slow.command).toContain("dpkg -l aide 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] tripwire installation check", () => {
    expect(slow.command).toContain("dpkg -l tripwire 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] AIDE database existence check", () => {
    expect(slow.command).toContain("test -f /var/lib/aide/aide.db.gz && echo 'AIDE_DB_EXISTS' || test -f /var/lib/aide/aide.db && echo 'AIDE_DB_EXISTS' || echo 'AIDE_DB_MISSING'");
  });

  it("[MUTATION-KILLER] AIDE cron job check", () => {
    expect(slow.command).toContain("grep -r 'aide' /etc/cron.daily /etc/cron.weekly /etc/cron.d/ /var/spool/cron/crontabs/");
  });

  it("[MUTATION-KILLER] auditd installation check", () => {
    expect(slow.command).toContain("dpkg -l auditd 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] auditd active status check", () => {
    expect(slow.command).toContain("systemctl is-active auditd 2>/dev/null || echo 'inactive'");
  });

  it("[MUTATION-KILLER] audit rules for passwd/shadow/sudoers", () => {
    expect(slow.command).toContain("auditctl -l 2>/dev/null | grep -E '/etc/passwd|/etc/shadow|/etc/sudoers'");
  });

  it("[MUTATION-KILLER] AIDE database modification timestamp", () => {
    expect(slow.command).toContain("stat -c '%Y' /var/lib/aide/aide.db 2>/dev/null || stat -c '%Y' /var/lib/aide/aide.db.gz 2>/dev/null");
  });
});

describe("[MUTATION-KILLER] malwareSection — all command strings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] chkrootkit installation check", () => {
    expect(slow.command).toContain("dpkg -l chkrootkit 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] rkhunter installation check", () => {
    expect(slow.command).toContain("dpkg -l rkhunter 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] SUID files in /tmp", () => {
    expect(slow.command).toContain("find /tmp -perm -4000 -type f 2>/dev/null | head -10");
  });

  it("[MUTATION-KILLER] SUID files in /dev", () => {
    expect(slow.command).toContain("find /dev -perm -4000 -type f 2>/dev/null | head -5");
  });

  it("[MUTATION-KILLER] world-writable files in /root", () => {
    expect(slow.command).toContain("find /root -perm -o+w -type f -maxdepth 3 2>/dev/null | head -5");
  });

  it("[MUTATION-KILLER] rkhunter scan summary", () => {
    expect(slow.command).toContain("test -f /var/log/rkhunter.log && tail -30 /var/log/rkhunter.log 2>/dev/null | grep -i 'system checks summary'");
  });

  it("[MUTATION-KILLER] hidden files in /tmp and /dev/shm", () => {
    expect(slow.command).toContain("find /tmp /dev/shm -name \".*\" -type f 2>/dev/null | head -10");
  });

  it("[MUTATION-KILLER] high CPU processes check", () => {
    expect(slow.command).toContain("ps aux 2>/dev/null | awk '{if($3>50)print $0}'");
  });

  it("[MUTATION-KILLER] hidden files count in /tmp and /var/tmp", () => {
    expect(slow.command).toContain("find /tmp /var/tmp -name '.*' -type f 2>/dev/null | wc -l");
  });
});

describe("[MUTATION-KILLER] macSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] /sys/kernel/security/lsm", () => {
    expect(medium.command).toContain("cat /sys/kernel/security/lsm 2>/dev/null");
  });

  it("[MUTATION-KILLER] aa-status / apparmor_status", () => {
    expect(medium.command).toContain("aa-status 2>/dev/null | head -20 || apparmor_status 2>/dev/null | head -20");
  });

  it("[MUTATION-KILLER] apparmor is-active", () => {
    expect(medium.command).toContain("systemctl is-active apparmor 2>/dev/null || echo 'inactive'");
  });

  it("[MUTATION-KILLER] getenforce SELinux check", () => {
    expect(medium.command).toContain("command -v getenforce >/dev/null 2>&1 && getenforce 2>/dev/null || echo 'NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] /etc/selinux/config SELINUX= check", () => {
    expect(medium.command).toContain("test -f /etc/selinux/config && grep '^SELINUX=' /etc/selinux/config");
  });

  it("[MUTATION-KILLER] /proc/self/status Seccomp check", () => {
    expect(medium.command).toContain("cat /proc/self/status 2>/dev/null | grep Seccomp");
  });

  it("[MUTATION-KILLER] AppArmor enforce count", () => {
    expect(medium.command).toContain("aa-status 2>/dev/null | grep -c 'enforce mode'");
  });

  it("[MUTATION-KILLER] AppArmor base abstraction", () => {
    expect(medium.command).toContain("cat /etc/apparmor.d/abstractions/base 2>/dev/null | wc -l");
  });
});

describe("[MUTATION-KILLER] memorySection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] sysctl vm.overcommit_memory/ratio/oom_kill", () => {
    expect(medium.command).toContain("sysctl vm.overcommit_memory vm.overcommit_ratio vm.oom_kill_allocating_task");
  });

  it("[MUTATION-KILLER] transparent hugepage check", () => {
    expect(medium.command).toContain("cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null");
  });

  it("[MUTATION-KILLER] zombie process count", () => {
    expect(medium.command).toContain("ps aux 2>/dev/null | grep -c ' Z '");
  });

  it("[MUTATION-KILLER] pid_max check", () => {
    expect(medium.command).toContain("cat /proc/sys/kernel/pid_max 2>/dev/null");
  });

  it("[MUTATION-KILLER] ulimit -a", () => {
    expect(medium.command).toContain("ulimit -a 2>/dev/null | head -20");
  });

  it("[MUTATION-KILLER] fs.suid_dumpable sysctl", () => {
    expect(medium.command).toContain("sysctl fs.suid_dumpable 2>/dev/null");
  });

  it("[MUTATION-KILLER] swappiness check", () => {
    expect(medium.command).toContain("cat /proc/sys/vm/swappiness 2>/dev/null");
  });

  it("[MUTATION-KILLER] swap info", () => {
    expect(medium.command).toContain("swapon --show=NAME,TYPE 2>/dev/null | tail +2 | head -5 || echo 'NO_SWAP'");
  });

  it("[MUTATION-KILLER] max_map_count check", () => {
    expect(medium.command).toContain("cat /proc/sys/vm/max_map_count 2>/dev/null");
  });
});

describe("[MUTATION-KILLER] cryptoSection — all command strings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] openssl version", () => {
    expect(slow.command).toContain("openssl version 2>/dev/null || echo 'NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] sshd -T ciphers/macs/kex/hostkey", () => {
    expect(slow.command).toContain("sshd -T 2>/dev/null | grep -iE '^ciphers|^macs|^kexalgorithms|^hostkeyalgorithms'");
  });

  it("[MUTATION-KILLER] SSH host keys listing", () => {
    expect(slow.command).toContain("ls /etc/ssh/ssh_host_*_key 2>/dev/null");
  });

  it("[MUTATION-KILLER] LUKS encryption check", () => {
    expect(slow.command).toContain("lsblk -f 2>/dev/null | grep -i 'crypto_luks'");
  });

  it("[MUTATION-KILLER] OpenSSL config MinProtocol/CipherString", () => {
    expect(slow.command).toContain("cat /etc/ssl/openssl.cnf 2>/dev/null | grep -iE 'MinProtocol|CipherString'");
  });

  it("[MUTATION-KILLER] TLS ports check", () => {
    expect(slow.command).toContain("ss -tlnp 2>/dev/null | grep -E ':443 |:8443 ' | head -5 || echo 'NO_TLS_PORTS'");
  });

  it("[MUTATION-KILLER] certificate expiry check via openssl", () => {
    expect(slow.command).toContain("openssl x509 -noout -enddate");
  });

  it("[MUTATION-KILLER] host key permissions stat", () => {
    expect(slow.command).toContain("stat -c '%a %n' /etc/ssh/ssh_host_*_key 2>/dev/null");
  });

  it("[MUTATION-KILLER] weak cipher count in OpenSSL", () => {
    expect(slow.command).toContain("openssl ciphers -v 'ALL:eNULL' 2>/dev/null | grep -ci 'NULL\\|RC4\\|DES\\|MD5'");
  });

  it("[MUTATION-KILLER] certificate count in /etc/ssl/certs/", () => {
    expect(slow.command).toContain("find /etc/ssl/certs/ -name '*.pem' 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] DH param validation", () => {
    expect(slow.command).toContain("openssl dhparam -check -in /etc/ssl/dhparams.pem");
  });

  it("[MUTATION-KILLER] world-readable private keys", () => {
    expect(slow.command).toContain("find /etc/ssl/ /etc/pki/ -name '*.key' -perm -o+r 2>/dev/null");
  });

  it("[MUTATION-KILLER] nginx TLS config check", () => {
    expect(slow.command).toContain("grep -rE 'ssl_protocols|ssl_ciphers' /etc/nginx/");
  });
});

describe("[MUTATION-KILLER] filesystemSection — all command strings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] world-writable files in /etc /usr", () => {
    expect(slow.command).toContain("find /etc /usr -maxdepth 2 -perm -o+w -type f 2>/dev/null | head -20");
  });

  it("[MUTATION-KILLER] SUID binaries in /usr/bin /usr/sbin", () => {
    expect(slow.command).toContain("find /usr/bin /usr/sbin -perm -4000 -type f 2>/dev/null | head -20");
  });

  it("[MUTATION-KILLER] /tmp permissions stat", () => {
    expect(slow.command).toContain("stat -c '%a %U %G' /tmp 2>/dev/null");
  });

  it("[MUTATION-KILLER] disk usage df -h /", () => {
    expect(slow.command).toContain("df -h / 2>/dev/null");
  });

  it("[MUTATION-KILLER] mount options via findmnt", () => {
    expect(slow.command).toContain("findmnt -o TARGET,OPTIONS --raw 2>/dev/null || cat /proc/mounts 2>/dev/null");
  });

  it("[MUTATION-KILLER] /dev/shm permissions", () => {
    expect(slow.command).toContain("stat -c '%a %U %G' /dev/shm 2>/dev/null");
  });

  it("[MUTATION-KILLER] umask check", () => {
    expect(slow.command).toContain("umask 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] home directory permissions", () => {
    expect(slow.command).toContain("find /home -maxdepth 1 -mindepth 1 -type d -exec stat -c '%a %n' {} \\;");
  });

  it("[MUTATION-KILLER] /var/tmp permissions", () => {
    expect(slow.command).toContain("stat -c '%a %U %G' /var/tmp 2>/dev/null");
  });

  it("[MUTATION-KILLER] /var mount options", () => {
    expect(slow.command).toContain("findmnt -o TARGET,OPTIONS /var 2>/dev/null");
  });

  it("[MUTATION-KILLER] system-wide SUID count", () => {
    expect(slow.command).toContain("find / -xdev -type f -perm -4000 2>/dev/null | wc -l");
  });
});

describe("[MUTATION-KILLER] secretsSection — all command strings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] world-readable .env sentinel WORLD_READABLE_ENV", () => {
    expect(slow.command).toContain("WORLD_READABLE_ENV");
  });

  it("[MUTATION-KILLER] world-readable .env negative sentinel NO_WORLD_READABLE_ENV", () => {
    expect(slow.command).toContain("NO_WORLD_READABLE_ENV");
  });

  it("[MUTATION-KILLER] SSH private key permissions stat", () => {
    expect(slow.command).toContain("stat -c '%a %n' /root/.ssh/id_rsa /root/.ssh/id_ed25519 /root/.ssh/id_ecdsa 2>/dev/null || echo 'NO_KEYS'");
  });

  it("[MUTATION-KILLER] git config tokens check", () => {
    expect(slow.command).toContain("git config --global --get-regexp 'url.*token' 2>/dev/null");
  });

  it("[MUTATION-KILLER] NO_GIT_TOKENS sentinel", () => {
    expect(slow.command).toContain("NO_GIT_TOKENS");
  });

  it("[MUTATION-KILLER] plaintext credentials grep in /etc", () => {
    expect(slow.command).toContain("grep -rEl '(password|secret|token|api_key|apikey|passwd)\\s*=' /etc");
  });

  it("[MUTATION-KILLER] home .env sentinel ENV_IN_HOME / NO_ENV_IN_HOME", () => {
    expect(slow.command).toContain("ENV_IN_HOME");
    expect(slow.command).toContain("NO_ENV_IN_HOME");
  });

  it("[MUTATION-KILLER] Docker compose .env sentinel DOCKER_ENV_FOUND / NO_DOCKER_ENV", () => {
    expect(slow.command).toContain("DOCKER_ENV_FOUND");
    expect(slow.command).toContain("NO_DOCKER_ENV");
  });

  it("[MUTATION-KILLER] npmrc token sentinel NPMRC_TOKEN_FOUND / NO_NPMRC_TOKEN", () => {
    expect(slow.command).toContain("NPMRC_TOKEN_FOUND");
    expect(slow.command).toContain("NO_NPMRC_TOKEN");
  });

  it("[MUTATION-KILLER] world-readable key sentinel WORLD_READABLE_KEY / NO_WORLD_READABLE_KEYS", () => {
    expect(slow.command).toContain("WORLD_READABLE_KEY");
    expect(slow.command).toContain("NO_WORLD_READABLE_KEYS");
  });

  it("[MUTATION-KILLER] AWS credentials sentinel AWS_CREDS_FOUND / NO_AWS_CREDS", () => {
    expect(slow.command).toContain("AWS_CREDS_FOUND");
    expect(slow.command).toContain("NO_AWS_CREDS");
  });

  it("[MUTATION-KILLER] kubeconfig sentinel KUBECONFIG_PERM / NO_KUBECONFIG", () => {
    expect(slow.command).toContain("KUBECONFIG_PERM");
    expect(slow.command).toContain("NO_KUBECONFIG");
  });

  it("[MUTATION-KILLER] NO_KUBE_DIR sentinel", () => {
    expect(slow.command).toContain("NO_KUBE_DIR");
  });

  it("[MUTATION-KILLER] world-readable bash history", () => {
    expect(slow.command).toContain("find /home -maxdepth 3 -name \".bash_history\" -perm -o+r 2>/dev/null");
  });

  it("[MUTATION-KILLER] SSH agent forwarding check", () => {
    expect(slow.command).toContain("sshd -T 2>/dev/null | grep -i 'allowagentforwarding'");
  });

  it("[MUTATION-KILLER] shell RC secrets grep", () => {
    expect(slow.command).toContain("grep -rE 'export\\s+(API_KEY|SECRET_KEY|TOKEN|PASSWORD|AWS_ACCESS_KEY)='");
  });
});

describe("[MUTATION-KILLER] cloudMetaSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] VPS detection with systemd-detect-virt", () => {
    expect(medium.command).toContain("systemd-detect-virt 2>/dev/null");
  });

  it("[MUTATION-KILLER] dmidecode fallback", () => {
    expect(medium.command).toContain("dmidecode -s system-product-name");
  });

  it("[MUTATION-KILLER] BARE_METAL sentinel", () => {
    expect(medium.command).toContain("BARE_METAL");
  });

  it("[MUTATION-KILLER] AWS metadata endpoint check", () => {
    expect(medium.command).toContain("http://169.254.169.254/latest/meta-data/");
  });

  it("[MUTATION-KILLER] GCP metadata endpoint check", () => {
    expect(medium.command).toContain("http://metadata.google.internal/computeMetadata/v1/");
  });

  it("[MUTATION-KILLER] Metadata-Flavor: Google header", () => {
    expect(medium.command).toContain("Metadata-Flavor: Google");
  });

  it("[MUTATION-KILLER] METADATA_ACCESSIBLE / METADATA_BLOCKED sentinels", () => {
    expect(medium.command).toContain("METADATA_ACCESSIBLE");
    expect(medium.command).toContain("METADATA_BLOCKED");
  });

  it("[MUTATION-KILLER] METADATA_FIREWALL_OK / METADATA_FIREWALL_MISSING", () => {
    expect(medium.command).toContain("METADATA_FIREWALL_OK");
    expect(medium.command).toContain("METADATA_FIREWALL_MISSING");
  });

  it("[MUTATION-KILLER] cloud-init log secrets check", () => {
    expect(medium.command).toContain("grep -iE 'password|secret|token|key' /var/log/cloud-init.log");
  });

  it("[MUTATION-KILLER] CLOUDINIT_CLEAN sentinel", () => {
    expect(medium.command).toContain("CLOUDINIT_CLEAN");
  });

  it("[MUTATION-KILLER] sensitive env in cloud-init user-data", () => {
    expect(medium.command).toContain("SENSITIVE_ENV_IN_CLOUDINIT");
    expect(medium.command).toContain("CLOUDINIT_NO_SENSITIVE_ENV");
  });

  it("[MUTATION-KILLER] IMDSv2 check", () => {
    expect(medium.command).toContain("IMDSV2_AVAILABLE");
    expect(medium.command).toContain("IMDSV2_UNAVAILABLE");
  });

  it("[MUTATION-KILLER] X-aws-ec2-metadata-token-ttl-seconds header", () => {
    expect(medium.command).toContain("X-aws-ec2-metadata-token-ttl-seconds: 21600");
  });
});

describe("[MUTATION-KILLER] supplyChainSection — all command strings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] HTTP repos in apt-cache policy", () => {
    expect(slow.command).toContain("apt-cache policy 2>/dev/null | grep -E '^\\s+[0-9]' | grep 'http://' | head -10 || echo 'NO_HTTP_REPOS'");
  });

  it("[MUTATION-KILLER] NO_HTTP_REPOS sentinel", () => {
    expect(slow.command).toContain("NO_HTTP_REPOS");
  });

  it("[MUTATION-KILLER] trusted.gpg.d listing", () => {
    expect(slow.command).toContain("ls /etc/apt/trusted.gpg.d/ 2>/dev/null");
  });

  it("[MUTATION-KILLER] dpkg --audit check", () => {
    expect(slow.command).toContain("dpkg --audit 2>/dev/null | head -10");
  });

  it("[MUTATION-KILLER] apt-key list", () => {
    expect(slow.command).toContain("apt-key list 2>&1 | head -20");
  });

  it("[MUTATION-KILLER] insecure apt config AllowUnauthenticated", () => {
    expect(slow.command).toContain("apt-config dump 2>/dev/null | grep -i 'AllowUnauthenticated\\|AllowInsecureRepositories' | head -5 || echo 'NONE'");
  });

  it("[MUTATION-KILLER] dpkg --verify modified package count", () => {
    expect(slow.command).toContain("dpkg --verify 2>/dev/null | wc -l");
  });

  it("[MUTATION-KILLER] debsums presence", () => {
    expect(slow.command).toContain("which debsums 2>/dev/null || echo 'NOT_INSTALLED'");
  });
});

describe("[MUTATION-KILLER] backupSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] KASTELL_BACKUP_FOUND / KASTELL_BACKUP_MISSING", () => {
    expect(medium.command).toContain("KASTELL_BACKUP_FOUND");
    expect(medium.command).toContain("KASTELL_BACKUP_MISSING");
  });

  it("[MUTATION-KILLER] backup file permissions sentinel BACKUP_FILE_PERMS", () => {
    expect(medium.command).toContain("BACKUP_FILE_PERMS:%a:%U:%G");
  });

  it("[MUTATION-KILLER] BACKUP_SCRIPT_PERMS_OK / BACKUP_SCRIPT_PERMS_WRITABLE", () => {
    expect(medium.command).toContain("BACKUP_SCRIPT_PERMS_OK");
    expect(medium.command).toContain("BACKUP_SCRIPT_PERMS_WRITABLE");
  });

  it("[MUTATION-KILLER] BACKUP_TOOL_INSTALLED / BACKUP_TOOL_NOT_INSTALLED", () => {
    expect(medium.command).toContain("BACKUP_TOOL_INSTALLED");
    expect(medium.command).toContain("BACKUP_TOOL_NOT_INSTALLED");
  });

  it("[MUTATION-KILLER] backup tool search rsync/borg/restic", () => {
    expect(medium.command).toContain("for t in rsync borg restic");
  });

  it("[MUTATION-KILLER] BACKUP_CRON_JOB_FOUND / BACKUP_CRON_JOB_NOT_FOUND", () => {
    expect(medium.command).toContain("BACKUP_CRON_JOB_FOUND");
    expect(medium.command).toContain("BACKUP_CRON_JOB_NOT_FOUND");
  });

  it("[MUTATION-KILLER] VAR_BACKUPS_EXISTS / VAR_BACKUPS_MISSING", () => {
    expect(medium.command).toContain("VAR_BACKUPS_EXISTS");
    expect(medium.command).toContain("VAR_BACKUPS_MISSING");
  });

  it("[MUTATION-KILLER] encrypted backup file search .enc/.gpg", () => {
    expect(medium.command).toContain("find /var/backups /root/.kastell/backups -maxdepth 2");
  });

  it("[MUTATION-KILLER] NO_BACKUP_TOOLS sentinel", () => {
    expect(medium.command).toContain("which rsync borg restic 2>/dev/null || echo 'NO_BACKUP_TOOLS'");
  });
});

describe("[MUTATION-KILLER] resourceLimitsSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] CGROUPS_V2_ACTIVE / CGROUPS_V2_ABSENT", () => {
    expect(medium.command).toContain("CGROUPS_V2_ACTIVE");
    expect(medium.command).toContain("CGROUPS_V2_ABSENT");
  });

  it("[MUTATION-KILLER] cgroup.controllers file check", () => {
    expect(medium.command).toContain("[ -f /sys/fs/cgroup/cgroup.controllers ]");
  });

  it("[MUTATION-KILLER] NPROC_SOFT sentinel", () => {
    expect(medium.command).toContain("NPROC_SOFT:");
  });

  it("[MUTATION-KILLER] NPROC_HARD sentinel", () => {
    expect(medium.command).toContain("NPROC_HARD:");
  });

  it("[MUTATION-KILLER] THREADS_MAX sentinel", () => {
    expect(medium.command).toContain("THREADS_MAX:");
  });

  it("[MUTATION-KILLER] kernel.threads-max sysctl", () => {
    expect(medium.command).toContain("sysctl -n kernel.threads-max 2>/dev/null");
  });

  it("[MUTATION-KILLER] LIMITS_CONF_NPROC_SET / LIMITS_CONF_NPROC_NOT_SET", () => {
    expect(medium.command).toContain("LIMITS_CONF_NPROC_SET");
    expect(medium.command).toContain("LIMITS_CONF_NPROC_NOT_SET");
  });

  it("[MUTATION-KILLER] LIMITS_CONF_MAXLOGINS_SET / LIMITS_CONF_MAXLOGINS_NOT_SET", () => {
    expect(medium.command).toContain("LIMITS_CONF_MAXLOGINS_SET");
    expect(medium.command).toContain("LIMITS_CONF_MAXLOGINS_NOT_SET");
  });

  it("[MUTATION-KILLER] limits.conf non-comment lines", () => {
    expect(medium.command).toContain("cat /etc/security/limits.conf 2>/dev/null | grep -vE '^#|^$'");
  });

  it("[MUTATION-KILLER] nproc in limits.conf", () => {
    expect(medium.command).toContain("grep -E 'nproc' /etc/security/limits.conf /etc/security/limits.d/*.conf");
  });
});

describe("[MUTATION-KILLER] incidentReadySection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] AUDITD_INSTALLED / AUDITD_NOT_INSTALLED", () => {
    expect(medium.command).toContain("AUDITD_INSTALLED");
    expect(medium.command).toContain("AUDITD_NOT_INSTALLED");
  });

  it("[MUTATION-KILLER] AUDITD_RUNNING / AUDITD_NOT_RUNNING", () => {
    expect(medium.command).toContain("AUDITD_RUNNING");
    expect(medium.command).toContain("AUDITD_NOT_RUNNING");
  });

  it("[MUTATION-KILLER] AUDITCTL_RULES / AUDITCTL_UNAVAIL sentinels", () => {
    expect(medium.command).toContain("AUDITCTL_RULES:");
    expect(medium.command).toContain("AUDITCTL_UNAVAIL");
  });

  it("[MUTATION-KILLER] LOG_FORWARDING_ACTIVE / LOG_FORWARDING_INACTIVE", () => {
    expect(medium.command).toContain("LOG_FORWARDING_ACTIVE:");
    expect(medium.command).toContain("LOG_FORWARDING_INACTIVE");
  });

  it("[MUTATION-KILLER] log forwarding services check", () => {
    expect(medium.command).toContain("for s in rsyslog vector fluent-bit promtail");
  });

  it("[MUTATION-KILLER] LAST_AVAILABLE / LAST_NOT_AVAILABLE", () => {
    expect(medium.command).toContain("LAST_AVAILABLE");
    expect(medium.command).toContain("LAST_NOT_AVAILABLE");
  });

  it("[MUTATION-KILLER] LASTB_AVAILABLE / LASTB_NOT_AVAILABLE", () => {
    expect(medium.command).toContain("LASTB_AVAILABLE");
    expect(medium.command).toContain("LASTB_NOT_AVAILABLE");
  });

  it("[MUTATION-KILLER] WTMP_ROTATION_CONFIGURED / WTMP_ROTATION_NOT_CONFIGURED", () => {
    expect(medium.command).toContain("WTMP_ROTATION_CONFIGURED");
    expect(medium.command).toContain("WTMP_ROTATION_NOT_CONFIGURED");
  });

  it("[MUTATION-KILLER] wtmp/btmp existence check", () => {
    expect(medium.command).toContain("ls -la /var/log/wtmp /var/log/btmp 2>/dev/null");
  });

  it("[MUTATION-KILLER] forensic tools check", () => {
    expect(medium.command).toContain("which volatility3 volatility dc3dd 2>/dev/null");
  });

  it("[MUTATION-KILLER] log archive count", () => {
    expect(medium.command).toContain("find /var/log -name '*.gz' -mtime -30 2>/dev/null | wc -l");
  });
});

describe("[MUTATION-KILLER] dnsSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] DNSSEC_ENABLED / DNSSEC_DISABLED", () => {
    expect(medium.command).toContain("DNSSEC_ENABLED");
    expect(medium.command).toContain("DNSSEC_DISABLED");
  });

  it("[MUTATION-KILLER] resolvectl status for DNSSEC", () => {
    expect(medium.command).toContain("resolvectl status 2>/dev/null");
  });

  it("[MUTATION-KILLER] DOH_DOT_TOOL_INSTALLED / DOH_DOT_TOOL_NOT_INSTALLED", () => {
    expect(medium.command).toContain("DOH_DOT_TOOL_INSTALLED");
    expect(medium.command).toContain("DOH_DOT_TOOL_NOT_INSTALLED");
  });

  it("[MUTATION-KILLER] stubby/dnscrypt-proxy search", () => {
    expect(medium.command).toContain("for t in stubby dnscrypt-proxy");
  });

  it("[MUTATION-KILLER] RESOLV_CONF_IMMUTABLE / RESOLV_CONF_MUTABLE", () => {
    expect(medium.command).toContain("RESOLV_CONF_IMMUTABLE");
    expect(medium.command).toContain("RESOLV_CONF_MUTABLE");
  });

  it("[MUTATION-KILLER] NAMESERVER_CONFIGURED / NAMESERVER_NOT_CONFIGURED", () => {
    expect(medium.command).toContain("NAMESERVER_CONFIGURED:");
    expect(medium.command).toContain("NAMESERVER_NOT_CONFIGURED");
  });

  it("[MUTATION-KILLER] nameserver count in resolv.conf", () => {
    expect(medium.command).toContain("grep -c 'nameserver' /etc/resolv.conf");
  });

  it("[MUTATION-KILLER] resolv.conf cat", () => {
    expect(medium.command).toContain("cat /etc/resolv.conf 2>/dev/null || echo 'N/A'");
  });

  it("[MUTATION-KILLER] systemd-resolved active check", () => {
    expect(medium.command).toContain("systemctl is-active systemd-resolved 2>/dev/null || echo 'inactive'");
  });

  it("[MUTATION-KILLER] search domain check", () => {
    expect(medium.command).toContain("grep -E 'search\\s+' /etc/resolv.conf 2>/dev/null || echo 'NONE'");
  });
});

describe("[MUTATION-KILLER] tlsSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] TLSHARDENING section separator", () => {
    expect(fast.command).toContain("echo '---SECTION:TLSHARDENING---'");
  });

  it("[MUTATION-KILLER] nginx installed check", () => {
    expect(fast.command).toContain("command -v nginx >/dev/null 2>&1 || echo 'NGINX_NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] nginx -T cache", () => {
    expect(fast.command).toContain("_NGX=$(nginx -T 2>/dev/null || true)");
  });

  it("[MUTATION-KILLER] ssl_protocols grep", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'ssl_protocols'");
  });

  it("[MUTATION-KILLER] ssl_ciphers grep", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'ssl_ciphers'");
  });

  it("[MUTATION-KILLER] HSTS header grep", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'Strict-Transport-Security'");
  });

  it("[MUTATION-KILLER] ssl_stapling grep", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'ssl_stapling[^_]'");
  });

  it("[MUTATION-KILLER] CERT_VALID_30DAYS / CERT_EXPIRING_SOON / CERT_NOT_FOUND", () => {
    expect(fast.command).toContain("CERT_NOT_FOUND");
    expect(fast.command).toContain("CERT_VALID_30DAYS");
    expect(fast.command).toContain("CERT_EXPIRING_SOON");
  });

  it("[MUTATION-KILLER] DH param check with NO_DH_PARAM sentinel", () => {
    expect(fast.command).toContain("NO_DH_PARAM");
  });

  it("[MUTATION-KILLER] ssl_compression check", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'ssl_compression'");
  });

  it("[MUTATION-KILLER] SSL_COMPRESSION_NOT_SET sentinel", () => {
    expect(fast.command).toContain("SSL_COMPRESSION_NOT_SET");
  });

  it("[MUTATION-KILLER] cert verify with openssl verify", () => {
    expect(fast.command).toContain("openssl verify -CApath /etc/ssl/certs");
  });

  it("[MUTATION-KILLER] CERT_VERIFY_NOT_POSSIBLE sentinel", () => {
    expect(fast.command).toContain("CERT_VERIFY_NOT_POSSIBLE");
  });
});

describe("[MUTATION-KILLER] httpHeadersSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] HTTPHEADERS section separator", () => {
    expect(fast.command).toContain("echo '---SECTION:HTTPHEADERS---'");
  });

  it("[MUTATION-KILLER] nginx check for httpHeaders", () => {
    expect(fast.command).toContain("command -v nginx >/dev/null 2>&1 || echo 'NGINX_NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] curl -skI https://localhost", () => {
    expect(fast.command).toContain("curl -skI --max-time 5 https://localhost 2>/dev/null");
  });

  it("[MUTATION-KILLER] curl http://localhost fallback", () => {
    expect(fast.command).toContain("curl -sI --max-time 5 http://localhost 2>/dev/null");
  });

  it("[MUTATION-KILLER] HTTP_NOT_RESPONDING sentinel", () => {
    expect(fast.command).toContain("HTTP_NOT_RESPONDING");
  });
});

describe("[MUTATION-KILLER] nginxSection — all command strings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] NGINX section separator", () => {
    expect(fast.command).toContain("echo '---SECTION:NGINX---'");
  });

  it("[MUTATION-KILLER] caddy/traefik alternative RP detection", () => {
    expect(fast.command).toContain("ALT_RP:caddy");
    expect(fast.command).toContain("ALT_RP:traefik");
  });

  it("[MUTATION-KILLER] server_tokens check", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'server_tokens'");
  });

  it("[MUTATION-KILLER] limit_req_zone/limit_req check", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'limit_req_zone|limit_req[[:space:]]'");
  });

  it("[MUTATION-KILLER] gzip check", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'gzip'");
  });

  it("[MUTATION-KILLER] client_max_body_size check", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'client_max_body_size'");
  });

  it("[MUTATION-KILLER] proxy_hide_header Server check", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'more_clear_headers|proxy_hide_header[[:space:]]+Server'");
  });

  it("[MUTATION-KILLER] access_log check", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'access_log'");
  });

  it("[MUTATION-KILLER] error_log check", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'error_log'");
  });

  it("[MUTATION-KILLER] WAF modsecurity/coraza detection", () => {
    expect(fast.command).toContain("echo \"$_NGX\" | grep -iE 'modsecurity[[:space:]]+on|modsecurityenabled|coraza'");
  });

  it("[MUTATION-KILLER] NO_WAF sentinel", () => {
    expect(fast.command).toContain("|| echo 'NO_WAF'");
  });
});

describe("[MUTATION-KILLER] ddosSection — all command strings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] DDOS section separator", () => {
    expect(medium.command).toContain("echo '---SECTION:DDOS---'");
  });

  it("[MUTATION-KILLER] DDoS sysctl parameters", () => {
    expect(medium.command).toContain("sysctl net.ipv4.tcp_max_syn_backlog net.ipv4.tcp_synack_retries net.ipv4.tcp_fin_timeout net.ipv4.tcp_tw_reuse net.ipv4.icmp_ratelimit net.ipv4.icmp_ignore_bogus_error_responses net.core.somaxconn net.ipv4.tcp_syn_retries");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION-KILLER: All section separators exhaustive check
// ═══════════════════════════════════════════════════════════════════════════════

describe("[MUTATION-KILLER] ALL section separators — complete list", () => {
  const batches = buildAuditBatchCommands({ platform: "bare" });
  const allCommands = batches.map(b => b.command).join("\n");

  const expectedSections = [
    "SSH", "FIREWALL", "UPDATES", "AUTH", "ACCOUNTS", "BOOT", "SCHEDULING",
    "BANNERS", "TLSHARDENING", "HTTPHEADERS", "NGINX",
    "DOCKER", "NETWORK", "LOGGING", "KERNEL", "SERVICES", "TIME", "MAC",
    "MEMORY", "CLOUDMETA", "BACKUP", "RESOURCELIMITS", "INCIDENTREADY", "DNS", "DDOS",
    "FILESYSTEM", "CRYPTO", "FILEINTEGRITY", "MALWARE", "SECRETS", "SUPPLYCHAIN",
  ];

  for (const section of expectedSections) {
    it(`[MUTATION-KILLER] contains ---SECTION:${section}--- separator`, () => {
      expect(allCommands).toContain(`---SECTION:${section}---`);
    });
  }

  it("[MUTATION-KILLER] total section count matches expected", () => {
    const sectionCount = (allCommands.match(/---SECTION:\w+---/g) || []).length;
    expect(sectionCount).toBe(expectedSections.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION-KILLER WAVE 2: Deep string-level assertions targeting survived mutations
// Each assertion kills a specific StringLiteral that partial toContain may miss
// ═══════════════════════════════════════════════════════════════════════════════

describe("[MUTATION-KILLER] NAMED_SEP template — exact echo format", () => {
  const batches = buildAuditBatchCommands({ platform: "bare" });
  const all = batches.map((b) => b.command).join("\n");

  // Each NAMED_SEP call produces: echo '---SECTION:NAME---'
  // Stryker can mutate the template prefix/suffix
  it("[MUTATION-KILLER] separators use echo with single quotes", () => {
    expect(all).toContain("echo '---SECTION:");
  });

  it("[MUTATION-KILLER] separator prefix is exactly ---SECTION:", () => {
    // Ensure prefix is not mutated to empty
    const matches = all.match(/echo '---SECTION:(\w+)---'/g) || [];
    expect(matches.length).toBe(31); // 31 sections
    for (const m of matches) {
      expect(m).toMatch(/^echo '---SECTION:\w+---'$/);
    }
  });

  it("[MUTATION-KILLER] separator suffix is exactly ---'", () => {
    // Every section separator ends with ---'
    const count = (all.match(/---SECTION:\w+---'/g) || []).length;
    expect(count).toBe(31);
  });
});

describe("[MUTATION-KILLER] BATCH_TIMEOUTS — exact keys and values", () => {
  it("[MUTATION-KILLER] fast key exists with value 30000", () => {
    expect(BATCH_TIMEOUTS["fast"]).toBe(30_000);
  });

  it("[MUTATION-KILLER] medium key exists with value 60000", () => {
    expect(BATCH_TIMEOUTS["medium"]).toBe(60_000);
  });

  it("[MUTATION-KILLER] slow key exists with value 120000", () => {
    expect(BATCH_TIMEOUTS["slow"]).toBe(120_000);
  });

  it("[MUTATION-KILLER] has exactly 4 keys", () => {
    expect(Object.keys(BATCH_TIMEOUTS)).toHaveLength(4);
  });

  it("[MUTATION-KILLER] plugin key exists with default value 60000", () => {
    expect(BATCH_TIMEOUTS["plugin"]).toBe(60_000);
  });

  it("[MUTATION-KILLER] fast is not equal to medium or slow", () => {
    expect(BATCH_TIMEOUTS.fast).not.toBe(BATCH_TIMEOUTS.medium);
    expect(BATCH_TIMEOUTS.fast).not.toBe(BATCH_TIMEOUTS.slow);
  });

  it("[MUTATION-KILLER] medium is not equal to slow", () => {
    expect(BATCH_TIMEOUTS.medium).not.toBe(BATCH_TIMEOUTS.slow);
  });
});

describe("[MUTATION-KILLER] sshSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] sshd -T grep has -iE flag", () => {
    expect(fast.command).toContain("sshd -T 2>/dev/null | grep -iE");
  });

  it("[MUTATION-KILLER] SSH section contains 'permitemptypasswords' keyword", () => {
    expect(fast.command).toContain("permitemptypasswords");
  });

  it("[MUTATION-KILLER] SSH section contains 'pubkeyauthentication' keyword", () => {
    expect(fast.command).toContain("pubkeyauthentication");
  });

  it("[MUTATION-KILLER] SSH section contains 'protocol' keyword in sshd -T check", () => {
    expect(fast.command).toContain("protocol|maxauthtries");
  });

  it("[MUTATION-KILLER] SSH section contains 'x11forwarding' keyword", () => {
    expect(fast.command).toContain("x11forwarding");
  });

  it("[MUTATION-KILLER] SSH section contains 'logingracetime' keyword", () => {
    expect(fast.command).toContain("logingracetime");
  });

  it("[MUTATION-KILLER] SSH section contains 'maxsessions' keyword", () => {
    expect(fast.command).toContain("maxsessions");
  });

  it("[MUTATION-KILLER] SSH section contains 'allowusers' keyword", () => {
    expect(fast.command).toContain("allowusers");
  });

  it("[MUTATION-KILLER] SSH section contains 'allowgroups' keyword", () => {
    expect(fast.command).toContain("allowgroups");
  });

  it("[MUTATION-KILLER] SSH section contains 'denyusers' keyword", () => {
    expect(fast.command).toContain("denyusers");
  });

  it("[MUTATION-KILLER] SSH section contains 'denygroups' keyword", () => {
    expect(fast.command).toContain("denygroups");
  });

  it("[MUTATION-KILLER] SSH section contains 'ignorerhosts' keyword", () => {
    expect(fast.command).toContain("ignorerhosts");
  });

  it("[MUTATION-KILLER] SSH section contains 'usedns' keyword", () => {
    expect(fast.command).toContain("usedns");
  });

  it("[MUTATION-KILLER] SSH section contains 'permituserenvironment' keyword", () => {
    expect(fast.command).toContain("permituserenvironment");
  });

  it("[MUTATION-KILLER] SSH section contains 'loglevel' keyword", () => {
    expect(fast.command).toContain("loglevel");
  });

  it("[MUTATION-KILLER] SSH section contains 'banner' keyword in hostbased line", () => {
    expect(fast.command).toContain("loglevel|banner");
  });

  it("[MUTATION-KILLER] SSH section contains 'strictmodes' keyword", () => {
    expect(fast.command).toContain("strictmodes");
  });

  it("[MUTATION-KILLER] SSH section contains 'printmotd' keyword", () => {
    expect(fast.command).toContain("printmotd");
  });
});

describe("[MUTATION-KILLER] firewallSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] checks iptables -L -n", () => {
    expect(fast.command).toContain("iptables -L -n 2>/dev/null");
  });

  it("[MUTATION-KILLER] nft list ruleset piped to head -20", () => {
    expect(fast.command).toContain("nft list ruleset 2>/dev/null | head -20");
  });

  it("[MUTATION-KILLER] ip6tables -L INPUT -n", () => {
    expect(fast.command).toContain("ip6tables -L INPUT -n 2>/dev/null | wc -l || echo '0'");
  });

  it("[MUTATION-KILLER] /proc/sys/net/netfilter/nf_conntrack_max path", () => {
    expect(fast.command).toContain("/proc/sys/net/netfilter/nf_conntrack_max");
  });

  it("[MUTATION-KILLER] FORWARD chain check", () => {
    expect(fast.command).toContain("iptables -L FORWARD -n");
  });
});

describe("[MUTATION-KILLER] updatesSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] apt list --upgradable path", () => {
    expect(fast.command).toContain("command -v apt >/dev/null 2>&1 && apt list --upgradable");
  });

  it("[MUTATION-KILLER] dpkg -l unattended-upgrades", () => {
    expect(fast.command).toContain("dpkg -l unattended-upgrades");
  });

  it("[MUTATION-KILLER] /var/lib/apt/lists/ path", () => {
    expect(fast.command).toContain("/var/lib/apt/lists/");
  });

  it("[MUTATION-KILLER] /var/run/reboot-required path", () => {
    expect(fast.command).toContain("/var/run/reboot-required");
  });

  it("[MUTATION-KILLER] /var/log/dpkg.log path", () => {
    expect(fast.command).toContain("/var/log/dpkg.log");
  });

  it("[MUTATION-KILLER] linux-image-* pattern", () => {
    expect(fast.command).toContain("linux-image-*");
  });

  it("[MUTATION-KILLER] 20auto-upgrades config path", () => {
    expect(fast.command).toContain("/etc/apt/apt.conf.d/20auto-upgrades");
  });

  it("[MUTATION-KILLER] /etc/apt/sources.list path", () => {
    expect(fast.command).toContain("/etc/apt/sources.list");
  });

  it("[MUTATION-KILLER] /etc/apt/sources.list.d/ path", () => {
    expect(fast.command).toContain("/etc/apt/sources.list.d/");
  });

  it("[MUTATION-KILLER] NO_REBOOT sentinel", () => {
    expect(fast.command).toContain("NO_REBOOT");
  });
});

describe("[MUTATION-KILLER] authSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] /etc/pam.d/common-auth path", () => {
    expect(fast.command).toContain("/etc/pam.d/common-auth");
  });

  it("[MUTATION-KILLER] /etc/login.defs path", () => {
    expect(fast.command).toContain("/etc/login.defs");
  });

  it("[MUTATION-KILLER] /etc/shadow path in stat", () => {
    expect(fast.command).toContain("stat -c '%a' /etc/shadow");
  });

  it("[MUTATION-KILLER] /etc/sudoers path", () => {
    expect(fast.command).toContain("/etc/sudoers");
  });

  it("[MUTATION-KILLER] /etc/sudoers.d/* path", () => {
    expect(fast.command).toContain("/etc/sudoers.d/*");
  });

  it("[MUTATION-KILLER] /etc/passwd path in awk", () => {
    expect(fast.command).toContain("awk -F: '($3 == 0) {print $1}' /etc/passwd");
  });

  it("[MUTATION-KILLER] /etc/pam.d/system-auth path", () => {
    expect(fast.command).toContain("/etc/pam.d/system-auth");
  });

  it("[MUTATION-KILLER] libpam-google-authenticator package", () => {
    expect(fast.command).toContain("libpam-google-authenticator");
  });

  it("[MUTATION-KILLER] libpam-oath package", () => {
    expect(fast.command).toContain("libpam-oath");
  });

  it("[MUTATION-KILLER] /etc/default/useradd path", () => {
    expect(fast.command).toContain("/etc/default/useradd");
  });

  it("[MUTATION-KILLER] /etc/pam.d/su path", () => {
    expect(fast.command).toContain("/etc/pam.d/su");
  });

  it("[MUTATION-KILLER] /etc/gshadow path", () => {
    expect(fast.command).toContain("/etc/gshadow");
  });

  it("[MUTATION-KILLER] /etc/security/pwquality.conf path", () => {
    expect(fast.command).toContain("/etc/security/pwquality.conf");
  });

  it("[MUTATION-KILLER] minlen|dcredit|ucredit|lcredit|ocredit keywords", () => {
    expect(fast.command).toContain("minlen|dcredit|ucredit|lcredit|ocredit");
  });

  it("[MUTATION-KILLER] NONE fallback in auth section", () => {
    expect(fast.command).toContain("|| echo 'NONE'");
  });
});

describe("[MUTATION-KILLER] dockerSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] docker ps -q pipe to head -5 and xargs inspect", () => {
    expect(medium.command).toContain("docker ps -q 2>/dev/null | head -5 | xargs -r docker inspect");
  });

  it("[MUTATION-KILLER] docker.sock path /var/run/docker.sock", () => {
    expect(medium.command).toContain("/var/run/docker.sock");
  });

  it("[MUTATION-KILLER] DOCKER_CONTENT_TRUST env variable name", () => {
    expect(medium.command).toContain("DOCKER_CONTENT_TRUST");
  });

  it("[MUTATION-KILLER] docker network ls command", () => {
    expect(medium.command).toContain("docker network ls");
  });

  it("[MUTATION-KILLER] docker volume ls command", () => {
    expect(medium.command).toContain("docker volume ls");
  });

  it("[MUTATION-KILLER] docker network inspect bridge", () => {
    expect(medium.command).toContain("docker network inspect bridge");
  });

  it("[MUTATION-KILLER] NO_CERTS_DIR sentinel", () => {
    expect(medium.command).toContain("NO_CERTS_DIR");
  });

  it("[MUTATION-KILLER] /etc/docker/certs.d/ path", () => {
    expect(medium.command).toContain("/etc/docker/certs.d/");
  });

  it("[MUTATION-KILLER] RegistryConfig.InsecureRegistryCIDRs format", () => {
    expect(medium.command).toContain("RegistryConfig.InsecureRegistryCIDRs");
  });

  it("[MUTATION-KILLER] Swarm.LocalNodeState format", () => {
    expect(medium.command).toContain("Swarm.LocalNodeState");
  });

  it("[MUTATION-KILLER] ExperimentalBuild format", () => {
    expect(medium.command).toContain("ExperimentalBuild");
  });

  it("[MUTATION-KILLER] Plugins.Authorization format", () => {
    expect(medium.command).toContain("Plugins.Authorization");
  });

  it("[MUTATION-KILLER] SecurityOpt format", () => {
    expect(medium.command).toContain("SecurityOpt");
  });

  it("[MUTATION-KILLER] ReadonlyRootfs format", () => {
    expect(medium.command).toContain("ReadonlyRootfs");
  });

  it("[MUTATION-KILLER] HostConfig.Privileged format", () => {
    expect(medium.command).toContain("HostConfig.Privileged");
  });

  it("[MUTATION-KILLER] Config.User format", () => {
    expect(medium.command).toContain("Config.User");
  });

  it("[MUTATION-KILLER] HostConfig.SecurityOpt format", () => {
    expect(medium.command).toContain("HostConfig.SecurityOpt");
  });

  it("[MUTATION-KILLER] HostConfig.ReadonlyRootfs format", () => {
    expect(medium.command).toContain("HostConfig.ReadonlyRootfs");
  });
});

describe("[MUTATION-KILLER] networkSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] /etc/resolv.conf path", () => {
    expect(medium.command).toContain("/etc/resolv.conf");
  });

  it("[MUTATION-KILLER] NO_HOSTS_ALLOW sentinel", () => {
    expect(medium.command).toContain("NO_HOSTS_ALLOW");
  });

  it("[MUTATION-KILLER] NO_HOSTS_DENY sentinel", () => {
    expect(medium.command).toContain("NO_HOSTS_DENY");
  });

  it("[MUTATION-KILLER] /etc/hosts.allow path", () => {
    expect(medium.command).toContain("/etc/hosts.allow");
  });

  it("[MUTATION-KILLER] /etc/hosts.deny path", () => {
    expect(medium.command).toContain("/etc/hosts.deny");
  });

  it("[MUTATION-KILLER] net.ipv4.ip_forward sysctl key", () => {
    expect(medium.command).toContain("net.ipv4.ip_forward");
  });

  it("[MUTATION-KILLER] net.ipv6.conf.all.disable_ipv6 sysctl key", () => {
    expect(medium.command).toContain("net.ipv6.conf.all.disable_ipv6");
  });

  it("[MUTATION-KILLER] net.ipv4.conf.all.send_redirects sysctl key", () => {
    expect(medium.command).toContain("net.ipv4.conf.all.send_redirects");
  });

  it("[MUTATION-KILLER] net.ipv4.conf.all.secure_redirects sysctl key", () => {
    expect(medium.command).toContain("net.ipv4.conf.all.secure_redirects");
  });

  it("[MUTATION-KILLER] net.ipv6.conf.all.accept_source_route sysctl key", () => {
    expect(medium.command).toContain("net.ipv6.conf.all.accept_source_route");
  });

  it("[MUTATION-KILLER] net.ipv4.conf.all.rp_filter sysctl key", () => {
    expect(medium.command).toContain("net.ipv4.conf.all.rp_filter");
  });

  it("[MUTATION-KILLER] :8080 port pattern", () => {
    expect(medium.command).toContain(":8080 ");
  });

  it("[MUTATION-KILLER] :8443 port pattern", () => {
    expect(medium.command).toContain(":8443 ");
  });

  it("[MUTATION-KILLER] :9000 port pattern", () => {
    expect(medium.command).toContain(":9000 ");
  });

  it("[MUTATION-KILLER] :3000 port pattern", () => {
    expect(medium.command).toContain(":3000 ");
  });

  it("[MUTATION-KILLER] :25 mail port", () => {
    expect(medium.command).toContain(":25 ");
  });

  it("[MUTATION-KILLER] :110 POP3 port", () => {
    expect(medium.command).toContain(":110 ");
  });

  it("[MUTATION-KILLER] :143 IMAP port", () => {
    expect(medium.command).toContain(":143 ");
  });

  it("[MUTATION-KILLER] PROMISC keyword", () => {
    expect(medium.command).toContain("PROMISC");
  });

  it("[MUTATION-KILLER] net.ipv4.conf.all.arp_announce sysctl key", () => {
    expect(medium.command).toContain("net.ipv4.conf.all.arp_announce");
  });

  it("[MUTATION-KILLER] net.ipv4.conf.all.arp_ignore sysctl key", () => {
    expect(medium.command).toContain("net.ipv4.conf.all.arp_ignore");
  });

  it("[MUTATION-KILLER] 0.0.0.0 bind address", () => {
    expect(medium.command).toContain("0.0.0.0");
  });

  it("[MUTATION-KILLER] EMPTY sentinel for hosts.allow", () => {
    expect(medium.command).toContain("|| echo 'EMPTY'");
  });
});

describe("[MUTATION-KILLER] loggingSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] /etc/logrotate.conf path", () => {
    expect(medium.command).toContain("/etc/logrotate.conf");
  });

  it("[MUTATION-KILLER] /var/log/auth.log path", () => {
    expect(medium.command).toContain("/var/log/auth.log");
  });

  it("[MUTATION-KILLER] /var/log/secure path", () => {
    expect(medium.command).toContain("/var/log/secure");
  });

  it("[MUTATION-KILLER] EXISTS sentinel for auth log", () => {
    expect(medium.command).toContain("echo 'EXISTS'");
  });

  it("[MUTATION-KILLER] MISSING sentinel for auth log", () => {
    expect(medium.command).toContain("echo 'MISSING'");
  });

  it("[MUTATION-KILLER] NO_RULES sentinel for auditctl", () => {
    expect(medium.command).toContain("echo 'NO_RULES'");
  });

  it("[MUTATION-KILLER] inactive sentinel for auditd", () => {
    expect(medium.command).toContain("echo 'inactive'");
  });

  it("[MUTATION-KILLER] /var/log path for stat", () => {
    expect(medium.command).toContain("stat -c '%a' /var/log");
  });

  it("[MUTATION-KILLER] /etc/systemd/journald.conf path", () => {
    expect(medium.command).toContain("/etc/systemd/journald.conf");
  });

  it("[MUTATION-KILLER] Storage keyword in journald grep", () => {
    expect(medium.command).toContain("'^Storage'");
  });

  it("[MUTATION-KILLER] vector tool", () => {
    expect(medium.command).toContain("vector");
  });

  it("[MUTATION-KILLER] promtail tool", () => {
    expect(medium.command).toContain("promtail");
  });

  it("[MUTATION-KILLER] fluent-bit tool", () => {
    expect(medium.command).toContain("fluent-bit");
  });

  it("[MUTATION-KILLER] /etc/rsyslog.conf path", () => {
    expect(medium.command).toContain("/etc/rsyslog.conf");
  });

  it("[MUTATION-KILLER] /etc/rsyslog.d/*.conf path", () => {
    expect(medium.command).toContain("/etc/rsyslog.d/*.conf");
  });

  it("[MUTATION-KILLER] logrotate.timer service", () => {
    expect(medium.command).toContain("logrotate.timer");
  });

  it("[MUTATION-KILLER] /etc/cron.daily/logrotate path", () => {
    expect(medium.command).toContain("/etc/cron.daily/logrotate");
  });

  it("[MUTATION-KILLER] watch keyword in auditctl grep", () => {
    expect(medium.command).toContain("grep -c 'watch'");
  });

  it("[MUTATION-KILLER] /etc/audit/auditd.conf path", () => {
    expect(medium.command).toContain("/etc/audit/auditd.conf");
  });

  it("[MUTATION-KILLER] max_log_file_action keyword", () => {
    expect(medium.command).toContain("max_log_file_action");
  });

  it("[MUTATION-KILLER] space_left_action keyword", () => {
    expect(medium.command).toContain("space_left_action");
  });
});

describe("[MUTATION-KILLER] kernelSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] core_uses_pid sysctl key", () => {
    expect(medium.command).toContain("core_uses_pid");
  });

  it("[MUTATION-KILLER] /sys/kernel/security/lsm path", () => {
    expect(medium.command).toContain("/sys/kernel/security/lsm");
  });

  it("[MUTATION-KILLER] cramfs module name", () => {
    expect(medium.command).toContain("cramfs");
  });

  it("[MUTATION-KILLER] freevxfs module name", () => {
    expect(medium.command).toContain("freevxfs");
  });

  it("[MUTATION-KILLER] jffs2 module name", () => {
    expect(medium.command).toContain("jffs2");
  });

  it("[MUTATION-KILLER] hfs module name", () => {
    expect(medium.command).toContain("hfs");
  });

  it("[MUTATION-KILLER] hfsplus module name", () => {
    expect(medium.command).toContain("hfsplus");
  });

  it("[MUTATION-KILLER] udf module name", () => {
    expect(medium.command).toContain("udf");
  });

  it("[MUTATION-KILLER] /etc/sysctl.d/*.conf path", () => {
    expect(medium.command).toContain("/etc/sysctl.d/*.conf");
  });

  it("[MUTATION-KILLER] /etc/systemd/coredump.conf path", () => {
    expect(medium.command).toContain("/etc/systemd/coredump.conf");
  });

  it("[MUTATION-KILLER] Storage|ProcessSizeMax grep pattern", () => {
    expect(medium.command).toContain("Storage|ProcessSizeMax");
  });

  it("[MUTATION-KILLER] /sys/kernel/security/lockdown path", () => {
    expect(medium.command).toContain("/sys/kernel/security/lockdown");
  });
});

describe("[MUTATION-KILLER] accountsSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] /etc/passwd path", () => {
    expect(fast.command).toContain("/etc/passwd");
  });

  it("[MUTATION-KILLER] /etc/shadow path", () => {
    expect(fast.command).toContain("/etc/shadow");
  });

  it("[MUTATION-KILLER] /root/.rhosts path", () => {
    expect(fast.command).toContain("/root/.rhosts");
  });

  it("[MUTATION-KILLER] /root/.netrc path", () => {
    expect(fast.command).toContain("/root/.netrc");
  });

  it("[MUTATION-KILLER] /root/.forward path", () => {
    expect(fast.command).toContain("/root/.forward");
  });

  it("[MUTATION-KILLER] /etc/hosts.equiv path", () => {
    expect(fast.command).toContain("/etc/hosts.equiv");
  });

  it("[MUTATION-KILLER] /etc/group path", () => {
    expect(fast.command).toContain("/etc/group");
  });

  it("[MUTATION-KILLER] lastlog -b 90 command", () => {
    expect(fast.command).toContain("lastlog -b 90");
  });

  it("[MUTATION-KILLER] UID_MAX keyword", () => {
    expect(fast.command).toContain("UID_MAX");
  });

  it("[MUTATION-KILLER] UID_MIN keyword", () => {
    expect(fast.command).toContain("UID_MIN");
  });

  it("[MUTATION-KILLER] GID_MAX keyword", () => {
    expect(fast.command).toContain("GID_MAX");
  });

  it("[MUTATION-KILLER] GID_MIN keyword", () => {
    expect(fast.command).toContain("GID_MIN");
  });
});

describe("[MUTATION-KILLER] servicesSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] telnet service name", () => {
    expect(medium.command).toContain("telnet");
  });

  it("[MUTATION-KILLER] rsh service name", () => {
    expect(medium.command).toContain("rsh");
  });

  it("[MUTATION-KILLER] rlogin service name", () => {
    expect(medium.command).toContain("rlogin");
  });

  it("[MUTATION-KILLER] vsftpd service name", () => {
    expect(medium.command).toContain("vsftpd");
  });

  it("[MUTATION-KILLER] tftpd-hpa service name", () => {
    expect(medium.command).toContain("tftpd-hpa");
  });

  it("[MUTATION-KILLER] nfs-server service name", () => {
    expect(medium.command).toContain("nfs-server");
  });

  it("[MUTATION-KILLER] rpcbind service name", () => {
    expect(medium.command).toContain("rpcbind");
  });

  it("[MUTATION-KILLER] smbd service name", () => {
    expect(medium.command).toContain("smbd");
  });

  it("[MUTATION-KILLER] nmbd service name", () => {
    expect(medium.command).toContain("nmbd");
  });

  it("[MUTATION-KILLER] avahi-daemon service name", () => {
    expect(medium.command).toContain("avahi-daemon");
  });

  it("[MUTATION-KILLER] cups service name", () => {
    expect(medium.command).toContain("cups");
  });

  it("[MUTATION-KILLER] isc-dhcp-server service name", () => {
    expect(medium.command).toContain("isc-dhcp-server");
  });

  it("[MUTATION-KILLER] named service name", () => {
    expect(medium.command).toContain("named");
  });

  it("[MUTATION-KILLER] snmpd service name", () => {
    expect(medium.command).toContain("snmpd");
  });

  it("[MUTATION-KILLER] squid service name", () => {
    expect(medium.command).toContain("squid");
  });

  it("[MUTATION-KILLER] xinetd service name in is-active", () => {
    expect(medium.command).toContain("xinetd ypserv");
  });

  it("[MUTATION-KILLER] ypserv service name", () => {
    expect(medium.command).toContain("ypserv");
  });

  it("[MUTATION-KILLER] /etc/inetd.conf path", () => {
    expect(medium.command).toContain("/etc/inetd.conf");
  });

  it("[MUTATION-KILLER] /etc/xinetd.conf path", () => {
    expect(medium.command).toContain("/etc/xinetd.conf");
  });

  it("[MUTATION-KILLER] --type=service flag", () => {
    expect(medium.command).toContain("--type=service");
  });

  it("[MUTATION-KILLER] --state=running flag", () => {
    expect(medium.command).toContain("--state=running");
  });

  it("[MUTATION-KILLER] --no-pager flag", () => {
    expect(medium.command).toContain("--no-pager");
  });

  it("[MUTATION-KILLER] 0.0.0.0: wildcard listener grep", () => {
    expect(medium.command).toContain("0.0.0.0:");
  });

  it("[MUTATION-KILLER] */systemd/* path pattern in find", () => {
    expect(medium.command).toContain("*/systemd/*");
  });
});

describe("[MUTATION-KILLER] bootSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] /boot/grub/grub.cfg path", () => {
    expect(fast.command).toContain("/boot/grub/grub.cfg");
  });

  it("[MUTATION-KILLER] /boot/grub2/grub.cfg path", () => {
    expect(fast.command).toContain("/boot/grub2/grub.cfg");
  });

  it("[MUTATION-KILLER] set superusers grep", () => {
    expect(fast.command).toContain("set superusers");
  });

  it("[MUTATION-KILLER] mokutil --sb-state command", () => {
    expect(fast.command).toContain("mokutil --sb-state");
  });

  it("[MUTATION-KILLER] /proc/cmdline path", () => {
    expect(fast.command).toContain("/proc/cmdline");
  });

  it("[MUTATION-KILLER] /etc/grub.d path", () => {
    expect(fast.command).toContain("/etc/grub.d");
  });

  it("[MUTATION-KILLER] /proc/mounts path", () => {
    expect(fast.command).toContain("/proc/mounts");
  });

  it("[MUTATION-KILLER] rescue.service path", () => {
    expect(fast.command).toContain("rescue.service");
  });

  it("[MUTATION-KILLER] emergency.service path", () => {
    expect(fast.command).toContain("emergency.service");
  });

  it("[MUTATION-KILLER] sulogin keyword", () => {
    expect(fast.command).toContain("sulogin");
  });

  it("[MUTATION-KILLER] kernel.modules_disabled sysctl key", () => {
    expect(fast.command).toContain("kernel.modules_disabled");
  });

  it("[MUTATION-KILLER] /sys/firmware/efi path", () => {
    expect(fast.command).toContain("/sys/firmware/efi");
  });

  it("[MUTATION-KILLER] UEFI sentinel", () => {
    expect(fast.command).toContain("echo 'UEFI'");
  });

  it("[MUTATION-KILLER] BIOS sentinel", () => {
    expect(fast.command).toContain("echo 'BIOS'");
  });

  it("[MUTATION-KILLER] password_pbkdf2 keyword", () => {
    expect(fast.command).toContain("password_pbkdf2");
  });
});

describe("[MUTATION-KILLER] schedulingSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] /etc/cron.allow path", () => {
    expect(fast.command).toContain("/etc/cron.allow");
  });

  it("[MUTATION-KILLER] /etc/cron.deny path", () => {
    expect(fast.command).toContain("/etc/cron.deny");
  });

  it("[MUTATION-KILLER] /etc/at.allow path", () => {
    expect(fast.command).toContain("/etc/at.allow");
  });

  it("[MUTATION-KILLER] /etc/at.deny path", () => {
    expect(fast.command).toContain("/etc/at.deny");
  });

  it("[MUTATION-KILLER] /etc/cron.d directory", () => {
    expect(fast.command).toContain("/etc/cron.d");
  });

  it("[MUTATION-KILLER] /etc/cron.daily directory", () => {
    expect(fast.command).toContain("/etc/cron.daily");
  });

  it("[MUTATION-KILLER] /etc/cron.weekly directory", () => {
    expect(fast.command).toContain("/etc/cron.weekly");
  });

  it("[MUTATION-KILLER] /etc/cron.monthly directory", () => {
    expect(fast.command).toContain("/etc/cron.monthly");
  });

  it("[MUTATION-KILLER] /etc/cron.hourly directory", () => {
    expect(fast.command).toContain("/etc/cron.hourly");
  });

  it("[MUTATION-KILLER] /etc/crontab path", () => {
    expect(fast.command).toContain("/etc/crontab");
  });

  it("[MUTATION-KILLER] /var/spool/cron/crontabs/ path", () => {
    expect(fast.command).toContain("/var/spool/cron/crontabs/");
  });

  it("[MUTATION-KILLER] EXISTS sentinel for cron.allow", () => {
    expect(fast.command).toContain("cron.allow EXISTS");
  });

  it("[MUTATION-KILLER] MISSING sentinel for cron.allow", () => {
    expect(fast.command).toContain("cron.allow MISSING");
  });

  it("[MUTATION-KILLER] EXISTS sentinel for cron.deny", () => {
    expect(fast.command).toContain("cron.deny EXISTS");
  });

  it("[MUTATION-KILLER] MISSING sentinel for cron.deny", () => {
    expect(fast.command).toContain("cron.deny MISSING");
  });

  it("[MUTATION-KILLER] EXISTS sentinel for at.allow", () => {
    expect(fast.command).toContain("at.allow EXISTS");
  });

  it("[MUTATION-KILLER] MISSING sentinel for at.allow", () => {
    expect(fast.command).toContain("at.allow MISSING");
  });

  it("[MUTATION-KILLER] EXISTS sentinel for at.deny", () => {
    expect(fast.command).toContain("at.deny EXISTS");
  });

  it("[MUTATION-KILLER] MISSING sentinel for at.deny", () => {
    expect(fast.command).toContain("at.deny MISSING");
  });
});

describe("[MUTATION-KILLER] timeSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] ntp service name", () => {
    expect(medium.command).toContain("ntp");
  });

  it("[MUTATION-KILLER] chrony service name", () => {
    expect(medium.command).toContain("chrony");
  });

  it("[MUTATION-KILLER] chronyd service name", () => {
    expect(medium.command).toContain("chronyd");
  });

  it("[MUTATION-KILLER] systemd-timesyncd service name", () => {
    expect(medium.command).toContain("systemd-timesyncd");
  });

  it("[MUTATION-KILLER] /etc/timezone path", () => {
    expect(medium.command).toContain("/etc/timezone");
  });

  it("[MUTATION-KILLER] NTPSynchronized keyword", () => {
    expect(medium.command).toContain("NTPSynchronized");
  });

  it("[MUTATION-KILLER] Timezone keyword in timedatectl show", () => {
    expect(medium.command).toContain("NTPSynchronized|Timezone");
  });

  it("[MUTATION-KILLER] ntpq -p command", () => {
    expect(medium.command).toContain("ntpq -p");
  });
});

describe("[MUTATION-KILLER] bannersSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] /etc/issue path", () => {
    expect(fast.command).toContain("/etc/issue");
  });

  it("[MUTATION-KILLER] /etc/issue.net path", () => {
    expect(fast.command).toContain("/etc/issue.net");
  });

  it("[MUTATION-KILLER] /etc/motd path", () => {
    expect(fast.command).toContain("/etc/motd");
  });

  it("[MUTATION-KILLER] MISSING fallback for banners", () => {
    expect(fast.command).toContain("|| echo 'MISSING'");
  });
});

describe("[MUTATION-KILLER] memorySection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] vm.overcommit_memory sysctl key", () => {
    expect(medium.command).toContain("vm.overcommit_memory");
  });

  it("[MUTATION-KILLER] vm.overcommit_ratio sysctl key", () => {
    expect(medium.command).toContain("vm.overcommit_ratio");
  });

  it("[MUTATION-KILLER] vm.oom_kill_allocating_task sysctl key", () => {
    expect(medium.command).toContain("vm.oom_kill_allocating_task");
  });

  it("[MUTATION-KILLER] /sys/kernel/mm/transparent_hugepage/enabled path", () => {
    expect(medium.command).toContain("/sys/kernel/mm/transparent_hugepage/enabled");
  });

  it("[MUTATION-KILLER] Z zombie process pattern", () => {
    expect(medium.command).toContain("' Z '");
  });

  it("[MUTATION-KILLER] /proc/sys/kernel/pid_max path", () => {
    expect(medium.command).toContain("/proc/sys/kernel/pid_max");
  });

  it("[MUTATION-KILLER] fs.suid_dumpable sysctl key", () => {
    expect(medium.command).toContain("fs.suid_dumpable");
  });

  it("[MUTATION-KILLER] /proc/sys/vm/swappiness path", () => {
    expect(medium.command).toContain("/proc/sys/vm/swappiness");
  });

  it("[MUTATION-KILLER] swapon --show=NAME,TYPE command", () => {
    expect(medium.command).toContain("swapon --show=NAME,TYPE");
  });

  it("[MUTATION-KILLER] NO_SWAP sentinel", () => {
    expect(medium.command).toContain("NO_SWAP");
  });

  it("[MUTATION-KILLER] /proc/sys/vm/max_map_count path", () => {
    expect(medium.command).toContain("/proc/sys/vm/max_map_count");
  });
});

describe("[MUTATION-KILLER] cryptoSection — granular substrings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] hostkeyalgorithms keyword", () => {
    expect(slow.command).toContain("hostkeyalgorithms");
  });

  it("[MUTATION-KILLER] ssh_host_*_key pattern", () => {
    expect(slow.command).toContain("ssh_host_*_key");
  });

  it("[MUTATION-KILLER] crypto_luks keyword", () => {
    expect(slow.command).toContain("crypto_luks");
  });

  it("[MUTATION-KILLER] /etc/ssl/openssl.cnf path", () => {
    expect(slow.command).toContain("/etc/ssl/openssl.cnf");
  });

  it("[MUTATION-KILLER] MinProtocol keyword", () => {
    expect(slow.command).toContain("MinProtocol");
  });

  it("[MUTATION-KILLER] CipherString keyword", () => {
    expect(slow.command).toContain("CipherString");
  });

  it("[MUTATION-KILLER] :443 port", () => {
    expect(slow.command).toContain(":443");
  });

  it("[MUTATION-KILLER] :8443 port in crypto", () => {
    expect(slow.command).toContain(":8443");
  });

  it("[MUTATION-KILLER] NO_TLS_PORTS sentinel", () => {
    expect(slow.command).toContain("NO_TLS_PORTS");
  });

  it("[MUTATION-KILLER] openssl x509 -noout -enddate command", () => {
    expect(slow.command).toContain("openssl x509 -noout -enddate");
  });

  it("[MUTATION-KILLER] ALL:eNULL cipher string", () => {
    expect(slow.command).toContain("ALL:eNULL");
  });

  it("[MUTATION-KILLER] /etc/ssl/certs/ path", () => {
    expect(slow.command).toContain("/etc/ssl/certs/");
  });

  it("[MUTATION-KILLER] /etc/ssl/dhparams.pem path", () => {
    expect(slow.command).toContain("/etc/ssl/dhparams.pem");
  });

  it("[MUTATION-KILLER] NO_DH_PARAMS sentinel", () => {
    expect(slow.command).toContain("NO_DH_PARAMS");
  });

  it("[MUTATION-KILLER] /etc/ssl/ and /etc/pki/ paths in key search", () => {
    expect(slow.command).toContain("/etc/ssl/");
    expect(slow.command).toContain("/etc/pki/");
  });

  it("[MUTATION-KILLER] /etc/nginx/ path", () => {
    expect(slow.command).toContain("/etc/nginx/");
  });

  it("[MUTATION-KILLER] NO_NGINX sentinel", () => {
    expect(slow.command).toContain("NO_NGINX");
  });
});

describe("[MUTATION-KILLER] filesystemSection — granular substrings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] /etc and /usr paths", () => {
    expect(slow.command).toContain("find /etc /usr");
  });

  it("[MUTATION-KILLER] /usr/bin and /usr/sbin paths", () => {
    expect(slow.command).toContain("find /usr/bin /usr/sbin");
  });

  it("[MUTATION-KILLER] -perm -4000 SUID flag", () => {
    expect(slow.command).toContain("-perm -4000");
  });

  it("[MUTATION-KILLER] -perm -o+w world-writable flag", () => {
    expect(slow.command).toContain("-perm -o+w");
  });

  it("[MUTATION-KILLER] /tmp path in stat", () => {
    expect(slow.command).toContain("stat -c '%a %U %G' /tmp");
  });

  it("[MUTATION-KILLER] findmnt -o TARGET,OPTIONS --raw command", () => {
    expect(slow.command).toContain("findmnt -o TARGET,OPTIONS --raw");
  });

  it("[MUTATION-KILLER] /dev/shm path", () => {
    expect(slow.command).toContain("/dev/shm");
  });

  it("[MUTATION-KILLER] umask command", () => {
    expect(slow.command).toContain("umask 2>/dev/null");
  });

  it("[MUTATION-KILLER] /var/tmp path", () => {
    expect(slow.command).toContain("/var/tmp");
  });

  it("[MUTATION-KILLER] findmnt /var path", () => {
    expect(slow.command).toContain("findmnt -o TARGET,OPTIONS /var");
  });

  it("[MUTATION-KILLER] find / -xdev command", () => {
    expect(slow.command).toContain("find / -xdev -type f -perm -4000");
  });
});

describe("[MUTATION-KILLER] secretsSection — granular substrings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] /root/.ssh/id_rsa path", () => {
    expect(slow.command).toContain("/root/.ssh/id_rsa");
  });

  it("[MUTATION-KILLER] /root/.ssh/id_ed25519 path", () => {
    expect(slow.command).toContain("/root/.ssh/id_ed25519");
  });

  it("[MUTATION-KILLER] /root/.ssh/id_ecdsa path", () => {
    expect(slow.command).toContain("/root/.ssh/id_ecdsa");
  });

  it("[MUTATION-KILLER] NO_KEYS sentinel", () => {
    expect(slow.command).toContain("NO_KEYS");
  });

  it("[MUTATION-KILLER] url.*token git config pattern", () => {
    expect(slow.command).toContain("url.*token");
  });

  it("[MUTATION-KILLER] /home /opt /srv /var/www paths in docker env search", () => {
    expect(slow.command).toContain("/home /opt /srv /var/www");
  });

  it("[MUTATION-KILLER] docker.env pattern", () => {
    expect(slow.command).toContain("docker.env");
  });

  it("[MUTATION-KILLER] _authToken pattern in npmrc", () => {
    expect(slow.command).toContain("_authToken");
  });

  it("[MUTATION-KILLER] .pem and .key file patterns in key search", () => {
    expect(slow.command).toContain("*.pem");
    expect(slow.command).toContain("*.key");
  });

  it("[MUTATION-KILLER] id_rsa and id_ed25519 and id_ecdsa names in key search", () => {
    expect(slow.command).toContain("id_rsa");
    expect(slow.command).toContain("id_ed25519");
    expect(slow.command).toContain("id_ecdsa");
  });

  it("[MUTATION-KILLER] .aws credential dir pattern", () => {
    expect(slow.command).toContain(".aws");
  });

  it("[MUTATION-KILLER] credentials file in .aws path", () => {
    expect(slow.command).toContain("credentials");
  });

  it("[MUTATION-KILLER] .kube dir pattern", () => {
    expect(slow.command).toContain(".kube");
  });

  it("[MUTATION-KILLER] .bash_history file", () => {
    expect(slow.command).toContain(".bash_history");
  });

  it("[MUTATION-KILLER] allowagentforwarding keyword in secrets", () => {
    expect(slow.command).toContain("allowagentforwarding");
  });

  it("[MUTATION-KILLER] API_KEY env var", () => {
    expect(slow.command).toContain("API_KEY");
  });

  it("[MUTATION-KILLER] SECRET_KEY env var", () => {
    expect(slow.command).toContain("SECRET_KEY");
  });

  it("[MUTATION-KILLER] TOKEN env var", () => {
    expect(slow.command).toContain("TOKEN");
  });

  it("[MUTATION-KILLER] PASSWORD env var", () => {
    expect(slow.command).toContain("PASSWORD");
  });

  it("[MUTATION-KILLER] AWS_ACCESS_KEY env var", () => {
    expect(slow.command).toContain("AWS_ACCESS_KEY");
  });

  it("[MUTATION-KILLER] .bashrc file", () => {
    expect(slow.command).toContain(".bashrc");
  });

  it("[MUTATION-KILLER] .profile file", () => {
    expect(slow.command).toContain(".profile");
  });
});

describe("[MUTATION-KILLER] cloudMetaSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] dmidecode -s system-product-name command", () => {
    expect(medium.command).toContain("dmidecode -s system-product-name");
  });

  it("[MUTATION-KILLER] 169.254.169.254 metadata IP", () => {
    expect(medium.command).toContain("169.254.169.254");
  });

  it("[MUTATION-KILLER] metadata.google.internal host", () => {
    expect(medium.command).toContain("metadata.google.internal");
  });

  it("[MUTATION-KILLER] Metadata-Flavor: Google header", () => {
    expect(medium.command).toContain("Metadata-Flavor: Google");
  });

  it("[MUTATION-KILLER] VPS_TYPE: sentinel prefix", () => {
    expect(medium.command).toContain("VPS_TYPE:");
  });

  it("[MUTATION-KILLER] /var/log/cloud-init.log path", () => {
    expect(medium.command).toContain("/var/log/cloud-init.log");
  });

  it("[MUTATION-KILLER] user-data.txt path", () => {
    expect(medium.command).toContain("user-data.txt");
  });

  it("[MUTATION-KILLER] /var/lib/cloud/instances/ path", () => {
    expect(medium.command).toContain("/var/lib/cloud/instances/");
  });

  it("[MUTATION-KILLER] DB_PASSWORD keyword", () => {
    expect(medium.command).toContain("DB_PASSWORD");
  });

  it("[MUTATION-KILLER] API_KEY in cloud-init", () => {
    expect(medium.command).toContain("API_KEY");
  });

  it("[MUTATION-KILLER] SECRET_KEY in cloud-init", () => {
    expect(medium.command).toContain("SECRET_KEY");
  });

  it("[MUTATION-KILLER] AWS_SECRET keyword", () => {
    expect(medium.command).toContain("AWS_SECRET");
  });

  it("[MUTATION-KILLER] PRIVATE_KEY keyword", () => {
    expect(medium.command).toContain("PRIVATE_KEY");
  });

  it("[MUTATION-KILLER] 21600 TTL in IMDSv2 header", () => {
    expect(medium.command).toContain("21600");
  });
});

describe("[MUTATION-KILLER] supplyChainSection — granular substrings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] http:// protocol in apt policy", () => {
    expect(slow.command).toContain("http://");
  });

  it("[MUTATION-KILLER] /etc/apt/trusted.gpg.d/ path", () => {
    expect(slow.command).toContain("/etc/apt/trusted.gpg.d/");
  });

  it("[MUTATION-KILLER] AllowUnauthenticated keyword", () => {
    expect(slow.command).toContain("AllowUnauthenticated");
  });

  it("[MUTATION-KILLER] AllowInsecureRepositories keyword", () => {
    expect(slow.command).toContain("AllowInsecureRepositories");
  });

  it("[MUTATION-KILLER] dpkg --verify command", () => {
    expect(slow.command).toContain("dpkg --verify");
  });

  it("[MUTATION-KILLER] debsums tool name", () => {
    expect(slow.command).toContain("debsums");
  });

  it("[MUTATION-KILLER] NOT_INSTALLED sentinel for debsums", () => {
    expect(slow.command).toContain("which debsums 2>/dev/null || echo 'NOT_INSTALLED'");
  });
});

describe("[MUTATION-KILLER] backupSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] /root/.kastell/backups/ path", () => {
    expect(medium.command).toContain("/root/.kastell/backups/");
  });

  it("[MUTATION-KILLER] /var/backups path", () => {
    expect(medium.command).toContain("/var/backups");
  });

  it("[MUTATION-KILLER] rsync tool in backup", () => {
    expect(medium.command).toContain("rsync");
  });

  it("[MUTATION-KILLER] borg tool in backup", () => {
    expect(medium.command).toContain("borg");
  });

  it("[MUTATION-KILLER] restic tool in backup", () => {
    expect(medium.command).toContain("restic");
  });

  it("[MUTATION-KILLER] .enc extension", () => {
    expect(medium.command).toContain("*.enc");
  });

  it("[MUTATION-KILLER] .gpg extension", () => {
    expect(medium.command).toContain("*.gpg");
  });

  it("[MUTATION-KILLER] BACKUP_FILE_PERMS sentinel", () => {
    expect(medium.command).toContain("BACKUP_FILE_PERMS");
  });

  it("[MUTATION-KILLER] backup cron job search pattern tar.*backup", () => {
    expect(medium.command).toContain("tar.*backup");
  });

  it("[MUTATION-KILLER] -mtime -30 recent file filter", () => {
    expect(medium.command).toContain("-mtime -30");
  });
});

describe("[MUTATION-KILLER] resourceLimitsSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] /sys/fs/cgroup/cgroup.controllers path", () => {
    expect(medium.command).toContain("/sys/fs/cgroup/cgroup.controllers");
  });

  it("[MUTATION-KILLER] ulimit -Su soft nproc", () => {
    expect(medium.command).toContain("ulimit -Su");
  });

  it("[MUTATION-KILLER] ulimit -Hu hard nproc", () => {
    expect(medium.command).toContain("ulimit -Hu");
  });

  it("[MUTATION-KILLER] kernel.threads-max sysctl key", () => {
    expect(medium.command).toContain("kernel.threads-max");
  });

  it("[MUTATION-KILLER] THREADS_MAX_NOT_FOUND sentinel", () => {
    expect(medium.command).toContain("THREADS_MAX_NOT_FOUND");
  });

  it("[MUTATION-KILLER] NOT_SET sentinel for nproc hard", () => {
    expect(medium.command).toContain("NOT_SET");
  });

  it("[MUTATION-KILLER] unlimited sentinel for nproc soft", () => {
    expect(medium.command).toContain("unlimited");
  });

  it("[MUTATION-KILLER] /etc/security/limits.conf path", () => {
    expect(medium.command).toContain("/etc/security/limits.conf");
  });

  it("[MUTATION-KILLER] /etc/security/limits.d/*.conf path", () => {
    expect(medium.command).toContain("/etc/security/limits.d/*.conf");
  });

  it("[MUTATION-KILLER] nproc keyword in limits grep", () => {
    expect(medium.command).toContain("nproc");
  });

  it("[MUTATION-KILLER] maxlogins keyword", () => {
    expect(medium.command).toContain("maxlogins");
  });
});

describe("[MUTATION-KILLER] incidentReadySection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] dpkg -l auditd check", () => {
    expect(medium.command).toContain("dpkg -l auditd");
  });

  it("[MUTATION-KILLER] ^active$ pattern for auditd", () => {
    expect(medium.command).toContain("'^active$'");
  });

  it("[MUTATION-KILLER] auditctl -l command", () => {
    expect(medium.command).toContain("auditctl -l");
  });

  it("[MUTATION-KILLER] rsyslog in log forwarding services", () => {
    expect(medium.command).toContain("rsyslog");
  });

  it("[MUTATION-KILLER] last -1 command", () => {
    expect(medium.command).toContain("last -1");
  });

  it("[MUTATION-KILLER] lastb -1 command", () => {
    expect(medium.command).toContain("lastb -1");
  });

  it("[MUTATION-KILLER] wtmp in logrotate grep", () => {
    expect(medium.command).toContain("wtmp");
  });

  it("[MUTATION-KILLER] /var/log/wtmp path", () => {
    expect(medium.command).toContain("/var/log/wtmp");
  });

  it("[MUTATION-KILLER] /var/log/btmp path", () => {
    expect(medium.command).toContain("/var/log/btmp");
  });

  it("[MUTATION-KILLER] volatility3 tool", () => {
    expect(medium.command).toContain("volatility3");
  });

  it("[MUTATION-KILLER] volatility tool", () => {
    expect(medium.command).toContain("volatility");
  });

  it("[MUTATION-KILLER] dc3dd tool", () => {
    expect(medium.command).toContain("dc3dd");
  });

  it("[MUTATION-KILLER] *.gz compressed log pattern", () => {
    expect(medium.command).toContain("*.gz");
  });

  it("[MUTATION-KILLER] /etc/logrotate.d/ path in wtmp check", () => {
    expect(medium.command).toContain("/etc/logrotate.d/");
  });
});

describe("[MUTATION-KILLER] dnsSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] resolvectl status command", () => {
    expect(medium.command).toContain("resolvectl status");
  });

  it("[MUTATION-KILLER] DNSSEC keyword in grep", () => {
    expect(medium.command).toContain("DNSSEC");
  });

  it("[MUTATION-KILLER] stubby tool", () => {
    expect(medium.command).toContain("stubby");
  });

  it("[MUTATION-KILLER] dnscrypt-proxy tool", () => {
    expect(medium.command).toContain("dnscrypt-proxy");
  });

  it("[MUTATION-KILLER] lsattr command for resolv.conf", () => {
    expect(medium.command).toContain("lsattr /etc/resolv.conf");
  });

  it("[MUTATION-KILLER] readlink command for resolv.conf", () => {
    expect(medium.command).toContain("readlink /etc/resolv.conf");
  });

  it("[MUTATION-KILLER] systemd in readlink check", () => {
    expect(medium.command).toContain("systemd");
  });

  it("[MUTATION-KILLER] nameserver keyword in grep", () => {
    expect(medium.command).toContain("nameserver");
  });

  it("[MUTATION-KILLER] systemd-resolved service", () => {
    expect(medium.command).toContain("systemd-resolved");
  });

  it("[MUTATION-KILLER] search domain grep pattern", () => {
    expect(medium.command).toContain("search");
  });
});

describe("[MUTATION-KILLER] tlsSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] NGINX_NOT_INSTALLED sentinel", () => {
    expect(fast.command).toContain("NGINX_NOT_INSTALLED");
  });

  it("[MUTATION-KILLER] nginx -T command", () => {
    expect(fast.command).toContain("nginx -T");
  });

  it("[MUTATION-KILLER] ssl_protocols keyword", () => {
    expect(fast.command).toContain("ssl_protocols");
  });

  it("[MUTATION-KILLER] ssl_ciphers keyword", () => {
    expect(fast.command).toContain("ssl_ciphers");
  });

  it("[MUTATION-KILLER] Strict-Transport-Security header", () => {
    expect(fast.command).toContain("Strict-Transport-Security");
  });

  it("[MUTATION-KILLER] ssl_stapling keyword", () => {
    expect(fast.command).toContain("ssl_stapling");
  });

  it("[MUTATION-KILLER] ssl_certificate keyword", () => {
    expect(fast.command).toContain("ssl_certificate");
  });

  it("[MUTATION-KILLER] ssl_dhparam keyword", () => {
    expect(fast.command).toContain("ssl_dhparam");
  });

  it("[MUTATION-KILLER] ssl_compression keyword", () => {
    expect(fast.command).toContain("ssl_compression");
  });

  it("[MUTATION-KILLER] openssl verify command", () => {
    expect(fast.command).toContain("openssl verify");
  });

  it("[MUTATION-KILLER] /etc/ssl/certs path in verify", () => {
    expect(fast.command).toContain("/etc/ssl/certs");
  });

  it("[MUTATION-KILLER] 2592000 seconds (30 days) in checkend", () => {
    expect(fast.command).toContain("2592000");
  });
});

describe("[MUTATION-KILLER] httpHeadersSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] https://localhost URL", () => {
    expect(fast.command).toContain("https://localhost");
  });

  it("[MUTATION-KILLER] http://localhost URL", () => {
    expect(fast.command).toContain("http://localhost");
  });

  it("[MUTATION-KILLER] --max-time 5 flag", () => {
    expect(fast.command).toContain("--max-time 5");
  });

  it("[MUTATION-KILLER] -skI curl flags", () => {
    expect(fast.command).toContain("-skI");
  });

  it("[MUTATION-KILLER] -sI curl flags", () => {
    expect(fast.command).toContain("-sI");
  });
});

describe("[MUTATION-KILLER] nginxSection — granular substrings", () => {
  const fast = buildAuditBatchCommands({ platform: "bare" })[0];

  it("[MUTATION-KILLER] ALT_RP: sentinel prefix", () => {
    expect(fast.command).toContain("ALT_RP:");
  });

  it("[MUTATION-KILLER] caddy alternative proxy", () => {
    expect(fast.command).toContain("caddy");
  });

  it("[MUTATION-KILLER] traefik alternative proxy", () => {
    expect(fast.command).toContain("traefik");
  });

  it("[MUTATION-KILLER] server_tokens keyword", () => {
    expect(fast.command).toContain("server_tokens");
  });

  it("[MUTATION-KILLER] limit_req_zone keyword", () => {
    expect(fast.command).toContain("limit_req_zone");
  });

  it("[MUTATION-KILLER] limit_req keyword", () => {
    expect(fast.command).toContain("limit_req");
  });

  it("[MUTATION-KILLER] gzip keyword", () => {
    expect(fast.command).toContain("gzip");
  });

  it("[MUTATION-KILLER] client_max_body_size keyword", () => {
    expect(fast.command).toContain("client_max_body_size");
  });

  it("[MUTATION-KILLER] more_clear_headers keyword", () => {
    expect(fast.command).toContain("more_clear_headers");
  });

  it("[MUTATION-KILLER] proxy_hide_header keyword", () => {
    expect(fast.command).toContain("proxy_hide_header");
  });

  it("[MUTATION-KILLER] access_log keyword", () => {
    expect(fast.command).toContain("access_log");
  });

  it("[MUTATION-KILLER] error_log keyword", () => {
    expect(fast.command).toContain("error_log");
  });

  it("[MUTATION-KILLER] modsecurity keyword", () => {
    expect(fast.command).toContain("modsecurity");
  });

  it("[MUTATION-KILLER] modsecurityenabled keyword", () => {
    expect(fast.command).toContain("modsecurityenabled");
  });

  it("[MUTATION-KILLER] coraza keyword", () => {
    expect(fast.command).toContain("coraza");
  });

  it("[MUTATION-KILLER] NO_WAF sentinel", () => {
    expect(fast.command).toContain("NO_WAF");
  });
});

describe("[MUTATION-KILLER] ddosSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] net.ipv4.tcp_max_syn_backlog key", () => {
    expect(medium.command).toContain("net.ipv4.tcp_max_syn_backlog");
  });

  it("[MUTATION-KILLER] net.ipv4.tcp_synack_retries key", () => {
    expect(medium.command).toContain("net.ipv4.tcp_synack_retries");
  });

  it("[MUTATION-KILLER] net.ipv4.tcp_fin_timeout key", () => {
    expect(medium.command).toContain("net.ipv4.tcp_fin_timeout");
  });

  it("[MUTATION-KILLER] net.ipv4.tcp_tw_reuse key", () => {
    expect(medium.command).toContain("net.ipv4.tcp_tw_reuse");
  });

  it("[MUTATION-KILLER] net.ipv4.icmp_ratelimit key", () => {
    expect(medium.command).toContain("net.ipv4.icmp_ratelimit");
  });

  it("[MUTATION-KILLER] net.ipv4.icmp_ignore_bogus_error_responses key", () => {
    expect(medium.command).toContain("net.ipv4.icmp_ignore_bogus_error_responses");
  });

  it("[MUTATION-KILLER] net.core.somaxconn key", () => {
    expect(medium.command).toContain("net.core.somaxconn");
  });

  it("[MUTATION-KILLER] net.ipv4.tcp_syn_retries key", () => {
    expect(medium.command).toContain("net.ipv4.tcp_syn_retries");
  });
});

describe("[MUTATION-KILLER] macSection — granular substrings", () => {
  const medium = buildAuditBatchCommands({ platform: "bare" })[1];

  it("[MUTATION-KILLER] /etc/selinux/config path", () => {
    expect(medium.command).toContain("/etc/selinux/config");
  });

  it("[MUTATION-KILLER] SELINUX= keyword", () => {
    expect(medium.command).toContain("SELINUX=");
  });

  it("[MUTATION-KILLER] /proc/self/status path", () => {
    expect(medium.command).toContain("/proc/self/status");
  });

  it("[MUTATION-KILLER] Seccomp keyword", () => {
    expect(medium.command).toContain("Seccomp");
  });

  it("[MUTATION-KILLER] enforce mode keyword", () => {
    expect(medium.command).toContain("enforce mode");
  });

  it("[MUTATION-KILLER] /etc/apparmor.d/abstractions/base path", () => {
    expect(medium.command).toContain("/etc/apparmor.d/abstractions/base");
  });

  it("[MUTATION-KILLER] NOT_INSTALLED sentinel for getenforce", () => {
    expect(medium.command).toContain("|| echo 'NOT_INSTALLED'");
  });
});

describe("[MUTATION-KILLER] malwareSection — granular substrings", () => {
  const slow = buildAuditBatchCommands({ platform: "bare" })[2];

  it("[MUTATION-KILLER] chkrootkit package", () => {
    expect(slow.command).toContain("chkrootkit");
  });

  it("[MUTATION-KILLER] rkhunter package", () => {
    expect(slow.command).toContain("rkhunter");
  });

  it("[MUTATION-KILLER] /tmp path in find", () => {
    expect(slow.command).toContain("find /tmp");
  });

  it("[MUTATION-KILLER] /dev path in SUID check", () => {
    expect(slow.command).toContain("find /dev");
  });

  it("[MUTATION-KILLER] /root path in world-writable check", () => {
    expect(slow.command).toContain("find /root");
  });

  it("[MUTATION-KILLER] /var/log/rkhunter.log path", () => {
    expect(slow.command).toContain("/var/log/rkhunter.log");
  });

  it("[MUTATION-KILLER] system checks summary keyword", () => {
    expect(slow.command).toContain("system checks summary");
  });

  it("[MUTATION-KILLER] /dev/shm path in hidden files", () => {
    expect(slow.command).toContain("/dev/shm");
  });

  it("[MUTATION-KILLER] /var/tmp path in hidden files count", () => {
    expect(slow.command).toContain("/var/tmp");
  });

  it("[MUTATION-KILLER] NO_SCAN sentinel", () => {
    expect(slow.command).toContain("NO_SCAN");
  });

  it("[MUTATION-KILLER] NOT_INSTALLED sentinel for chkrootkit", () => {
    expect(slow.command).toContain("dpkg -l chkrootkit 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'");
  });

  it("[MUTATION-KILLER] ps aux for high CPU", () => {
    expect(slow.command).toContain("ps aux");
  });
});
