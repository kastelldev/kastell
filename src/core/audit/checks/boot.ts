/**
 * Boot security check parser.
 * Checks bootloader hardening, secure boot, and kernel boot parameters.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface BootCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
  vpsIrrelevant?: boolean;
}

const BOOT_CHECKS: BootCheckDef[] = [
  {
    id: CHECK_IDS.BOOT.BOOT_GRUB_PERMS,
    name: "Bootloader Config Restricted",
    severity: "warning",
    vpsIrrelevant: true,
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
    safeToAutoFix: "SAFE",
    explain:
      "A world-readable bootloader config can reveal kernel parameters and system configuration to local attackers.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_GRUB_PASSWORD,
    name: "GRUB Password Set",
    severity: "info",
    vpsIrrelevant: true,
    check: (output) => {
      const hasPw = /GRUB_PW_SET/i.test(output) || /set superusers/i.test(output);
      return {
        passed: hasPw,
        currentValue: hasPw ? "GRUB password is configured" : "No GRUB password set",
      };
    },
    expectedValue: "GRUB password configured to prevent unauthorized boot changes",
    fixCommand: "grub-mkpasswd-pbkdf2 # Then add to /etc/grub.d/40_custom",
    safeToAutoFix: "SAFE",
    explain:
      "Without a GRUB password, anyone with physical or console access can modify boot parameters to gain root access.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_SECURE_BOOT,
    name: "Secure Boot Status",
    severity: "info",
    vpsIrrelevant: true,
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
    safeToAutoFix: "SAFE",
    explain:
      "Secure Boot prevents loading unsigned kernel modules and bootloaders, protecting against rootkit installation.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_CMDLINE_SECURITY,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Kernel boot parameters should enable mandatory access control frameworks to enforce security policies.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_GRUB_DIR_PERMS,
    name: "GRUB Directory Restricted",
    severity: "warning",
    vpsIrrelevant: true,
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
    safeToAutoFix: "SAFE",
    explain:
      "The GRUB configuration directory contains scripts that run at boot — restricting access prevents unauthorized boot modifications.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_BOOT_PARTITION,
    name: "/boot Mount Options",
    severity: "info",
    vpsIrrelevant: true,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Restrictive mount options on /boot prevent execution of setuid binaries and device files from the boot partition.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_SINGLE_USER_AUTH,
    name: "Single User Mode Authentication",
    severity: "warning",
    vpsIrrelevant: true,
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
    safeToAutoFix: "SAFE",
    explain:
      "Without authentication in single-user mode, anyone with console access gets a root shell without a password.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_KERNEL_MODULES,
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
    safeToAutoFix: "SAFE",
    explain:
      "Restricting kernel module loading after boot prevents attackers from loading rootkit kernel modules at runtime.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_UEFI_SECURE,
    name: "System Uses UEFI Boot",
    severity: "info",
    vpsIrrelevant: true,
    check: (output) => {
      const isUefi = /\bUEFI\b/.test(output);
      return {
        passed: isUefi,
        currentValue: isUefi ? "System boots via UEFI" : "System boots via BIOS (legacy)",
      };
    },
    expectedValue: "System uses UEFI boot mode",
    fixCommand: "# UEFI vs BIOS is a hardware/firmware setting — configure via BIOS setup",
    safeToAutoFix: "GUARDED",
    explain:
      "UEFI boot supports Secure Boot which verifies bootloader integrity, preventing boot-level rootkits.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_RESCUE_AUTH,
    name: "Rescue/Emergency Mode Requires Authentication",
    severity: "warning",
    vpsIrrelevant: true,
    check: (output) => {
      const hasAuth = /sulogin/i.test(output);
      return {
        passed: hasAuth,
        currentValue: hasAuth
          ? "Rescue/emergency mode requires authentication (sulogin found)"
          : "Rescue/emergency mode may not require authentication",
      };
    },
    expectedValue: "sulogin reference found in rescue.service or emergency.service",
    fixCommand:
      "systemctl edit rescue.service  # Add ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
    safeToAutoFix: "SAFE",
    explain:
      "Without authentication on rescue mode, physical or console access grants immediate root shell.",
  },
  {
    id: CHECK_IDS.BOOT.BOOT_GRUB_UNRESTRICTED,
    name: "GRUB Bootloader Has Password Authentication",
    severity: "info",
    vpsIrrelevant: true,
    check: (output) => {
      // grep for 'set superusers' or 'password_pbkdf2' in grub config
      // Returns matching lines or "NONE"
      const isNone = /^NONE$/m.test(output);
      const hasSuperusers = /set superusers/i.test(output);
      const hasPbkdf2 = /password_pbkdf2/i.test(output);
      const passed = !isNone && (hasSuperusers || hasPbkdf2);
      return {
        passed,
        currentValue: passed
          ? "GRUB superuser authentication is configured"
          : "GRUB has no superuser/password authentication",
      };
    },
    expectedValue: "GRUB superuser and password_pbkdf2 entries configured",
    fixCommand: "Configure GRUB superuser: grub-mkpasswd-pbkdf2 && update-grub",
    safeToAutoFix: "GUARDED",
    explain:
      "GRUB superuser authentication prevents unauthorized kernel parameter modification at boot time, blocking single-user mode attacks.",
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
    const { passed, currentValue } = isNA
      ? { passed: false, currentValue: "Unable to determine" }
      : def.check(output);
    return {
      id: def.id,
      category: "Boot",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      safeToAutoFix: def.safeToAutoFix,
      explain: def.explain,
      ...(def.vpsIrrelevant !== undefined && { vpsIrrelevant: def.vpsIrrelevant }),
    };
  });
};
