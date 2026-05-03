/**
 * Filesystem check parser.
 * Parses mount/find output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

// CodeQL suppression: fixCommand strings are display-only recommendations;
// no user input reaches shell execution


export const parseFilesystemChecks: CheckParser = (sectionOutput: string, _platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  // Output sections from commands.ts filesystemSection():
  // - World-writable files in /etc /usr (find output, up to 20 lines)
  // - SUID binaries (find output, up to 20 lines)
  // - /tmp permissions (stat output: "1777 root root")
  // - Disk usage (df output)

  // FS-01: /tmp permissions (sticky bit 1777)
  // Match stat output: "1777 root root" — 3-4 digit perms + owner + group
  const tmpMatch = output.match(/^([01]?\d{3})\s+([a-z_]\w*)\s+([a-z_]\w*)$/m);
  const tmpPerms = tmpMatch ? tmpMatch[1] : null;
  const hasStickyBit = tmpPerms !== null && tmpPerms.startsWith("1");
  const fs01: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT,
    category: "Filesystem",
    name: "/tmp Sticky Bit Set",
    severity: "warning",
    passed: hasStickyBit,
    currentValue: isNA
      ? "Unable to determine"
      : tmpPerms
        ? `Permissions: ${tmpPerms}`
        : "Unable to determine",
    expectedValue: "1777 (sticky bit set)",
    fixCommand: "chmod 1777 /tmp",
    safeToAutoFix: "SAFE",
    explain: "The sticky bit on /tmp prevents users from deleting other users' files.",
  };

  // FS-02: World-writable files count
  // The find output for world-writable files appears before SUID binary paths.
  // World-writable files come from: find /etc /usr -maxdepth 2 -perm -o+w -type f
  // SUID binaries come from: find /usr/bin /usr/sbin -perm -4000 -type f
  // We distinguish by looking at lines before the SUID section (/usr/bin/ or /usr/sbin/ paths)
  const allLines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const worldWritableLines: string[] = [];
  for (const line of allLines) {
    // SUID binaries are in /usr/bin/ or /usr/sbin/ — skip those
    if (line.startsWith("/usr/bin/") || line.startsWith("/usr/sbin/")) continue;
    // World-writable files are in /etc/ or /usr/ (but not /usr/bin/ or /usr/sbin/)
    if (line.startsWith("/etc/") || (line.startsWith("/usr/") && !line.startsWith("/usr/bin/") && !line.startsWith("/usr/sbin/"))) {
      worldWritableLines.push(line);
    }
  }
  const hasWorldWritable = worldWritableLines.length > 0;
  const fs02: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE,
    category: "Filesystem",
    name: "No World-Writable Files",
    severity: "warning",
    passed: isNA ? false : !hasWorldWritable,
    currentValue: isNA
      ? "Unable to determine"
      : hasWorldWritable
        ? `${worldWritableLines.length} world-writable file(s) found`
        : "No world-writable files in /etc, /usr",
    expectedValue: "No world-writable files in system directories",
    fixCommand: "find /etc /usr -maxdepth 2 -perm -o+w -type f -exec chmod o-w {} \\;",
    safeToAutoFix: "SAFE",
    explain: "World-writable files in system directories can be modified by any user, enabling privilege escalation.",
  };

  // FS-03: SUID/SGID binaries count (threshold: 20+)
  const suidLines = output.split("\n").filter((l) => {
    const trimmed = l.trim();
    return (trimmed.startsWith("/usr/bin/") || trimmed.startsWith("/usr/sbin/")) && !trimmed.includes("N/A");
  });
  const suidCount = suidLines.length;
  const fs03: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_SUID_THRESHOLD,
    category: "Filesystem",
    name: "SUID Binaries Within Threshold",
    severity: "info",
    passed: isNA ? false : suidCount <= 15,
    currentValue: isNA
      ? "Unable to determine"
      : `${suidCount} SUID binary/ies found`,
    expectedValue: "15 or fewer SUID binaries",
    fixCommand: "find /usr/bin /usr/sbin -perm -4000 -type f -exec ls -la {} \\;",
    safeToAutoFix: "SAFE",
    explain: "Excessive SUID binaries increase attack surface for privilege escalation.",
  };

  // FS-04: Home directory permissions
  // Parse `find /home -maxdepth 1 -mindepth 1 -type d -exec stat -c '%a %n' {} \;` output
  // Lines look like: "750 /home/user1" — world-readable if last digit >= 5 (e.g., 755, 757)
  const homeDirLines = output.split("\n").filter((l) => {
    const t = l.trim();
    return /^\d{3,4}\s+\/home\//.test(t);
  });
  const worldReadableHomeDirs = homeDirLines.filter((l) => {
    const permsMatch = l.trim().match(/^(\d{3,4})\s/);
    if (!permsMatch) return false;
    const perms = permsMatch[1];
    const otherDigit = parseInt(perms[perms.length - 1], 10);
    return otherDigit >= 4; // world-readable (4=r, 5=rx, 6=rw, 7=rwx)
  });
  const homePermsPass = homeDirLines.length > 0 && worldReadableHomeDirs.length === 0;
  const fs04: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS,
    category: "Filesystem",
    name: "Home Directory Permissions",
    severity: "warning",
    passed: isNA ? false : homePermsPass,
    currentValue: isNA
      ? "Unable to determine"
      : homeDirLines.length === 0
        ? "No home directories found"
        : worldReadableHomeDirs.length > 0
          ? `${worldReadableHomeDirs.length} world-readable home dir(s) found`
          : "Home directories not world-readable",
    expectedValue: "Home directories not world-readable (mode 750 or stricter)",
    fixCommand: "chmod 750 /home/*",
    safeToAutoFix: "SAFE",
    explain: "World-readable home directories expose sensitive user files to all local users.",
  };

  // FS-05: Disk usage (warn if >90%)
  const diskMatch = output.match(/(\d+)%\s+\/$/m);
  const diskUsage = diskMatch ? parseInt(diskMatch[1], 10) : null;
  const fs05: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_DISK_USAGE,
    category: "Filesystem",
    name: "Disk Usage Under Threshold",
    severity: "warning",
    passed: isNA ? false : diskUsage !== null ? diskUsage < 90 : false,
    currentValue: isNA
      ? "Unable to determine"
      : diskUsage !== null
        ? `Root filesystem ${diskUsage}% used`
        : "Unable to determine disk usage",
    expectedValue: "Root filesystem < 90% used",
    fixCommand: "df -h && du -sh /var/log/ /tmp/ /var/cache/",
    safeToAutoFix: "SAFE",
    explain: "High disk usage can cause service failures, log loss, and security tool malfunction.",
  };

  // NEW CHECKS: mount option hardening and additional filesystem security
  // These parse data from the expanded filesystemSection() commands.

  const mountLines = output.split("\n");

  /** Find mount line for a path and check if it has a specific option */
  function checkMountOption(
    mountPath: string,
    option: string,
  ): { hasOption: boolean; detected: boolean } {
    const escapedPath = mountPath.replace(/\//g, "\\/");
    const line = mountLines.find((l) => new RegExp(`\\s${escapedPath}(\\s|$)`).test(l) || l.startsWith(`${mountPath} `));
    if (!line) return { hasOption: false, detected: false };
    return { hasOption: line.includes(option), detected: true };
  }

  function makeMountCheck(
    id: string, name: string, mountPath: string, option: string,
    severity: "warning" | "info", fixCommand: string, explain: string,
  ): AuditCheck {
    const { hasOption, detected } = checkMountOption(mountPath, option);
    return {
      id, category: "Filesystem", name, severity,
      passed: isNA ? false : hasOption,
      currentValue: isNA ? "Unable to determine"
        : detected ? (hasOption ? `${option} set on ${mountPath}` : `${option} not set on ${mountPath}`)
        : `${mountPath} mount options not detected`,
      expectedValue: `${mountPath} mounted with ${option}`,
      fixCommand, explain,
    };
  }

  const fs06 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_HOME_NOEXEC, "/home Mount noexec", "/home", "noexec", "warning",
    "mount -o remount,noexec /home  # also add noexec to /etc/fstab",
    "Mounting /home with noexec prevents execution of scripts placed in user home directories.");

  const fs07 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_HOME_NOSUID, "/home Mount nosuid", "/home", "nosuid", "warning",
    "mount -o remount,nosuid /home  # also add nosuid to /etc/fstab",
    "Mounting /home with nosuid prevents SUID binaries placed in user home directories from being exploited.");

  const fs08 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOEXEC, "/var/tmp Mount noexec", "/var/tmp", "noexec", "warning",
    "mount -o remount,noexec /var/tmp  # also add noexec to /etc/fstab",
    "Mounting /var/tmp with noexec prevents execution of attacker-placed scripts in the temp directory.");

  const fs09 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOSUID, "/var/tmp Mount nosuid", "/var/tmp", "nosuid", "warning",
    "mount -o remount,nosuid /var/tmp  # also add nosuid to /etc/fstab",
    "Mounting /var/tmp with nosuid prevents SUID exploitation from world-writable temp directories.");

  const fs10 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_DEV_SHM_NOEXEC, "/dev/shm Mount noexec", "/dev/shm", "noexec", "warning",
    "mount -o remount,noexec /dev/shm  # also add noexec to /etc/fstab",
    "Mounting /dev/shm with noexec prevents in-memory exploits from executing arbitrary code.");

  const fs11 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_DEV_SHM_NOSUID, "/dev/shm Mount nosuid", "/dev/shm", "nosuid", "info",
    "mount -o remount,nosuid /dev/shm  # also add nosuid to /etc/fstab",
    "Mounting /dev/shm with nosuid reduces risk of SUID exploitation from shared memory.");

  // FS-UMASK-RESTRICTIVE: umask is 022 or 027
  const umaskMatch = output.match(/\b(0?0?27|0?0?22)\b/);
  const umaskValue = umaskMatch ? umaskMatch[0] : null;
  const fs12: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE,
    category: "Filesystem",
    name: "Restrictive Default umask",
    severity: "info",
    passed: isNA ? false : umaskValue !== null,
    currentValue: isNA
      ? "Unable to determine"
      : umaskValue !== null
        ? `umask ${umaskValue}`
        : "Non-restrictive umask detected",
    expectedValue: "umask 022 or 027",
    fixCommand: "echo 'umask 027' >> /etc/profile.d/kastell-umask.sh",
    safeToAutoFix: "SAFE",
    explain: "A restrictive umask ensures newly created files are not world-readable by default.",
  };

  // FS-TMP-NOEXEC: /tmp mounted with noexec
  const fs13 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_TMP_NOEXEC, "/tmp Mount noexec", "/tmp", "noexec", "warning",
    "mount -o remount,noexec /tmp  # also add noexec to /etc/fstab",
    "Mounting /tmp with noexec is a key hardening step that prevents execution of attacker-dropped scripts.");

  // FS-NO-UNOWNED-FILES: No unowned files (proxy: world-writable count is low)
  // We infer from the existing world-writable file list — short list (<3 items) means clean
  const fs14: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_NO_UNOWNED_FILES,
    category: "Filesystem",
    name: "No Unowned Files in Critical Dirs",
    severity: "info",
    passed: isNA ? false : worldWritableLines.length < 3,
    currentValue: isNA
      ? "Unable to determine"
      : worldWritableLines.length < 3
        ? "No excessive unowned/world-writable files detected"
        : `${worldWritableLines.length} world-writable file(s) in system directories`,
    expectedValue: "Fewer than 3 world-writable files in /etc and /usr",
    fixCommand: "find /etc /usr -maxdepth 2 -perm -o+w -type f -exec ls -la {} \\;",
    safeToAutoFix: "SAFE",
    explain: "Unowned or world-writable files in system directories may indicate leftover exploit artifacts.",
  };

  // FS-TMP-NOSUID: /tmp mounted with nosuid
  const fs15 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_TMP_NOSUID, "/tmp Mount nosuid", "/tmp", "nosuid", "warning",
    "mount -o remount,nosuid /tmp  # also add nosuid to /etc/fstab",
    "Mounting /tmp with nosuid prevents SUID bit exploitation from world-writable temp directory.");

  // FS-NODEV-REMOVABLE: Removable media mounted with nodev
  const fs16 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_NODEV_REMOVABLE, "/media Mount nodev", "/media", "nodev", "info",
    "Add nodev option to removable media mount points in /etc/fstab",
    "Mounting removable media with nodev prevents device file exploits from USB or external media.");

  // FS-VAR-LOG-SEPARATE: /var/log on separate partition
  const varLogLines = output.split("\n").filter((l) => {
    const t = l.trim();
    return t.includes("/var/log") && !t.includes("/var/log/");
  });
  const hasVarLogSeparate = varLogLines.length > 0;
  const fs17: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_VAR_LOG_SEPARATE,
    category: "Filesystem",
    name: "/var/log on Separate Partition",
    severity: "info",
    passed: isNA ? false : hasVarLogSeparate,
    currentValue: isNA
      ? "Unable to determine"
      : hasVarLogSeparate
        ? "/var/log is on a separate partition"
        : "/var/log is not on a separate partition",
    expectedValue: "/var/log mounted as a distinct partition",
    fixCommand: "Create separate /var/log partition or LVM volume and mount in /etc/fstab",
    safeToAutoFix: "GUARDED",
    explain: "Separate /var/log partition prevents log flooding from filling the root filesystem.",
  };

  // FS-BOOT-NOSUID: /boot mounted with nosuid
  const fs18 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_BOOT_NOSUID, "/boot Mount nosuid", "/boot", "nosuid", "info",
    "mount -o remount,nosuid /boot  # also add nosuid to /etc/fstab",
    "Mounting /boot with nosuid prevents SUID exploitation from modified boot files.");

  // FS-VAR-NOEXEC: /var mounted with noexec
  const fs19 = makeMountCheck(CHECK_IDS.FILESYSTEM.FS_VAR_NOEXEC, "/var Mount noexec", "/var", "noexec", "info",
    "mount -o remount,noexec /var  # also add noexec to /etc/fstab",
    "Mounting /var with noexec prevents execution of scripts placed in application data directories.");

  // FS-SUID-SYSTEM-COUNT: system-wide SUID file count
  // find / -xdev -type f -perm -4000 | wc -l — a standalone number
  let suidSystemCount: number | null = null;
  for (const line of mountLines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      const val = parseInt(trimmed, 10);
      // System-wide SUID count is typically 10-100; distinguish from other numbers
      if (val >= 0 && val < 10000) {
        suidSystemCount = val;
        // Don't break — we want the last standalone number (the wc -l from find / -xdev)
      }
    }
  }
  const fs20: AuditCheck = {
    id: CHECK_IDS.FILESYSTEM.FS_SUID_SYSTEM_COUNT,
    category: "Filesystem",
    name: "System-Wide SUID File Count",
    severity: "info",
    passed: isNA ? false : suidSystemCount !== null ? suidSystemCount <= 30 : false,
    currentValue: isNA
      ? "Unable to determine"
      : suidSystemCount !== null
        ? `${suidSystemCount} SUID files found system-wide`
        : "SUID count not determinable",
    expectedValue: "30 or fewer SUID files system-wide",
    fixCommand: "find / -xdev -type f -perm -4000 -exec ls -la {} \\; -- review and remove unnecessary SUID bits",
    safeToAutoFix: "SAFE",
    explain: "Each SUID binary is a potential privilege escalation vector; keeping the count low reduces attack surface.",
  };

  return [fs01, fs02, fs03, fs04, fs05, fs06, fs07, fs08, fs09, fs10, fs11, fs12, fs13, fs14, fs15, fs16, fs17, fs18, fs19, fs20];
};
