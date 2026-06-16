/**
 * Smoke test for fsMock helper. Mirrors auditFixtures.smoke.test.ts pattern
 * (P139 A14): validates the factory's shape and behavior contracts so test
 * suites that depend on it fail at the helper layer, not 100 lines deep.
 */

import { jest, describe, it, expect } from "@jest/globals";
import { createFsMock, asStats, jsonString, resetFsMock } from "../fsMock.js";

describe("fsMock smoke", () => {
  it("createFsMock() exposes all expected fs method mocks", () => {
    const mock = createFsMock();
    expect(typeof mock.readFileSync).toBe("function");
    expect(typeof mock.writeFileSync).toBe("function");
    expect(typeof mock.chmodSync).toBe("function");
    expect(typeof mock.mkdirSync).toBe("function");
    expect(typeof mock.existsSync).toBe("function");
    expect(typeof mock.statSync).toBe("function");
    expect(typeof mock.unlinkSync).toBe("function");
    expect(typeof mock.renameSync).toBe("function");
    expect(typeof mock.copyFileSync).toBe("function");
  });

  it("createFsMock() default existsSync returns false", () => {
    const mock = createFsMock();
    expect(mock.existsSync()).toBe(false);
  });

  it("createFsMock(overrides) replaces the named mock", () => {
    const customExists = jest.fn(() => true);
    const mock = createFsMock({ existsSync: customExists });
    expect(mock.existsSync).toBe(customExists);
    expect(mock.existsSync()).toBe(true);
  });

  it("asStats() casts plain object to fs.Stats shape", () => {
    const stats = asStats({ mtimeMs: 1234, dev: 7 });
    expect(stats.mtimeMs).toBe(1234);
    expect(stats.dev).toBe(7);
  });

  it("jsonString() returns JSON-encoded string with fs-readable type", () => {
    expect(jsonString({ a: 1 })).toBe('{"a":1}');
    expect(jsonString([1, 2])).toBe("[1,2]");
  });

  it("resetFsMock() clears mockReturnValue (not just call history)", () => {
    const mock = createFsMock();
    mock.readFileSync.mockReturnValue("hello");
    mock.existsSync.mockReturnValue(true);

    expect(mock.readFileSync()).toBe("hello");
    expect(mock.existsSync()).toBe(true);

    resetFsMock(mock);

    expect(mock.readFileSync()).toBeUndefined();
    expect(mock.existsSync()).toBeUndefined();
  });

  it("resetFsMock() ignores non-mock properties without throwing", () => {
    const hybrid = { readFileSync: jest.fn(), randomProp: "string", num: 42 };
    expect(() => resetFsMock(hybrid)).not.toThrow();
    expect(hybrid.randomProp).toBe("string");
    expect(hybrid.num).toBe(42);
  });
});
