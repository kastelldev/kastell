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
      "net.ipv4.conf.all.rp_filter = 2",
      "net.ipv4.tcp_timestamps = 0",
      "net.ipv4.icmp_echo_ignore_broadcasts = 1",
      "net.ipv6.conf.all.accept_redirects = 0",
      "kernel.unprivileged_bpf_disabled = 1",
      "net.core.bpf_jit_harden = 1",
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
      // KRN-PANIC-REBOOT
      "kernel.panic = 60",
    ].join("\n"),
    // Kernel version
    "5.15.0-91-generic",
    // Security modules
    "lockdown,capability,landlock,yama,apparmor",
    // KRN-MODULE-BLACKLIST: 0 blacklisted modules loaded
    "0",
    // KRN-SYSCTL-HARDENED: 3 sysctl.d configs
    "3",
    // KRN-COREDUMP-SYSTEMD: Storage=none
    "Storage=none\nProcessSizeMax=0",
    // KRN-LOCKDOWN-MODE: integrity mode active
    "none [integrity] confidentiality",
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

  it("should return 31 checks", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    expect(checks).toHaveLength(31);
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
    expect(checks).toHaveLength(31);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });

  it("KRN-MODULE-BLACKLIST passes when 0 blacklisted modules loaded", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-MODULE-BLACKLIST");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
    expect(check!.currentValue).toContain("0");
  });

  it("KRN-MODULE-BLACKLIST fails when blacklisted modules are loaded", () => {
    const checks = parseKernelChecks("5.15.0-91-generic\nN/A\n3\nStorage=none\n[integrity]\n", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-MODULE-BLACKLIST");
    expect(check).toBeDefined();
    // No standalone "0" in this output so it should not pass
    expect(check!.currentValue).toBeDefined();
  });

  it("KRN-PANIC-REBOOT passes when kernel.panic = 60", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PANIC-REBOOT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
    expect(check!.currentValue).toContain("60");
  });

  it("KRN-PANIC-REBOOT fails when kernel.panic = 0", () => {
    const checks = parseKernelChecks("kernel.panic = 0\n5.15.0\nN/A\n0\n0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PANIC-REBOOT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("KRN-SYSCTL-HARDENED passes when sysctl.d has config files", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-SYSCTL-HARDENED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("KRN-COREDUMP-SYSTEMD passes when Storage=none", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-COREDUMP-SYSTEMD");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
    expect(check!.currentValue).toContain("none");
  });

  it("KRN-COREDUMP-SYSTEMD fails when Storage is default (not none)", () => {
    const checks = parseKernelChecks("kernel.randomize_va_space = 2\n5.15.0-91-generic\nN/A\n0\n0\nStorage=external\n[none] integrity confidentiality", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-COREDUMP-SYSTEMD");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("KRN-LOCKDOWN-MODE passes when [integrity] is active", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-LOCKDOWN-MODE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("KRN-LOCKDOWN-MODE fails when [none] is active", () => {
    const checks = parseKernelChecks("kernel.randomize_va_space = 2\n5.15.0-91-generic\nN/A\n0\n0\nStorage=none\n[none] integrity confidentiality", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-LOCKDOWN-MODE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  // KRN-RP-FILTER loose mode tests
  it("KRN-RP-FILTER passes when rp_filter=2 (loose mode, Docker-compatible)", () => {
    const checks = parseKernelChecks("net.ipv4.conf.all.rp_filter = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-RP-FILTER");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("KRN-RP-FILTER passes when rp_filter=1 (strict mode)", () => {
    const checks = parseKernelChecks("net.ipv4.conf.all.rp_filter = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-RP-FILTER");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("KRN-RP-FILTER fails when rp_filter=0 (disabled)", () => {
    const checks = parseKernelChecks("net.ipv4.conf.all.rp_filter = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-RP-FILTER");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  // KRN-BPF-JIT-HARDEN tests
  it("KRN-BPF-JIT-HARDEN passes when bpf_jit_harden=1", () => {
    const checks = parseKernelChecks("net.core.bpf_jit_harden = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-BPF-JIT-HARDEN");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("KRN-BPF-JIT-HARDEN passes when bpf_jit_harden=2", () => {
    const checks = parseKernelChecks("net.core.bpf_jit_harden = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-BPF-JIT-HARDEN");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("KRN-BPF-JIT-HARDEN fails when bpf_jit_harden=0", () => {
    const checks = parseKernelChecks("net.core.bpf_jit_harden = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-BPF-JIT-HARDEN");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  // ─── MUTATION-KILLER TESTS ───────────────────────────────────────

  it("ID array assertion — all 31 check IDs in exact order", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const ids = checks.map((c: { id: string }) => c.id);
    expect(ids).toEqual([
      "KRN-ASLR-ENABLED",
      "KRN-CORE-DUMPS-RESTRICTED",
      "KRN-NETWORK-HARDENING",
      "KRN-KERNEL-VERSION",
      "KRN-DMESG-RESTRICTED",
      "KRN-PTRACE-SCOPE",
      "KRN-KPTR-RESTRICT",
      "KRN-PERF-PARANOID",
      "KRN-SYN-COOKIES",
      "KRN-IP-FORWARD-DISABLED",
      "KRN-RP-FILTER",
      "KRN-TCP-TIMESTAMPS",
      "KRN-ICMP-BROADCAST",
      "KRN-ACCEPT-REDIRECTS-V6",
      "KRN-BPF-UNPRIVILEGED",
      "KRN-MODULES-DISABLED",
      "KRN-IP-FORWARD-V6",
      "KRN-SEND-REDIRECTS",
      "KRN-SECURE-REDIRECTS",
      "KRN-SYSRQ-DISABLED",
      "KRN-CORE-PATTERN-SAFE",
      "KRN-PANIC-ON-OOPS",
      "KRN-NMI-WATCHDOG-DISABLED",
      "KRN-UNPRIVILEGED-USERNS",
      "KRN-EXEC-SHIELD",
      "KRN-MODULE-BLACKLIST",
      "KRN-PANIC-REBOOT",
      "KRN-SYSCTL-HARDENED",
      "KRN-COREDUMP-SYSTEMD",
      "KRN-LOCKDOWN-MODE",
      "KRN-BPF-JIT-HARDEN",
    ]);
  });

  it("N/A blanket assertion — all checks have Unable to determine and passed=false", () => {
    const checks = parseKernelChecks("N/A", "bare");
    expect(checks).toHaveLength(31);
    for (const check of checks) {
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine");
    }
  });

  it("empty string blanket assertion — all checks have passed=false", () => {
    const checks = parseKernelChecks("", "bare");
    expect(checks).toHaveLength(31);
    for (const check of checks) {
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine");
    }
  });

  it("currentValue exact strings for sysctl-based checks from secureOutput", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const byId = (id: string) => checks.find((c: { id: string }) => c.id === id)!;

    expect(byId("KRN-ASLR-ENABLED").currentValue).toBe("kernel.randomize_va_space = 2");
    expect(byId("KRN-CORE-DUMPS-RESTRICTED").currentValue).toBe("kernel.core_uses_pid = 1");
    expect(byId("KRN-NETWORK-HARDENING").currentValue).toBe(
      "accept_redirects=0, accept_source_route=0, log_martians=1"
    );
    expect(byId("KRN-DMESG-RESTRICTED").currentValue).toBe("kernel.dmesg_restrict = 1");
    expect(byId("KRN-PTRACE-SCOPE").currentValue).toBe("kernel.yama.ptrace_scope = 1");
    expect(byId("KRN-KPTR-RESTRICT").currentValue).toBe("kernel.kptr_restrict = 1");
    expect(byId("KRN-PERF-PARANOID").currentValue).toBe("kernel.perf_event_paranoid = 2");
    expect(byId("KRN-SYN-COOKIES").currentValue).toBe("net.ipv4.tcp_syncookies = 1");
    expect(byId("KRN-IP-FORWARD-DISABLED").currentValue).toBe("net.ipv4.ip_forward = 0");
    expect(byId("KRN-RP-FILTER").currentValue).toBe("net.ipv4.conf.all.rp_filter = 2");
    expect(byId("KRN-TCP-TIMESTAMPS").currentValue).toBe("net.ipv4.tcp_timestamps = 0");
    expect(byId("KRN-ICMP-BROADCAST").currentValue).toBe("net.ipv4.icmp_echo_ignore_broadcasts = 1");
    expect(byId("KRN-ACCEPT-REDIRECTS-V6").currentValue).toBe("net.ipv6.conf.all.accept_redirects = 0");
    expect(byId("KRN-BPF-UNPRIVILEGED").currentValue).toBe("kernel.unprivileged_bpf_disabled = 1");
    expect(byId("KRN-MODULES-DISABLED").currentValue).toBe("kernel.modules_disabled = 0");
    expect(byId("KRN-IP-FORWARD-V6").currentValue).toBe("net.ipv6.conf.all.forwarding = 0");
    expect(byId("KRN-SEND-REDIRECTS").currentValue).toBe("net.ipv4.conf.all.send_redirects = 0");
    expect(byId("KRN-SECURE-REDIRECTS").currentValue).toBe("net.ipv4.conf.all.secure_redirects = 0");
    expect(byId("KRN-SYSRQ-DISABLED").currentValue).toBe("kernel.sysrq = 0");
    expect(byId("KRN-CORE-PATTERN-SAFE").currentValue).toBe("kernel.core_pattern = core");
    expect(byId("KRN-PANIC-ON-OOPS").currentValue).toBe("kernel.panic_on_oops = 1");
    expect(byId("KRN-NMI-WATCHDOG-DISABLED").currentValue).toBe("kernel.nmi_watchdog = 0");
    expect(byId("KRN-UNPRIVILEGED-USERNS").currentValue).toBe("kernel.unprivileged_userns_clone = 0");
    expect(byId("KRN-BPF-JIT-HARDEN").currentValue).toBe("net.core.bpf_jit_harden = 1");
  });

  it("secureOutput — all 31 checks pass except KRN-MODULES-DISABLED", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    for (const check of checks) {
      if (check.id === "KRN-MODULES-DISABLED") {
        // secureOutput has kernel.modules_disabled = 0 which fails (expects 1)
        expect(check.passed).toBe(false);
      } else {
        expect(check.passed).toBe(true);
      }
    }
  });

  // ─── BOUNDARY: KRN-PTRACE-SCOPE (>= 1) ──────────────────────────

  it("KRN-PTRACE-SCOPE boundary: 0 fails (below threshold)", () => {
    const checks = parseKernelChecks("kernel.yama.ptrace_scope = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PTRACE-SCOPE")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("kernel.yama.ptrace_scope = 0");
  });

  it("KRN-PTRACE-SCOPE boundary: 1 passes (exactly at threshold)", () => {
    const checks = parseKernelChecks("kernel.yama.ptrace_scope = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PTRACE-SCOPE")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.yama.ptrace_scope = 1");
  });

  it("KRN-PTRACE-SCOPE boundary: 2 passes (above threshold)", () => {
    const checks = parseKernelChecks("kernel.yama.ptrace_scope = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PTRACE-SCOPE")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.yama.ptrace_scope = 2");
  });

  it("KRN-PTRACE-SCOPE boundary: 3 passes (maximum lockdown)", () => {
    const checks = parseKernelChecks("kernel.yama.ptrace_scope = 3", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PTRACE-SCOPE")!;
    expect(check.passed).toBe(true);
  });

  // ─── BOUNDARY: KRN-KPTR-RESTRICT (>= 1) ─────────────────────────

  it("KRN-KPTR-RESTRICT boundary: 0 fails (below threshold)", () => {
    const checks = parseKernelChecks("kernel.kptr_restrict = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-KPTR-RESTRICT")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("kernel.kptr_restrict = 0");
  });

  it("KRN-KPTR-RESTRICT boundary: 1 passes (exactly at threshold)", () => {
    const checks = parseKernelChecks("kernel.kptr_restrict = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-KPTR-RESTRICT")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.kptr_restrict = 1");
  });

  it("KRN-KPTR-RESTRICT boundary: 2 passes (above threshold)", () => {
    const checks = parseKernelChecks("kernel.kptr_restrict = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-KPTR-RESTRICT")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.kptr_restrict = 2");
  });

  // ─── BOUNDARY: KRN-PERF-PARANOID (>= 2) ─────────────────────────

  it("KRN-PERF-PARANOID boundary: 1 fails (below threshold)", () => {
    const checks = parseKernelChecks("kernel.perf_event_paranoid = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PERF-PARANOID")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("kernel.perf_event_paranoid = 1");
  });

  it("KRN-PERF-PARANOID boundary: 2 passes (exactly at threshold)", () => {
    const checks = parseKernelChecks("kernel.perf_event_paranoid = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PERF-PARANOID")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.perf_event_paranoid = 2");
  });

  it("KRN-PERF-PARANOID boundary: 3 passes (above threshold)", () => {
    const checks = parseKernelChecks("kernel.perf_event_paranoid = 3", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PERF-PARANOID")!;
    expect(check.passed).toBe(true);
  });

  it("KRN-PERF-PARANOID boundary: 0 fails (well below threshold)", () => {
    const checks = parseKernelChecks("kernel.perf_event_paranoid = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PERF-PARANOID")!;
    expect(check.passed).toBe(false);
  });

  // ─── BOUNDARY: KRN-SYSRQ-DISABLED (<= 1) ────────────────────────

  it("KRN-SYSRQ-DISABLED boundary: 0 passes (fully disabled)", () => {
    const checks = parseKernelChecks("kernel.sysrq = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-SYSRQ-DISABLED")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.sysrq = 0");
  });

  it("KRN-SYSRQ-DISABLED boundary: 1 passes (restricted)", () => {
    const checks = parseKernelChecks("kernel.sysrq = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-SYSRQ-DISABLED")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.sysrq = 1");
  });

  it("KRN-SYSRQ-DISABLED boundary: 2 fails (above threshold)", () => {
    const checks = parseKernelChecks("kernel.sysrq = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-SYSRQ-DISABLED")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("kernel.sysrq = 2");
  });

  it("KRN-SYSRQ-DISABLED boundary: 176 fails (bitmask value)", () => {
    const checks = parseKernelChecks("kernel.sysrq = 176", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-SYSRQ-DISABLED")!;
    expect(check.passed).toBe(false);
  });

  // ─── BOUNDARY: KRN-PANIC-REBOOT (> 0) ───────────────────────────

  it("KRN-PANIC-REBOOT boundary: 0 fails (no auto-reboot)", () => {
    const checks = parseKernelChecks("kernel.panic = 0\n5.15.0\nN/A\n0\n0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PANIC-REBOOT")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("kernel.panic = 0");
  });

  it("KRN-PANIC-REBOOT boundary: 1 passes (minimal reboot timeout)", () => {
    const checks = parseKernelChecks("kernel.panic = 1\n5.15.0\nN/A\n0\n0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-PANIC-REBOOT")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.panic = 1");
  });

  // ─── BOUNDARY: KRN-RP-FILTER (>= 1) ─────────────────────────────

  it("KRN-RP-FILTER boundary: 0 fails, 1 passes, 2 passes", () => {
    const fail = parseKernelChecks("net.ipv4.conf.all.rp_filter = 0", "bare")
      .find((c: { id: string }) => c.id === "KRN-RP-FILTER")!;
    expect(fail.passed).toBe(false);

    const pass1 = parseKernelChecks("net.ipv4.conf.all.rp_filter = 1", "bare")
      .find((c: { id: string }) => c.id === "KRN-RP-FILTER")!;
    expect(pass1.passed).toBe(true);

    const pass2 = parseKernelChecks("net.ipv4.conf.all.rp_filter = 2", "bare")
      .find((c: { id: string }) => c.id === "KRN-RP-FILTER")!;
    expect(pass2.passed).toBe(true);
  });

  // ─── BOUNDARY: KRN-BPF-JIT-HARDEN (>= 1) ───────────────────────

  it("KRN-BPF-JIT-HARDEN boundary: 0 fails, 1 passes, 2 passes", () => {
    const fail = parseKernelChecks("net.core.bpf_jit_harden = 0", "bare")
      .find((c: { id: string }) => c.id === "KRN-BPF-JIT-HARDEN")!;
    expect(fail.passed).toBe(false);

    const pass1 = parseKernelChecks("net.core.bpf_jit_harden = 1", "bare")
      .find((c: { id: string }) => c.id === "KRN-BPF-JIT-HARDEN")!;
    expect(pass1.passed).toBe(true);

    const pass2 = parseKernelChecks("net.core.bpf_jit_harden = 2", "bare")
      .find((c: { id: string }) => c.id === "KRN-BPF-JIT-HARDEN")!;
    expect(pass2.passed).toBe(true);
  });

  // ─── EXEC-SHIELD special logic (null OR "1" passes) ─────────────

  it("KRN-EXEC-SHIELD passes when exec_shield is absent (null — modern kernel)", () => {
    const checks = parseKernelChecks("kernel.randomize_va_space = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-EXEC-SHIELD")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("Not present (modern kernel uses hardware NX bit)");
  });

  it("KRN-EXEC-SHIELD passes when exec_shield = 1", () => {
    const checks = parseKernelChecks("kernel.exec_shield = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-EXEC-SHIELD")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("kernel.exec_shield = 1");
  });

  it("KRN-EXEC-SHIELD fails when exec_shield = 0", () => {
    const checks = parseKernelChecks("kernel.exec_shield = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-EXEC-SHIELD")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("kernel.exec_shield = 0");
  });

  // ─── CORE-PATTERN-SAFE pipe detection ────────────────────────────

  it("KRN-CORE-PATTERN-SAFE fails when core_pattern starts with |", () => {
    const checks = parseKernelChecks("kernel.core_pattern = |/usr/share/apport/apport", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-PATTERN-SAFE")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toContain("|");
  });

  it("KRN-CORE-PATTERN-SAFE passes when core_pattern is a file path", () => {
    const checks = parseKernelChecks("kernel.core_pattern = /tmp/cores/core.%e.%p", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-PATTERN-SAFE")!;
    expect(check.passed).toBe(true);
  });

  // ─── COREDUMP-SYSTEMD OR logic (Storage=none OR ProcessSizeMax=0) ──

  it("KRN-COREDUMP-SYSTEMD passes with ProcessSizeMax=0 even without Storage=none", () => {
    const output = [
      "kernel.randomize_va_space = 2",
      "5.15.0-91-generic",
      "N/A",
      "0",
      "0",
      "Storage=external\nProcessSizeMax=0",
      "[none] integrity confidentiality",
    ].join("\n");
    const checks = parseKernelChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-COREDUMP-SYSTEMD")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toContain("ProcessSizeMax=0");
  });

  it("KRN-COREDUMP-SYSTEMD currentValue includes both Storage and ProcessSizeMax", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-COREDUMP-SYSTEMD")!;
    expect(check.currentValue).toBe("Storage=none, ProcessSizeMax=0");
  });

  // ─── LOCKDOWN-MODE [confidentiality] also passes ─────────────────

  it("KRN-LOCKDOWN-MODE passes with [confidentiality]", () => {
    const output = [
      "kernel.randomize_va_space = 2",
      "5.15.0-91-generic",
      "N/A",
      "0",
      "0",
      "Storage=none",
      "none integrity [confidentiality]",
    ].join("\n");
    const checks = parseKernelChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-LOCKDOWN-MODE")!;
    expect(check.passed).toBe(true);
  });

  // ─── MODULE-BLACKLIST count parsing ──────────────────────────────

  it("KRN-MODULE-BLACKLIST fails when count > 0", () => {
    const output = [
      "kernel.randomize_va_space = 2",
      "5.15.0-91-generic",
      "apparmor",
      "2",
      "3",
      "Storage=none",
      "[integrity]",
    ].join("\n");
    const checks = parseKernelChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-MODULE-BLACKLIST")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toContain("2");
  });

  // ─── SEVERITY assertions for key checks ──────────────────────────

  it("severity assignments are correct for critical/warning/info checks", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const byId = (id: string) => checks.find((c: { id: string }) => c.id === id)!;

    // critical
    expect(byId("KRN-ASLR-ENABLED").severity).toBe("critical");

    // warning
    expect(byId("KRN-CORE-DUMPS-RESTRICTED").severity).toBe("warning");
    expect(byId("KRN-NETWORK-HARDENING").severity).toBe("warning");
    expect(byId("KRN-PTRACE-SCOPE").severity).toBe("warning");
    expect(byId("KRN-KPTR-RESTRICT").severity).toBe("warning");
    expect(byId("KRN-SYN-COOKIES").severity).toBe("warning");
    expect(byId("KRN-IP-FORWARD-DISABLED").severity).toBe("warning");
    expect(byId("KRN-RP-FILTER").severity).toBe("warning");
    expect(byId("KRN-ICMP-BROADCAST").severity).toBe("warning");
    expect(byId("KRN-ACCEPT-REDIRECTS-V6").severity).toBe("warning");
    expect(byId("KRN-BPF-UNPRIVILEGED").severity).toBe("warning");
    expect(byId("KRN-IP-FORWARD-V6").severity).toBe("warning");
    expect(byId("KRN-SEND-REDIRECTS").severity).toBe("warning");
    expect(byId("KRN-SECURE-REDIRECTS").severity).toBe("warning");
    expect(byId("KRN-SYSRQ-DISABLED").severity).toBe("warning");
    expect(byId("KRN-CORE-PATTERN-SAFE").severity).toBe("warning");
    expect(byId("KRN-UNPRIVILEGED-USERNS").severity).toBe("warning");
    expect(byId("KRN-BPF-JIT-HARDEN").severity).toBe("warning");

    // info
    expect(byId("KRN-KERNEL-VERSION").severity).toBe("info");
    expect(byId("KRN-DMESG-RESTRICTED").severity).toBe("info");
    expect(byId("KRN-PERF-PARANOID").severity).toBe("info");
    expect(byId("KRN-TCP-TIMESTAMPS").severity).toBe("info");
    expect(byId("KRN-MODULES-DISABLED").severity).toBe("info");
    expect(byId("KRN-PANIC-ON-OOPS").severity).toBe("info");
    expect(byId("KRN-NMI-WATCHDOG-DISABLED").severity).toBe("info");
    expect(byId("KRN-EXEC-SHIELD").severity).toBe("info");
    expect(byId("KRN-MODULE-BLACKLIST").severity).toBe("info");
    expect(byId("KRN-PANIC-REBOOT").severity).toBe("info");
    expect(byId("KRN-SYSCTL-HARDENED").severity).toBe("info");
    expect(byId("KRN-COREDUMP-SYSTEMD").severity).toBe("info");
    expect(byId("KRN-LOCKDOWN-MODE").severity).toBe("info");
  });

  // ─── KERNEL-VERSION currentValue format ──────────────────────────

  it("KRN-KERNEL-VERSION currentValue includes Kernel prefix", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-KERNEL-VERSION")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("Kernel 5.15.0-91-generic");
  });

  // ─── UNPRIVILEGED-USERNS null sysctl ─────────────────────────────

  it("KRN-UNPRIVILEGED-USERNS fails when sysctl key not present", () => {
    const checks = parseKernelChecks("kernel.randomize_va_space = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-UNPRIVILEGED-USERNS")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("Sysctl key not available (may not be supported on this kernel)");
  });

  it("KRN-UNPRIVILEGED-USERNS fails when value is 1", () => {
    const checks = parseKernelChecks("kernel.unprivileged_userns_clone = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-UNPRIVILEGED-USERNS")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("kernel.unprivileged_userns_clone = 1");
  });

  // ─── SYSCTL-HARDENED count parsing ───────────────────────────────

  it("KRN-SYSCTL-HARDENED fails when sysctl.d count is 0", () => {
    // blacklistCount=0 is on first "0" line, sysctlDirCount=0 needs a second separate "0" line
    // The parser skips identical lines, so we use distinct values
    const output = [
      "kernel.randomize_va_space = 2",
      "5.15.0-91-generic",
      "apparmor",
      "1",
      "0",
      "Storage=none",
      "[integrity]",
    ].join("\n");
    const checks = parseKernelChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-SYSCTL-HARDENED")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toContain("0");
  });

  // ─── ASLR boundary (exact string comparison = "2") ──────────────

  it("KRN-ASLR-ENABLED fails when ASLR=1 (partial)", () => {
    const checks = parseKernelChecks("kernel.randomize_va_space = 1", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-ASLR-ENABLED")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("kernel.randomize_va_space = 1");
  });

  it("KRN-ASLR-ENABLED passes only when ASLR=2 (full)", () => {
    const checks = parseKernelChecks("kernel.randomize_va_space = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-ASLR-ENABLED")!;
    expect(check.passed).toBe(true);
  });

  // ─── CORE-DUMPS-RESTRICTED OR logic ──────────────────────────────

  it("KRN-CORE-DUMPS-RESTRICTED passes with fs.suid_dumpable=0", () => {
    const checks = parseKernelChecks("fs.suid_dumpable = 0", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-DUMPS-RESTRICTED")!;
    expect(check.passed).toBe(true);
    expect(check.currentValue).toBe("fs.suid_dumpable = 0");
  });

  it("KRN-CORE-DUMPS-RESTRICTED fails with fs.suid_dumpable=2 and no core_uses_pid", () => {
    const checks = parseKernelChecks("fs.suid_dumpable = 2", "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-DUMPS-RESTRICTED")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("fs.suid_dumpable = 2");
  });

  // ─── NETWORK-HARDENING partial failure ───────────────────────────

  it("KRN-NETWORK-HARDENING fails when only 2 of 3 sysctls are correct", () => {
    const output = [
      "net.ipv4.conf.all.accept_redirects = 0",
      "net.ipv4.conf.all.accept_source_route = 0",
      "net.ipv4.conf.all.log_martians = 0",
    ].join("\n");
    const checks = parseKernelChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "KRN-NETWORK-HARDENING")!;
    expect(check.passed).toBe(false);
    expect(check.currentValue).toContain("log_martians=0");
  });

  // ─── MUTATION-KILLER WAVE 2 ─────────────────────────────────────

  describe("KRN-03 NETWORK-HARDENING && conditional — each individual sysctl wrong", () => {
    it("fails when only accept_redirects is wrong (1 instead of 0)", () => {
      const output = [
        "net.ipv4.conf.all.accept_redirects = 1",
        "net.ipv4.conf.all.accept_source_route = 0",
        "net.ipv4.conf.all.log_martians = 1",
      ].join("\n");
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-NETWORK-HARDENING")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("accept_redirects=1");
    });

    it("fails when only accept_source_route is wrong (1 instead of 0)", () => {
      const output = [
        "net.ipv4.conf.all.accept_redirects = 0",
        "net.ipv4.conf.all.accept_source_route = 1",
        "net.ipv4.conf.all.log_martians = 1",
      ].join("\n");
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-NETWORK-HARDENING")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("accept_source_route=1");
    });

    it("fails when only log_martians is wrong (0 instead of 1)", () => {
      const output = [
        "net.ipv4.conf.all.accept_redirects = 0",
        "net.ipv4.conf.all.accept_source_route = 0",
        "net.ipv4.conf.all.log_martians = 0",
      ].join("\n");
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-NETWORK-HARDENING")!;
      expect(check.passed).toBe(false);
    });

    it("passes only when all three are correct", () => {
      const output = [
        "net.ipv4.conf.all.accept_redirects = 0",
        "net.ipv4.conf.all.accept_source_route = 0",
        "net.ipv4.conf.all.log_martians = 1",
      ].join("\n");
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-NETWORK-HARDENING")!;
      expect(check.passed).toBe(true);
    });

    it("currentValue is 'Unable to determine' when all three sysctls are absent", () => {
      const checks = parseKernelChecks("kernel.randomize_va_space = 2", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-NETWORK-HARDENING")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine");
    });
  });

  describe("KRN-02 CORE-DUMPS-RESTRICTED — OR logic edge cases", () => {
    it("passes with core_uses_pid=1 even when suid_dumpable=2", () => {
      const output = "fs.suid_dumpable = 2\nkernel.core_uses_pid = 1";
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-DUMPS-RESTRICTED")!;
      expect(check.passed).toBe(true);
      // currentValue prefers suid_dumpable when present
      expect(check.currentValue).toBe("fs.suid_dumpable = 2");
    });

    it("fails when both suid_dumpable and core_uses_pid are absent", () => {
      const checks = parseKernelChecks("kernel.randomize_va_space = 2", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-DUMPS-RESTRICTED")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine");
    });

    it("fails with suid_dumpable=1 and no core_uses_pid", () => {
      const checks = parseKernelChecks("fs.suid_dumpable = 1", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-DUMPS-RESTRICTED")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("fs.suid_dumpable = 1");
    });

    it("currentValue shows core_uses_pid when suid_dumpable is absent", () => {
      const checks = parseKernelChecks("kernel.core_uses_pid = 1", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-DUMPS-RESTRICTED")!;
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("kernel.core_uses_pid = 1");
    });
  });

  describe("KRN-26 MODULE-BLACKLIST — boundary val >= 0 && val < 20", () => {
    it("passes with val=0 (exactly at lower boundary)", () => {
      const output = "kernel.randomize_va_space = 2\n5.15.0\napparmor\n0\n1\nStorage=none\n[integrity]";
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-MODULE-BLACKLIST")!;
      expect(check.passed).toBe(true);
      expect(check.currentValue).toContain("0");
    });

    it("fails with val=19 (just below upper boundary)", () => {
      const output = "kernel.randomize_va_space = 2\n5.15.0\napparmor\n19\n1\nStorage=none\n[integrity]";
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-MODULE-BLACKLIST")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("19");
    });
  });

  describe("KRN-30 LOCKDOWN-MODE — absent lockdown", () => {
    it("fails when lockdown line is entirely absent", () => {
      const output = "kernel.randomize_va_space = 2\n5.15.0-91-generic\nN/A\n0\n0\nStorage=none";
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-LOCKDOWN-MODE")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Lockdown mode not available");
    });
  });

  describe("KRN-29 COREDUMP-SYSTEMD — config not found", () => {
    it("currentValue is 'Coredump config not found' when neither Storage nor ProcessSizeMax present", () => {
      const output = "kernel.randomize_va_space = 2\n5.15.0-91-generic\nN/A\n0\n0\n[none]";
      const checks = parseKernelChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-COREDUMP-SYSTEMD")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Coredump config not found");
    });
  });

  describe("Boolean literal inversion killers — explicit pass/fail pairs", () => {
    const booleanChecks: Array<[string, string, string, string]> = [
      ["KRN-SYN-COOKIES", "net.ipv4.tcp_syncookies", "1", "0"],
      ["KRN-TCP-TIMESTAMPS", "net.ipv4.tcp_timestamps", "0", "1"],
      ["KRN-ICMP-BROADCAST", "net.ipv4.icmp_echo_ignore_broadcasts", "1", "0"],
      ["KRN-ACCEPT-REDIRECTS-V6", "net.ipv6.conf.all.accept_redirects", "0", "1"],
      ["KRN-BPF-UNPRIVILEGED", "kernel.unprivileged_bpf_disabled", "1", "0"],
      ["KRN-MODULES-DISABLED", "kernel.modules_disabled", "1", "0"],
      ["KRN-IP-FORWARD-V6", "net.ipv6.conf.all.forwarding", "0", "1"],
      ["KRN-SEND-REDIRECTS", "net.ipv4.conf.all.send_redirects", "0", "1"],
      ["KRN-SECURE-REDIRECTS", "net.ipv4.conf.all.secure_redirects", "0", "1"],
      ["KRN-PANIC-ON-OOPS", "kernel.panic_on_oops", "1", "0"],
      ["KRN-NMI-WATCHDOG-DISABLED", "kernel.nmi_watchdog", "0", "1"],
      ["KRN-DMESG-RESTRICTED", "kernel.dmesg_restrict", "1", "0"],
    ];

    it.each(booleanChecks)(
      "%s passes with %s=%s, fails with %s=%s",
      (checkId, sysctlKey, passVal, failVal) => {
        const passChecks = parseKernelChecks(`${sysctlKey} = ${passVal}`, "bare");
        const pass = passChecks.find((c: { id: string }) => c.id === checkId)!;
        expect(pass.passed).toBe(true);
        expect(pass.currentValue).toBe(`${sysctlKey} = ${passVal}`);

        const failChecks = parseKernelChecks(`${sysctlKey} = ${failVal}`, "bare");
        const fail = failChecks.find((c: { id: string }) => c.id === checkId)!;
        expect(fail.passed).toBe(false);
        expect(fail.currentValue).toBe(`${sysctlKey} = ${failVal}`);
      },
    );
  });

  describe("Missing sysctl key — currentValue 'Unable to determine'", () => {
    const nullSysctlChecks = [
      "KRN-ASLR-ENABLED",
      "KRN-DMESG-RESTRICTED",
      "KRN-SYN-COOKIES",
      "KRN-IP-FORWARD-DISABLED",
      "KRN-TCP-TIMESTAMPS",
      "KRN-ICMP-BROADCAST",
      "KRN-ACCEPT-REDIRECTS-V6",
      "KRN-BPF-UNPRIVILEGED",
      "KRN-MODULES-DISABLED",
      "KRN-IP-FORWARD-V6",
      "KRN-SEND-REDIRECTS",
      "KRN-SECURE-REDIRECTS",
      "KRN-PANIC-ON-OOPS",
      "KRN-NMI-WATCHDOG-DISABLED",
    ];

    it.each(nullSysctlChecks)(
      "%s shows 'Unable to determine' when sysctl key absent from output",
      (checkId) => {
        const checks = parseKernelChecks("some irrelevant text only", "bare");
        const check = checks.find((c: { id: string }) => c.id === checkId)!;
        expect(check.passed).toBe(false);
        expect(check.currentValue).toBe("Unable to determine");
      },
    );
  });

  describe("KRN-KERNEL-VERSION — no version in output", () => {
    it("fails and shows 'Unable to determine kernel version' when no version pattern", () => {
      const checks = parseKernelChecks("kernel.randomize_va_space = 2\nno-version-here\nN/A", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-KERNEL-VERSION")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine kernel version");
    });
  });

  describe("KRN-24 UNPRIVILEGED-USERNS — explicit triple-state (null/0/1)", () => {
    it("fails when value is null (sysctl key absent)", () => {
      const checks = parseKernelChecks("kernel.randomize_va_space = 2", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-UNPRIVILEGED-USERNS")!;
      expect(check.passed).toBe(false);
    });

    it("passes when value is exactly 0", () => {
      const checks = parseKernelChecks("kernel.unprivileged_userns_clone = 0", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-UNPRIVILEGED-USERNS")!;
      expect(check.passed).toBe(true);
    });

    it("fails when value is 1", () => {
      const checks = parseKernelChecks("kernel.unprivileged_userns_clone = 1", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-UNPRIVILEGED-USERNS")!;
      expect(check.passed).toBe(false);
    });

    it("fails when value is 2", () => {
      const checks = parseKernelChecks("kernel.unprivileged_userns_clone = 2", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-UNPRIVILEGED-USERNS")!;
      expect(check.passed).toBe(false);
    });
  });

  describe("KRN-20 SYSRQ — negative boundary", () => {
    it("passes with kernel.sysrq = -1 (negative is <= 1)", () => {
      const checks = parseKernelChecks("kernel.sysrq = -1", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-SYSRQ-DISABLED")!;
      expect(check.passed).toBe(true);
    });
  });

  describe("KRN-21 CORE-PATTERN-SAFE — null pattern", () => {
    it("fails when core_pattern sysctl is absent", () => {
      const checks = parseKernelChecks("kernel.randomize_va_space = 2", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-CORE-PATTERN-SAFE")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine");
    });
  });

  describe("KRN-27 PANIC-REBOOT — negative value", () => {
    it("fails with kernel.panic = -1 (negative is not > 0)", () => {
      const checks = parseKernelChecks("kernel.panic = -1\n5.15.0\nN/A\n0\n0", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-PANIC-REBOOT")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("kernel.panic = -1");
    });
  });

  describe("KRN-25 EXEC-SHIELD — value 2 fails", () => {
    it("fails when exec_shield = 2 (only null or 1 pass)", () => {
      const checks = parseKernelChecks("kernel.exec_shield = 2", "bare");
      const check = checks.find((c: { id: string }) => c.id === "KRN-EXEC-SHIELD")!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("kernel.exec_shield = 2");
    });
  });
});
