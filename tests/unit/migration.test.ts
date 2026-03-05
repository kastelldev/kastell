/**
 * Tests for config directory migration from ~/.quicklify to ~/.kastell
 */
import * as fs from "fs";
import * as os from "os";

jest.mock("fs");
jest.mock("os", () => ({
  homedir: () => "/mock-home",
}));

// Mock chalk to avoid ANSI codes in test output
jest.mock("chalk", () => {
  const chalkObj = {
    yellow: (msg: string) => msg,
  };
  return {
    __esModule: true,
    default: chalkObj,
    ...chalkObj,
  };
});

const mockedFs = fs as jest.Mocked<typeof fs>;

// Re-import after mocks are set up
import { migrateConfigIfNeeded } from "../../src/utils/migration";

describe("migrateConfigIfNeeded", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it("should do nothing when ~/.kastell already exists (no overwrite)", () => {
    // ~/.kastell exists
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes(".kastell")) return true;
      return false;
    });

    migrateConfigIfNeeded();

    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockedFs.cpSync).not.toHaveBeenCalled();
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("should do nothing when ~/.quicklify does not exist (fresh install)", () => {
    // Neither directory exists
    mockedFs.existsSync.mockReturnValue(false);

    migrateConfigIfNeeded();

    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockedFs.cpSync).not.toHaveBeenCalled();
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("should copy ~/.quicklify to ~/.kastell when old exists and new does not", () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const path = String(p);
      if (path.includes(".kastell")) return false;
      if (path.includes(".quicklify")) return true;
      return false;
    });

    migrateConfigIfNeeded();

    // Should create new dir
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".kastell"),
      expect.objectContaining({ recursive: true, mode: 0o700 }),
    );
    // Should copy contents
    expect(mockedFs.cpSync).toHaveBeenCalledWith(
      expect.stringContaining(".quicklify"),
      expect.stringContaining(".kastell"),
      expect.objectContaining({ recursive: true }),
    );
    // Should write .migrated flag
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".migrated"),
      expect.any(String),
      expect.objectContaining({ mode: 0o600 }),
    );
  });

  it("should show chalk.yellow warning after successful migration", () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const path = String(p);
      if (path.includes(".kastell")) return false;
      if (path.includes(".quicklify")) return true;
      return false;
    });

    migrateConfigIfNeeded();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Migrated config from ~/.quicklify to ~/.kastell"),
    );
  });

  it("should handle copy failure gracefully without crashing", () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const path = String(p);
      if (path.includes(".kastell")) return false;
      if (path.includes(".quicklify")) return true;
      return false;
    });
    mockedFs.mkdirSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });

    // Should not throw
    expect(() => migrateConfigIfNeeded()).not.toThrow();
  });
});
