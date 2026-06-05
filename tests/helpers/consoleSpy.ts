/**
 * Shared console spy helper for test files.
 * Provides a consistent way to capture and restore console.log output.
 *
 * Usage:
 * ```ts
 * import { createConsoleSpy } from "./consoleSpy";
 *
 * describe("my tests", () => {
 *   const spy = createConsoleSpy();
 *
 *   beforeEach(() => spy.setup());
 *   afterEach(() => spy.restore());
 *
 *   it("captures output", () => {
 *     spy.setup();
 *     console.log("hello");
 *     // Either assertion style works:
 *     expect(spy.getCalls()).toEqual([["hello"]]);
 *     expect(spy.consoleSpy).toHaveBeenCalledWith("hello");
 *   });
 * });
 * ```
 *
 * The `consoleSpy` getter exposes the underlying jest.SpyInstance for direct
 * assertion methods like `toHaveBeenCalledWith`. CQS-11 M6 evaluated removing
 * it (the project prefers direct property over getter per LESSONS) — kept
 * because 3 test files rely on `spy.consoleSpy.toHaveBeenCalledWith(...)`
 * for richer Jest matchers. The getter IS the public surface for spy access.
 */

export function createConsoleSpy() {
  let consoleSpy: jest.SpyInstance | null = null;

  function setup(): jest.SpyInstance {
    if (consoleSpy) consoleSpy.mockRestore();
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    return consoleSpy;
  }

  function restore(): void {
    consoleSpy?.mockRestore();
    consoleSpy = null;
  }

  function getCalls(): unknown[][] {
    return consoleSpy?.mock.calls ?? [];
  }

  return { get consoleSpy() { return consoleSpy; }, setup, restore, getCalls };
}
