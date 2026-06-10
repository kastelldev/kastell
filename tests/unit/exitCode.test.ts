import { markCommandFailed } from "../../src/utils/exitCode";

describe("markCommandFailed", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("sets a deferred process failure without exiting", () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    markCommandFailed();
    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("returns false for inline use in return statements", () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const result = markCommandFailed();
    expect(result).toBe(false);
    exit.mockRestore();
  });
});
