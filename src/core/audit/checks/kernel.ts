/**
 * Kernel security check parser.
 * Parses sysctl values into 5 security checks with semantic IDs.
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
    id: "KRN-ASLR-ENABLED",
    category: "Kernel",
    name: "ASLR Enabled (Full)",
    severity: "critical",
    passed: isNA ? false : aslr === "2",
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
    id: "KRN-CORE-DUMPS-RESTRICTED",
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
    id: "KRN-NETWORK-HARDENING",
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
    id: "KRN-KERNEL-VERSION",
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
    id: "KRN-DMESG-RESTRICTED",
    category: "Kernel",
    name: "dmesg Restricted",
    severity: "info",
    passed: isNA ? false : dmesgRestrict === "1",
    currentValue: isNA
      ? "Unable to determine"
      : dmesgRestrict !== null
        ? `kernel.dmesg_restrict = ${dmesgRestrict}`
        : "Unable to determine",
    expectedValue: "kernel.dmesg_restrict = 1",
    fixCommand: "sysctl -w kernel.dmesg_restrict=1 && echo 'kernel.dmesg_restrict=1' >> /etc/sysctl.conf",
    explain: "Restricting dmesg prevents unprivileged users from reading kernel messages that may contain sensitive info.",
  };

  // KRN-06: ptrace scope (kernel.yama.ptrace_scope >= 1)
  const ptraceScope = extractSysctlValue(output, "kernel.yama.ptrace_scope");
  const krn06: AuditCheck = {
    id: "KRN-PTRACE-SCOPE",
    category: "Kernel",
    name: "Ptrace Scope Restricted",
    severity: "warning",
    passed: isNA ? false : ptraceScope !== null && parseInt(ptraceScope, 10) >= 1,
    currentValue: isNA
      ? "Unable to determine"
      : ptraceScope !== null
        ? `kernel.yama.ptrace_scope = ${ptraceScope}`
        : "Unable to determine",
    expectedValue: "kernel.yama.ptrace_scope = 1 or higher",
    fixCommand: "sysctl -w kernel.yama.ptrace_scope=1 && echo 'kernel.yama.ptrace_scope=1' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Restricting ptrace prevents unprivileged processes from tracing or attaching to other processes.",
  };

  // KRN-07: kptr restrict (kernel.kptr_restrict >= 1)
  const kptrRestrict = extractSysctlValue(output, "kernel.kptr_restrict");
  const krn07: AuditCheck = {
    id: "KRN-KPTR-RESTRICT",
    category: "Kernel",
    name: "Kernel Pointer Restriction",
    severity: "warning",
    passed: isNA ? false : kptrRestrict !== null && parseInt(kptrRestrict, 10) >= 1,
    currentValue: isNA
      ? "Unable to determine"
      : kptrRestrict !== null
        ? `kernel.kptr_restrict = ${kptrRestrict}`
        : "Unable to determine",
    expectedValue: "kernel.kptr_restrict = 1 or higher",
    fixCommand: "sysctl -w kernel.kptr_restrict=1 && echo 'kernel.kptr_restrict=1' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Hiding kernel pointer addresses prevents attackers from exploiting kernel vulnerabilities via address leaks.",
  };

  // KRN-08: perf event paranoid (kernel.perf_event_paranoid >= 2)
  const perfParanoid = extractSysctlValue(output, "kernel.perf_event_paranoid");
  const krn08: AuditCheck = {
    id: "KRN-PERF-PARANOID",
    category: "Kernel",
    name: "Perf Events Restricted",
    severity: "info",
    passed: isNA ? false : perfParanoid !== null && parseInt(perfParanoid, 10) >= 2,
    currentValue: isNA
      ? "Unable to determine"
      : perfParanoid !== null
        ? `kernel.perf_event_paranoid = ${perfParanoid}`
        : "Unable to determine",
    expectedValue: "kernel.perf_event_paranoid = 2 or higher",
    fixCommand: "sysctl -w kernel.perf_event_paranoid=2 && echo 'kernel.perf_event_paranoid=2' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Restricting perf events prevents unprivileged users from gaining performance counter data for side-channel attacks.",
  };

  // KRN-09: TCP SYN cookies (net.ipv4.tcp_syncookies = 1)
  const synCookiesKrn = extractSysctlValue(output, "net.ipv4.tcp_syncookies");
  const krn09: AuditCheck = {
    id: "KRN-SYN-COOKIES",
    category: "Kernel",
    name: "TCP SYN Cookies Enabled",
    severity: "warning",
    passed: isNA ? false : synCookiesKrn === "1",
    currentValue: isNA
      ? "Unable to determine"
      : synCookiesKrn !== null
        ? `net.ipv4.tcp_syncookies = ${synCookiesKrn}`
        : "Unable to determine",
    expectedValue: "net.ipv4.tcp_syncookies = 1",
    fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1 && echo 'net.ipv4.tcp_syncookies=1' >> /etc/sysctl.d/99-kastell.conf",
    explain: "SYN cookies protect the server against SYN flood denial-of-service attacks.",
  };

  // KRN-10: IP forwarding disabled (net.ipv4.ip_forward = 0)
  const ipForwardKrn = extractSysctlValue(output, "net.ipv4.ip_forward");
  const krn10: AuditCheck = {
    id: "KRN-IP-FORWARD-DISABLED",
    category: "Kernel",
    name: "IPv4 Forwarding Disabled",
    severity: "warning",
    passed: isNA ? false : ipForwardKrn === "0",
    currentValue: isNA
      ? "Unable to determine"
      : ipForwardKrn !== null
        ? `net.ipv4.ip_forward = ${ipForwardKrn}`
        : "Unable to determine",
    expectedValue: "net.ipv4.ip_forward = 0",
    fixCommand: "sysctl -w net.ipv4.ip_forward=0 && echo 'net.ipv4.ip_forward=0' >> /etc/sysctl.d/99-kastell.conf",
    explain: "IP forwarding should be disabled on servers that are not routers to prevent packet routing abuse.",
  };

  // KRN-11: Reverse path filter (net.ipv4.conf.all.rp_filter = 1)
  const rpFilter = extractSysctlValue(output, "net.ipv4.conf.all.rp_filter");
  const krn11: AuditCheck = {
    id: "KRN-RP-FILTER",
    category: "Kernel",
    name: "Reverse Path Filtering Enabled",
    severity: "warning",
    passed: isNA ? false : rpFilter === "1",
    currentValue: isNA
      ? "Unable to determine"
      : rpFilter !== null
        ? `net.ipv4.conf.all.rp_filter = ${rpFilter}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.rp_filter = 1",
    fixCommand: "sysctl -w net.ipv4.conf.all.rp_filter=1 && echo 'net.ipv4.conf.all.rp_filter=1' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Reverse path filtering drops packets with a source address that cannot be reached via the incoming interface.",
  };

  // KRN-12: TCP timestamps (net.ipv4.tcp_timestamps = 0)
  const tcpTimestamps = extractSysctlValue(output, "net.ipv4.tcp_timestamps");
  const krn12: AuditCheck = {
    id: "KRN-TCP-TIMESTAMPS",
    category: "Kernel",
    name: "TCP Timestamps Disabled",
    severity: "info",
    passed: isNA ? false : tcpTimestamps === "0",
    currentValue: isNA
      ? "Unable to determine"
      : tcpTimestamps !== null
        ? `net.ipv4.tcp_timestamps = ${tcpTimestamps}`
        : "Unable to determine",
    expectedValue: "net.ipv4.tcp_timestamps = 0 (disabled)",
    fixCommand: "sysctl -w net.ipv4.tcp_timestamps=0 && echo 'net.ipv4.tcp_timestamps=0' >> /etc/sysctl.d/99-kastell.conf",
    explain: "TCP timestamps can be used to fingerprint the system uptime and derive information for certain attacks.",
  };

  // KRN-13: ICMP broadcast (net.ipv4.icmp_echo_ignore_broadcasts = 1)
  const icmpBroadcast = extractSysctlValue(output, "net.ipv4.icmp_echo_ignore_broadcasts");
  const krn13: AuditCheck = {
    id: "KRN-ICMP-BROADCAST",
    category: "Kernel",
    name: "ICMP Broadcast Ignored",
    severity: "warning",
    passed: isNA ? false : icmpBroadcast === "1",
    currentValue: isNA
      ? "Unable to determine"
      : icmpBroadcast !== null
        ? `net.ipv4.icmp_echo_ignore_broadcasts = ${icmpBroadcast}`
        : "Unable to determine",
    expectedValue: "net.ipv4.icmp_echo_ignore_broadcasts = 1",
    fixCommand: "sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=1 && echo 'net.ipv4.icmp_echo_ignore_broadcasts=1' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Ignoring ICMP broadcasts prevents the server from being used as an amplifier in smurf attacks.",
  };

  // KRN-14: IPv6 accept redirects (net.ipv6.conf.all.accept_redirects = 0)
  const ipv6AcceptRedirects = extractSysctlValue(output, "net.ipv6.conf.all.accept_redirects");
  const krn14: AuditCheck = {
    id: "KRN-ACCEPT-REDIRECTS-V6",
    category: "Kernel",
    name: "IPv6 ICMP Redirects Rejected",
    severity: "warning",
    passed: isNA ? false : ipv6AcceptRedirects === "0",
    currentValue: isNA
      ? "Unable to determine"
      : ipv6AcceptRedirects !== null
        ? `net.ipv6.conf.all.accept_redirects = ${ipv6AcceptRedirects}`
        : "Unable to determine",
    expectedValue: "net.ipv6.conf.all.accept_redirects = 0",
    fixCommand: "sysctl -w net.ipv6.conf.all.accept_redirects=0 && echo 'net.ipv6.conf.all.accept_redirects=0' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Accepting IPv6 ICMP redirects can allow attackers to redirect traffic through malicious routes.",
  };

  // KRN-15: BPF unprivileged (kernel.unprivileged_bpf_disabled = 1)
  const bpfUnprivileged = extractSysctlValue(output, "kernel.unprivileged_bpf_disabled");
  const krn15: AuditCheck = {
    id: "KRN-BPF-UNPRIVILEGED",
    category: "Kernel",
    name: "Unprivileged BPF Disabled",
    severity: "warning",
    passed: isNA ? false : bpfUnprivileged === "1",
    currentValue: isNA
      ? "Unable to determine"
      : bpfUnprivileged !== null
        ? `kernel.unprivileged_bpf_disabled = ${bpfUnprivileged}`
        : "Unable to determine",
    expectedValue: "kernel.unprivileged_bpf_disabled = 1",
    fixCommand: "sysctl -w kernel.unprivileged_bpf_disabled=1 && echo 'kernel.unprivileged_bpf_disabled=1' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Disabling unprivileged BPF prevents non-root users from loading eBPF programs that could be used for attacks.",
  };

  // KRN-16: Kernel modules disabled (kernel.modules_disabled = 1)
  const modulesDisabled = extractSysctlValue(output, "kernel.modules_disabled");
  const krn16: AuditCheck = {
    id: "KRN-MODULES-DISABLED",
    category: "Kernel",
    name: "Kernel Module Loading Disabled",
    severity: "info",
    passed: isNA ? false : modulesDisabled === "1",
    currentValue: isNA
      ? "Unable to determine"
      : modulesDisabled !== null
        ? `kernel.modules_disabled = ${modulesDisabled}`
        : "Unable to determine",
    expectedValue: "kernel.modules_disabled = 1",
    fixCommand: "sysctl -w kernel.modules_disabled=1 && echo 'kernel.modules_disabled=1' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Disabling kernel module loading prevents attackers from loading malicious kernel modules after system startup.",
  };

  // KRN-17: IPv6 forwarding disabled (net.ipv6.conf.all.forwarding = 0)
  const ipv6Forward = extractSysctlValue(output, "net.ipv6.conf.all.forwarding");
  const krn17: AuditCheck = {
    id: "KRN-IP-FORWARD-V6",
    category: "Kernel",
    name: "IPv6 Forwarding Disabled",
    severity: "warning",
    passed: isNA ? false : ipv6Forward === "0",
    currentValue: isNA
      ? "Unable to determine"
      : ipv6Forward !== null
        ? `net.ipv6.conf.all.forwarding = ${ipv6Forward}`
        : "Unable to determine",
    expectedValue: "net.ipv6.conf.all.forwarding = 0",
    fixCommand: "sysctl -w net.ipv6.conf.all.forwarding=0 && echo 'net.ipv6.conf.all.forwarding=0' >> /etc/sysctl.d/99-kastell.conf",
    explain: "IPv6 forwarding should be disabled on servers that are not IPv6 routers.",
  };

  // KRN-18: Send redirects disabled (net.ipv4.conf.all.send_redirects = 0)
  const sendRedirects = extractSysctlValue(output, "net.ipv4.conf.all.send_redirects");
  const krn18: AuditCheck = {
    id: "KRN-SEND-REDIRECTS",
    category: "Kernel",
    name: "ICMP Redirect Sending Disabled",
    severity: "warning",
    passed: isNA ? false : sendRedirects === "0",
    currentValue: isNA
      ? "Unable to determine"
      : sendRedirects !== null
        ? `net.ipv4.conf.all.send_redirects = ${sendRedirects}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.send_redirects = 0",
    fixCommand: "sysctl -w net.ipv4.conf.all.send_redirects=0 && echo 'net.ipv4.conf.all.send_redirects=0' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Sending ICMP redirects is only needed on routers and can be exploited to redirect traffic on non-router systems.",
  };

  // KRN-19: Secure redirects disabled (net.ipv4.conf.all.secure_redirects = 0)
  const secureRedirects = extractSysctlValue(output, "net.ipv4.conf.all.secure_redirects");
  const krn19: AuditCheck = {
    id: "KRN-SECURE-REDIRECTS",
    category: "Kernel",
    name: "Secure ICMP Redirects Disabled",
    severity: "warning",
    passed: isNA ? false : secureRedirects === "0",
    currentValue: isNA
      ? "Unable to determine"
      : secureRedirects !== null
        ? `net.ipv4.conf.all.secure_redirects = ${secureRedirects}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.secure_redirects = 0",
    fixCommand: "sysctl -w net.ipv4.conf.all.secure_redirects=0 && echo 'net.ipv4.conf.all.secure_redirects=0' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Even so-called secure ICMP redirects from gateways can be used to redirect traffic maliciously.",
  };

  return [krn01, krn02, krn03, krn04, krn05, krn06, krn07, krn08, krn09, krn10, krn11, krn12, krn13, krn14, krn15, krn16, krn17, krn18, krn19];
};
