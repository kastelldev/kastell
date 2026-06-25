import { withCommandBoundary, failWith, CommandFailure } from "../../src/utils/commandBoundary";

describe("withCommandBoundary", () => {
  const previousExitCode = process.exitCode;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.exitCode = undefined;
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    errorSpy.mockRestore();
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
});