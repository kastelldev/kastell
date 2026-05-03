import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseBootChecks } from "../../src/core/audit/checks/boot.js";

describe("parseBootChecks", () => {
  const secureOutput = [
    "600 root root",
    "GRUB_PW_SET",
    "SecureBoot enabled",
    "BOOT_IMAGE=/vmlinuz root=/dev/sda1 apparmor=1 security=apparmor",
    "700 root root /etc/grub.d",
    "/boot ext4 rw,nosuid,nodev 0 0",
    "/usr/lib/systemd/system/rescue.service:ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
    "kernel.modules_disabled = 1",
    "UEFI",
    // GRUB superuser/pbkdf2 auth (BOOT-GRUB-UNRESTRICTED)
    "set superusers=\"admin\"",
    "password_pbkdf2 admin grub.pbkdf2.sha512.10000.xyz",
  ].join("\n");

  const insecureOutput = [
    "644 root root",
    "GRUB_NO_PW",
    "N/A",
    "BOOT_IMAGE=/vmlinuz root=/dev/sda1",
    "755 root root /etc/grub.d",
    "N/A",
    "N/A",
    "kernel.modules_disabled = 0",
    "BIOS",
  ].join("\n");

  it("should return 11 checks for the Boot category", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    expect(checks).toHaveLength(11);
    checks.forEach((c) => expect(c.category).toBe("Boot"));
  });

  it("all check IDs should start with BOOT-", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^BOOT-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("BOOT-GRUB-PERMS passes with 600 root:root", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-PERMS");
    expect(check!.passed).toBe(true);
  });

  it("BOOT-GRUB-PERMS fails with 644", () => {
    const checks = parseBootChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-PERMS");
    expect(check!.passed).toBe(false);
  });

  it("BOOT-GRUB-PASSWORD passes when GRUB_PW_SET", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-PASSWORD");
    expect(check!.passed).toBe(true);
  });

  it("BOOT-GRUB-PASSWORD fails when GRUB_NO_PW", () => {
    const checks = parseBootChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-PASSWORD");
    expect(check!.passed).toBe(false);
  });

  it("BOOT-SECURE-BOOT passes when SecureBoot enabled", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-SECURE-BOOT");
    expect(check!.passed).toBe(true);
  });

  it("BOOT-SINGLE-USER-AUTH passes when sulogin configured", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-SINGLE-USER-AUTH");
    expect(check!.passed).toBe(true);
  });

  it("BOOT-UEFI-SECURE passes when UEFI detected", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-UEFI-SECURE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("BOOT-UEFI-SECURE fails when BIOS detected", () => {
    const checks = parseBootChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-UEFI-SECURE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("BOOT-RESCUE-AUTH passes when sulogin configured", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-RESCUE-AUTH");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseBootChecks("N/A", "bare");
    expect(checks).toHaveLength(11);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("BOOT-GRUB-UNRESTRICTED passes when set superusers and password_pbkdf2 present", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-UNRESTRICTED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/superuser authentication/i);
  });

  it("BOOT-GRUB-UNRESTRICTED fails when NONE sentinel (no superuser config)", () => {
    const output = insecureOutput + "\nNONE";
    const checks = parseBootChecks(output, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-UNRESTRICTED");
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/no superuser/i);
  });
});

describe("[MUTATION-KILLER] Boot check string assertions", () => {
  const secureOutput = [
    "600 root root",
    "GRUB_PW_SET",
    "SecureBoot enabled",
    "BOOT_IMAGE=/vmlinuz root=/dev/sda1 apparmor=1 security=apparmor",
    "700 root root /etc/grub.d",
    "/boot ext4 rw,nosuid,nodev 0 0",
    "/usr/lib/systemd/system/rescue.service:ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
    "kernel.modules_disabled = 1",
    "UEFI",
    "set superusers=\"admin\"",
    "password_pbkdf2 admin grub.pbkdf2.sha512.10000.xyz",
  ].join("\n");

  const checks = parseBootChecks(secureOutput, "bare");

  const expectedChecks = [
    {
      id: "BOOT-GRUB-PERMS",
      name: "Bootloader Config Restricted",
      severity: "warning",
      expectedValue: "grub.cfg permissions 400 or 600, owned root:root",
      fixCommand: "chmod 600 /boot/grub/grub.cfg && chown root:root /boot/grub/grub.cfg",
      safeToAutoFix: "SAFE",
      explain: "A world-readable bootloader config can reveal kernel parameters and system configuration to local attackers.",
    },
    {
      id: "BOOT-GRUB-PASSWORD",
      name: "GRUB Password Set",
      severity: "info",
      expectedValue: "GRUB password configured to prevent unauthorized boot changes",
      fixCommand: "grub-mkpasswd-pbkdf2 # Then add to /etc/grub.d/40_custom",
      safeToAutoFix: "SAFE",
      explain: "Without a GRUB password, anyone with physical or console access can modify boot parameters to gain root access.",
    },
    {
      id: "BOOT-SECURE-BOOT",
      name: "Secure Boot Status",
      severity: "info",
      expectedValue: "Secure Boot enabled (where hardware supports it)",
      fixCommand: "mokutil --enable-validation # Requires reboot and BIOS/UEFI access",
      safeToAutoFix: "SAFE",
      explain: "Secure Boot prevents loading unsigned kernel modules and bootloaders, protecting against rootkit installation.",
    },
    {
      id: "BOOT-CMDLINE-SECURITY",
      name: "Kernel Boot Security Parameters",
      severity: "info",
      expectedValue: "apparmor=1 or security= present in /proc/cmdline",
      fixCommand: "Edit GRUB_CMDLINE_LINUX in /etc/default/grub to include 'apparmor=1 security=apparmor' && update-grub",
      safeToAutoFix: "GUARDED",
      explain: "Kernel boot parameters should enable mandatory access control frameworks to enforce security policies.",
    },
    {
      id: "BOOT-GRUB-DIR-PERMS",
      name: "GRUB Directory Restricted",
      severity: "warning",
      expectedValue: "/etc/grub.d not accessible by others (e.g., 700 or 750)",
      fixCommand: "chmod 700 /etc/grub.d",
      safeToAutoFix: "SAFE",
      explain: "The GRUB configuration directory contains scripts that run at boot — restricting access prevents unauthorized boot modifications.",
    },
    {
      id: "BOOT-BOOT-PARTITION",
      name: "/boot Mount Options",
      severity: "info",
      expectedValue: "/boot mounted with nosuid and nodev options",
      fixCommand: "Edit /etc/fstab: add nosuid,nodev options for /boot partition",
      safeToAutoFix: "GUARDED",
      explain: "Restrictive mount options on /boot prevent execution of setuid binaries and device files from the boot partition.",
    },
    {
      id: "BOOT-SINGLE-USER-AUTH",
      name: "Single User Mode Authentication",
      severity: "warning",
      expectedValue: "sulogin configured for single-user mode",
      fixCommand: "systemctl edit rescue.service # Add ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
      safeToAutoFix: "SAFE",
      explain: "Without authentication in single-user mode, anyone with console access gets a root shell without a password.",
    },
    {
      id: "BOOT-KERNEL-MODULES",
      name: "Kernel Module Loading Restricted",
      severity: "info",
      expectedValue: "kernel.modules_disabled = 1 (after boot)",
      fixCommand: "echo 'kernel.modules_disabled=1' >> /etc/sysctl.d/99-hardening.conf && sysctl -p",
      safeToAutoFix: "SAFE",
      explain: "Restricting kernel module loading after boot prevents attackers from loading rootkit kernel modules at runtime.",
    },
    {
      id: "BOOT-UEFI-SECURE",
      name: "System Uses UEFI Boot",
      severity: "info",
      expectedValue: "System uses UEFI boot mode",
      fixCommand: "# UEFI vs BIOS is a hardware/firmware setting — configure via BIOS setup",
      safeToAutoFix: "GUARDED",
      explain: "UEFI boot supports Secure Boot which verifies bootloader integrity, preventing boot-level rootkits.",
    },
    {
      id: "BOOT-RESCUE-AUTH",
      name: "Rescue/Emergency Mode Requires Authentication",
      severity: "warning",
      expectedValue: "sulogin reference found in rescue.service or emergency.service",
      fixCommand: "systemctl edit rescue.service  # Add ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
      safeToAutoFix: "SAFE",
      explain: "Without authentication on rescue mode, physical or console access grants immediate root shell.",
    },
    {
      id: "BOOT-GRUB-UNRESTRICTED",
      name: "GRUB Bootloader Has Password Authentication",
      severity: "info",
      expectedValue: "GRUB superuser and password_pbkdf2 entries configured",
      fixCommand: "Configure GRUB superuser: grub-mkpasswd-pbkdf2 && update-grub",
      safeToAutoFix: "GUARDED",
      explain: "GRUB superuser authentication prevents unauthorized kernel parameter modification at boot time, blocking single-user mode attacks.",
    },
  ];

  it("[MUTATION-KILLER] returns exactly 11 checks", () => {
    expect(checks).toHaveLength(11);
    expect(expectedChecks).toHaveLength(11);
  });

  expectedChecks.forEach((expected) => {
    describe(`${expected.id}`, () => {
      it("[MUTATION-KILLER] has correct id", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check).toBeDefined();
        expect(check!.id).toBe(expected.id);
      });

      it("[MUTATION-KILLER] has correct name", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.name).toBe(expected.name);
      });

      it("[MUTATION-KILLER] has correct severity", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.severity).toBe(expected.severity);
      });

      it("[MUTATION-KILLER] has correct category", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.category).toBe("Boot");
      });

      it("[MUTATION-KILLER] has correct expectedValue", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.expectedValue).toBe(expected.expectedValue);
      });

      it("[MUTATION-KILLER] has correct fixCommand", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.fixCommand).toBe(expected.fixCommand);
      });

      it("[MUTATION-KILLER] has correct explain", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.explain).toBe(expected.explain);
      });

      it("[MUTATION-KILLER] has correct safeToAutoFix", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.safeToAutoFix).toBe(expected.safeToAutoFix);
      });
    });
  });

  it("[MUTATION-KILLER] every check has non-empty fixCommand", () => {
    checks.forEach((c) => {
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty explain (> 10 chars)", () => {
    checks.forEach((c) => {
      expect(c.explain).toBeDefined();
      expect(c.explain!.length).toBeGreaterThan(10);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty name", () => {
    checks.forEach((c) => {
      expect(c.name.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty id", () => {
    checks.forEach((c) => {
      expect(c.id.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty expectedValue", () => {
    checks.forEach((c) => {
      expect(c.expectedValue.length).toBeGreaterThan(0);
    });
  });
});

describe("[MUTATION-KILLER] Boot N/A output string assertions", () => {
  const naChecks = parseBootChecks("N/A", "bare");

  it("[MUTATION-KILLER] every N/A check has currentValue 'Unable to determine'", () => {
    naChecks.forEach((c) => {
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("[MUTATION-KILLER] every N/A check has category Boot", () => {
    naChecks.forEach((c) => {
      expect(c.category).toBe("Boot");
    });
  });

  it("[MUTATION-KILLER] N/A check count matches expected", () => {
    expect(naChecks).toHaveLength(11);
  });

  it("[MUTATION-KILLER] N/A output preserves all check IDs", () => {
    const ids = naChecks.map((c) => c.id);
    expect(ids).toContain("BOOT-GRUB-PERMS");
    expect(ids).toContain("BOOT-GRUB-PASSWORD");
    expect(ids).toContain("BOOT-SECURE-BOOT");
    expect(ids).toContain("BOOT-CMDLINE-SECURITY");
    expect(ids).toContain("BOOT-GRUB-DIR-PERMS");
    expect(ids).toContain("BOOT-BOOT-PARTITION");
    expect(ids).toContain("BOOT-SINGLE-USER-AUTH");
    expect(ids).toContain("BOOT-KERNEL-MODULES");
    expect(ids).toContain("BOOT-UEFI-SECURE");
    expect(ids).toContain("BOOT-RESCUE-AUTH");
    expect(ids).toContain("BOOT-GRUB-UNRESTRICTED");
  });
});

describe("[MUTATION-KILLER] Boot currentValue strings for secure output", () => {
  const secureOutput = [
    "600 root root",
    "GRUB_PW_SET",
    "SecureBoot enabled",
    "BOOT_IMAGE=/vmlinuz root=/dev/sda1 apparmor=1 security=apparmor",
    "700 root root /etc/grub.d",
    "/boot ext4 rw,nosuid,nodev 0 0",
    "/usr/lib/systemd/system/rescue.service:ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
    "kernel.modules_disabled = 1",
    "UEFI",
    "set superusers=\"admin\"",
    "password_pbkdf2 admin grub.pbkdf2.sha512.10000.xyz",
  ].join("\n");

  const checks = parseBootChecks(secureOutput, "bare");

  it("[MUTATION-KILLER] BOOT-GRUB-PERMS currentValue contains permissions", () => {
    const check = checks.find((c) => c.id === "BOOT-GRUB-PERMS");
    expect(check!.currentValue).toBe("grub.cfg permissions: 600");
  });

  it("[MUTATION-KILLER] BOOT-GRUB-PASSWORD currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-GRUB-PASSWORD");
    expect(check!.currentValue).toBe("GRUB password is configured");
  });

  it("[MUTATION-KILLER] BOOT-SECURE-BOOT currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-SECURE-BOOT");
    expect(check!.currentValue).toBe("Secure Boot is enabled");
  });

  it("[MUTATION-KILLER] BOOT-CMDLINE-SECURITY currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-CMDLINE-SECURITY");
    expect(check!.currentValue).toBe("Security framework enabled in boot parameters");
  });

  it("[MUTATION-KILLER] BOOT-GRUB-DIR-PERMS currentValue contains permissions", () => {
    const check = checks.find((c) => c.id === "BOOT-GRUB-DIR-PERMS");
    expect(check!.currentValue).toBe("/etc/grub.d permissions: 700");
  });

  it("[MUTATION-KILLER] BOOT-BOOT-PARTITION currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-BOOT-PARTITION");
    expect(check!.currentValue).toBe("/boot has restrictive mount options");
  });

  it("[MUTATION-KILLER] BOOT-SINGLE-USER-AUTH currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-SINGLE-USER-AUTH");
    expect(check!.currentValue).toBe("Single-user mode requires authentication");
  });

  it("[MUTATION-KILLER] BOOT-KERNEL-MODULES currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-KERNEL-MODULES");
    expect(check!.currentValue).toBe("Kernel module loading is restricted");
  });

  it("[MUTATION-KILLER] BOOT-UEFI-SECURE currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-UEFI-SECURE");
    expect(check!.currentValue).toBe("System boots via UEFI");
  });

  it("[MUTATION-KILLER] BOOT-RESCUE-AUTH currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-RESCUE-AUTH");
    expect(check!.currentValue).toBe("Rescue/emergency mode requires authentication (sulogin found)");
  });

  it("[MUTATION-KILLER] BOOT-GRUB-UNRESTRICTED currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BOOT-GRUB-UNRESTRICTED");
    expect(check!.currentValue).toBe("GRUB superuser authentication is configured");
  });
});

describe("[MUTATION-KILLER] Boot currentValue strings for insecure output", () => {
  const insecureOutput = [
    "644 root root",
    "GRUB_NO_PW",
    "N/A",
    "BOOT_IMAGE=/vmlinuz root=/dev/sda1",
    "755 root root /etc/grub.d",
    "N/A",
    "N/A",
    "kernel.modules_disabled = 0",
    "BIOS",
  ].join("\n");

  const checks = parseBootChecks(insecureOutput, "bare");

  it("[MUTATION-KILLER] BOOT-GRUB-PERMS insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BOOT-GRUB-PERMS");
    expect(check!.currentValue).toBe("grub.cfg permissions: 644");
  });

  it("[MUTATION-KILLER] BOOT-GRUB-PASSWORD insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BOOT-GRUB-PASSWORD");
    expect(check!.currentValue).toBe("No GRUB password set");
  });

  it("[MUTATION-KILLER] BOOT-SECURE-BOOT insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BOOT-SECURE-BOOT");
    expect(check!.currentValue).toBe("mokutil not available (VPS/container)");
  });

  it("[MUTATION-KILLER] BOOT-CMDLINE-SECURITY insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BOOT-CMDLINE-SECURITY");
    expect(check!.currentValue).toBe("No security framework in kernel cmdline");
  });

  it("[MUTATION-KILLER] BOOT-BOOT-PARTITION insecure currentValue when no /boot", () => {
    // insecureOutput has "N/A" for /boot, not a real partition
    const check = checks.find((c) => c.id === "BOOT-BOOT-PARTITION");
    expect(check!.currentValue).toBe("/boot not found as separate partition");
  });

  it("[MUTATION-KILLER] BOOT-KERNEL-MODULES insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BOOT-KERNEL-MODULES");
    expect(check!.currentValue).toBe("Kernel module loading is not restricted");
  });

  it("[MUTATION-KILLER] BOOT-UEFI-SECURE insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BOOT-UEFI-SECURE");
    expect(check!.currentValue).toBe("System boots via BIOS (legacy)");
  });

  it("[MUTATION-KILLER] BOOT-GRUB-UNRESTRICTED insecure currentValue (no NONE sentinel)", () => {
    // Without NONE sentinel but also without superusers/pbkdf2
    const check = checks.find((c) => c.id === "BOOT-GRUB-UNRESTRICTED");
    expect(check!.currentValue).toBe("GRUB has no superuser/password authentication");
  });
});

describe("[MUTATION-KILLER] Boot vpsIrrelevant flag assertions", () => {
  const secureOutput = [
    "600 root root",
    "GRUB_PW_SET",
    "SecureBoot enabled",
    "BOOT_IMAGE=/vmlinuz root=/dev/sda1 apparmor=1 security=apparmor",
    "700 root root /etc/grub.d",
    "/boot ext4 rw,nosuid,nodev 0 0",
    "/usr/lib/systemd/system/rescue.service:ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
    "kernel.modules_disabled = 1",
    "UEFI",
    "set superusers=\"admin\"",
    "password_pbkdf2 admin grub.pbkdf2.sha512.10000.xyz",
  ].join("\n");

  const checks = parseBootChecks(secureOutput, "bare");

  const vpsIrrelevantIds = [
    "BOOT-GRUB-PERMS",
    "BOOT-GRUB-PASSWORD",
    "BOOT-SECURE-BOOT",
    "BOOT-GRUB-DIR-PERMS",
    "BOOT-BOOT-PARTITION",
    "BOOT-SINGLE-USER-AUTH",
    "BOOT-UEFI-SECURE",
    "BOOT-RESCUE-AUTH",
    "BOOT-GRUB-UNRESTRICTED",
  ];

  const vpsRelevantIds = [
    "BOOT-CMDLINE-SECURITY",
    "BOOT-KERNEL-MODULES",
  ];

  vpsIrrelevantIds.forEach((id) => {
    it(`[MUTATION-KILLER] ${id} has vpsIrrelevant=true`, () => {
      const check = checks.find((c) => c.id === id);
      expect(check).toBeDefined();
      expect((check as unknown as Record<string, unknown>).vpsIrrelevant).toBe(true);
    });
  });

  vpsRelevantIds.forEach((id) => {
    it(`[MUTATION-KILLER] ${id} does not have vpsIrrelevant flag`, () => {
      const check = checks.find((c) => c.id === id);
      expect(check).toBeDefined();
      expect((check as unknown as Record<string, unknown>).vpsIrrelevant).toBeUndefined();
    });
  });
});
