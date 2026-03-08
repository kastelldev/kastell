/**
 * Kernel security check parser.
 * Parses sysctl values into 5 security checks (KRN-01 through KRN-05).
 */

import type { AuditCheck, CheckParser } from "../types.js";

function extractSysctlValue(output: string, key: string): string | null {
  const regex = new RegExp(`${key.replace(/\./g, "\\.")}\\s*=\\s*(\\S+)`, "m");
  const match = output.match(regex);
  return match ? match[1].trim() : null;
}

export const parseKernelChecks: CheckParser = (sectionOutput: string, _platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  // KRN-01: ASLR (kernel.randomize_va_space = 2)
  const aslr = extractSysctlValue(output, "kernel.randomize_va_space");
  const krn01: AuditCheck = {
    id: "KRN-01",
    category: "Kernel",
    name: "ASLR Enabled (Full)",
    severity: "critical",
    passed: aslr === "2",
    currentValue: isNA
      ? "Unable to determine"
      : aslr !== null
        ? `kernel.randomize_va_space = ${aslr}`
        : "Unable to determine",
    expectedValue: "kernel.randomize_va_space = 2",
    fixCommand: "sysctl -w kernel.randomize_va_space=2 && echo 'kernel.randomize_va_space=2' >> /etc/sysctl.conf",
    explain: "ASLR randomizes memory addresses, making exploitation of memory corruption bugs significantly harder.",
  };

  // KRN-02: Core dumps restricted (fs.suid_dumpable = 0 or core_uses_pid)
  const suidDumpable = extractSysctlValue(output, "fs.suid_dumpable");
  const coreUsesPid = extractSysctlValue(output, "kernel.core_uses_pid");
  const coreRestricted = suidDumpable === "0" || coreUsesPid === "1";
  const krn02: AuditCheck = {
    id: "KRN-02",
    category: "Kernel",
    name: "Core Dumps Restricted",
    severity: "warning",
    passed: isNA ? false : coreRestricted,
    currentValue: isNA
      ? "Unable to determine"
      : suidDumpable !== null
        ? `fs.suid_dumpable = ${suidDumpable}`
        : coreUsesPid !== null
          ? `kernel.core_uses_pid = ${coreUsesPid}`
          : "Unable to determine",
    expectedValue: "fs.suid_dumpable = 0",
    fixCommand: "sysctl -w fs.suid_dumpable=0 && echo 'fs.suid_dumpable=0' >> /etc/sysctl.conf",
    explain: "Core dumps can contain sensitive data like passwords and encryption keys.",
  };

  // KRN-03: Kernel hardening sysctls
  const acceptRedirects = extractSysctlValue(output, "net.ipv4.conf.all.accept_redirects");
  const acceptSourceRoute = extractSysctlValue(output, "net.ipv4.conf.all.accept_source_route");
  const logMartians = extractSysctlValue(output, "net.ipv4.conf.all.log_martians");

  const hardeningPassed = acceptRedirects === "0" && acceptSourceRoute === "0" && logMartians === "1";
  const krn03: AuditCheck = {
    id: "KRN-03",
    category: "Kernel",
    name: "Network Hardening Sysctls",
    severity: "warning",
    passed: isNA ? false : hardeningPassed,
    currentValue: isNA
      ? "Unable to determine"
      : [
          acceptRedirects !== null ? `accept_redirects=${acceptRedirects}` : null,
          acceptSourceRoute !== null ? `accept_source_route=${acceptSourceRoute}` : null,
          logMartians !== null ? `log_martians=${logMartians}` : null,
        ].filter(Boolean).join(", ") || "Unable to determine",
    expectedValue: "accept_redirects=0, accept_source_route=0, log_martians=1",
    fixCommand: [
      "sysctl -w net.ipv4.conf.all.accept_redirects=0",
      "sysctl -w net.ipv4.conf.all.accept_source_route=0",
      "sysctl -w net.ipv4.conf.all.log_martians=1",
    ].join(" && "),
    explain: "Network hardening sysctls prevent ICMP redirect attacks, source routing, and enable martian packet logging.",
  };

  // KRN-04: Kernel version (basic presence check)
  const kernelVersion = output.match(/(\d+\.\d+\.\d+[-\w]*)/);
  const krn04: AuditCheck = {
    id: "KRN-04",
    category: "Kernel",
    name: "Kernel Version",
    severity: "info",
    passed: isNA ? false : kernelVersion !== null,
    currentValue: isNA
      ? "Unable to determine"
      : kernelVersion
        ? `Kernel ${kernelVersion[1]}`
        : "Unable to determine kernel version",
    expectedValue: "Kernel version identifiable",
    fixCommand: "apt update && apt upgrade -y linux-generic",
    explain: "Keeping the kernel updated ensures security patches are applied.",
  };

  // KRN-05: dmesg restricted (kernel.dmesg_restrict = 1)
  const dmesgRestrict = extractSysctlValue(output, "kernel.dmesg_restrict");
  const krn05: AuditCheck = {
    id: "KRN-05",
    category: "Kernel",
    name: "dmesg Restricted",
    severity: "info",
    passed: dmesgRestrict === "1",
    currentValue: isNA
      ? "Unable to determine"
      : dmesgRestrict !== null
        ? `kernel.dmesg_restrict = ${dmesgRestrict}`
        : "Unable to determine",
    expectedValue: "kernel.dmesg_restrict = 1",
    fixCommand: "sysctl -w kernel.dmesg_restrict=1 && echo 'kernel.dmesg_restrict=1' >> /etc/sysctl.conf",
    explain: "Restricting dmesg prevents unprivileged users from reading kernel messages that may contain sensitive info.",
  };

  return [krn01, krn02, krn03, krn04, krn05];
};
