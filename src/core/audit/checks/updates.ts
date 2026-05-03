/**
 * System Updates check parser.
 * Parses apt/unattended-upgrades output into 4 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

export const parseUpdatesChecks: CheckParser = (sectionOutput: string, _platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const lines = isNA ? [] : sectionOutput.split("\n").map((l) => l.trim()).filter(Boolean);

  // The output sections correspond to commands in commands.ts updatesSection():
  // Line 0: security update count (number or N/A)
  // Line 1: unattended-upgrades dpkg status line or N/A
  // Line 2: apt lists timestamp or N/A
  // Line 3: NO_REBOOT or REBOOT_REQUIRED

  // Find each value by pattern rather than positional index
  // Security count: 0-9999 (small number, not a 10+ digit timestamp)
  const securityCountStr = lines.find((l) => /^\d{1,4}$/.test(l)) ?? "N/A";
  const unattendedLine = lines.find((l) => l.includes("unattended-upgrades")) ?? "N/A";
  // Apt timestamp: Unix epoch (10+ digits, e.g. 1709913600)
  const aptTimestampStr = lines.find((l) => /^\d{10,}$/.test(l)) ?? "N/A";
  const rebootLine = lines.find((l) => l === "REBOOT_REQUIRED" || l === "NO_REBOOT") ?? "N/A";

  // UPD-01: Security updates pending
  const securityCount = parseInt(securityCountStr, 10);
  const hasSecurityUpdates = !isNaN(securityCount) && securityCount > 0;
  const upd01: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_SECURITY_PATCHES,
    category: "Updates",
    name: "Security Updates Pending",
    severity: "critical",
    passed: !isNaN(securityCount) && securityCount === 0,
    currentValue: isNA || isNaN(securityCount)
      ? "Unable to determine"
      : hasSecurityUpdates
        ? `${securityCount} security update(s) pending`
        : "No security updates pending",
    expectedValue: "0 security updates",
    fixCommand: "apt update && apt upgrade -y",
    safeToAutoFix: "SAFE",
    explain: "Pending security updates leave known vulnerabilities unpatched.",
  };

  // UPD-02: Unattended upgrades installed
  const unattendedInstalled = unattendedLine.includes("unattended-upgrades");
  const upd02: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_AUTO_UPDATES,
    category: "Updates",
    name: "Automatic Security Updates",
    severity: "warning",
    passed: unattendedInstalled,
    currentValue: isNA
      ? "Unable to determine"
      : unattendedInstalled
        ? "unattended-upgrades installed"
        : "unattended-upgrades not installed",
    expectedValue: "unattended-upgrades installed",
    fixCommand: "apt install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades",
    safeToAutoFix: "SAFE",
    explain: "Automatic security updates ensure critical patches are applied promptly.",
  };

  // UPD-03: APT cache freshness (within 7 days)
  const aptTimestamp = parseInt(aptTimestampStr, 10);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const sevenDays = 7 * 24 * 60 * 60;
  const isFresh = !isNaN(aptTimestamp) && (nowEpoch - aptTimestamp) < sevenDays;
  const upd03: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_CACHE_FRESH,
    category: "Updates",
    name: "Package Cache Fresh",
    severity: "info",
    passed: isFresh,
    currentValue: isNA || isNaN(aptTimestamp)
      ? "Unable to determine"
      : isFresh
        ? "APT cache updated within 7 days"
        : "APT cache older than 7 days",
    expectedValue: "APT cache updated within 7 days",
    fixCommand: "apt update",
    safeToAutoFix: "SAFE",
    explain: "Stale package cache may hide available security updates.",
  };

  // UPD-04: Reboot required
  const rebootRequired = rebootLine.includes("REBOOT_REQUIRED");
  const noReboot = rebootLine.includes("NO_REBOOT");
  const upd04: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_REBOOT_REQUIRED,
    category: "Updates",
    name: "System Reboot Required",
    severity: "warning",
    passed: noReboot,
    currentValue: isNA
      ? "Unable to determine"
      : rebootRequired
        ? "Reboot required"
        : noReboot
          ? "No reboot required"
          : "Unable to determine",
    expectedValue: "No reboot required",
    fixCommand: "reboot",
    safeToAutoFix: "GUARDED",
    explain: "Some updates require a reboot to take effect, especially kernel updates.",
  };

  
  // The new commands (indices 4-9) in updatesSection():
  // [4]: stat -c '%Y' /var/log/dpkg.log -> dpkg activity timestamp
  // [5]: which trivy grype -> CVE scanner presence
  // [6]: dpkg --audit | wc -l -> half-installed package count
  // [7]: uname -r -> running kernel
  // [8]: dpkg -l 'linux-image-*' -> installed kernel
  // [9]: cat /etc/apt/apt.conf.d/20auto-upgrades -> auto-upgrades config

  // UPD-05: Last dpkg activity within 30 days
  const thirtyDays = 30 * 24 * 60 * 60;
  const allTimestamps = lines.filter((l) => /^\d{10,}$/.test(l)).map((l) => parseInt(l, 10));
  const latestTimestamp = allTimestamps.length > 0 ? allTimestamps.reduce((a, b) => (b > a ? b : a)) : NaN;
  const isUpgradeRecent = !isNaN(latestTimestamp) && (Math.floor(Date.now() / 1000) - latestTimestamp) < thirtyDays;
  const upd05: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_LAST_UPGRADE_RECENT,
    category: "Updates",
    name: "Last Package Activity Recent",
    severity: "warning",
    passed: isUpgradeRecent,
    currentValue: isNA || isNaN(latestTimestamp)
      ? "Unable to determine"
      : isUpgradeRecent
        ? "Package activity within last 30 days"
        : "No package activity in over 30 days",
    expectedValue: "Package activity within 30 days",
    fixCommand: "apt update && apt upgrade -y",
    safeToAutoFix: "SAFE",
    explain: "Systems with no package activity for 30+ days are likely missing critical security patches.",
  };

  // UPD-06: CVE scanner (trivy or grype) installed
  const cveToolLine = lines.find((l) => l.includes("trivy") || l.includes("grype") || l === "NONE") ?? "N/A";
  const hasCveTool = cveToolLine !== "NONE" && cveToolLine !== "N/A" && cveToolLine.trim() !== "";
  const upd06: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_CVE_SCANNER_PRESENT,
    category: "Updates",
    name: "CVE Scanner Installed",
    severity: "info",
    passed: hasCveTool,
    currentValue: hasCveTool ? `CVE scanner found: ${cveToolLine}` : "No CVE scanner found",
    expectedValue: "trivy or grype installed",
    fixCommand: "curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin",
    safeToAutoFix: "SAFE",
    explain: "A CVE scanner enables proactive detection of known vulnerabilities in installed packages.",
  };

  // UPD-07: No half-installed packages
  const dpkgAuditLine = isNA ? null : lines.find((l) => /^\d{1,4}$/.test(l) && l !== securityCountStr);
  const dpkgPartialCount = dpkgAuditLine !== undefined && dpkgAuditLine !== null ? parseInt(dpkgAuditLine, 10) : NaN;
  const noDpkgPartial = !isNaN(dpkgPartialCount) && dpkgPartialCount === 0;
  const upd07: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_DPKG_NO_PARTIAL,
    category: "Updates",
    name: "No Partial Packages",
    severity: "warning",
    passed: noDpkgPartial,
    currentValue: isNA ? "Unable to determine" : `${dpkgPartialCount} partially installed package(s)`,
    expectedValue: "0 partially installed packages",
    fixCommand: "dpkg --configure -a && apt install -f",
    safeToAutoFix: "SAFE",
    explain: "Partially installed packages indicate interrupted upgrades that may leave the system in an inconsistent state.",
  };

  // UPD-08: Running kernel version present (informational)
  const kernelVersion = lines.find((l) => /^\d+\.\d+\./.test(l)) ?? "";
  const hasKernelInfo = kernelVersion.length > 0;
  const upd08: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_KERNEL_CURRENT,
    category: "Updates",
    name: "Kernel Version Detected",
    severity: "info",
    passed: hasKernelInfo,
    currentValue: hasKernelInfo ? `Kernel: ${kernelVersion}` : "Unable to determine kernel version",
    expectedValue: "Kernel version detectable",
    fixCommand: "uname -r",
    safeToAutoFix: "SAFE",
    explain: "Knowing the running kernel version helps verify security patches have been applied via reboots.",
  };

  // UPD-09: Unattended-upgrades actually enabled (not just installed)
  const autoUpgradesContent = lines.find((l) => l.includes("APT::Periodic") || l.includes("Unattended-Upgrade")) ?? "";
  const isUnattendedEnabled = /APT::Periodic::Unattended-Upgrade\s+"1"/.test(sectionOutput);
  const upd09: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_UNATTENDED_ENABLED,
    category: "Updates",
    name: "Unattended Upgrades Enabled",
    severity: "warning",
    passed: isUnattendedEnabled,
    currentValue: isUnattendedEnabled
      ? "Unattended-Upgrade enabled in configuration"
      : autoUpgradesContent || "Unattended-Upgrade not enabled",
    expectedValue: `APT::Periodic::Unattended-Upgrade "1"`,
    fixCommand: `dpkg-reconfigure -plow unattended-upgrades`,
    safeToAutoFix: "SAFE",
    explain: "Unattended-upgrades must be explicitly enabled in 20auto-upgrades to apply security patches automatically.",
  };

  // UPD-10: APT repos use HTTPS (informational)
  const hasHttpRepos = !isNA && /http:\/\//.test(sectionOutput) && !/apt list|upgradable/.test(sectionOutput);
  const upd10: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_APT_HTTPS,
    category: "Updates",
    name: "APT Sources Use HTTPS",
    severity: "info",
    passed: !isNA && !hasHttpRepos,
    currentValue: isNA ? "Unable to determine" : hasHttpRepos ? "Some APT repos use HTTP" : "APT repo HTTPS status not directly verified here",
    expectedValue: "APT repositories using HTTPS",
    fixCommand: "See /etc/apt/sources.list and replace http:// with https://",
    safeToAutoFix: "GUARDED",
    explain: "APT repos using HTTPS prevent man-in-the-middle attacks during package downloads.",
  };

  // UPD-11: Security repository configured in APT sources
  // grep -rE 'security' /etc/apt/sources.list* output — matching lines or NONE
  const securityRepoLine = lines.find(
    (l) => l.includes("security") && (l.includes("deb ") || l.includes("https://") || l.includes("http://"))
  ) ?? "";
  const hasSecurityRepo = securityRepoLine.length > 0;
  const upd11: AuditCheck = {
    id: CHECK_IDS.UPDATES.UPD_SECURITY_REPO_PRIORITY,
    category: "Updates",
    name: "Security Repository Configured",
    severity: "info",
    passed: hasSecurityRepo,
    currentValue: isNA
      ? "Unable to determine"
      : hasSecurityRepo
        ? "Security repository found in APT sources"
        : "No dedicated security repository found in APT sources",
    expectedValue: "A security repository entry exists in /etc/apt/sources.list",
    fixCommand: "Ensure /etc/apt/sources.list includes the Ubuntu security repository",
    safeToAutoFix: "GUARDED",
    explain:
      "A dedicated security repository ensures critical patches are available immediately without waiting for general release cycles.",
  };

  return [upd01, upd02, upd03, upd04, upd05, upd06, upd07, upd08, upd09, upd10, upd11];
};
