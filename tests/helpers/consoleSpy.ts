/**
 * Shared console spy helper for test files.
 * Provides a consistent way to capture and restore console.log output.
 *
 * Usage:
 * ```ts
 * import { createConsoleSpy } from "./consoleSpy";
 *
 * describe("my tests", () => {
 *   const { consoleSpy, restore } = createConsoleSpy();
 *
 *   beforeEach(() => consoleSpy.setup());
 *   afterEach(() => restore());
 * });
 * ```
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