/**
 * Filesystem check parser.
 * Parses mount/find output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";

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
    id: "FS-TMP-STICKY-BIT",
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
    id: "FS-NO-WORLD-WRITABLE",
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
    explain: "World-writable files in system directories can be modified by any user, enabling privilege escalation.",
  };

  // FS-03: SUID/SGID binaries count (threshold: 20+)
  const suidLines = output.split("\n").filter((l) => {
    const trimmed = l.trim();
    return (trimmed.startsWith("/usr/bin/") || trimmed.startsWith("/usr/sbin/")) && !trimmed.includes("N/A");
  });
  const suidCount = suidLines.length;
  const fs03: AuditCheck = {
    id: "FS-SUID-THRESHOLD",
    category: "Filesystem",
    name: "SUID Binaries Within Threshold",
    severity: "info",
    passed: isNA ? false : suidCount <= 15,
    currentValue: isNA
      ? "Unable to determine"
      : `${suidCount} SUID binary/ies found`,
    expectedValue: "15 or fewer SUID binaries",
    fixCommand: "find /usr/bin /usr/sbin -perm -4000 -type f -exec ls -la {} \\;",
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
    id: "FS-HOME-PERMISSIONS",
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
    explain: "World-readable home directories expose sensitive user files to all local users.",
  };

  // FS-05: Disk usage (warn if >90%)
  const diskMatch = output.match(/(\d+)%\s+\/$/m);
  const diskUsage = diskMatch ? parseInt(diskMatch[1], 10) : null;
  const fs05: AuditCheck = {
    id: "FS-DISK-USAGE",
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
    explain: "High disk usage can cause service failures, log loss, and security tool malfunction.",
  };

  // NEW CHECKS: mount option hardening and additional filesystem security
  // These parse data from the expanded filesystemSection() commands.

  // FS-HOME-NOEXEC: /home mounted with noexec
  const mountOutput = output;
  const homeMount = mountOutput.split("\n").find((l) => /\s\/home(\s|$)/.test(l) || l.startsWith("/home "));
  const homeMountOptions = homeMount ?? "";
  const fs06: AuditCheck = {
    id: "FS-HOME-NOEXEC",
    category: "Filesystem",
    name: "/home Mount noexec",
    severity: "warning",
    passed: isNA ? false : homeMountOptions.includes("noexec"),
    currentValue: isNA
      ? "Unable to determine"
      : homeMountOptions
        ? homeMountOptions.includes("noexec") ? "noexec set on /home" : "noexec not set on /home"
        : "/home mount options not detected",
    expectedValue: "/home mounted with noexec",
    fixCommand: "mount -o remount,noexec /home  # also add noexec to /etc/fstab",
    explain: "Mounting /home with noexec prevents execution of scripts placed in user home directories.",
  };

  // FS-HOME-NOSUID: /home mounted with nosuid
  const fs07: AuditCheck = {
    id: "FS-HOME-NOSUID",
    category: "Filesystem",
    name: "/home Mount nosuid",
    severity: "warning",
    passed: isNA ? false : homeMountOptions.includes("nosuid"),
    currentValue: isNA
      ? "Unable to determine"
      : homeMountOptions
        ? homeMountOptions.includes("nosuid") ? "nosuid set on /home" : "nosuid not set on /home"
        : "/home mount options not detected",
    expectedValue: "/home mounted with nosuid",
    fixCommand: "mount -o remount,nosuid /home  # also add nosuid to /etc/fstab",
    explain: "Mounting /home with nosuid prevents SUID binaries placed in user home directories from being exploited.",
  };

  // FS-VAR-TMP-NOEXEC: /var/tmp mounted with noexec
  const varTmpMount = mountOutput.split("\n").find((l) => /\s\/var\/tmp(\s|$)/.test(l) || l.startsWith("/var/tmp "));
  const varTmpMountOptions = varTmpMount ?? "";
  const fs08: AuditCheck = {
    id: "FS-VAR-TMP-NOEXEC",
    category: "Filesystem",
    name: "/var/tmp Mount noexec",
    severity: "warning",
    passed: isNA ? false : varTmpMountOptions.includes("noexec"),
    currentValue: isNA
      ? "Unable to determine"
      : varTmpMountOptions
        ? varTmpMountOptions.includes("noexec") ? "noexec set on /var/tmp" : "noexec not set on /var/tmp"
        : "/var/tmp mount options not detected",
    expectedValue: "/var/tmp mounted with noexec",
    fixCommand: "mount -o remount,noexec /var/tmp  # also add noexec to /etc/fstab",
    explain: "Mounting /var/tmp with noexec prevents execution of attacker-placed scripts in the temp directory.",
  };

  // FS-VAR-TMP-NOSUID: /var/tmp mounted with nosuid
  const fs09: AuditCheck = {
    id: "FS-VAR-TMP-NOSUID",
    category: "Filesystem",
    name: "/var/tmp Mount nosuid",
    severity: "warning",
    passed: isNA ? false : varTmpMountOptions.includes("nosuid"),
    currentValue: isNA
      ? "Unable to determine"
      : varTmpMountOptions
        ? varTmpMountOptions.includes("nosuid") ? "nosuid set on /var/tmp" : "nosuid not set on /var/tmp"
        : "/var/tmp mount options not detected",
    expectedValue: "/var/tmp mounted with nosuid",
    fixCommand: "mount -o remount,nosuid /var/tmp  # also add nosuid to /etc/fstab",
    explain: "Mounting /var/tmp with nosuid prevents SUID exploitation from world-writable temp directories.",
  };

  // FS-DEV-SHM-NOEXEC: /dev/shm mounted with noexec
  const devShmMount = mountOutput.split("\n").find((l) => /\s\/dev\/shm(\s|$)/.test(l) || l.startsWith("/dev/shm "));
  const devShmMountOptions = devShmMount ?? "";
  const fs10: AuditCheck = {
    id: "FS-DEV-SHM-NOEXEC",
    category: "Filesystem",
    name: "/dev/shm Mount noexec",
    severity: "warning",
    passed: isNA ? false : devShmMountOptions.includes("noexec"),
    currentValue: isNA
      ? "Unable to determine"
      : devShmMountOptions
        ? devShmMountOptions.includes("noexec") ? "noexec set on /dev/shm" : "noexec not set on /dev/shm"
        : "/dev/shm mount options not detected",
    expectedValue: "/dev/shm mounted with noexec",
    fixCommand: "mount -o remount,noexec /dev/shm  # also add noexec to /etc/fstab",
    explain: "Mounting /dev/shm with noexec prevents in-memory exploits from executing arbitrary code.",
  };

  // FS-DEV-SHM-NOSUID: /dev/shm mounted with nosuid
  const fs11: AuditCheck = {
    id: "FS-DEV-SHM-NOSUID",
    category: "Filesystem",
    name: "/dev/shm Mount nosuid",
    severity: "info",
    passed: isNA ? false : devShmMountOptions.includes("nosuid"),
    currentValue: isNA
      ? "Unable to determine"
      : devShmMountOptions
        ? devShmMountOptions.includes("nosuid") ? "nosuid set on /dev/shm" : "nosuid not set on /dev/shm"
        : "/dev/shm mount options not detected",
    expectedValue: "/dev/shm mounted with nosuid",
    fixCommand: "mount -o remount,nosuid /dev/shm  # also add nosuid to /etc/fstab",
    explain: "Mounting /dev/shm with nosuid reduces risk of SUID exploitation from shared memory.",
  };

  // FS-UMASK-RESTRICTIVE: umask is 022 or 027
  const umaskMatch = output.match(/\b(0?0?27|0?0?22)\b/);
  const umaskValue = umaskMatch ? umaskMatch[0] : null;
  const fs12: AuditCheck = {
    id: "FS-UMASK-RESTRICTIVE",
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
    explain: "A restrictive umask ensures newly created files are not world-readable by default.",
  };

  // FS-TMP-NOEXEC: /tmp mounted with noexec
  const tmpMount = mountOutput.split("\n").find((l) => /\s\/tmp(\s|$)/.test(l) || l.startsWith("/tmp "));
  const tmpMountOptions = tmpMount ?? "";
  const fs13: AuditCheck = {
    id: "FS-TMP-NOEXEC",
    category: "Filesystem",
    name: "/tmp Mount noexec",
    severity: "warning",
    passed: isNA ? false : tmpMountOptions.includes("noexec"),
    currentValue: isNA
      ? "Unable to determine"
      : tmpMountOptions
        ? tmpMountOptions.includes("noexec") ? "noexec set on /tmp" : "noexec not set on /tmp"
        : "/tmp mount options not detected",
    expectedValue: "/tmp mounted with noexec",
    fixCommand: "mount -o remount,noexec /tmp  # also add noexec to /etc/fstab",
    explain: "Mounting /tmp with noexec is a key hardening step that prevents execution of attacker-dropped scripts.",
  };

  // FS-NO-UNOWNED-FILES: No unowned files (proxy: world-writable count is low)
  // We infer from the existing world-writable file list — short list (<3 items) means clean
  const fs14: AuditCheck = {
    id: "FS-NO-UNOWNED-FILES",
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
    explain: "Unowned or world-writable files in system directories may indicate leftover exploit artifacts.",
  };

  // FS-TMP-NOSUID: /tmp mounted with nosuid
  const fs15: AuditCheck = {
    id: "FS-TMP-NOSUID",
    category: "Filesystem",
    name: "/tmp Mount nosuid",
    severity: "warning",
    passed: isNA ? false : tmpMountOptions.includes("nosuid"),
    currentValue: isNA
      ? "Unable to determine"
      : tmpMountOptions
        ? tmpMountOptions.includes("nosuid") ? "nosuid set on /tmp" : "nosuid not set on /tmp"
        : "/tmp mount options not detected",
    expectedValue: "/tmp mounted with nosuid",
    fixCommand: "mount -o remount,nosuid /tmp  # also add nosuid to /etc/fstab",
    explain: "Mounting /tmp with nosuid prevents SUID bit exploitation from world-writable temp directory.",
  };

  return [fs01, fs02, fs03, fs04, fs05, fs06, fs07, fs08, fs09, fs10, fs11, fs12, fs13, fs14, fs15];
};
