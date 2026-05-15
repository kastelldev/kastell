import { validateChecks } from "../../src/plugin/validate.js";
import { ValidationError } from "../../src/utils/errors.js";

const valid = {
  id: "WP-001",
  category: "WordPress",
  name: "Test",
  severity: "warning",
  checkCommand: "echo ok",
};

describe("validateChecks", () => {
  it("accepts a valid check", () => {
    expect(() => validateChecks([valid], "WP")).not.toThrow();
  });

  it("accepts id with underscores and dashes (WP-A_B-C)", () => {
    expect(() => validateChecks([{ ...valid, id: "WP-A_B-C" }], "WP")).not.toThrow();
  });

  it("rejects id with single-quote", () => {
    expect(() => validateChecks([{ ...valid, id: "WP'001" }], "WP")).toThrow(ValidationError);
  });

  it("rejects id with shell substitution", () => {
    expect(() => validateChecks([{ ...valid, id: "WP$(x)" }], "WP")).toThrow(ValidationError);
  });

  it("rejects id with semicolon", () => {
    expect(() => validateChecks([{ ...valid, id: "WP;rm" }], "WP")).toThrow(ValidationError);
  });

  it("rejects id with newline", () => {
    expect(() => validateChecks([{ ...valid, id: "WP\nfoo" }], "WP")).toThrow(ValidationError);
  });

  it("rejects id longer than 64 chars", () => {
    const longId = "WP-" + "A".repeat(63);
    expect(() => validateChecks([{ ...valid, id: longId }], "WP")).toThrow(ValidationError);
  });

  it("rejects id not starting with checkPrefix-", () => {
    expect(() => validateChecks([{ ...valid, id: "XX-001" }], "WP")).toThrow(/prefix/);
  });

  it("rejects checkCommand containing ---SECTION:", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: "echo '---SECTION:X---'" }], "WP"),
    ).toThrow(/---SECTION:/);
  });

  it("rejects checkCommand containing heredoc tag", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: "echo KASTELL_PLUGIN_CHECK_EOF" }], "WP"),
    ).toThrow(/heredoc tag/);
  });

  it("rejects checkCommand containing CR", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: "echo ok\r" }], "WP"),
    ).toThrow(/CR/);
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      validateChecks([valid, { ...valid, name: "Other" }], "WP"),
    ).toThrow(/Duplicate/);
  });

  it("rejects invalid severity", () => {
    expect(() =>
      validateChecks([{ ...valid, severity: "high" }], "WP"),
    ).toThrow(ValidationError);
  });

  it("rejects empty checkCommand", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: "" }], "WP"),
    ).toThrow(ValidationError);
  });
});