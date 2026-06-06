import { createConsoleSpy } from "../consoleSpy";

describe("consoleSpy", () => {
  const { setup, restore, getCalls } = createConsoleSpy();

  afterEach(() => restore());

  it("should capture console.log calls", () => {
    setup();
    console.log("hello", "world");
    expect(getCalls()).toHaveLength(1);
    expect(getCalls()[0]).toEqual(["hello", "world"]);
  });

  it("should return empty calls after restore", () => {
    setup();
    console.log("test");
    restore();
    expect(getCalls()).toHaveLength(0);
  });

  it("should be re-runnable after restore", () => {
    setup();
    console.log("first");
    restore();
    setup();
    console.log("second");
    expect(getCalls()).toHaveLength(1);
    expect(getCalls()[0]).toEqual(["second"]);
  });

  // CQS-11 M6: getter kept (3 test files depend on it for toHaveBeenCalledWith).
  // The original spec suggested removing the getter for sade API, but production
  // usage (tests/unit/explain-command.test.ts, schedule.test.ts, update.test.ts)
  // shows it's load-bearing. JSDoc was fixed instead — example was misleading.
  it("should expose consoleSpy getter returning the jest.SpyInstance after setup", () => {
    const fresh = createConsoleSpy();
    expect(fresh.consoleSpy).toBeNull();
    fresh.setup();
    expect(fresh.consoleSpy).not.toBeNull();
    expect(typeof fresh.consoleSpy?.mock).toBe("object");
    fresh.restore();
  });
});
