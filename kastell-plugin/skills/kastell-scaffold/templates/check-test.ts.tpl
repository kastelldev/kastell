import { parse__NAME_PASCAL__Checks } from "../../core/audit/checks/__NAME__.js";

describe("parse__NAME_PASCAL__Checks", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns checks when section output is valid", () => {
    const result = parse__NAME_PASCAL__Checks("TODO_SENTINEL present", "linux");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].passed).toBe(true);
  });

  it("returns empty array when section output is empty", () => {
    const result = parse__NAME_PASCAL__Checks("", "linux");
    expect(result).toEqual([]);
  });

  it("returns empty array when skip marker present", () => {
    const result = parse__NAME_PASCAL__Checks("SKIP_MARKER", "linux");
    expect(result).toEqual([]);
  });

  it("returns failed check when sentinel missing", () => {
    const result = parse__NAME_PASCAL__Checks("some other output", "linux");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].passed).toBe(false);
  });
});
