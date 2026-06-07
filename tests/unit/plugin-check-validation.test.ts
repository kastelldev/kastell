jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

import { validateChecks } from "../../src/plugin/validate.js";
import { ValidationError } from "../../src/utils/errors.js";

const valid = {
  id: "WP-001",
  category: "WordPress",
  name: "Test",
  severity: "warning",
  checkCommand: { kind: "read", cmd: "echo ok" },
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

  it("accepts mutate-local command kind", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } }], "WP"),
    ).not.toThrow();
  });

  it("accepts mutate-global command kind", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: { kind: "mutate-global", cmd: "hcloud firewall apply-to-resource" } }], "WP"),
    ).not.toThrow();
  });

  it("rejects legacy string checkCommand", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: "echo ok" as unknown }], "WP"),
    ).toThrow(ValidationError);
  });

  it("rejects unknown checkCommand kind with author-facing message", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: { kind: "reads", cmd: "echo ok" } }], "WP"),
    ).toThrow(/checkCommand\.kind must be one of: read, mutate-local, mutate-global/);
  });

  it("rejects extra fields inside checkCommand", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: { kind: "read", cmd: "echo ok", extra: true } }], "WP"),
    ).toThrow(ValidationError);
  });

  it("rejects checkCommand cmd containing ---SECTION:", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: { kind: "read", cmd: "echo '---SECTION:X---'" } }], "WP"),
    ).toThrow(/---SECTION:/);
  });

  it("rejects checkCommand cmd containing heredoc tag", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: { kind: "read", cmd: "echo KASTELL_PLUGIN_CHECK_EOF" } }], "WP"),
    ).toThrow(/heredoc tag/);
  });

  it("rejects checkCommand cmd containing CR", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: { kind: "read", cmd: "echo ok\r" } }], "WP"),
    ).toThrow(/CR/);
  });

  it("rejects empty checkCommand cmd", () => {
    expect(() =>
      validateChecks([{ ...valid, checkCommand: { kind: "read", cmd: "" } }], "WP"),
    ).toThrow(ValidationError);
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
});
