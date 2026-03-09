/**
 * Filesystem check parser.
 * Parses mount/find output into 5 security checks (FS-01 through FS-05).
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
    id: "FS-01",
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
    id: "FS-02",
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
    id: "FS-03",
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
  // This is not directly in the output from commands.ts, so we do a basic check
  const fs04: AuditCheck = {
    id: "FS-04",
    category: "Filesystem",
    name: "Home Directory Permissions",
    severity: "info",
    passed: false, // Stub — no command in filesystemSection() to verify this
    currentValue: isNA ? "Unable to determine" : "Check not available in current output",
    expectedValue: "Home directories not world-readable",
    fixCommand: "chmod 750 /home/*",
    explain: "World-readable home directories expose sensitive user files.",
  };

  // FS-05: Disk usage (warn if >90%)
  const diskMatch = output.match(/(\d+)%\s+\/$/m);
  const diskUsage = diskMatch ? parseInt(diskMatch[1], 10) : null;
  const fs05: AuditCheck = {
    id: "FS-05",
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

  return [fs01, fs02, fs03, fs04, fs05];
};
