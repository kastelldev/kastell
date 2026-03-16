/**
 * Unit tests for VPS type extraction and adjustment utilities.
 * Covers extractVpsType and applyVpsAdjustments from vps.ts.
 */

import { applyVpsAdjustments, extractVpsType } from "../../src/core/audit/vps.js";
import type { AuditCategory } from "../../src/core/audit/types.js";

describe("extractVpsType", () => {
  it("returns 'kvm' when input contains VPS_TYPE:kvm", () => {
    expect(extractVpsType(["some output\nVPS_TYPE:kvm\nmore output"])).toBe("kvm");
  });

  it("returns 'xen' when input contains VPS_TYPE:xen", () => {
    expect(extractVpsType(["VPS_TYPE:xen"])).toBe("xen");
  });

  it("returns null when input contains BARE_METAL", () => {
    expect(extractVpsType(["BARE_METAL"])).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractVpsType([""])).toBeNull();
    expect(extractVpsType([])).toBeNull();
  });
});

describe("applyVpsAdjustments", () => {
  const makeCategory = (checks: AuditCategory["checks"]): AuditCategory => ({
    name: "Test",
    checks,
    score: 50,
    maxScore: 100,
  });

  it("returns categories unchanged and adjustedCount=0 on bare metal (vpsType=null)", () => {
    const categories: AuditCategory[] = [
      makeCategory([
        {
          id: "BOOT-GRUB-PERMS",
          category: "Boot",
          name: "GRUB Perms",
          severity: "warning",
          passed: false,
          currentValue: "644",
          expectedValue: "600",
          fixCommand: "chmod 600 /boot/grub/grub.cfg",
          explain: "Restricts access to bootloader config.",
          vpsIrrelevant: true,
        },
      ]),
    ];

    const { categories: result, adjustedCount } = applyVpsAdjustments(categories, null);

    expect(adjustedCount).toBe(0);
    expect(result).toBe(categories); // same reference — no copy on bare metal
    expect(result[0].checks[0].severity).toBe("warning");
  });

  it("downgrades vpsIrrelevant warning check to info on VPS, adjustedCount=1", () => {
    const vpsCheck = {
      id: "BOOT-GRUB-PERMS",
      category: "Boot",
      name: "GRUB Perms",
      severity: "warning" as const,
      passed: false,
      currentValue: "644",
      expectedValue: "600",
      fixCommand: "chmod 600 /boot/grub/grub.cfg",
      explain: "Restricts access to bootloader config.",
      vpsIrrelevant: true as const,
    };
    const normalCheck = {
      id: "BOOT-CMDLINE-SECURITY",
      category: "Boot",
      name: "Kernel Cmdline",
      severity: "warning" as const,
      passed: false,
      currentValue: "no apparmor",
      expectedValue: "apparmor=1",
      fixCommand: "edit /etc/default/grub",
      explain: "Kernel boot parameters should enable MAC.",
    };

    const categories: AuditCategory[] = [makeCategory([vpsCheck, normalCheck])];
    const { categories: result, adjustedCount } = applyVpsAdjustments(categories, "kvm");

    expect(adjustedCount).toBe(1);
    expect(result[0].checks[0].severity).toBe("info");
    expect(result[0].checks[1].severity).toBe("warning"); // unchanged
  });

  it("does not double-count checks already at severity info", () => {
    const alreadyInfoCheck = {
      id: "BOOT-GRUB-PASSWORD",
      category: "Boot",
      name: "GRUB Password",
      severity: "info" as const,
      passed: false,
      currentValue: "no password",
      expectedValue: "password set",
      fixCommand: "grub2-mkpasswd-pbkdf2",
      explain: "GRUB password prevents unauthorized changes.",
      vpsIrrelevant: true as const,
    };

    const categories: AuditCategory[] = [makeCategory([alreadyInfoCheck])];
    const { adjustedCount } = applyVpsAdjustments(categories, "kvm");

    expect(adjustedCount).toBe(0);
  });

  it("does not mutate original categories (immutable spread)", () => {
    const original = {
      id: "BOOT-GRUB-PERMS",
      category: "Boot",
      name: "GRUB Perms",
      severity: "warning" as const,
      passed: false,
      currentValue: "644",
      expectedValue: "600",
      fixCommand: "chmod 600 /boot/grub/grub.cfg",
      explain: "Restricts access to bootloader config.",
      vpsIrrelevant: true as const,
    };
    const categories: AuditCategory[] = [makeCategory([original])];

    const { categories: result } = applyVpsAdjustments(categories, "kvm");

    expect(result).not.toBe(categories);
    expect(result[0]).not.toBe(categories[0]);
    expect(result[0].checks[0]).not.toBe(categories[0].checks[0]);
    expect(original.severity).toBe("warning"); // original unchanged
  });
});
