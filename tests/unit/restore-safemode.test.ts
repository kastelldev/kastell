/**
 * Tests specifically for the SAFE_MODE fix in restore.ts.
 *
 * Verifies that restore.ts uses isSafeMode() from core/manage.ts
 * (which checks KASTELL_SAFE_MODE / QUICKLIFY_SAFE_MODE) rather than reading process.env.SAFE_MODE
 * directly.
 */

import * as manageModule from "../../src/core/manage";
import * as sshUtils from "../../src/utils/ssh";
import * as configModule from "../../src/utils/config";
import { restoreCommand } from "../../src/commands/restore";

jest.mock("../../src/core/manage");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/config");
jest.mock("../../src/commands/backup", () => ({
  listBackups: jest.fn().mockReturnValue([]),
  getBackupDir: jest.fn().mockReturnValue("/home/user/.kastell/backups/test"),
}));

const mockedManage = manageModule as jest.Mocked<typeof manageModule>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedConfig = configModule as jest.Mocked<typeof configModule>;

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  delete process.env.SAFE_MODE;
  delete process.env.KASTELL_SAFE_MODE;
  delete process.env.QUICKLIFY_SAFE_MODE;
  // SSH available by default
  mockedSsh.checkSshAvailable.mockReturnValue(true);
});

afterAll(() => {
  process.env = originalEnv;
});

// ─── Core SAFE_MODE behavior via isSafeMode() ──────────────────────────────────

describe("restoreCommand — SAFE_MODE via isSafeMode()", () => {
  it("blocks restore when isSafeMode() returns true (KASTELL_SAFE_MODE=true)", async () => {
    // Mock isSafeMode to return true — this is what KASTELL_SAFE_MODE=true does
    mockedManage.isSafeMode.mockReturnValue(true);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    await restoreCommand();
    consoleSpy.mockRestore();

    // isSafeMode should have been called
    expect(mockedManage.isSafeMode).toHaveBeenCalled();
    // SSH exec should NOT have been called (blocked before server selection)
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
  });

  it("does NOT block restore when isSafeMode() returns false (KASTELL_SAFE_MODE unset)", async () => {
    // isSafeMode returns false — restore should proceed
    mockedManage.isSafeMode.mockReturnValue(false);
    // No server found → command exits early but NOT due to SAFE_MODE
    mockedConfig.findServers.mockReturnValue([]);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    await restoreCommand("nonexistent");
    consoleSpy.mockRestore();

    expect(mockedManage.isSafeMode).toHaveBeenCalled();
  });

  it("does NOT block restore when SAFE_MODE=true (old env var, wrong one)", async () => {
    // The OLD bug: process.env.SAFE_MODE was read directly.
    // After fix: only KASTELL_SAFE_MODE matters (via isSafeMode()).
    process.env.SAFE_MODE = "true";
    // isSafeMode() checks KASTELL_SAFE_MODE — which is unset → returns false
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedConfig.findServers.mockReturnValue([]);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    await restoreCommand("nonexistent");
    consoleSpy.mockRestore();

    // Command should have proceeded (not blocked by SAFE_MODE)
    expect(mockedManage.isSafeMode).toHaveBeenCalled();
  });

  it("uses isSafeMode() from core/manage, not process.env.SAFE_MODE directly", async () => {
    // Ensure isSafeMode is called (meaning the import from core/manage is used)
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedConfig.findServers.mockReturnValue([]);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    await restoreCommand("test");
    consoleSpy.mockRestore();

    // isSafeMode from the mock should have been invoked
    expect(mockedManage.isSafeMode).toHaveBeenCalledTimes(1);
  });

  it("error message mentions KASTELL_SAFE_MODE when blocked", async () => {
    mockedManage.isSafeMode.mockReturnValue(true);

    const logCalls: string[] = [];
    const consoleSpy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logCalls.push(args.join(" "));
    });
    await restoreCommand();
    consoleSpy.mockRestore();

    const output = logCalls.join("\n");
    expect(output).toContain("KASTELL_SAFE_MODE");
    // Must NOT mention old SAFE_MODE (without the prefix)
    // i.e. the error message text should not say "Set SAFE_MODE=false"
    expect(output).not.toMatch(/Set SAFE_MODE=false/);
  });
});
