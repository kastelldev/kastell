jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
}));

import { readFileSync, existsSync } from "fs";
import { parseChangelog, displayChangelog } from "../../src/core/changelog";

const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

const SAMPLE_CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

## [1.15.0] - 2026-03-27

### Added
- Feature A
- Feature B

### Fixed
- Bug fix C

## [1.14.0] - 2026-03-24

### Added
- Feature D

## [1.13.0] - 2026-03-19

### Added
- Feature E
`;

beforeEach(() => {
  mockedExistsSync.mockReturnValue(true);
  mockedReadFileSync.mockReturnValue(SAMPLE_CHANGELOG);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseChangelog", () => {
  it("should parse multiple version entries", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG);
    expect(entries).toHaveLength(3);
    expect(entries[0].version).toBe("1.15.0");
    expect(entries[1].version).toBe("1.14.0");
    expect(entries[2].version).toBe("1.13.0");
  });

  it("should extract dates", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG);
    expect(entries[0].date).toBe("2026-03-27");
    expect(entries[1].date).toBe("2026-03-24");
  });

  it("should extract content between versions", () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG);
    expect(entries[0].content).toContain("Feature A");
    expect(entries[0].content).toContain("Bug fix C");
    expect(entries[0].content).not.toContain("Feature D");
  });

  it("should handle version without brackets (## v1.0.0)", () => {
    const raw = "## v1.0.0\n\n- Initial release\n";
    const entries = parseChangelog(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].version).toBe("1.0.0");
  });

  it("should handle version without date", () => {
    const raw = "## [2.0.0]\n\n- Breaking changes\n";
    const entries = parseChangelog(raw);
    expect(entries[0].date).toBe("");
  });

  it("should return empty array for empty input", () => {
    expect(parseChangelog("")).toHaveLength(0);
    expect(parseChangelog("# Changelog\n\nNothing here")).toHaveLength(0);
  });
});

describe("displayChangelog", () => {
  it("should return latest version by default", () => {
    const output = displayChangelog({});
    expect(output).toContain("1.15.0");
    expect(output).toContain("Feature A");
    expect(output).not.toContain("Feature D");
  });

  it("should return specific version", () => {
    const output = displayChangelog({ version: "v1.14.0" });
    expect(output).toContain("1.14.0");
    expect(output).toContain("Feature D");
  });

  it("should return specific version without v prefix", () => {
    const output = displayChangelog({ version: "1.13.0" });
    expect(output).toContain("1.13.0");
    expect(output).toContain("Feature E");
  });

  it("should return not found message for unknown version", () => {
    const output = displayChangelog({ version: "v99.0.0" });
    expect(output).toContain("not found");
  });

  it("should return all versions with --all", () => {
    const output = displayChangelog({ all: true });
    expect(output).toContain("1.15.0");
    expect(output).toContain("1.14.0");
    expect(output).toContain("1.13.0");
  });

  it("should return null when changelog file not found", () => {
    mockedExistsSync.mockReturnValue(false);
    const output = displayChangelog({});
    expect(output).toBeNull();
  });
});
