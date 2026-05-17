import { AuditError } from "../../src/core/audit/errors";

describe("AuditError", () => {
  test("is Error subclass with message", () => {
    const err = new AuditError("Server not found: foo");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Server not found: foo");
    expect(err.name).toBe("AuditError");
  });
});