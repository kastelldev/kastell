import { confirmOrCancel } from "../../src/utils/prompts.js";

jest.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

describe("confirmOrCancel", () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    jest.restoreAllMocks();
  });

  it("returns true when force is true", async () => {
    const result = await confirmOrCancel("Test?", true);
    expect(result).toBe(true);
  });

  it("calls confirmFn in TTY mode and returns their choice", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const mockConfirm = jest.fn().mockResolvedValue(true);

    const result = await confirmOrCancel("Continue?", false, undefined, mockConfirm);
    expect(result).toBe(true);
    expect(mockConfirm).toHaveBeenCalledWith({ message: "Continue?", default: false });
  });

  it("returns false when user declines in TTY mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const mockConfirm = jest.fn().mockResolvedValue(false);

    const result = await confirmOrCancel("Continue?", false, undefined, mockConfirm);
    expect(result).toBe(false);
  });

  it("returns false and warns in non-TTY mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    const { logger } = await import("../../src/utils/logger.js");

    const result = await confirmOrCancel("Continue?", false, "Use --force");
    expect(result).toBe(false);
    expect(logger.warning).toHaveBeenCalledWith("Use --force");
  });

  it("uses default cancel message when none provided", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    const { logger } = await import("../../src/utils/logger.js");

    const result = await confirmOrCancel("Continue?", false);
    expect(result).toBe(false);
    expect(logger.warning).toHaveBeenCalledWith("Use --force to proceed in non-interactive mode.");
  });
});
