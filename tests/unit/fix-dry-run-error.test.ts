/**
 * F-012: `kastell fix --dry-run` without --safe should error with clear message.
 */

import { fixSafeCommand } from "../../src/commands/fix.js";
import { logger } from "../../src/utils/logger.js";

jest.mock("../../src/utils/serverSelect.js");
jest.mock("../../src/utils/ssh.js");
jest.mock("../../src/core/audit/index.js");
jest.mock("../../src/core/audit/fix.js");
jest.mock("../../src/core/audit/scoring.js");
jest.mock("../../src/core/backup.js");
jest.mock("../../src/utils/logger.js");
jest.mock("../../src/core/audit/fix-history.js");
jest.mock("../../src/core/audit/handlers/index.js");
jest.mock("../../src/core/audit/profiles.js");
jest.mock("../../src/utils/fixReport.js");
jest.mock("fs");
jest.mock("inquirer");
jest.mock("../../src/core/audit/regression.js");
jest.mock("../../src/core/audit/pluginFix.js", () => ({
  __esModule: true,
  isPluginFixCommand: () => false,
  parsePluginFixCommand: () => null,
  getPluginBackupPaths: () => [],
  getAppliedPluginNames: () => [],
  executePluginFix: async () => ({ success: false }),
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe("kastell fix --dry-run without --safe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("errors with clear message", async () => {
    process.exitCode = 0;

    await fixSafeCommand(undefined, { dryRun: true, safe: false });

    expect(process.exitCode).toBe(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("--dry-run requires --safe"),
    );
  });
});
