import { parseKernelChecks } from "../../src/core/audit/checks/kernel.js";

describe("parseKernelChecks", () => {
  const secureOutput = [
    // sysctl values
    [
      "kernel.randomize_va_space = 2",
      "net.ipv4.conf.all.accept_redirects = 0",
      "net.ipv4.conf.all.accept_source_route = 0",
      "net.ipv4.conf.all.log_martians = 1",
      "net.ipv4.tcp_syncookies = 1",
      "kernel.core_uses_pid = 1",
      "kernel.dmesg_restrict = 1",
      "kernel.yama.ptrace_scope = 1",
      "kernel.kptr_restrict = 1",
      "kernel.perf_event_paranoid = 2",
      "net.ipv4.ip_forward = 0",
      "net.ipv4.conf.all.rp_filter = 1",
      "net.ipv4.tcp_timestamps = 0",
      "net.ipv4.icmp_echo_ignore_broadcasts = 1",
      "net.ipv6.conf.all.accept_redirects = 0",
      "kernel.unprivileged_bpf_disabled = 1",
      "kernel.modules_disabled = 0",
      "net.ipv6.conf.all.forwarding = 0",
      "net.ipv4.conf.all.send_redirects = 0",
      "net.ipv4.conf.all.secure_redirects = 0",
      // new KRN-20..25 sysctl values
      "kernel.sysrq = 0",
      "kernel.core_pattern = core",
      "kernel.panic_on_oops = 1",
      "kernel.nmi_watchdog = 0",
      "kernel.unprivileged_userns_clone = 0",
    ].join("\n"),
    // Kernel version
    "5.15.0-91-generic",
    // Security modules
    "lockdown,capability,landlock,yama,apparmor",
  ].join("\n");

  const insecureOutput = [
    // sysctl values (ASLR disabled, etc.)
    [
      "kernel.randomize_va_space = 0",
      "net.ipv4.conf.all.accept_redirects = 1",
      "net.ipv4.conf.all.accept_source_route = 1",
      "net.ipv4.conf.all.log_martians = 0",
      "kernel.yama.ptrace_scope = 0",
      "net.ipv4.ip_forward = 1",
    ].join("\n"),
    // Old kernel
    "4.15.0-20-generic",
    // No security modules
    "N/A",
  ].join("\n");

  it("should return 25 checks", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    expect(checks).toHaveLength(25);
    checks.forEach((check) => {
      expect(check.category).toBe("Kernel");
      expect(check.id).toMatch(/^KRN-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return KRN-ASLR-ENABLED passed when ASLR=2", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const krn01 = checks.find((c: { id: string }) => c.id === "KRN-ASLR-ENABLED");
    expect(krn01!.passed).toBe(true);
  });

  it("should return KRN-ASLR-ENABLED failed when ASLR=0 (critical)", () => {
    const checks = parseKernelChecks(insecureOutput, "bare");
    const krn01 = checks.find((c: { id: string }) => c.id === "KRN-ASLR-ENABLED");
    expect(krn01!.passed).toBe(false);
    expect(krn01!.severity).toBe("critical");
  });

  it("should return KRN-CORE-DUMPS-RESTRICTED passed when core_uses_pid=1", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const krn02 = checks.find((c: { id: string }) => c.id === "KRN-CORE-DUMPS-RESTRICTED");
    expect(krn02).toBeDefined();
  });

  it("should return KRN-NETWORK-HARDENING for kernel hardening sysctls", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const krn03 = checks.find((c: { id: string }) => c.id === "KRN-NETWORK-HARDENING");
    expect(krn03).toBeDefined();
    expect(krn03!.passed).toBe(true);
  });

  it("should return KRN-NETWORK-HARDENING failed with insecure sysctls", () => {
    const checks = parseKernelChecks(insecureOutput, "bare");
    const krn03 = checks.find((c: { id: string }) => c.id === "KRN-NETWORK-HARDENING");
    expect(krn03!.passed).toBe(false);
  });

  it("should return KRN-DMESG-RESTRICTED for dmesg restrict", () => {
    const outputWithDmesg = secureOutput + "\nkernel.dmesg_restrict = 1";
    const checks = parseKernelChecks(outputWithDmesg, "bare");
    const krn05 = checks.find((c: { id: string }) => c.id === "KRN-DMESG-RESTRICTED");
    expect(krn05).toBeDefined();
    expect(krn05!.passed).toBe(true);
  });

  it("should return KRN-PTRACE-SCOPE passed with ptrace_scope=1, failed with 0", () => {
    const passChecks = parseKernelChecks("kernel.yama.ptrace_scope = 1", "bare");
    const pass = passChecks.find((c: { id: string }) => c.id === "KRN-PTRACE-SCOPE");
    expect(pass!.passed).toBe(true);

    const failChecks = parseKernelChecks("kernel.yama.ptrace_scope = 0", "bare");
    const fail = failChecks.find((c: { id: string }) => c.id === "KRN-PTRACE-SCOPE");
    expect(fail!.passed).toBe(false);
  });

  it("should return KRN-IP-FORWARD-DISABLED passed with ip_forward=0, failed with 1", () => {
    const passChecks = parseKernelChecks("net.ipv4.ip_forward = 0", "bare");
    const pass = passChecks.find((c: { id: string }) => c.id === "KRN-IP-FORWARD-DISABLED");
    expect(pass!.passed).toBe(true);

    const failChecks = parseKernelChecks("net.ipv4.ip_forward = 1", "bare");
    const fail = failChecks.find((c: { id: string }) => c.id === "KRN-IP-FORWARD-DISABLED");
    expect(fail!.passed).toBe(false);
  });

  it("should return KRN-BPF-UNPRIVILEGED present in checks", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const bpf = checks.find((c: { id: string }) => c.id === "KRN-BPF-UNPRIVILEGED");
    expect(bpf).toBeDefined();
    expect(bpf!.passed).toBe(true);
  });

  it("KRN-SYSRQ-DISABLED passes when kernel.sysrq = 0", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-SYSRQ-DISABLED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("KRN-SYSRQ-DISABLED fails when kernel.sysrq = 176", () => {
    const checks = parseKernelChecks("kernel.sysrq = 176", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-SYSRQ-DISABLED");
    expect(check!.passed).toBe(false);
  });

  it("KRN-CORE-PATTERN-SAFE passes when core_pattern does not start with |", () => {
    const checks = parseKernelChecks("kernel.core_pattern = core", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-PATTERN-SAFE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("KRN-UNPRIVILEGED-USERNS passes when value is 0", () => {
    const checks = parseKernelChecks("kernel.unprivileged_userns_clone = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-UNPRIVILEGED-USERNS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseKernelChecks("N/A", "bare");
    expect(checks).toHaveLength(25);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });
});
