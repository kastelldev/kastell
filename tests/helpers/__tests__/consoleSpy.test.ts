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
});