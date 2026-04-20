import { classifyError } from "../../src/utils/errorMapper.js";
import {
  ValidationError,
  PermissionError,
  TransientError,
  BusinessError,
} from "../../src/utils/errors.js";

describe("classifyError", () => {
  it("classifies ValidationError with hint", () => {
    const err = new ValidationError("bad input", { hint: "Use a valid IP" });
    const result = classifyError(err);
    expect(result.message).toBe("Use a valid IP");
    expect(result.isTyped).toBe(true);
  });

  it("classifies ValidationError without hint — falls back to message", () => {
    const err = new ValidationError("bad input");
    const result = classifyError(err);
    expect(result.message).toBe("bad input");
    expect(result.isTyped).toBe(true);
  });

  it("classifies PermissionError", () => {
    const result = classifyError(new PermissionError("forbidden"));
    expect(result.message).toBe("forbidden");
    expect(result.hint).toContain("token");
    expect(result.isTyped).toBe(true);
  });

  it("classifies TransientError", () => {
    const result = classifyError(new TransientError("timeout"));
    expect(result.message).toBe("timeout");
    expect(result.hint).toContain("retry");
    expect(result.isTyped).toBe(true);
  });

  it("classifies BusinessError with hint", () => {
    const err = new BusinessError("no disks", { hint: "Check server state" });
    const result = classifyError(err);
    expect(result.message).toBe("no disks");
    expect(result.hint).toBe("Check server state");
    expect(result.isTyped).toBe(true);
  });

  it("classifies BusinessError without hint", () => {
    const result = classifyError(new BusinessError("rule violation"));
    expect(result.message).toBe("rule violation");
    expect(result.hint).toBeUndefined();
    expect(result.isTyped).toBe(true);
  });

  it("falls back for plain Error", () => {
    const result = classifyError(new Error("generic"));
    expect(result.message).toBe("generic");
    expect(result.isTyped).toBe(false);
  });

  it("falls back for string", () => {
    const result = classifyError("raw string error");
    expect(result.message).toBe("raw string error");
    expect(result.isTyped).toBe(false);
  });

  it("falls back for undefined", () => {
    const result = classifyError(undefined);
    expect(result.message).toBe("Unknown error");
    expect(result.isTyped).toBe(false);
  });
});
