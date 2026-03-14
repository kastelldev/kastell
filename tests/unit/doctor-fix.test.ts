/**
 * Unit tests for runDoctorFix — doctor --fix engine.
 */

jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  sshExec: jest.fn(),
}));

jest.mock("os", () => ({
  homedir: () => "/home/test",
}));

import { sshExec } from "../../src/utils/ssh";
import { runDoctorFix } from "../../src/core/doctor-fix";
import type { DoctorFinding } from "../../src/core/doctor";
import inquirer from "inquirer";

const mockedSshExec = sshExec as jest.MockedFunction<typeof sshExec>;
const mockedPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeFinding(
  overrides: Partial<DoctorFinding> & { id: string },
): DoctorFinding {
  return {
    severity: "warning",
    description: "Some issue",
    command: "manual-command",
    ...overrides,
  };
}

const stalePackages = makeFinding({
  id: "STALE_PACKAGES",
  severity: "warning",
  description: "15 packages available for upgrade",
  fixCommand: "sudo apt update && sudo apt upgrade -y",
});

const dockerDisk = makeFinding({
  id: "DOCKER_DISK",
  severity: "critical",
  description: "Docker has ~10 GB reclaimable",
  fixCommand: "docker system prune -a --force",
});

const diskTrend = makeFinding({
  id: "DISK_TREND",
  severity: "warning",
  description: "Disk full in 5 days",
  // no fixCommand — not auto-fixable
});

const SERVER_IP = "1.2.3.4";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runDoctorFix — dry-run mode", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns all findings in skipped without calling sshExec", async () => {
    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, dockerDisk, diskTrend],
      { dryRun: true, force: false },
    );

    expect(mockedSshExec).not.toHaveBeenCalled();
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

    expect(mockedSshExec).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(["STALE_PACKAGES"]);
  });
});

describe("runDoctorFix — force mode", () => {
  beforeEach(() => jest.resetAllMocks());

  it("calls sshExec for each finding with fixCommand", async () => {
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, dockerDisk],
      { dryRun: false, force: true },
    );

    expect(mockedSshExec).toHaveBeenCalledTimes(2);
    expect(mockedSshExec).toHaveBeenCalledWith(SERVER_IP, stalePackages.fixCommand);
    expect(mockedSshExec).toHaveBeenCalledWith(SERVER_IP, dockerDisk.fixCommand);
    expect(result.applied).toEqual(["STALE_PACKAGES", "DOCKER_DISK"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("skips findings without fixCommand", async () => {
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, diskTrend, dockerDisk],
      { dryRun: false, force: true },
    );

    expect(mockedSshExec).toHaveBeenCalledTimes(2);
    expect(result.applied).toEqual(["STALE_PACKAGES", "DOCKER_DISK"]);
    expect(result.skipped).toEqual(["DISK_TREND"]);
  });

  it("does not prompt when force is true", async () => {
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    await runDoctorFix(
      SERVER_IP,
      [stalePackages],
      { dryRun: false, force: true },
    );

    expect(mockedPrompt).not.toHaveBeenCalled();
  });

  it("records failed finding when sshExec returns non-zero exit code", async () => {
    mockedSshExec.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "Permission denied",
    });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages],
      { dryRun: false, force: true },
    );

    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain("STALE_PACKAGES");
    expect(result.failed[0]).toContain("Permission denied");
  });

  it("records failed finding when sshExec throws", async () => {
    mockedSshExec.mockRejectedValue(new Error("Connection refused"));

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

  it("continues to next finding after an sshExec failure", async () => {
    mockedSshExec
      .mockRejectedValueOnce(new Error("SSH timeout"))
      .mockResolvedValueOnce({ code: 0, stdout: "ok", stderr: "" });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, dockerDisk],
      { dryRun: false, force: true },
    );

    expect(result.failed).toHaveLength(1);
    expect(result.applied).toEqual(["DOCKER_DISK"]);
  });
});

describe("runDoctorFix — interactive mode", () => {
  beforeEach(() => jest.resetAllMocks());

  it("prompts per finding and executes on confirm", async () => {
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, dockerDisk],
      { dryRun: false, force: false },
    );

    expect(mockedPrompt).toHaveBeenCalledTimes(2);
    expect(result.applied).toEqual(["STALE_PACKAGES", "DOCKER_DISK"]);
    expect(result.skipped).toEqual([]);
  });

  it("adds to skipped when user declines, continues loop for next finding", async () => {
    mockedPrompt
      .mockResolvedValueOnce({ confirm: false })
      .mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, dockerDisk],
      { dryRun: false, force: false },
    );

    expect(mockedPrompt).toHaveBeenCalledTimes(2);
    expect(result.skipped).toEqual(["STALE_PACKAGES"]);
    expect(result.applied).toEqual(["DOCKER_DISK"]);
  });

  it("skipping a finding does not abort the loop — subsequent findings still prompt", async () => {
    mockedPrompt
      .mockResolvedValueOnce({ confirm: false })
      .mockResolvedValueOnce({ confirm: false })
      .mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const extraFinding = makeFinding({
      id: "HIGH_SWAP",
      fixCommand: "sudo apt update && sudo apt upgrade -y",
    });

    const result = await runDoctorFix(
      SERVER_IP,
      [stalePackages, dockerDisk, extraFinding],
      { dryRun: false, force: false },
    );

    expect(mockedPrompt).toHaveBeenCalledTimes(3);
    expect(result.skipped).toEqual(["STALE_PACKAGES", "DOCKER_DISK"]);
    expect(result.applied).toEqual(["HIGH_SWAP"]);
  });

  it("skips findings without fixCommand and adds 'not auto-fixable' context", async () => {
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

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
