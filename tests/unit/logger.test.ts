import { logger, createSpinner } from "../../src/utils/logger";

describe("logger", () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("should log info messages", () => {
    logger.info("test info");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.any(String), "test info");
  });

  it("should log success messages", () => {
    logger.success("task done");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.any(String), "task done");
  });

  it("should log error messages to stderr", () => {
    logger.error("something failed");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.any(String), "something failed");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("should log warning messages to stderr", () => {
    logger.warning("be careful");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.any(String), "be careful");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("should log title with empty lines before and after", () => {
    logger.title("My Title");
    expect(stdoutSpy).toHaveBeenCalledTimes(3);
  });

  it("should log step messages", () => {
    logger.step("doing something");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.any(String), "doing something");
  });
});

describe("createSpinner", () => {
  it("should create a spinner with given text", () => {
    const spinner = createSpinner("Loading...");
    expect(spinner).toBeDefined();
  });

  it("should return spinner with start method", () => {
    const spinner = createSpinner("Loading...");
    expect(typeof spinner.start).toBe("function");
  });

  it("should return spinner with succeed method", () => {
    const spinner = createSpinner("Loading...");
    expect(typeof spinner.succeed).toBe("function");
  });

  it("should return spinner with fail method", () => {
    const spinner = createSpinner("Loading...");
    expect(typeof spinner.fail).toBe("function");
  });

  it("should allow chaining start", () => {
    const spinner = createSpinner("Loading...");
    const result = spinner.start();
    expect(result).toBe(spinner);
  });
});
