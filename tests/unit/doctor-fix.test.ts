/**
 * Unit tests for runDoctorFix — doctor --fix engine.
 * Uses handler dispatch (resolveHandlerChain / executeHandlerChain) instead of raw sshExec.
 */

jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  sshExec: jest.fn(),
}));

jest.mock("../../src/core/audit/handlers/index.js", () => ({
  resolveHandlerChain: jest.fn(),
  executeHandlerChain: jest.fn(),
}));

jest.mock("../../src/core/audit/fix-history.js", () => ({
  saveFixHistory: jest.fn(),
}));

jest.mock("os", () => ({
  homedir: () => "/home/test",
}));

import { resolveHandlerChain, executeHandlerChain } from "../../src/core/audit/handlers/index.js";
import { runDoctorFix } from "../../src/core/doctor-fix";
import type { DoctorFinding } from "../../src/core/doctor";
import inquirer from "inquirer";

const mockedResolve = resolveHandlerChain as jest.MockedFunction<typeof resolveHandlerChain>;
const mockedExecute = executeHandlerChain as jest.MockedFunction<typeof executeHandlerChain>;
const mockedPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeFinding(
  overrides: Partial<DoctorFinding> & { id: string },
): DoctorFinding {
  return {
    severity: "warning",
    description: "Some issue",
    command: "manual-command",
    weight: 5,
    ...overrides,
  };
}

const stalePackages = makeFinding({
  id: "STALE_PACKAGES",
  severity: "warning",
  description: "15 packages available for upgrade",
  fixCommand: "apt-upgrade",
});

const diskTrend = makeFinding({
  id: "DISK_TREND",
  severity: "warning",
  description: "Disk full in 5 days",
  // no fixCommand — not auto-fixable
});

const dockerDisk = makeFinding({
  id: "DOCKER_DISK",
  severity: "critical",
  description: "Docker has ~10 GB reclaimable",
  // no fixCommand — Docker FORBIDDEN per D-02
});

const FAKE_CHAIN = [{ handler: {} as never, params: { type: "apt-upgrade" as const, action: "upgrade" } }];

const SERVER_IP = "1.2.3.4";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runDoctorFix — dry-run mode", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns all findings in skipped without calling resolveHandlerChain", async () => {
    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, dockerDisk, diskTrend],
      { dryRun: true, force: false },
    );

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedExecute).not.toHaveBeenCalled();
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual(["STALE_PACKAGES", "DOCKER_DISK", "DISK_TREND"]);
  });

  it("dry-run wins when force is also true (safety wins)", async () => {
    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages],
      { dryRun: true, force: true },
    );

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(["STALE_PACKAGES"]);
  });
});

describe("runDoctorFix — force mode", () => {
  beforeEach(() => jest.resetAllMocks());

  it("calls resolveHandlerChain and executeHandlerChain for finding with fixCommand", async () => {
    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockResolvedValue({ success: true });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages],
      { dryRun: false, force: true },
    );

    expect(mockedResolve).toHaveBeenCalledWith("apt-upgrade");
    expect(mockedExecute).toHaveBeenCalledWith(SERVER_IP, FAKE_CHAIN);
    expect(result.applied).toEqual(["STALE_PACKAGES"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("skips findings without fixCommand", async () => {
    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockResolvedValue({ success: true });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, diskTrend, dockerDisk],
      { dryRun: false, force: true },
    );

    // Only stalePackages has fixCommand
    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(result.applied).toEqual(["STALE_PACKAGES"]);
    expect(result.skipped).toEqual(["DISK_TREND", "DOCKER_DISK"]);
  });

  it("does not prompt when force is true", async () => {
    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockResolvedValue({ success: true });

    await runDoctorFix(
      SERVER_IP,
      [stalePackages],
      { dryRun: false, force: true },
    );

    expect(mockedPrompt).not.toHaveBeenCalled();
  });

  it("returns failed with handler format error for unknown fixCommand", async () => {
    mockedResolve.mockReturnValue(null);

    const unknownFinding = makeFinding({
      id: "UNKNOWN_FIX",
      fixCommand: "totally-unknown-command",
    });

    const result = await runDoctorFix(
      SERVER_IP,
      [unknownFinding],
      { dryRun: false, force: true },
    );

    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain("UNKNOWN_FIX");
    expect(result.failed[0]).toContain("Unknown handler format");
  });

  it("returns failed when handler execution fails", async () => {
    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockResolvedValue({ success: false, error: "SSH connection failed" });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages],
      { dryRun: false, force: true },
    );

    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain("STALE_PACKAGES");
    expect(result.failed[0]).toContain("SSH connection failed");
  });

  it("records failed finding when executeHandlerChain throws", async () => {
    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockRejectedValue(new Error("Connection refused"));

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages],
      { dryRun: false, force: true },
    );

    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain("STALE_PACKAGES");
    expect(result.failed[0]).toContain("Connection refused");
  });

  it("continues to next finding after a handler failure", async () => {
    const stalePackages2 = makeFinding({
      id: "STALE_PACKAGES_2",
      fixCommand: "apt-upgrade",
    });

    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute
      .mockRejectedValueOnce(new Error("SSH timeout"))
      .mockResolvedValueOnce({ success: true });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, stalePackages2],
      { dryRun: false, force: true },
    );

    expect(result.failed).toHaveLength(1);
    expect(result.applied).toEqual(["STALE_PACKAGES_2"]);
  });
});

describe("runDoctorFix — interactive mode", () => {
  beforeEach(() => jest.resetAllMocks());

  it("prompts per finding and dispatches to handler on confirm", async () => {
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockResolvedValue({ success: true });

    const stalePackages2 = makeFinding({
      id: "STALE_PACKAGES_2",
      fixCommand: "apt-upgrade",
    });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, stalePackages2],
      { dryRun: false, force: false },
    );

    expect(mockedPrompt).toHaveBeenCalledTimes(2);
    expect(result.applied).toEqual(["STALE_PACKAGES", "STALE_PACKAGES_2"]);
    expect(result.skipped).toEqual([]);
  });

  it("adds to skipped when user declines, continues loop for next finding", async () => {
    mockedPrompt
      .mockResolvedValueOnce({ confirm: false })
      .mockResolvedValueOnce({ confirm: true });
    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockResolvedValue({ success: true });

    const stalePackages2 = makeFinding({
      id: "STALE_PACKAGES_2",
      fixCommand: "apt-upgrade",
    });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, stalePackages2],
      { dryRun: false, force: false },
    );

    expect(mockedPrompt).toHaveBeenCalledTimes(2);
    expect(result.skipped).toEqual(["STALE_PACKAGES"]);
    expect(result.applied).toEqual(["STALE_PACKAGES_2"]);
  });

  it("skips findings without fixCommand and does not prompt for them", async () => {
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockResolvedValue({ success: true });

    const result = await runDoctorFix(
      SERVER_IP,
      [diskTrend, stalePackages],
      { dryRun: false, force: false },
    );

    // DISK_TREND has no fixCommand — skipped automatically, no prompt
    expect(mockedPrompt).toHaveBeenCalledTimes(1);
    expect(result.skipped).toContain("DISK_TREND");
    expect(result.applied).toContain("STALE_PACKAGES");
  });
});

describe("runDoctorFix — invalid IP", () => {
  beforeEach(() => jest.resetAllMocks());

  it("rejects with assertValidIp error for invalid IP", async () => {
    const sshModule = require("../../src/utils/ssh");
    const mockAssertValidIp = sshModule.assertValidIp as jest.MockedFunction<() => void>;
    mockAssertValidIp.mockImplementation(() => {
      const e = new Error("Invalid IP address format");
      throw e;
    });

    await expect(
      runDoctorFix("not-an-ip", [], { dryRun: false, force: false }),
    ).rejects.toThrow("Invalid IP address format");
  });
});
