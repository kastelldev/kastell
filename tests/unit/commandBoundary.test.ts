import { setMachineMode } from "../../src/utils/logger";
import { withCommandBoundary, failWith, CommandFailure } from "../../src/utils/commandBoundary";

describe("withCommandBoundary", () => {
  const previousExitCode = process.exitCode;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    process.exitCode = undefined;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    setMachineMode(false);
    process.exitCode = previousExitCode;
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("should set exit code 1 when handler throws CommandFailure", async () => {
    const run = withCommandBoundary(async () => {
      throw new CommandFailure("Bad input");
    });

    await run();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should rethrow unknown programmer errors", async () => {
    const run = withCommandBoundary(async () => {
      throw new TypeError("programmer bug");
    });

    await expect(run()).rejects.toThrow("programmer bug");
  });

  it("should set exit code 1 when handler calls failWith", async () => {
    const run = withCommandBoundary(async () => failWith("No server"));

    await run();

    expect(process.exitCode).toBe(1);
  });

  it("should wrap a non-Error cause in an Error so it is not silently dropped", () => {
    const stringCause = "network timeout string";
    const failure = new CommandFailure("Boundary fired", { cause: stringCause });

    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toBe(stringCause);
  });

  it("should preserve an Error cause unchanged", () => {
    const errorCause = new Error("original");
    const failure = new CommandFailure("Boundary fired", { cause: errorCause });

    expect(failure.cause).toBe(errorCause);
  });

  it("should emit command failure hints on stderr", async () => {
    const run = withCommandBoundary(async () => {
      throw new CommandFailure("Bad input", { hint: "Run kastell doctor" });
    });

    await run();

    // withCommandBoundary calls markCommandFailed(), which owns process.exitCode.
    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), "Bad input");
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), "Run kastell doctor");
  });

  it("should not write command failure hints to stdout in machine mode", async () => {
    setMachineMode(true);
    const run = withCommandBoundary(async () => {
      throw new CommandFailure("Bad input", { hint: "Run kastell doctor" });
    });

    await run();

    expect(process.exitCode).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), "Run kastell doctor");
  });
});