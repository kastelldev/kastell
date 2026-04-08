import { shellEscape } from "../../src/utils/shellEscape.js";

describe("shellEscape", () => {
  it("wraps plain cron expression in single quotes", () => {
    expect(shellEscape("* * * * *")).toBe("'* * * * *'");
  });

  it("wraps plain string in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  it("escapes embedded single quote using POSIX close-escape-reopen pattern", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it("returns empty single-quoted string for empty input", () => {
    expect(shellEscape("")).toBe("''");
  });

  it("escapes multiple embedded single quotes", () => {
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it("does not alter normal cron step expression", () => {
    expect(shellEscape("*/5 * * * *")).toBe("'*/5 * * * *'");
  });
});
