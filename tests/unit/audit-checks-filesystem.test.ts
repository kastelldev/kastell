import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseFilesystemChecks } from "../../src/core/audit/checks/filesystem.js";

describe("parseFilesystemChecks", () => {
  // Secure output includes data from all 11 filesystemSection() commands:
  // 1. World-writable files in /etc /usr (none)
  // 2. SUID binaries (typical safe set)
  // 3. /tmp permissions (sticky bit)
  // 4. Disk usage (low)
  // 5. findmnt output (with noexec/nosuid on all relevant mounts)
  // 6. /dev/shm stat
  // 7. umask
  // 8. home dir permissions (find output)
  // 9. /var/tmp stat
  // 10. /var mount options (FS-VAR-NOEXEC)
  // 11. system-wide SUID count (FS-SUID-SYSTEM-COUNT)
  const secureOutput = [
    // World-writable files (none)
    "N/A",
    // SUID binaries (typical safe set)
    "/usr/bin/passwd\n/usr/bin/sudo\n/usr/bin/chfn",
    // /tmp permissions
    "1777 root root",
    // Disk usage
    "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   20G   28G  42% /",
    // findmnt output with noexec/nosuid on relevant mounts (includes /var/log as separate mount)
    "/home rw,nosuid,noexec,relatime\n/var/tmp rw,nosuid,noexec,relatime\n/dev/shm rw,nosuid,noexec\n/tmp rw,nosuid,noexec,relatime\n/var/log rw,nosuid,noexec,relatime\n/media rw,nodev,relatime\n/boot rw,nosuid,noexec,relatime\n/var rw,nosuid,noexec,relatime",
    // /dev/shm stat
    "1777 root root",
    // umask
    "0022",
    // home dir permissions (750 = not world-readable)
    "750 /home/user1\n750 /home/user2",
    // /var/tmp stat
    "1777 root root",
    // system-wide SUID binary count (FS-SUID-SYSTEM-COUNT) — a small number <= 30
    "22",
  ].join("\n");

  const insecureOutput = [
    // World-writable files found
    "/etc/cron.d/something\n/etc/sensitive\n/usr/local/bin/app",
    // Many SUID binaries
    Array(15).fill("/usr/bin/something").join("\n"),
    // /tmp permissions (no sticky bit)
    "0777 root root",
    // Disk usage high
    "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   48G    1G  96% /",
    // findmnt output — no noexec/nosuid
    "/home rw,relatime\n/var/tmp rw,relatime\n/dev/shm rw\n/tmp rw,relatime",
    // /dev/shm stat
    "777 root root",
    // umask (permissive)
    "0000",
    // home dir permissions (755 = world-readable)
    "755 /home/user1\n755 /home/user2",
    // /var/tmp stat
    "1777 root root",
  ].join("\n");

  it("should return 20 checks", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    expect(checks).toHaveLength(20);
    checks.forEach((check) => {
      expect(check.category).toBe("Filesystem");
      expect(check.id).toMatch(/^FS-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return FS-TMP-STICKY-BIT passed when /tmp has sticky bit (1777)", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const fs01 = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT);
    expect(fs01!.passed).toBe(true);
  });

  it("should return FS-TMP-STICKY-BIT failed when /tmp has 0777 (no sticky bit)", () => {
    const checks = parseFilesystemChecks(insecureOutput, "bare");
    const fs01 = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT);
    expect(fs01!.passed).toBe(false);
  });

  it("should return FS-NO-WORLD-WRITABLE passed when no world-writable files", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const fs02 = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE);
    expect(fs02!.passed).toBe(true);
  });

  it("should return FS-NO-WORLD-WRITABLE failed when world-writable files exist", () => {
    const checks = parseFilesystemChecks(insecureOutput, "bare");
    const fs02 = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE);
    expect(fs02!.passed).toBe(false);
  });

  it("should return FS-HOME-NOEXEC passed when /home mount has noexec", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_NOEXEC);
    expect(check!.passed).toBe(true);
  });

  it("should return FS-HOME-NOEXEC failed when /home mount lacks noexec", () => {
    const checks = parseFilesystemChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_NOEXEC);
    expect(check!.passed).toBe(false);
  });

  it("should return FS-TMP-NOEXEC passed when /tmp mount has noexec", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_NOEXEC);
    expect(check!.passed).toBe(true);
  });

  it("should return FS-TMP-NOEXEC failed when /tmp mount lacks noexec", () => {
    const checks = parseFilesystemChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_NOEXEC);
    expect(check!.passed).toBe(false);
  });

  it("should return FS-UMASK-RESTRICTIVE passed with umask 0022", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE);
    expect(check!.passed).toBe(true);
  });

  it("should return FS-UMASK-RESTRICTIVE failed with permissive umask 0000", () => {
    const checks = parseFilesystemChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE);
    expect(check!.passed).toBe(false);
  });

  it("should return FS-HOME-PERMISSIONS passed when home dirs are mode 750", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
    expect(check!.passed).toBe(true);
  });

  it("should return FS-HOME-PERMISSIONS failed when home dirs are world-readable (755)", () => {
    const checks = parseFilesystemChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
    expect(check!.passed).toBe(false);
  });

  it("should return FS-NODEV-REMOVABLE passed when /media mount has nodev", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NODEV_REMOVABLE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should return FS-VAR-LOG-SEPARATE passed when /var/log is a separate mount", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_LOG_SEPARATE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should return FS-BOOT-NOSUID passed when /boot mount has nosuid", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_BOOT_NOSUID);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseFilesystemChecks("N/A", "bare");
    expect(checks).toHaveLength(20);
  });

  it("FS-VAR-NOEXEC passes when /var mount has noexec", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_NOEXEC);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("FS-VAR-NOEXEC fails when /var mount lacks noexec", () => {
    const output = secureOutput.replace("/var rw,nosuid,noexec,relatime", "/var rw,relatime");
    const checks = parseFilesystemChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_NOEXEC);
    expect(check!.passed).toBe(false);
  });

  it("FS-SUID-SYSTEM-COUNT passes when SUID count <= 30", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_SYSTEM_COUNT);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/22 SUID files/);
  });

  it("FS-SUID-SYSTEM-COUNT fails when SUID count > 30", () => {
    // Replace trailing 22 with 45 (22 is the last element in the joined array)
    const output = secureOutput.replace(/\b22$/, "45");
    const checks = parseFilesystemChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_SYSTEM_COUNT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/45 SUID files/);
  });

  describe("mutation-killer tests", () => {
    // --- FS-TMP-STICKY-BIT: regex ^([01]?\d{3})\s+([a-z_]\w*)\s+([a-z_]\w*)$ ---
    it("[FS-TMP-STICKY-BIT] passes with 1777 (4-digit, starts with 1)", () => {
      const output = "1777 root root\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Permissions: 1777");
    });

    it("[FS-TMP-STICKY-BIT] fails with 0777 (starts with 0, not 1)", () => {
      const output = "0777 root root\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Permissions: 0777");
    });

    it("[FS-TMP-STICKY-BIT] fails with 777 (3-digit, no leading 1)", () => {
      const output = "777 root root\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT);
      expect(check!.passed).toBe(false);
    });

    it("[FS-TMP-STICKY-BIT] currentValue says 'Unable to determine' when no stat line", () => {
      const output = "no stat output\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Unable to determine");
    });

    // --- FS-NO-WORLD-WRITABLE: world-writable file line classification ---
    it("[FS-NO-WORLD-WRITABLE] detects /etc/ path as world-writable", () => {
      const output = "/etc/some-file\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/1 world-writable/);
    });

    it("[FS-NO-WORLD-WRITABLE] detects /usr/local/ path (not /usr/bin/ or /usr/sbin/)", () => {
      const output = "/usr/local/bin/app\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE);
      expect(check!.passed).toBe(false);
    });

    it("[FS-NO-WORLD-WRITABLE] does not count /usr/bin/ paths as world-writable", () => {
      const output = "/usr/bin/something\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE);
      expect(check!.passed).toBe(true);
    });

    it("[FS-NO-WORLD-WRITABLE] does not count /usr/sbin/ paths as world-writable", () => {
      const output = "/usr/sbin/something\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE);
      expect(check!.passed).toBe(true);
    });

    it("[FS-NO-WORLD-WRITABLE] passes when only /var paths present (not /etc or /usr)", () => {
      const output = "/var/something\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE);
      expect(check!.passed).toBe(true);
    });

    it("[FS-NO-WORLD-WRITABLE] N/A forces false", () => {
      const checks = parseFilesystemChecks("N/A", "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE);
      expect(check!.passed).toBe(false);
    });

    // --- FS-SUID-THRESHOLD: suidCount <= 15 boundary ---
    it("[FS-SUID-THRESHOLD] passes with exactly 15 SUID binaries", () => {
      const suidLines = Array(15).fill("/usr/bin/suid").join("\n");
      const output = suidLines + "\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_THRESHOLD);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/15 SUID/);
    });

    it("[FS-SUID-THRESHOLD] fails with 16 SUID binaries", () => {
      const suidLines = Array(16).fill("/usr/bin/suid").join("\n");
      const output = suidLines + "\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_THRESHOLD);
      expect(check!.passed).toBe(false);
    });

    it("[FS-SUID-THRESHOLD] passes with 0 SUID binaries", () => {
      const output = "no suid here\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_THRESHOLD);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/0 SUID/);
    });

    it("[FS-SUID-THRESHOLD] skips /usr/bin/ lines containing N/A", () => {
      const output = "/usr/bin/test N/A\n/usr/bin/real\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_THRESHOLD);
      expect(check!.currentValue).toMatch(/1 SUID/);
    });

    it("[FS-SUID-THRESHOLD] counts /usr/sbin/ paths too", () => {
      const output = "/usr/sbin/something\n/usr/bin/other\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_THRESHOLD);
      expect(check!.currentValue).toMatch(/2 SUID/);
    });

    // --- FS-HOME-PERMISSIONS: world-readable threshold (otherDigit >= 4) ---
    it("[FS-HOME-PERMISSIONS] passes with perms 750 (other=0)", () => {
      const output = "750 /home/user1\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Home directories not world-readable");
    });

    it("[FS-HOME-PERMISSIONS] passes with perms 703 (other=3, not >= 4)", () => {
      const output = "703 /home/user1\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
      expect(check!.passed).toBe(true);
    });

    it("[FS-HOME-PERMISSIONS] fails with perms 754 (other=4)", () => {
      const output = "754 /home/user1\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/1 world-readable/);
    });

    it("[FS-HOME-PERMISSIONS] fails with perms 757 (other=7)", () => {
      const output = "757 /home/user1\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
      expect(check!.passed).toBe(false);
    });

    it("[FS-HOME-PERMISSIONS] fails when no home dir lines found", () => {
      const output = "42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No home directories found");
    });

    it("[FS-HOME-PERMISSIONS] passes when multiple homes all restricted", () => {
      const output = "700 /home/a\n750 /home/b\n710 /home/c\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
      expect(check!.passed).toBe(true);
    });

    // --- FS-DISK-USAGE: boundary at 90% ---
    it("[FS-DISK-USAGE] passes at 89%", () => {
      const output = "Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 50G 44G 6G 89% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_DISK_USAGE);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/89%/);
    });

    it("[FS-DISK-USAGE] fails at exactly 90%", () => {
      const output = "Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 50G 45G 5G 90% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_DISK_USAGE);
      expect(check!.passed).toBe(false);
    });

    it("[FS-DISK-USAGE] fails when disk usage not determinable", () => {
      const output = "no disk info";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_DISK_USAGE);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Unable to determine disk usage");
    });

    it("[FS-DISK-USAGE] passes at 1%", () => {
      const output = "/dev/sda1 50G 1G 49G 1% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_DISK_USAGE);
      expect(check!.passed).toBe(true);
    });

    // --- makeMountCheck / checkMountOption: mount detection ---
    it("[FS-HOME-NOSUID] passes when /home has nosuid", () => {
      const output = "/home rw,nosuid,relatime\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_NOSUID);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/nosuid set on \/home/);
    });

    it("[FS-HOME-NOSUID] fails when /home lacks nosuid", () => {
      const output = "/home rw,relatime\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_NOSUID);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/nosuid not set on \/home/);
    });

    it("[FS-VAR-TMP-NOEXEC] passes when /var/tmp has noexec", () => {
      const output = "/var/tmp rw,nosuid,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOEXEC);
      expect(check!.passed).toBe(true);
    });

    it("[FS-VAR-TMP-NOEXEC] fails when /var/tmp lacks noexec", () => {
      const output = "/var/tmp rw,nosuid\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOEXEC);
      expect(check!.passed).toBe(false);
    });

    it("[FS-VAR-TMP-NOSUID] passes when /var/tmp has nosuid", () => {
      const output = "/var/tmp rw,nosuid,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOSUID);
      expect(check!.passed).toBe(true);
    });

    it("[FS-VAR-TMP-NOSUID] fails when /var/tmp lacks nosuid", () => {
      const output = "/var/tmp rw,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOSUID);
      expect(check!.passed).toBe(false);
    });

    it("[FS-DEV-SHM-NOEXEC] passes when /dev/shm has noexec", () => {
      const output = "/dev/shm rw,nosuid,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_DEV_SHM_NOEXEC);
      expect(check!.passed).toBe(true);
    });

    it("[FS-DEV-SHM-NOEXEC] fails when /dev/shm lacks noexec", () => {
      const output = "/dev/shm rw,nosuid\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_DEV_SHM_NOEXEC);
      expect(check!.passed).toBe(false);
    });

    it("[FS-DEV-SHM-NOSUID] passes when /dev/shm has nosuid", () => {
      const output = "/dev/shm rw,nosuid,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_DEV_SHM_NOSUID);
      expect(check!.passed).toBe(true);
    });

    it("[FS-DEV-SHM-NOSUID] fails when /dev/shm lacks nosuid", () => {
      const output = "/dev/shm rw,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_DEV_SHM_NOSUID);
      expect(check!.passed).toBe(false);
    });

    it("[FS-TMP-NOSUID] passes when /tmp has nosuid", () => {
      const output = "/tmp rw,nosuid,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_NOSUID);
      expect(check!.passed).toBe(true);
    });

    it("[FS-TMP-NOSUID] fails when /tmp lacks nosuid", () => {
      const output = "/tmp rw,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_TMP_NOSUID);
      expect(check!.passed).toBe(false);
    });

    // --- checkMountOption: mount path not detected ---
    it("[FS-HOME-NOEXEC] currentValue shows 'not detected' when /home not in mount output", () => {
      const output = "42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_NOEXEC);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/not detected/);
    });

    // --- FS-UMASK-RESTRICTIVE: regex \b(0?0?27|0?0?22)\b ---
    it("[FS-UMASK-RESTRICTIVE] passes with 027", () => {
      const output = "027\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/umask 027/);
    });

    it("[FS-UMASK-RESTRICTIVE] passes with 22 (shorthand)", () => {
      const output = "22\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE);
      expect(check!.passed).toBe(true);
    });

    it("[FS-UMASK-RESTRICTIVE] passes with 0027", () => {
      const output = "0027\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE);
      expect(check!.passed).toBe(true);
    });

    it("[FS-UMASK-RESTRICTIVE] fails with 0077 (no match for 77)", () => {
      const output = "0077\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Non-restrictive umask detected");
    });

    // --- FS-NO-UNOWNED-FILES: worldWritableLines.length < 3 ---
    it("[FS-NO-UNOWNED-FILES] passes when 0 world-writable files", () => {
      const output = "42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_UNOWNED_FILES);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/No excessive/);
    });

    it("[FS-NO-UNOWNED-FILES] passes when exactly 2 world-writable files", () => {
      const output = "/etc/file1\n/etc/file2\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_UNOWNED_FILES);
      expect(check!.passed).toBe(true);
    });

    it("[FS-NO-UNOWNED-FILES] fails when 3 world-writable files", () => {
      const output = "/etc/file1\n/etc/file2\n/etc/file3\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NO_UNOWNED_FILES);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/3 world-writable/);
    });

    // --- FS-NODEV-REMOVABLE ---
    it("[FS-NODEV-REMOVABLE] fails when /media lacks nodev", () => {
      const output = "/media rw,relatime\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_NODEV_REMOVABLE);
      expect(check!.passed).toBe(false);
    });

    // --- FS-VAR-LOG-SEPARATE ---
    it("[FS-VAR-LOG-SEPARATE] passes when /var/log in mount output (not /var/log/subdir)", () => {
      const output = "something /var/log something\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_LOG_SEPARATE);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("/var/log is on a separate partition");
    });

    it("[FS-VAR-LOG-SEPARATE] fails when only /var/log/ subdir present", () => {
      const output = "/var/log/audit something\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_LOG_SEPARATE);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("/var/log is not on a separate partition");
    });

    it("[FS-VAR-LOG-SEPARATE] fails when no /var/log line", () => {
      const output = "42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_LOG_SEPARATE);
      expect(check!.passed).toBe(false);
    });

    // --- FS-BOOT-NOSUID ---
    it("[FS-BOOT-NOSUID] passes when /boot has nosuid", () => {
      const output = "/boot rw,nosuid,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_BOOT_NOSUID);
      expect(check!.passed).toBe(true);
    });

    it("[FS-BOOT-NOSUID] fails when /boot lacks nosuid", () => {
      const output = "/boot rw,noexec\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_BOOT_NOSUID);
      expect(check!.passed).toBe(false);
    });

    // --- FS-SUID-SYSTEM-COUNT: boundary at 30 ---
    it("[FS-SUID-SYSTEM-COUNT] passes at exactly 30", () => {
      const output = "42% /\n30";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_SYSTEM_COUNT);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/30 SUID files/);
    });

    it("[FS-SUID-SYSTEM-COUNT] fails at 31", () => {
      const output = "42% /\n31";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_SYSTEM_COUNT);
      expect(check!.passed).toBe(false);
    });

    it("[FS-SUID-SYSTEM-COUNT] fails when no standalone number (null)", () => {
      const output = "no numbers here\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_SUID_SYSTEM_COUNT);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("SUID count not determinable");
    });

    // --- N/A: all checks false ---
    it("[ALL] all checks return false for empty string", () => {
      const checks = parseFilesystemChecks("", "bare");
      expect(checks).toHaveLength(20);
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });

    it("[ALL] all checks return false for whitespace-only input", () => {
      const checks = parseFilesystemChecks("   \n  \n  ", "bare");
      expect(checks).toHaveLength(20);
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });

    // --- FS-VAR-NOEXEC checkMountOption edge: /var vs /var/tmp ---
    it("[FS-VAR-NOEXEC] detects /var mount separately from /var/tmp", () => {
      const output = "/var rw,noexec,relatime\n/var/tmp rw,relatime\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const varNoexec = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_NOEXEC);
      const varTmpNoexec = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOEXEC);
      expect(varNoexec!.passed).toBe(true);
      expect(varTmpNoexec!.passed).toBe(false);
    });

    // --- FS-HOME-PERMISSIONS: 4-digit perms ---
    it("[FS-HOME-PERMISSIONS] handles 4-digit perms correctly", () => {
      const output = "1750 /home/user1\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
      expect(check!.passed).toBe(true);
    });

    it("[FS-HOME-PERMISSIONS] fails with 4-digit perms ending in 5 (1755)", () => {
      const output = "1755 /home/user1\n42% /";
      const checks = parseFilesystemChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS);
      expect(check!.passed).toBe(false);
    });
  });

  describe("[MUTATION-KILLER] Filesystem check metadata completeness", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      [CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT, "warning", "SAFE"],
      [CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE, "warning", "SAFE"],
      [CHECK_IDS.FILESYSTEM.FS_SUID_THRESHOLD, "info", "SAFE"],
      [CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS, "warning", "SAFE"],
      [CHECK_IDS.FILESYSTEM.FS_DISK_USAGE, "warning", "SAFE"],
      [CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE, "info", "SAFE"],
      [CHECK_IDS.FILESYSTEM.FS_NO_UNOWNED_FILES, "info", "SAFE"],
      [CHECK_IDS.FILESYSTEM.FS_VAR_LOG_SEPARATE, "info", "GUARDED"],
      [CHECK_IDS.FILESYSTEM.FS_SUID_SYSTEM_COUNT, "info", "SAFE"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("Filesystem");
      expect(c!.severity).toBe(severity);
      expect(c!.safeToAutoFix).toBe(safe);
    });

    it("[MUTATION-KILLER] every check has non-empty fixCommand and explain", () => {
      checks.forEach((c) => {
        expect(c.fixCommand).toBeDefined();
        expect(c.fixCommand!.length).toBeGreaterThan(0);
        expect(c.explain).toBeDefined();
        expect(c.explain!.length).toBeGreaterThan(10);
      });
    });

    it("[MUTATION-KILLER] all IDs start with FS-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^FS-/));
    });
  });
});
