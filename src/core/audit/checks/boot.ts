/**
 * Boot security check parser.
 * Checks bootloader hardening, secure boot, and kernel boot parameters.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface BootCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const BOOT_CHECKS: BootCheckDef[] = [
  {
    id: "BOOT-GRUB-PERMS",
    name: "Bootloader Config Restricted",
    severity: "warning",
    check: (output) => {
      // stat output: "400 root root" or "600 root root"
      const permMatch = output.match(/(\d{3,4})\s+root\s+root/);
      if (!permMatch) return { passed: false, currentValue: "Unable to read grub.cfg permissions" };
      const perms = permMatch[1];
      const passed = perms === "400" || perms === "600";
      return {
        passed,
        currentValue: `grub.cfg permissions: ${perms}`,
      };
    },
    expectedValue: "grub.cfg permissions 400 or 600, owned root:root",
    fixCommand: "chmod 600 /boot/grub/grub.cfg && chown root:root /boot/grub/grub.cfg",
    explain:
      "A world-readable bootloader config can reveal kernel parameters and system configuration to local attackers.",
  },
  {
    id: "BOOT-GRUB-PASSWORD",
    name: "GRUB Password Set",
    severity: "info",
    check: (output) => {
      const hasPw = /GRUB_PW_SET/i.test(output) || /set superusers/i.test(output);
      return {
        passed: hasPw,
        currentValue: hasPw ? "GRUB password is configured" : "No GRUB password set",
      };
    },
    expectedValue: "GRUB password configured to prevent unauthorized boot changes",
    fixCommand: "grub2-mkpasswd-pbkdf2 # Then add to /etc/grub.d/40_custom",
    explain:
      "Without a GRUB password, anyone with physical or console access can modify boot parameters to gain root access.",
  },
  {
    id: "BOOT-SECURE-BOOT",
    name: "Secure Boot Status",
    severity: "info",
    check: (output) => {
      if (/N\/A/i.test(output) && !/SecureBoot/i.test(output)) {
        return { passed: false, currentValue: "mokutil not available (VPS/container)" };
      }
      const enabled = /SecureBoot enabled/i.test(output);
      return {
        passed: enabled,
        currentValue: enabled ? "Secure Boot is enabled" : "Secure Boot is disabled or unavailable",
      };
    },
    expectedValue: "Secure Boot enabled (where hardware supports it)",
    fixCommand: "mokutil --enable-validation # Requires reboot and BIOS/UEFI access",
    explain:
      "Secure Boot prevents loading unsigned kernel modules and bootloaders, protecting against rootkit installation.",
  },
  {
    id: "BOOT-CMDLINE-SECURITY",
    name: "Kernel Boot Security Parameters",
    severity: "info",
    check: (output) => {
      const hasApparmor = /apparmor=1/i.test(output) || /security=/i.test(output);
      return {
        passed: hasApparmor,
        currentValue: hasApparmor
          ? "Security framework enabled in boot parameters"
          : "No security framework in kernel cmdline",
      };
    },
    expectedValue: "apparmor=1 or security= present in /proc/cmdline",
    fixCommand:
      "Edit GRUB_CMDLINE_LINUX in /etc/default/grub to include 'apparmor=1 security=apparmor' && update-grub",
    explain:
      "Kernel boot parameters should enable mandatory access control frameworks to enforce security policies.",
  },
  {
    id: "BOOT-GRUB-DIR-PERMS",
    name: "GRUB Directory Restricted",
    severity: "warning",
    check: (output) => {
      // stat of /etc/grub.d
      const match = output.match(/(\d{3,4})\s+root\s+root.*grub/);
      if (!match) return { passed: false, currentValue: "Unable to read /etc/grub.d permissions" };
      const perms = match[1];
      const othersExec = parseInt(perms.slice(-1), 10);
      const passed = othersExec === 0;
      return {
        passed,
        currentValue: `/etc/grub.d permissions: ${perms}`,
      };
    },
    expectedValue: "/etc/grub.d not accessible by others (e.g., 700 or 750)",
    fixCommand: "chmod 700 /etc/grub.d",
    explain:
      "The GRUB configuration directory contains scripts that run at boot — restricting access prevents unauthorized boot modifications.",
  },
  {
    id: "BOOT-BOOT-PARTITION",
    name: "/boot Mount Options",
    severity: "info",
    check: (output) => {
      if (!output.includes("/boot")) {
        return { passed: false, currentValue: "/boot not found as separate partition" };
      }
      const hasNosuid = /nosuid/i.test(output);
      const hasNodev = /nodev/i.test(output);
      const passed = hasNosuid || hasNodev;
      return {
        passed,
        currentValue: passed
          ? "/boot has restrictive mount options"
          : "/boot lacks nosuid/nodev mount options",
      };
    },
    expectedValue: "/boot mounted with nosuid and nodev options",
    fixCommand:
      "Edit /etc/fstab: add nosuid,nodev options for /boot partition",
    explain:
      "Restrictive mount options on /boot prevent execution of setuid binaries and device files from the boot partition.",
  },
  {
    id: "BOOT-SINGLE-USER-AUTH",
    name: "Single User Mode Authentication",
    severity: "warning",
    check: (output) => {
      const hasAuth = /sulogin/i.test(output);
      return {
        passed: hasAuth,
        currentValue: hasAuth
          ? "Single-user mode requires authentication"
          : "Single-user mode may not require password",
      };
    },
    expectedValue: "sulogin configured for single-user mode",
    fixCommand:
      "systemctl edit rescue.service # Add ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
    explain:
      "Without authentication in single-user mode, anyone with console access gets a root shell without a password.",
  },
  {
    id: "BOOT-KERNEL-MODULES",
    name: "Kernel Module Loading Restricted",
    severity: "info",
    check: (output) => {
      const restricted = /modules_disabled\s*=\s*1/i.test(output) ||
        /kernel\.modules_disabled\s*=\s*1/i.test(output);
      return {
        passed: restricted,
        currentValue: restricted
          ? "Kernel module loading is restricted"
          : "Kernel module loading is not restricted",
      };
    },
    expectedValue: "kernel.modules_disabled = 1 (after boot)",
    fixCommand:
      "echo 'kernel.modules_disabled=1' >> /etc/sysctl.d/99-hardening.conf && sysctl -p",
    explain:
      "Restricting kernel module loading after boot prevents attackers from loading rootkit kernel modules at runtime.",
  },
];

export const parseBootChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return BOOT_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Boot",
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
      category: "Boot",
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
