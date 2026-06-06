/**
 * Tests for runForbiddenFixes (P139 CQS-08 coverage gap).
 *
 * P139 CQS-08 refactored buildAuditBatchCommands to take an options object,
 * which reshuffled helpers around the forbidden-fixes flow. The actual
 * runForbiddenFixes function was never given direct unit coverage — it
 * was only invoked indirectly through CLI/MCP paths with mocked helpers.
 *
 * LCOV reported 0 calls in coverage. These tests pin the empty-input short
 * circuit and the user-declined branch (the two most likely regressions
 * during future refactors of the forbidden-fixes prompt loop).
 */

jest.mock("../../src/utils/ssh.js");
jest.mock("inquirer");

import inquirer from "inquirer";
import { sshMasterOpen, sshMasterClose } from "../../src/utils/ssh.js";
import { runForbiddenFixes } from "../../src/core/audit/fix.js";
import type { FixPreview } from "../../src/core/audit/fix.js";

const mockInquirer = inquirer as unknown as { prompt: jest.Mock };
const mockSshMasterOpen = sshMasterOpen as jest.MockedFunction<typeof sshMasterOpen>;
const mockSshMasterClose = sshMasterClose as jest.MockedFunction<typeof sshMasterClose>;

describe("runForbiddenFixes", () => {
  beforeEach(() => {
    // LESSONS: jest.clearAllMocks() preserves mockReturnValue / mockImplementation
    // between tests, which leaks defaults across cases and breaks chains.
    // Use mockReset() per-mock to fully wipe both call history AND implementation.
    mockInquirer.prompt.mockReset();
    mockSshMasterOpen.mockReset();
    mockSshMasterClose.mockReset();
    // Default: open/close succeed silently so the non-empty path doesn't
    // blow up before the inquirer mock can respond.
    mockSshMasterOpen.mockResolvedValue(undefined as never);
    mockSshMasterClose.mockResolvedValue(undefined as never);
  });

  it("returns empty result and skips SSH open when forbiddenFixes is empty", async () => {
    const result = await runForbiddenFixes("1.2.3.4", []);

    expect(result).toEqual({ applied: [], skipped: [], errors: [], executionLog: [] });
    expect(mockSshMasterOpen).not.toHaveBeenCalled();
    expect(mockSshMasterClose).not.toHaveBeenCalled();
    expect(mockInquirer.prompt).not.toHaveBeenCalled();
  });

  it("skips the fix and closes SSH master when user declines inquirer prompt", async () => {
    mockInquirer.prompt.mockResolvedValueOnce({ proceed: false });

    const fix: FixPreview = {
      checkId: "KASTELL-FORBIDDEN-001",
      command: "chmod 777 /etc/passwd",
      tier: "FORBIDDEN",
    };

    const result = await runForbiddenFixes("1.2.3.4", [fix]);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(["KASTELL-FORBIDDEN-001"]);
    expect(result.errors).toEqual([]);
    // sshMasterClose runs in the finally block — we want to make sure the
    // session is not left dangling when the user backs out.
    expect(mockSshMasterClose).toHaveBeenCalledWith("1.2.3.4");
  });
});
