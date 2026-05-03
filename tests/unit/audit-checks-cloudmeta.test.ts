import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseCloudMetaChecks } from "../../src/core/audit/checks/cloudmeta.js";

describe("parseCloudMetaChecks", () => {
  const vpsOutput = [
    "IS_VPS",
    "METADATA_BLOCKED",
    "CLOUDINIT_CLEAN",
    "IMDSV2_AVAILABLE",
    "CLOUDINIT_NO_SENSITIVE_ENV",
  ].join("\n");

  const vpsFailOutput = [
    "IS_VPS",
    "METADATA_ACCESSIBLE",
    "password=supersecret",
    "token: ghp_abc123",
    "IMDSV2_UNAVAILABLE",
  ].join("\n");

  describe("BARE_METAL skip logic", () => {
    it("returns empty array for BARE_METAL sentinel", () => {
      const checks = parseCloudMetaChecks("BARE_METAL", "bare");
      expect(checks).toHaveLength(0);
    });

    it("returns empty array for empty input", () => {
      const checks = parseCloudMetaChecks("", "bare");
      expect(checks).toHaveLength(0);
    });

    it("returns empty array for N/A input", () => {
      const checks = parseCloudMetaChecks("N/A", "bare");
      expect(checks).toHaveLength(0);
    });
  });

  describe("IS_VPS — check count and shape", () => {
    it("returns at least 6 checks when IS_VPS sentinel present", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      expect(checks.length).toBeGreaterThanOrEqual(6);
    });

    it("all check IDs start with CLOUDMETA-", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      checks.forEach((c) => expect(c.id).toMatch(/^CLOUDMETA-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'Cloud Metadata' on all checks", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      checks.forEach((c) => expect(c.category).toBe("Cloud Metadata"));
    });
  });

  describe("IS_VPS — severity budget", () => {
    it("critical checks <= 40% of total", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount / checks.length).toBeLessThanOrEqual(0.4);
    });
  });

  describe("CLOUDMETA-ENDPOINT-BLOCKED", () => {
    it("passes when METADATA_BLOCKED sentinel present", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-ENDPOINT-BLOCKED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when METADATA_ACCESSIBLE sentinel present", () => {
      const checks = parseCloudMetaChecks(vpsFailOutput, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-ENDPOINT-BLOCKED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("CLOUDMETA-INIT-LOG-CLEAN", () => {
    it("passes when CLOUDINIT_CLEAN sentinel present", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-INIT-LOG-CLEAN");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when credential-like lines found in cloud-init output", () => {
      const checks = parseCloudMetaChecks(vpsFailOutput, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-INIT-LOG-CLEAN");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("CLOUDMETA-IMDSV2-ENFORCED", () => {
    it("passes when IMDSV2_AVAILABLE sentinel present", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-IMDSV2-ENFORCED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when IMDSV2_UNAVAILABLE sentinel present", () => {
      const checks = parseCloudMetaChecks(vpsFailOutput, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-IMDSV2-ENFORCED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("CLOUDMETA-IMDSV1-DISABLED", () => {
    it("passes when METADATA_BLOCKED sentinel present", () => {
      const checks = parseCloudMetaChecks(vpsOutput, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-IMDSV1-DISABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when IMDSV2_AVAILABLE sentinel present", () => {
      const output = "IS_VPS\nIMDSV2_AVAILABLE\nCLOUDINIT_CLEAN";
      const checks = parseCloudMetaChecks(output, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-IMDSV1-DISABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when neither METADATA_BLOCKED nor IMDSV2_AVAILABLE present", () => {
      const checks = parseCloudMetaChecks(vpsFailOutput, "coolify");
      const check = checks.find((c) => c.id === "CLOUDMETA-IMDSV1-DISABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });
});
