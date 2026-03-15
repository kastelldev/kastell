/**
 * System Updates check parser.
 * Parses apt/unattended-upgrades output into 4 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";

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
    id: "UPD-SECURITY-PATCHES",
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
    explain: "Pending security updates leave known vulnerabilities unpatched.",
  };

  // UPD-02: Unattended upgrades installed
  const unattendedInstalled = unattendedLine.includes("unattended-upgrades");
  const upd02: AuditCheck = {
    id: "UPD-AUTO-UPDATES",
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
    explain: "Automatic security updates ensure critical patches are applied promptly.",
  };

  // UPD-03: APT cache freshness (within 7 days)
  const aptTimestamp = parseInt(aptTimestampStr, 10);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const sevenDays = 7 * 24 * 60 * 60;
  const isFresh = !isNaN(aptTimestamp) && (nowEpoch - aptTimestamp) < sevenDays;
  const upd03: AuditCheck = {
    id: "UPD-CACHE-FRESH",
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
    explain: "Stale package cache may hide available security updates.",
  };

  // UPD-04: Reboot required
  const rebootRequired = rebootLine.includes("REBOOT_REQUIRED");
  const noReboot = rebootLine.includes("NO_REBOOT");
  const upd04: AuditCheck = {
    id: "UPD-REBOOT-REQUIRED",
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
    explain: "Some updates require a reboot to take effect, especially kernel updates.",
  };

  return [upd01, upd02, upd03, upd04];
};
