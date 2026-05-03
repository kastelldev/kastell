/**
 * Kernel security check parser.
 * Parses sysctl values into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { extractSysctlValue } from "./shared/sysctl.js";
import { CHECK_IDS } from "../checkIds.js";

export const parseKernelChecks: CheckParser = (sectionOutput: string, _platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  // KRN-01: ASLR (kernel.randomize_va_space = 2)
  const aslr = extractSysctlValue(output, "kernel.randomize_va_space");
  const krn01: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_ASLR_ENABLED,
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
    safeToAutoFix: "SAFE",
    explain: "ASLR randomizes memory addresses, making exploitation of memory corruption bugs significantly harder.",
  };

  // KRN-02: Core dumps restricted (fs.suid_dumpable = 0 or core_uses_pid)
  const suidDumpable = extractSysctlValue(output, "fs.suid_dumpable");
  const coreUsesPid = extractSysctlValue(output, "kernel.core_uses_pid");
  const coreRestricted = suidDumpable === "0" || coreUsesPid === "1";
  const krn02: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_CORE_DUMPS_RESTRICTED,
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
    safeToAutoFix: "SAFE",
    explain: "Core dumps can contain sensitive data like passwords and encryption keys.",
  };

  // KRN-03: Kernel hardening sysctls
  const acceptRedirects = extractSysctlValue(output, "net.ipv4.conf.all.accept_redirects");
  const acceptSourceRoute = extractSysctlValue(output, "net.ipv4.conf.all.accept_source_route");
  const logMartians = extractSysctlValue(output, "net.ipv4.conf.all.log_martians");

  const hardeningPassed = acceptRedirects === "0" && acceptSourceRoute === "0" && logMartians === "1";
  const krn03: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_NETWORK_HARDENING,
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
    id: CHECK_IDS.KERNEL.KRN_KERNEL_VERSION,
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
    safeToAutoFix: "SAFE",
    explain: "Keeping the kernel updated ensures security patches are applied.",
  };

  // KRN-05: dmesg restricted (kernel.dmesg_restrict = 1)
  const dmesgRestrict = extractSysctlValue(output, "kernel.dmesg_restrict");
  const krn05: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_DMESG_RESTRICTED,
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
    safeToAutoFix: "SAFE",
    explain: "Restricting dmesg prevents unprivileged users from reading kernel messages that may contain sensitive info.",
  };

  // KRN-06: ptrace scope (kernel.yama.ptrace_scope >= 1)
  const ptraceScope = extractSysctlValue(output, "kernel.yama.ptrace_scope");
  const krn06: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_PTRACE_SCOPE,
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
    safeToAutoFix: "SAFE",
    explain: "Restricting ptrace prevents unprivileged processes from tracing or attaching to other processes.",
  };

  // KRN-07: kptr restrict (kernel.kptr_restrict >= 1)
  const kptrRestrict = extractSysctlValue(output, "kernel.kptr_restrict");
  const krn07: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_KPTR_RESTRICT,
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
    safeToAutoFix: "SAFE",
    explain: "Hiding kernel pointer addresses prevents attackers from exploiting kernel vulnerabilities via address leaks.",
  };

  // KRN-08: perf event paranoid (kernel.perf_event_paranoid >= 2)
  const perfParanoid = extractSysctlValue(output, "kernel.perf_event_paranoid");
  const krn08: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_PERF_PARANOID,
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
    safeToAutoFix: "SAFE",
    explain: "Restricting perf events prevents unprivileged users from gaining performance counter data for side-channel attacks.",
  };

  // KRN-09: TCP SYN cookies (net.ipv4.tcp_syncookies = 1)
  const synCookiesKrn = extractSysctlValue(output, "net.ipv4.tcp_syncookies");
  const krn09: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_SYN_COOKIES,
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
    safeToAutoFix: "SAFE",
    explain: "SYN cookies protect the server against SYN flood denial-of-service attacks.",
  };

  // KRN-10: IP forwarding disabled (net.ipv4.ip_forward = 0)
  const ipForwardKrn = extractSysctlValue(output, "net.ipv4.ip_forward");
  const krn10: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_IP_FORWARD_DISABLED,
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
    safeToAutoFix: "GUARDED",
    explain: "IP forwarding should be disabled on servers that are not routers to prevent packet routing abuse. GUARDED: disabling may break Docker networking or SSH on misconfigured setups.",
  };

  // KRN-11: Reverse path filter (net.ipv4.conf.all.rp_filter >= 1)
  // Accepts both strict (1) and loose (2) modes — loose mode is required for Docker bridge networking
  const rpFilter = extractSysctlValue(output, "net.ipv4.conf.all.rp_filter");
  const krn11: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_RP_FILTER,
    category: "Kernel",
    name: "Reverse Path Filtering Enabled",
    severity: "warning",
    passed: isNA ? false : rpFilter !== null && parseInt(rpFilter, 10) >= 1,
    currentValue: isNA
      ? "Unable to determine"
      : rpFilter !== null
        ? `net.ipv4.conf.all.rp_filter = ${rpFilter}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.rp_filter = 1 or 2 (loose mode for Docker compatibility)",
    fixCommand: "sysctl -w net.ipv4.conf.all.rp_filter=2 && echo 'net.ipv4.conf.all.rp_filter=2' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain: "Reverse path filtering drops packets with a source address that cannot be reached via the incoming interface. Loose mode (2) is Docker-compatible.",
  };

  // KRN-12: TCP timestamps (net.ipv4.tcp_timestamps = 0)
  const tcpTimestamps = extractSysctlValue(output, "net.ipv4.tcp_timestamps");
  const krn12: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_TCP_TIMESTAMPS,
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
    safeToAutoFix: "SAFE",
    explain: "TCP timestamps can be used to fingerprint the system uptime and derive information for certain attacks.",
  };

  // KRN-13: ICMP broadcast (net.ipv4.icmp_echo_ignore_broadcasts = 1)
  const icmpBroadcast = extractSysctlValue(output, "net.ipv4.icmp_echo_ignore_broadcasts");
  const krn13: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_ICMP_BROADCAST,
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
    safeToAutoFix: "SAFE",
    explain: "Ignoring ICMP broadcasts prevents the server from being used as an amplifier in smurf attacks.",
  };

  // KRN-14: IPv6 accept redirects (net.ipv6.conf.all.accept_redirects = 0)
  const ipv6AcceptRedirects = extractSysctlValue(output, "net.ipv6.conf.all.accept_redirects");
  const krn14: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_ACCEPT_REDIRECTS_V6,
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
    safeToAutoFix: "SAFE",
    explain: "Accepting IPv6 ICMP redirects can allow attackers to redirect traffic through malicious routes.",
  };

  // KRN-15: BPF unprivileged (kernel.unprivileged_bpf_disabled = 1)
  const bpfUnprivileged = extractSysctlValue(output, "kernel.unprivileged_bpf_disabled");
  const krn15: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_BPF_UNPRIVILEGED,
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
    safeToAutoFix: "SAFE",
    explain: "Disabling unprivileged BPF prevents non-root users from loading eBPF programs that could be used for attacks.",
  };

  // KRN-16: Kernel modules disabled (kernel.modules_disabled = 1)
  const modulesDisabled = extractSysctlValue(output, "kernel.modules_disabled");
  const krn16: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_MODULES_DISABLED,
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
    safeToAutoFix: "GUARDED",
    explain: "Disabling kernel module loading prevents attackers from loading malicious kernel modules after system startup. GUARDED: irreversible until reboot, may prevent required module loading.",
  };

  // KRN-17: IPv6 forwarding disabled (net.ipv6.conf.all.forwarding = 0)
  const ipv6Forward = extractSysctlValue(output, "net.ipv6.conf.all.forwarding");
  const krn17: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_IP_FORWARD_V6,
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
    safeToAutoFix: "SAFE",
    explain: "IPv6 forwarding should be disabled on servers that are not IPv6 routers.",
  };

  // KRN-18: Send redirects disabled (net.ipv4.conf.all.send_redirects = 0)
  const sendRedirects = extractSysctlValue(output, "net.ipv4.conf.all.send_redirects");
  const krn18: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_SEND_REDIRECTS,
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
    safeToAutoFix: "SAFE",
    explain: "Sending ICMP redirects is only needed on routers and can be exploited to redirect traffic on non-router systems.",
  };

  // KRN-19: Secure redirects disabled (net.ipv4.conf.all.secure_redirects = 0)
  const secureRedirects = extractSysctlValue(output, "net.ipv4.conf.all.secure_redirects");
  const krn19: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_SECURE_REDIRECTS,
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
    safeToAutoFix: "SAFE",
    explain: "Even so-called secure ICMP redirects from gateways can be used to redirect traffic maliciously.",
  };

  // KRN-20: SysRq disabled or restricted (kernel.sysrq = 0 or 1)
  const sysrq = extractSysctlValue(output, "kernel.sysrq");
  const sysrqVal = sysrq !== null ? parseInt(sysrq, 10) : null;
  const krn20: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_SYSRQ_DISABLED,
    category: "Kernel",
    name: "SysRq Disabled or Restricted",
    severity: "warning",
    passed: isNA ? false : sysrqVal !== null && sysrqVal <= 1,
    currentValue: isNA
      ? "Unable to determine"
      : sysrq !== null
        ? `kernel.sysrq = ${sysrq}`
        : "Unable to determine",
    expectedValue: "kernel.sysrq = 0 or 1 (restricted)",
    fixCommand: "sysctl -w kernel.sysrq=0 && echo 'kernel.sysrq = 0' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "SysRq provides low-level kernel commands via keyboard; unrestricted access enables forced reboots and memory dumps.",
  };

  // KRN-21: Core pattern safe (not piped)
  const corePattern = extractSysctlValue(output, "kernel.core_pattern");
  const corePatternSafe = corePattern !== null && !corePattern.startsWith("|");
  const krn21: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_CORE_PATTERN_SAFE,
    category: "Kernel",
    name: "Core Dump Pattern Safe",
    severity: "warning",
    passed: isNA ? false : corePatternSafe,
    currentValue: isNA
      ? "Unable to determine"
      : corePattern !== null
        ? `kernel.core_pattern = ${corePattern}`
        : "Unable to determine",
    expectedValue: "kernel.core_pattern does not start with | (no piped core dumps)",
    fixCommand: "echo 'kernel.core_pattern=core' > /etc/sysctl.d/99-kastell-core.conf && sysctl -p",
    safeToAutoFix: "SAFE",
    explain:
      "Piped core patterns can execute arbitrary programs when a process crashes, enabling privilege escalation.",
  };

  // KRN-22: Panic on oops (kernel.panic_on_oops = 1)
  const panicOnOops = extractSysctlValue(output, "kernel.panic_on_oops");
  const krn22: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_PANIC_ON_OOPS,
    category: "Kernel",
    name: "Panic on Kernel Oops",
    severity: "info",
    passed: isNA ? false : panicOnOops === "1",
    currentValue: isNA
      ? "Unable to determine"
      : panicOnOops !== null
        ? `kernel.panic_on_oops = ${panicOnOops}`
        : "Unable to determine",
    expectedValue: "kernel.panic_on_oops = 1",
    fixCommand: "sysctl -w kernel.panic_on_oops=1 && echo 'kernel.panic_on_oops = 1' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "Kernel oops without panic allows a potentially compromised kernel to continue running.",
  };

  // KRN-23: NMI watchdog disabled (kernel.nmi_watchdog = 0)
  const nmiWatchdog = extractSysctlValue(output, "kernel.nmi_watchdog");
  const krn23: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_NMI_WATCHDOG_DISABLED,
    category: "Kernel",
    name: "NMI Watchdog Disabled",
    severity: "info",
    passed: isNA ? false : nmiWatchdog === "0",
    currentValue: isNA
      ? "Unable to determine"
      : nmiWatchdog !== null
        ? `kernel.nmi_watchdog = ${nmiWatchdog}`
        : "Unable to determine",
    expectedValue: "kernel.nmi_watchdog = 0 (disabled on production VPS)",
    fixCommand: "sysctl -w kernel.nmi_watchdog=0 && echo 'kernel.nmi_watchdog = 0' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "NMI watchdog generates hardware interrupts that are rarely needed on VPS; disabling reduces attack surface.",
  };

  // KRN-24: Unprivileged user namespaces disabled
  const unprivUserns = extractSysctlValue(output, "kernel.unprivileged_userns_clone");
  const krn24: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_UNPRIVILEGED_USERNS,
    category: "Kernel",
    name: "Unprivileged User Namespaces Disabled",
    severity: "warning",
    passed: isNA
      ? false
      : unprivUserns === null
        ? false
        : unprivUserns === "0",
    currentValue: isNA
      ? "Unable to determine"
      : unprivUserns !== null
        ? `kernel.unprivileged_userns_clone = ${unprivUserns}`
        : "Sysctl key not available (may not be supported on this kernel)",
    expectedValue: "kernel.unprivileged_userns_clone = 0",
    fixCommand: "sysctl -w kernel.unprivileged_userns_clone=0 && echo 'kernel.unprivileged_userns_clone = 0' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "Unprivileged user namespaces expand attack surface by allowing sandbox escapes and privilege escalation exploits.",
  };

  // KRN-25: Exec-shield (may not exist on modern kernels)
  const execShield = extractSysctlValue(output, "kernel.exec_shield");
  const krn25: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_EXEC_SHIELD,
    category: "Kernel",
    name: "Exec-Shield or NX Bit Protection",
    severity: "info",
    passed: isNA ? false : execShield === null || execShield === "1",
    currentValue: isNA
      ? "Unable to determine"
      : execShield !== null
        ? `kernel.exec_shield = ${execShield}`
        : "Not present (modern kernel uses hardware NX bit)",
    expectedValue: "kernel.exec_shield = 1 or not present (NX bit handles this on modern CPUs)",
    fixCommand: "# Modern kernels use NX bit. Verify: grep -q ' nx ' /proc/cpuinfo && echo 'NX enabled'",
    safeToAutoFix: "GUARDED",
    explain:
      "Exec-shield provides executable space protection; on modern kernels, hardware NX bit provides equivalent protection.",
  };

  // KRN-26: No blacklisted filesystem modules loaded
  // lsmod | grep -cE 'cramfs|freevxfs|jffs2|hfs|hfsplus|udf' output — count of loaded blacklisted modules
  const blacklistLines = output.split("\n");
  let blacklistCount: number | null = null;
  for (const line of blacklistLines) {
    const trimmed = line.trim();
    // Look for a standalone digit (count output from grep -c)
    if (/^\d+$/.test(trimmed)) {
      const val = parseInt(trimmed, 10);
      // Plausible count 0-20
      if (val >= 0 && val < 20) {
        blacklistCount = val;
        break;
      }
    }
  }
  const krn26: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_MODULE_BLACKLIST,
    category: "Kernel",
    name: "Blacklisted Filesystem Modules Not Loaded",
    severity: "info",
    passed: isNA ? false : blacklistCount === 0,
    currentValue: isNA
      ? "Unable to determine"
      : blacklistCount !== null
        ? `${blacklistCount} blacklisted module(s) loaded`
        : "Unable to determine module state",
    expectedValue: "0 blacklisted filesystem modules (cramfs, hfs, udf, etc.) loaded",
    fixCommand: "echo 'install cramfs /bin/true' >> /etc/modprobe.d/blacklist.conf && echo 'install hfs /bin/true' >> /etc/modprobe.d/blacklist.conf",
    safeToAutoFix: "SAFE",
    explain: "Obsolete filesystem kernel modules (cramfs, hfs, udf) can be exploited to mount crafted filesystem images for privilege escalation.",
  };

  // KRN-27: kernel.panic auto-reboot (>0)
  const kernelPanic = extractSysctlValue(output, "kernel.panic");
  const kernelPanicVal = kernelPanic !== null ? parseInt(kernelPanic, 10) : null;
  const krn27: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_PANIC_REBOOT,
    category: "Kernel",
    name: "Kernel Panic Auto-Reboot Configured",
    severity: "info",
    passed: isNA ? false : kernelPanicVal !== null && kernelPanicVal > 0,
    currentValue: isNA
      ? "Unable to determine"
      : kernelPanic !== null
        ? `kernel.panic = ${kernelPanic}`
        : "Unable to determine",
    expectedValue: "kernel.panic > 0 (auto-reboot on panic)",
    fixCommand: "sysctl -w kernel.panic=60 && echo 'kernel.panic = 60' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain: "Setting kernel.panic > 0 ensures automatic reboot after a kernel panic, preventing indefinite downtime on headless servers.",
  };

  // KRN-28: sysctl hardening configs in /etc/sysctl.d/
  // ls /etc/sysctl.d/*.conf | wc -l output
  let sysctlDirCount: number | null = null;
  for (const line of blacklistLines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      const val = parseInt(trimmed, 10);
      // sysctl.d config count is typically 0-20; distinct from blacklist count (already parsed)
      // We need to find the second standalone digit that follows the first
      if (val >= 0 && val <= 50 && sysctlDirCount === null && blacklistCount !== null) {
        // Skip the first digit (blacklistCount) — look for subsequent one
        if (blacklistLines.indexOf(line) > blacklistLines.findIndex((l) => l.trim() === String(blacklistCount))) {
          sysctlDirCount = val;
          break;
        }
      }
    }
  }
  const krn28: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_SYSCTL_HARDENED,
    category: "Kernel",
    name: "Sysctl Hardening Configs Present",
    severity: "info",
    passed: isNA ? false : sysctlDirCount !== null && sysctlDirCount > 0,
    currentValue: isNA
      ? "Unable to determine"
      : sysctlDirCount !== null
        ? `${sysctlDirCount} sysctl.d config file(s) found`
        : "Unable to determine sysctl.d config count",
    expectedValue: "At least 1 hardening config in /etc/sysctl.d/",
    fixCommand: "Create /etc/sysctl.d/99-kastell.conf with hardening settings",
    safeToAutoFix: "GUARDED",
    explain: "Persistent sysctl configuration files in /etc/sysctl.d/ ensure kernel hardening survives reboots.",
  };

  // KRN-29: Systemd coredump disabled (Storage=none or ProcessSizeMax=0)
  const coredumpSection = output.match(/Storage[=\s]+(\S+)/i);
  const coredumpStorage = coredumpSection ? coredumpSection[1].toLowerCase() : null;
  const processSizeMatch = output.match(/ProcessSizeMax[=\s]+(\S+)/i);
  const processSizeMax = processSizeMatch ? processSizeMatch[1] : null;
  const coredumpDisabled = coredumpStorage === "none"
    || processSizeMax === "0";
  const krn29: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_COREDUMP_SYSTEMD,
    category: "Kernel",
    name: "Systemd Coredumps Disabled",
    severity: "info",
    passed: isNA ? false : coredumpDisabled,
    currentValue: isNA
      ? "Unable to determine"
      : coredumpStorage !== null
        ? `Storage=${coredumpStorage}${processSizeMax !== null ? `, ProcessSizeMax=${processSizeMax}` : ""}`
        : "Coredump config not found",
    expectedValue: "Storage=none or ProcessSizeMax=0 in /etc/systemd/coredump.conf",
    fixCommand: "echo -e '[Coredump]\\nStorage=none\\nProcessSizeMax=0' > /etc/systemd/coredump.conf.d/kastell.conf",
    safeToAutoFix: "SAFE",
    explain: "Disabling systemd core dumps prevents sensitive memory contents from being written to disk after crashes.",
  };

  // KRN-30: Kernel lockdown mode enabled
  const lockdownValue = output.match(/\[(integrity|confidentiality)\]/i);
  const lockdownEnabled = lockdownValue !== null;
  const lockdownLine = output.split("\n").find((l) => /\[none\]|\[integrity\]|\[confidentiality\]/i.test(l));
  const krn30: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_LOCKDOWN_MODE,
    category: "Kernel",
    name: "Kernel Lockdown Mode Enabled",
    severity: "info",
    passed: isNA ? false : lockdownEnabled,
    currentValue: isNA
      ? "Unable to determine"
      : lockdownLine?.trim() ?? "Lockdown mode not available",
    expectedValue: "[integrity] or [confidentiality] in /sys/kernel/security/lockdown",
    fixCommand: "Add lockdown=integrity to kernel boot parameters in GRUB",
    safeToAutoFix: "GUARDED",
    explain: "Kernel lockdown mode prevents even root from modifying the running kernel, blocking rootkit installation.",
  };

  // KRN-31: BPF JIT hardening (net.core.bpf_jit_harden >= 1)
  const bpfJitHarden = extractSysctlValue(output, "net.core.bpf_jit_harden");
  const krn31: AuditCheck = {
    id: CHECK_IDS.KERNEL.KRN_BPF_JIT_HARDEN,
    category: "Kernel",
    name: "BPF JIT Hardening Enabled",
    severity: "warning",
    passed: isNA ? false : bpfJitHarden !== null && parseInt(bpfJitHarden, 10) >= 1,
    currentValue: isNA
      ? "Unable to determine"
      : bpfJitHarden !== null
        ? `net.core.bpf_jit_harden = ${bpfJitHarden}`
        : "Unable to determine",
    expectedValue: "net.core.bpf_jit_harden = 1 or 2",
    fixCommand: "sysctl -w net.core.bpf_jit_harden=1 && echo 'net.core.bpf_jit_harden=1' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain: "BPF JIT hardening prevents JIT spray attacks by constant-blinding JIT-compiled BPF bytecode.",
  };

  return [krn01, krn02, krn03, krn04, krn05, krn06, krn07, krn08, krn09, krn10, krn11, krn12, krn13, krn14, krn15, krn16, krn17, krn18, krn19, krn20, krn21, krn22, krn23, krn24, krn25, krn26, krn27, krn28, krn29, krn30, krn31];
};
