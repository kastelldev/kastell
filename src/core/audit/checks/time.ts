/**
 * Time synchronization security check parser.
 * Checks NTP service, clock sync, timezone, and hardware clock.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface TimeCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const TIME_CHECKS: TimeCheckDef[] = [
  {
    id: "TIME-NTP-ACTIVE",
    name: "NTP Service Running",
    severity: "warning",
    check: (output) => {
      const active =
        /\bactive\b/i.test(output) &&
        (/ntp|chrony|chronyd|systemd-timesyncd/i.test(output) ||
          /NTP service:\s*active/i.test(output));
      return {
        passed: active,
        currentValue: active ? "NTP service is running" : "No NTP service detected",
      };
    },
    expectedValue: "ntp, chrony, or systemd-timesyncd is active",
    fixCommand: "timedatectl set-ntp true && systemctl enable --now systemd-timesyncd",
    explain:
      "Time synchronization is critical for TLS certificate validation, log correlation, and security audit accuracy.",
  },
  {
    id: "TIME-SYNCHRONIZED",
    name: "Clock NTP Synchronized",
    severity: "warning",
    check: (output) => {
      const synced =
        /NTP synchronized:\s*yes/i.test(output) ||
        /System clock synchronized:\s*yes/i.test(output);
      return {
        passed: synced,
        currentValue: synced ? "Clock is NTP synchronized" : "Clock is not NTP synchronized",
      };
    },
    expectedValue: "NTP synchronized: yes",
    fixCommand: "timedatectl set-ntp true && systemctl restart systemd-timesyncd",
    explain:
      "An unsynchronized clock causes TLS failures, incorrect log timestamps, and authentication token expiry issues.",
  },
  {
    id: "TIME-TIMEZONE-SET",
    name: "Timezone Configured",
    severity: "info",
    check: (output) => {
      const hasTz =
        /Time zone:/i.test(output) ||
        /Etc\//i.test(output) ||
        /UTC/i.test(output) ||
        /\w+\/\w+/i.test(output);
      return {
        passed: hasTz,
        currentValue: hasTz ? "Timezone is configured" : "Timezone not configured",
      };
    },
    expectedValue: "Timezone explicitly set (not blank)",
    fixCommand: "timedatectl set-timezone UTC",
    explain:
      "A configured timezone ensures consistent log timestamps across the infrastructure for incident correlation.",
  },
  {
    id: "TIME-HWCLOCK-SYNC",
    name: "Hardware Clock Readable",
    severity: "info",
    check: (output) => {
      // hwclock --show returns a timestamp or N/A
      const hasTimestamp =
        /\d{4}-\d{2}-\d{2}/i.test(output) || /\d{2}:\d{2}:\d{2}/i.test(output);
      return {
        passed: hasTimestamp,
        currentValue: hasTimestamp
          ? "Hardware clock is readable"
          : "Hardware clock not accessible (common on VPS)",
      };
    },
    expectedValue: "hwclock returns a valid timestamp",
    fixCommand: "hwclock --systohc # Sync hardware clock from system clock",
    explain:
      "Hardware clock synchronization ensures the system maintains correct time across reboots.",
  },
  {
    id: "TIME-CHRONY-SOURCES",
    name: "NTP Source Configured",
    severity: "info",
    check: (output) => {
      const hasSource =
        /Reference ID/i.test(output) ||
        /System time/i.test(output) ||
        /ntp.*server/i.test(output) ||
        /pool.*ntp/i.test(output);
      return {
        passed: hasSource,
        currentValue: hasSource
          ? "NTP source is configured"
          : "No NTP source reference detected",
      };
    },
    expectedValue: "Chrony or NTP shows valid time source reference",
    fixCommand: "echo 'server pool.ntp.org iburst' >> /etc/chrony/chrony.conf && systemctl restart chrony",
    explain:
      "A configured NTP source ensures the server synchronizes time from trusted upstream servers.",
  },
  {
    id: "TIME-DRIFT-CHECK",
    name: "Clock Drift Within Range",
    severity: "warning",
    check: (output) => {
      // chronyc tracking shows "System time : X.XXX seconds" offset
      const driftMatch = output.match(/System time\s*:\s*([\d.]+)\s*seconds/i);
      if (driftMatch) {
        const drift = parseFloat(driftMatch[1]);
        const passed = drift < 1.0;
        return {
          passed,
          currentValue: `Clock drift: ${drift.toFixed(3)} seconds`,
        };
      }
      // If chronyc not available, check timedatectl for NTP sync as proxy
      const synced = /NTP synchronized:\s*yes/i.test(output) ||
        /System clock synchronized:\s*yes/i.test(output);
      return {
        passed: synced,
        currentValue: synced
          ? "Clock synchronized (drift not measurable without chrony)"
          : "Clock drift unknown — NTP not synchronized",
      };
    },
    expectedValue: "Clock drift less than 1 second",
    fixCommand: "chronyc makestep # Force immediate time correction",
    explain:
      "Excessive clock drift causes Kerberos authentication failures, TLS errors, and unreliable security event timestamps.",
  },
  {
    id: "TIME-NTP-PEERS-CONFIGURED",
    name: "Multiple NTP Sources Configured",
    severity: "info",
    check: (output) => {
      // ntpq -p output lists peer rows starting with * or + or o
      const ntpPeerLines = output.split("\n").filter((l) => /^[*+o]/.test(l.trim()));
      const hasChronySource = /Reference ID/i.test(output);
      const hasPeers = ntpPeerLines.length >= 2 || hasChronySource;
      return {
        passed: hasPeers,
        currentValue: hasPeers
          ? `NTP peers configured (${ntpPeerLines.length > 0 ? ntpPeerLines.length + " peer(s)" : "chrony source detected"})`
          : "Fewer than 2 NTP peers detected",
      };
    },
    expectedValue: "At least 2 NTP peer sources configured for redundancy",
    fixCommand: "# Add additional NTP servers to /etc/ntp.conf or /etc/chrony/chrony.conf",
    explain:
      "Multiple NTP sources provide redundancy and protect against time manipulation from a single compromised server.",
  },
  {
    id: "TIME-NO-DRIFT",
    name: "System Clock Synchronized",
    severity: "warning",
    check: (output) => {
      const synced =
        /System clock synchronized:\s*yes/i.test(output) ||
        /NTP synchronized:\s*yes/i.test(output);
      return {
        passed: synced,
        currentValue: synced
          ? "System clock is synchronized"
          : "System clock synchronization not confirmed",
      };
    },
    expectedValue: "timedatectl shows 'System clock synchronized: yes'",
    fixCommand: "timedatectl set-ntp true && systemctl restart systemd-timesyncd",
    explain:
      "Clock drift causes TLS certificate validation failures, log correlation errors, and authentication token expiry issues.",
  },
  {
    id: "TIME-NTP-SYNCHRONIZED",
    name: "NTP Synchronized via timedatectl show",
    severity: "warning",
    check: (output) => {
      // timedatectl show output includes NTPSynchronized=yes
      const synced = /NTPSynchronized=yes/i.test(output);
      return {
        passed: synced,
        currentValue: synced ? "NTPSynchronized=yes (timedatectl show)" : "NTPSynchronized not confirmed",
      };
    },
    expectedValue: "timedatectl show reports NTPSynchronized=yes",
    fixCommand: "timedatectl set-ntp true",
    explain:
      "Accurate time synchronization is critical for log correlation, certificate validation, and forensic timeline reconstruction.",
  },
];

export const parseTimeChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return TIME_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Time",
        name: def.name,
        severity: def.severity,
        passed: false,
        currentValue: "Unable to determine",
        expectedValue: def.expectedValue,
        fixCommand: def.fixCommand,
        explain: def.explain,
      };
    }
    const { passed, currentValue } = def.check(output);
    return {
      id: def.id,
      category: "Time",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      explain: def.explain,
    };
  });
};
