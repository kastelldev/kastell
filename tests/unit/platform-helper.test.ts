import { isWindows } from "../../src/utils/platform";

describe("isWindows", () => {
  test("returns true on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    expect(isWindows()).toBe(true);
  });
  test("returns false on linux", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    expect(isWindows()).toBe(false);
  });
});
