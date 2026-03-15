import { parseBackupChecks } from "../../src/core/audit/checks/backup.js";

describe("parseBackupChecks", () => {
  const validOutput = [
    "KASTELL_BACKUP_FOUND",
    "BACKUP_FILE_PERMS:600:root:root",
    "BACKUP_SCRIPT_PERMS_OK",
    "BACKUP_TOOL_INSTALLED:rsync",
    "BACKUP_CRON_JOB_FOUND",
    "VAR_BACKUPS_EXISTS",
  ].join("\n");

  const badOutput = [
    "KASTELL_BACKUP_MISSING",
    "BACKUP_FILE_PERMS:777:nobody:nogroup",
    "BACKUP_SCRIPT_PERMS_WRITABLE",
    "BACKUP_TOOL_NOT_INSTALLED",
    "BACKUP_CRON_JOB_NOT_FOUND",
    "VAR_BACKUPS_MISSING",
  ].join("\n");

  describe("N/A handling", () => {
    it("returns checks with passed=false and currentValue='Unable to determine' for N/A input", () => {
      const checks = parseBackupChecks("N/A", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("returns checks with passed=false for empty string input", () => {
      const checks = parseBackupChecks("", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("check count and shape", () => {
    it("returns at least 6 checks", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      expect(checks.length).toBeGreaterThanOrEqual(6);
    });

    it("all check IDs start with BACKUP-", () => {
      const checks = parseBackupChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^BACKUP-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseBackupChecks("", "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseBackupChecks("", "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'Backup Hygiene' on all checks", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("Backup Hygiene"));
    });
  });

  describe("severity budget", () => {
    it("has at most 40% critical severity checks", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount / checks.length).toBeLessThanOrEqual(0.4);
    });
  });

  describe("BACKUP-RECENT-BACKUP", () => {
    it("passes when KASTELL_BACKUP_FOUND is present", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-RECENT-BACKUP");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when KASTELL_BACKUP_MISSING is present", () => {
      const checks = parseBackupChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-RECENT-BACKUP");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("BACKUP-ENCRYPTION-PRESENT", () => {
    it("passes when backup file has 600 permissions owned by root", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-ENCRYPTION-PRESENT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when backup file has 777 permissions", () => {
      const checks = parseBackupChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-ENCRYPTION-PRESENT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("passes with 640 permissions and root owner", () => {
      const output = validOutput.replace("BACKUP_FILE_PERMS:600:root:root", "BACKUP_FILE_PERMS:640:root:root");
      const checks = parseBackupChecks(output, "bare");
      const check = checks.find((c) => c.id === "BACKUP-ENCRYPTION-PRESENT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });

  describe("BACKUP-SCRIPT-PERMS", () => {
    it("passes when BACKUP_SCRIPT_PERMS_OK", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-SCRIPT-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when BACKUP_SCRIPT_PERMS_WRITABLE", () => {
      const checks = parseBackupChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-SCRIPT-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("BACKUP-TOOL-INSTALLED", () => {
    it("passes when a backup tool is installed", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-TOOL-INSTALLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no backup tool is installed", () => {
      const checks = parseBackupChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-TOOL-INSTALLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("BACKUP-CRON-JOB", () => {
    it("passes when a cron backup job is found", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-CRON-JOB");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no cron backup job found", () => {
      const checks = parseBackupChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-CRON-JOB");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("BACKUP-VAR-BACKUPS", () => {
    it("passes when /var/backups exists", () => {
      const checks = parseBackupChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-VAR-BACKUPS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when /var/backups missing", () => {
      const checks = parseBackupChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "BACKUP-VAR-BACKUPS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });
});
