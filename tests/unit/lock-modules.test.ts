import { describe, it, expect } from "@jest/globals";

describe("lock module exports", () => {
  it("re-exports all builders from barrel", async () => {
    const lock = await import("../../src/core/lock/index.js");
    expect(lock.applyLock).toBeDefined();
    expect(lock.buildSysctlHardeningCommand).toBeDefined();
    expect(lock.buildUnattendedUpgradesCommand).toBeDefined();
    expect(lock.buildLoginBannersCommand).toBeDefined();
    expect(lock.buildAuditdCommand).toBeDefined();
    expect(lock.buildResourceLimitsCommand).toBeDefined();
    expect(lock.buildServiceDisableCommand).toBeDefined();
    expect(lock.buildAptValidationCommand).toBeDefined();
    expect(lock.buildLogRetentionCommand).toBeDefined();
    expect(lock.buildCloudMetaBlockCommand).toBeDefined();
    expect(lock.buildAccountLockCommand).toBeDefined();
    expect(lock.buildAideInitCommand).toBeDefined();
    expect(lock.buildBackupPermissionsCommand).toBeDefined();
    expect(lock.buildDnsSecurityCommand).toBeDefined();
    expect(lock.buildDnsRollbackCommand).toBeDefined();
    expect(lock.buildPwqualityCommand).toBeDefined();
    expect(lock.buildDockerHardeningCommand).toBeDefined();
    expect(lock.buildSshCipherCommand).toBeDefined();
    expect(lock.buildCronAccessCommand).toBeDefined();
    expect(lock.buildSshFineTuningCommand).toBeDefined();
    expect(lock.buildLoginDefsCommand).toBeDefined();
    expect(lock.buildFaillockCommand).toBeDefined();
    expect(lock.buildSudoHardeningCommand).toBeDefined();
  });

  it("does not export runLockStep", async () => {
    const lock = await import("../../src/core/lock/index.js");
    expect((lock as Record<string, unknown>).runLockStep).toBeUndefined();
  });
});