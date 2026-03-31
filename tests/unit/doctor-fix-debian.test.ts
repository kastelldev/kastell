/**
 * Tests for DOC-01 doctor-fix integration with handler dispatch.
 *
 * Verifies that:
 * 1. checkStalePackages fixCommand is "apt-upgrade" (handler-compatible format)
 * 2. checkDockerDisk has no fixCommand (Docker = FORBIDDEN per D-02)
 * 3. runDoctorFix dispatches "apt-upgrade" via resolveHandlerChain (not raw sshExec)
 * 4. Unknown fixCommand produces "Unknown handler format" error
 */

jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  sshExec: jest.fn(),
}));

jest.mock("../../src/core/audit/handlers/index.js", () => ({
  resolveHandlerChain: jest.fn(),
  executeHandlerChain: jest.fn(),
}));

jest.mock("os", () => ({
  homedir: () => "/home/test",
}));

import { resolveHandlerChain, executeHandlerChain } from "../../src/core/audit/handlers/index.js";
import { runDoctorFix } from "../../src/core/doctor-fix";
import { checkStalePackages, checkDockerDisk } from "../../src/core/doctor";
import type { DoctorFinding } from "../../src/core/doctor";

const mockedResolve = resolveHandlerChain as jest.MockedFunction<typeof resolveHandlerChain>;
const mockedExecute = executeHandlerChain as jest.MockedFunction<typeof executeHandlerChain>;

const FAKE_CHAIN = [{ handler: {} as never, params: { type: "apt-upgrade" as const, action: "upgrade" } }];

const SERVER_IP = "1.2.3.4";

const APT_OUTPUT_11_PKGS = [
  "Listing...",
  "pkg1/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg2/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg3/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg4/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg5/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg6/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg7/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg8/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg9/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg10/focal 1.0 amd64 [upgradable from: 0.9]",
  "pkg11/focal 1.0 amd64 [upgradable from: 0.9]",
].join("\n");

describe("DOC-01 — checkStalePackages fixCommand format", () => {
  it('produces fixCommand "apt-upgrade" (handler-compatible format)', () => {
    const finding = checkStalePackages(APT_OUTPUT_11_PKGS);
    expect(finding).not.toBeNull();
    expect(finding!.fixCommand).toBe("apt-upgrade");
  });

  it("does not produce the old raw shell command", () => {
    const finding = checkStalePackages(APT_OUTPUT_11_PKGS);
    expect(finding).not.toBeNull();
    expect(finding!.fixCommand).not.toContain("sudo apt update");
    expect(finding!.fixCommand).not.toContain("DEBIAN_FRONTEND=noninteractive sudo apt");
  });
});

describe("D-02 — checkDockerDisk produces no fixCommand", () => {
  it("returns finding without fixCommand (Docker FORBIDDEN)", () => {
    const dockerDfOutput = [
      '{"Type":"Images","Active":1,"Reclaimable":"8GB (30%)","Size":"10GB","TotalCount":3}',
      '{"Type":"Containers","Active":0,"Reclaimable":"0B (0%)","Size":"0B","TotalCount":0}',
    ].join("\n");

    const finding = checkDockerDisk(dockerDfOutput);
    expect(finding).not.toBeNull();
    expect(finding!.fixCommand).toBeUndefined();
  });

  it("finding.command still references docker system prune -a (manual remediation info)", () => {
    const dockerDfOutput = '{"Type":"Images","Active":1,"Reclaimable":"8GB (30%)","Size":"10GB","TotalCount":3}';
    const finding = checkDockerDisk(dockerDfOutput);
    expect(finding).not.toBeNull();
    expect(finding!.command).toContain("docker system prune");
  });
});

describe("DOC-01 — runDoctorFix uses handler dispatch for apt-upgrade", () => {
  beforeEach(() => jest.resetAllMocks());

  it("dispatches apt-upgrade finding via resolveHandlerChain in force mode", async () => {
    const finding: DoctorFinding = {
      id: "STALE_PACKAGES",
      severity: "warning",
      description: "11 packages available for upgrade",
      command: "sudo apt update && sudo apt upgrade",
      fixCommand: "apt-upgrade",
    };

    mockedResolve.mockReturnValue(FAKE_CHAIN);
    mockedExecute.mockResolvedValue({ success: true });

    const result = await runDoctorFix(SERVER_IP, [finding], {
      dryRun: false,
      force: true,
    });

    expect(mockedResolve).toHaveBeenCalledWith("apt-upgrade");
    expect(mockedExecute).toHaveBeenCalledWith(SERVER_IP, FAKE_CHAIN);
    expect(result.applied).toContain("STALE_PACKAGES");
    expect(result.failed).toHaveLength(0);
  });

  it("records failed with Unknown handler format for unrecognized fixCommand", async () => {
    const oldFinding: DoctorFinding = {
      id: "STALE_PACKAGES",
      severity: "warning",
      description: "11 packages available for upgrade",
      command: "sudo apt update && sudo apt upgrade",
      fixCommand: "sudo apt update && sudo apt upgrade -y",
    };

    mockedResolve.mockReturnValue(null);

    const result = await runDoctorFix(SERVER_IP, [oldFinding], {
      dryRun: false,
      force: true,
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain("Unknown handler format");
    expect(result.applied).toHaveLength(0);
  });
});
