/**
 * Tests for config directory migration from ~/.quicklify to ~/.kastell
 */
import * as fs from "fs";
import * as os from "os";

jest.mock("fs");
jest.mock("os", () => ({
  homedir: () => "/mock-home",
}));

// Mock secureWrite to avoid platform-specific permission operations
jest.mock("../../src/utils/secureWrite", () => ({
  secureMkdirSync: jest.fn(),
  secureWriteFileSync: jest.fn(),
}));

const mockSecureWrite = jest.requireMock("../../src/utils/secureWrite");

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
    expect(mockSecureWrite.secureMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".kastell"),
      expect.objectContaining({ recursive: true }),
    );
    // Should copy contents
    expect(mockedFs.cpSync).toHaveBeenCalledWith(
      expect.stringContaining(".quicklify"),
      expect.stringContaining(".kastell"),
      expect.objectContaining({ recursive: true }),
    );
    // Should write .migrated flag
    expect(mockSecureWrite.secureWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".migrated"),
      expect.any(String),
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

  it("should migrate mode field for servers missing it", () => {
    const servers = [
      { id: "1", name: "no-mode", provider: "hetzner", ip: "1.1.1.1", region: "nbg1", size: "cax11", createdAt: "2026-01-01T00:00:00Z" },
    ];
    // .kastell exists (skip dir migration), servers.json exists
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));

    migrateConfigIfNeeded();

    expect(mockSecureWrite.secureWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("servers.json.tmp"),
      expect.stringContaining('"mode": "coolify"'),
    );
  });

  it("should NOT write when all servers already have mode", () => {
    const servers = [
      { id: "1", name: "has-mode", provider: "hetzner", ip: "1.1.1.1", region: "nbg1", size: "cax11", createdAt: "2026-01-01T00:00:00Z", mode: "coolify" },
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(servers));

    migrateConfigIfNeeded();

    // secureWriteFileSync should not be called for servers.json.tmp (only .migrated flag would be called)
    const calls = mockSecureWrite.secureWriteFileSync.mock.calls;
    const serverWriteCalls = calls.filter((c: string[]) => String(c[0]).includes("servers.json"));
    expect(serverWriteCalls).toHaveLength(0);
  });

  it("should handle mode migration failure gracefully", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("corrupt file");
    });

    expect(() => migrateConfigIfNeeded()).not.toThrow();
  });
});
