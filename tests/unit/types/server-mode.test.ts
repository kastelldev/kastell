import { isServerMode } from "../../../src/types/index.js";

describe("isServerMode", () => {
  it("should accept 'dokploy' as valid server mode", () => {
    expect(isServerMode("dokploy")).toBe(true);
  });

  it("should accept 'coolify' as valid server mode", () => {
    expect(isServerMode("coolify")).toBe(true);
  });

  it("should accept 'bare' as valid server mode", () => {
    expect(isServerMode("bare")).toBe(true);
  });

  it("should reject invalid modes", () => {
    expect(isServerMode("invalid")).toBe(false);
    expect(isServerMode("")).toBe(false);
    expect(isServerMode(null)).toBe(false);
    expect(isServerMode(undefined)).toBe(false);
  });
});
