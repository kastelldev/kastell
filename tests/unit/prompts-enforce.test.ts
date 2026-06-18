/**
 * P143-D CLI Guard Cleanup — enforceOrCancel + confirmTypedNameInTty helpers
 *
 * Helper-level contract tests. Migration of 13 destructive commands to use
 * these helpers is verified by their existing per-command test files
 * (migration must be transparent).
 *
 * enforceOrCancel contract:
 *   - confirmed: true                 -> returns true, no side effects
 *   - confirmed: false, declined      -> returns false, logs message, no markFailed
 *   - confirmed: false, non-tty       -> returns false, logs message, markFailed called
 *
 * confirmTypedNameInTty contract:
 *   - TTY + match                     -> returns true
 *   - TTY + mismatch                  -> returns false
 *   - non-TTY                         -> throws (caller is responsible for filtering)
 */

jest.mock("inquirer", () => ({
  __esModule: true,
  default: {
    prompt: jest.fn(),
  },
}));

jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

jest.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  },
}));

import inquirer from "inquirer";
import {
  enforceOrCancel,
  confirmTypedNameInTty,
  type ConfirmationDecision,
} from "../../src/utils/prompts.js";

const mockedInquirerPrompt = inquirer.prompt as unknown as jest.Mock;

describe("enforceOrCancel — 6-case contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Case 1: declined in TTY mode -> returns false, logs message, does NOT call markFailed", () => {
    const markFailed = jest.fn();
    const decision: ConfirmationDecision = {
      confirmed: false,
      reason: "declined",
      message: "Operation cancelled.",
    };
    const { logger } = jest.requireMock("../../src/utils/logger.js") as {
      logger: { info: jest.Mock; error: jest.Mock };
    };

    const result = enforceOrCancel(decision, markFailed);

    expect(result).toBe(false);
    expect(markFailed).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Operation cancelled.");
  });

  it("Case 2: non-TTY refusal -> returns false, logs message, calls markFailed exactly once", () => {
    const markFailed = jest.fn();
    const decision: ConfirmationDecision = {
      confirmed: false,
      reason: "non-tty",
      message: "Use --force.",
    };
    const { logger } = jest.requireMock("../../src/utils/logger.js") as {
      logger: { info: jest.Mock; error: jest.Mock };
    };

    const result = enforceOrCancel(decision, markFailed);

    expect(result).toBe(false);
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("Use --force.");
  });

  it("Case 3: --force confirmation -> returns true, no side effects", () => {
    const markFailed = jest.fn();
    const decision: ConfirmationDecision = { confirmed: true, source: "force" };
    const { logger } = jest.requireMock("../../src/utils/logger.js") as {
      logger: { info: jest.Mock; error: jest.Mock };
    };

    const result = enforceOrCancel(decision, markFailed);

    expect(result).toBe(true);
    expect(markFailed).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("Case 4: prompt confirmation -> returns true, no side effects", () => {
    const markFailed = jest.fn();
    const decision: ConfirmationDecision = { confirmed: true, source: "prompt" };
    const { logger } = jest.requireMock("../../src/utils/logger.js") as {
      logger: { info: jest.Mock; error: jest.Mock };
    };

    const result = enforceOrCancel(decision, markFailed);

    expect(result).toBe(true);
    expect(markFailed).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("Case 5: two consecutive declined decisions -> markFailed never called", () => {
    const markFailed = jest.fn();
    const decision: ConfirmationDecision = {
      confirmed: false,
      reason: "declined",
      message: "Operation cancelled.",
    };

    const r1 = enforceOrCancel(decision, markFailed);
    const r2 = enforceOrCancel(decision, markFailed);

    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("Case 6: declined and non-tty mix -> markFailed count matches non-tty calls", () => {
    const markFailed = jest.fn();
    const declined: ConfirmationDecision = {
      confirmed: false,
      reason: "declined",
      message: "Operation cancelled.",
    };
    const nonTty: ConfirmationDecision = {
      confirmed: false,
      reason: "non-tty",
      message: "Use --force.",
    };

    expect(enforceOrCancel(declined, markFailed)).toBe(false);
    expect(enforceOrCancel(nonTty, markFailed)).toBe(false);
    expect(enforceOrCancel(declined, markFailed)).toBe(false);

    expect(markFailed).toHaveBeenCalledTimes(1);
  });
});

describe("confirmTypedNameInTty — typed-name second confirmation", () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    mockedInquirerPrompt.mockReset();
  });

  it("returns true when typed input matches expected name", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    mockedInquirerPrompt.mockResolvedValueOnce({ confirmName: "coolify-test" });

    const ok = await confirmTypedNameInTty({
      expected: "coolify-test",
      promptMessage: "Type the server name to confirm:",
    });

    expect(ok).toBe(true);
    expect(mockedInquirerPrompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: "input",
          name: "confirmName",
          message: "Type the server name to confirm:",
        }),
      ]),
    );
  });

  it("returns false when typed input does not match expected name", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    mockedInquirerPrompt.mockResolvedValueOnce({ confirmName: "wrong-name" });

    const ok = await confirmTypedNameInTty({
      expected: "coolify-test",
      promptMessage: "Type the server name to confirm:",
    });

    expect(ok).toBe(false);
  });

  it("trims whitespace before comparing", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    mockedInquirerPrompt.mockResolvedValueOnce({ confirmName: "  coolify-test  " });

    const ok = await confirmTypedNameInTty({
      expected: "coolify-test",
      promptMessage: "Type the server name to confirm:",
    });

    expect(ok).toBe(true);
  });

  it("throws in non-TTY environment (caller is responsible for filtering)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });

    await expect(
      confirmTypedNameInTty({
        expected: "coolify-test",
        promptMessage: "Type the server name to confirm:",
      }),
    ).rejects.toThrow(/TTY/i);
  });
});
