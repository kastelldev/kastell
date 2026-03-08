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
    ].join("\n"),
    // Old kernel
    "4.15.0-20-generic",
    // No security modules
    "N/A",
  ].join("\n");

  it("should return 5 checks", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    expect(checks).toHaveLength(5);
    checks.forEach((check) => {
      expect(check.category).toBe("Kernel");
      expect(check.id).toMatch(/^KRN-0[1-5]$/);
    });
  });

  it("should return KRN-01 passed when ASLR=2", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const krn01 = checks.find((c: { id: string }) => c.id === "KRN-01");
    expect(krn01!.passed).toBe(true);
  });

  it("should return KRN-01 failed when ASLR=0 (critical)", () => {
    const checks = parseKernelChecks(insecureOutput, "bare");
    const krn01 = checks.find((c: { id: string }) => c.id === "KRN-01");
    expect(krn01!.passed).toBe(false);
    expect(krn01!.severity).toBe("critical");
  });

  it("should return KRN-02 passed when core_uses_pid=1 (indicating core dump controls)", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const krn02 = checks.find((c: { id: string }) => c.id === "KRN-02");
    expect(krn02).toBeDefined();
  });

  it("should return KRN-03 for kernel hardening sysctls", () => {
    const checks = parseKernelChecks(secureOutput, "bare");
    const krn03 = checks.find((c: { id: string }) => c.id === "KRN-03");
    expect(krn03).toBeDefined();
    expect(krn03!.passed).toBe(true);
  });

  it("should return KRN-03 failed with insecure sysctls", () => {
    const checks = parseKernelChecks(insecureOutput, "bare");
    const krn03 = checks.find((c: { id: string }) => c.id === "KRN-03");
    expect(krn03!.passed).toBe(false);
  });

  it("should return KRN-05 for dmesg restrict", () => {
    const outputWithDmesg = secureOutput + "\nkernel.dmesg_restrict = 1";
    const checks = parseKernelChecks(outputWithDmesg, "bare");
    const krn05 = checks.find((c: { id: string }) => c.id === "KRN-05");
    expect(krn05).toBeDefined();
    expect(krn05!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseKernelChecks("N/A", "bare");
    expect(checks).toHaveLength(5);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });
});
