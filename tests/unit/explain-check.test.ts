import { findCheckById } from "../../src/core/audit/explainCheck.js";

describe("findCheckById", () => {
  it("returns exact match", () => {
    const result = findCheckById("SSH-PASSWORD-AUTH");
    expect(result.match).not.toBeNull();
    expect(result.match!.id).toBe("SSH-PASSWORD-AUTH");
    expect(result.suggestions).toEqual([]);
  });

  it("returns case-insensitive match", () => {
    const result = findCheckById("ssh-password-auth");
    expect(result.match).not.toBeNull();
    expect(result.match!.id).toBe("SSH-PASSWORD-AUTH");
  });

  it("returns null match with suggestions for close typo", () => {
    const result = findCheckById("SSH-PASWORD-AUTH");
    expect(result.match).toBeNull();
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions).toContain("SSH-PASSWORD-AUTH");
  });

  it("returns null match with empty suggestions for unrelated input", () => {
    const result = findCheckById("ZZZZZ-NONEXISTENT-999");
    expect(result.match).toBeNull();
    expect(result.suggestions).toEqual([]);
  });
});
