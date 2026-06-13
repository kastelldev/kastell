import { confirmOrCancel, type ConfirmationDecision } from "../../src/utils/prompts.js";
import { markCommandFailed } from "../../src/utils/exitCode.js";

jest.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

describe("confirmOrCancel — ConfirmationDecision contract", () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    jest.restoreAllMocks();
  });

  it("returns { confirmed: true, source: 'force' } when force is true", async () => {
    const decision: ConfirmationDecision = await confirmOrCancel("Test?", true);
    expect(decision).toEqual({ confirmed: true, source: "force" });
  });

  it("returns { confirmed: true, source: 'prompt' } when user accepts in TTY mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const mockConfirm = jest.fn().mockResolvedValue(true);

    const decision = await confirmOrCancel("Continue?", false, undefined, mockConfirm);
    expect(decision).toEqual({ confirmed: true, source: "prompt" });
    expect(mockConfirm).toHaveBeenCalledWith({ message: "Continue?", default: false });
  });

  it("returns { confirmed: false, reason: 'declined' } when user declines in TTY mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const mockConfirm = jest.fn().mockResolvedValue(false);

    const decision = await confirmOrCancel("Continue?", false, undefined, mockConfirm);
    expect(decision.confirmed).toBe(false);
    if (decision.confirmed === false) {
      expect(decision.reason).toBe("declined");
      expect(typeof decision.message).toBe("string");
      expect(decision.message.length).toBeGreaterThan(0);
    }
  });

  it("returns { confirmed: false, reason: 'non-tty' } with explicit opt-in message in non-TTY mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    const { logger } = await import("../../src/utils/logger.js");

    const decision = await confirmOrCancel("Continue?", false, "Use --force to proceed in non-interactive mode.");
    expect(decision.confirmed).toBe(false);
    if (decision.confirmed === false) {
      expect(decision.reason).toBe("non-tty");
      // The non-TTY message MUST mention the documented explicit opt-in
      expect(decision.message).toMatch(/--force/i);
    }
    expect(logger.warning).toHaveBeenCalledWith("Use --force to proceed in non-interactive mode.");
  });

  it("uses default cancel message containing explicit opt-in when none provided", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    const { logger } = await import("../../src/utils/logger.js");

    const decision = await confirmOrCancel("Continue?", false);
    expect(decision.confirmed).toBe(false);
    if (decision.confirmed === false) {
      expect(decision.reason).toBe("non-tty");
      expect(decision.message).toMatch(/--force/i);
    }
    expect(logger.warning).toHaveBeenCalledWith("Use --force to proceed in non-interactive mode.");
  });
});

describe("confirmOrCancel — F-IMP-1 exit invariant", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  it("never calls process.exit()", async () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(((..._args: unknown[]) => {
      // no-op
    }) as never);
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });

    await confirmOrCancel("Test?", false);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("never changes process.exitCode", async () => {
    process.exitCode = 0;
    const exitCodeSpy = jest.spyOn(process, "exitCode", "set");
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });

    await confirmOrCancel("Test?", false);

    expect(exitCodeSpy).not.toHaveBeenCalled();
  });

  it("never calls markCommandFailed()", async () => {
    const markSpy = jest.spyOn({ markCommandFailed }, "markCommandFailed");
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });

    await confirmOrCancel("Test?", false);

    expect(markSpy).not.toHaveBeenCalled();
  });
});
