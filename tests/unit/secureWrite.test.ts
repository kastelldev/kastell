// Mock child_process and os for platform-specific ACL tests
jest.mock("child_process", () => ({
  spawnSync: jest.fn(),
}));

jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    chmodSync: jest.fn(),
  };
});

jest.mock("os", () => {
  const actual = jest.requireActual<typeof import("os")>("os");
  return {
    ...actual,
    userInfo: jest.fn(),
  };
});

jest.mock("../../src/utils/securityLogger", () => ({
  SecurityLogger: {
    warn: jest.fn(),
  },
}));

import { writeFileSync, mkdirSync, chmodSync } from "fs";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import { userInfo } from "os";
import { SecurityLogger } from "../../src/utils/securityLogger";

const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
const mockedChmodSync = chmodSync as jest.MockedFunction<typeof chmodSync>;
const mockedUserInfo = userInfo as jest.MockedFunction<typeof userInfo>;
const mockedSecurityLoggerWarn = SecurityLogger.warn as jest.MockedFunction<typeof SecurityLogger.warn>;

let secureWriteModule: typeof import("../../src/utils/secureWrite");

async function loadModule() {
  jest.resetModules();
  jest.clearAllMocks();
  // Re-apply mocks after resetModules
  jest.doMock("child_process", () => ({ spawnSync: mockedSpawnSync }));
  jest.doMock("fs", () => ({
    writeFileSync: mockedWriteFileSync,
    mkdirSync: mockedMkdirSync,
    chmodSync: mockedChmodSync,
  }));
  jest.doMock("os", () => ({ userInfo: mockedUserInfo }));
  jest.doMock("../../src/utils/securityLogger", () => ({
    SecurityLogger: { warn: mockedSecurityLoggerWarn },
  }));
  secureWriteModule = await import("../../src/utils/secureWrite");
  return secureWriteModule;
}

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockedWriteFileSync.mockReturnValue(undefined);
  mockedMkdirSync.mockReturnValue(undefined);
  mockedChmodSync.mockReturnValue(undefined);
  mockedUserInfo.mockReturnValue({ username: "testuser", uid: 1000, gid: 1000, shell: "/bin/bash", homedir: "/home/testuser" });
  mockedSecurityLoggerWarn.mockReturnValue(undefined);
  mockedSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", pid: 1, output: ["", null, null] as unknown as SpawnSyncReturns<string>['output'], signal: null });
  // Reset module-level flag
  const { clearCache } = await import("../../src/utils/secureWrite");
  clearCache();
});

// ─── ensureSecureDir ──────────────────────────────────────────────────────────

describe("ensureSecureDir", () => {
  it("should skip repeated calls for same path but run for different path", async () => {
    await loadModule();
    const { ensureSecureDir } = secureWriteModule;

    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    ensureSecureDir("/some/path");
    ensureSecureDir("/some/path");
    ensureSecureDir("/some/other/path");

    expect(mockedChmodSync).toHaveBeenCalledTimes(2);
    expect(mockedChmodSync).toHaveBeenCalledWith("/some/path", 0o700);
    expect(mockedChmodSync).toHaveBeenCalledWith("/some/other/path", 0o700);
  });

  it("should call chmodSync with 0o700 on first call (unix)", async () => {
    await loadModule();
    const { ensureSecureDir } = secureWriteModule;

    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    ensureSecureDir("/secure/dir");

    expect(mockedChmodSync).toHaveBeenCalledWith("/secure/dir", 0o700);
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("should skip applyPermissions entirely on win32 (no icacls, no chmod)", async () => {
    await loadModule();
    const { ensureSecureDir } = secureWriteModule;

    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    ensureSecureDir("C:\\Users\\testuser\\secure");

    expect(mockedSpawnSync).not.toHaveBeenCalled();
    expect(mockedChmodSync).not.toHaveBeenCalled();
  });

  it("should call SecurityLogger.warn when chmodSync throws", async () => {
    await loadModule();
    const { ensureSecureDir } = secureWriteModule;

    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    mockedChmodSync.mockImplementationOnce(() => {
      throw new Error("permission denied");
    });

    ensureSecureDir("/secure/dir");

    expect(mockedSecurityLoggerWarn).toHaveBeenCalledWith(
      "chmod operation failed",
      expect.objectContaining({ path: "/secure/dir", platform: "linux" }),
    );
  });
});

// ─── secureWriteFileSync ───────────────────────────────────────────────────────

describe("secureWriteFileSync", () => {
  it("should call writeFileSync with correct arguments", async () => {
    await loadModule();
    const { secureWriteFileSync } = secureWriteModule;

    secureWriteFileSync("/path/to/file.txt", "test content");

    expect(mockedWriteFileSync).toHaveBeenCalledWith("/path/to/file.txt", "test content", undefined);
  });

  it("should pass options to writeFileSync", async () => {
    await loadModule();
    const { secureWriteFileSync } = secureWriteModule;
    const opts = { encoding: "utf8" as const, mode: 0o644 };

    secureWriteFileSync("/path/to/file.txt", "test content", opts);

    expect(mockedWriteFileSync).toHaveBeenCalledWith("/path/to/file.txt", "test content", opts);
  });

  describe("win32 platform", () => {
    it("should skip applyPermissions entirely on win32 (no icacls, no chmod)", async () => {
      await loadModule();
      const { secureWriteFileSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      mockedChmodSync.mockClear();
      mockedSpawnSync.mockClear();

      secureWriteFileSync("C:\\Users\\testuser\\file.txt", "data");

      expect(mockedChmodSync).not.toHaveBeenCalled();
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe("unix platform", () => {
    it("should call chmodSync with 0o600", async () => {
      await loadModule();
      const { secureWriteFileSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });

      secureWriteFileSync("/home/testuser/file.txt", "data");

      expect(mockedChmodSync).toHaveBeenCalledWith("/home/testuser/file.txt", 0o600);
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    });

    it("should call SecurityLogger.warn when chmodSync throws", async () => {
      await loadModule();
      const { secureWriteFileSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      mockedChmodSync.mockImplementationOnce(() => {
        throw new Error("permission denied");
      });

      secureWriteFileSync("/home/testuser/file.txt", "data");

      expect(mockedSecurityLoggerWarn).toHaveBeenCalledWith(
        "chmod operation failed",
        expect.objectContaining({ path: "/home/testuser/file.txt", platform: "linux" }),
      );
    });
  });
});

// ─── secureMkdirSync ──────────────────────────────────────────────────────────

describe("secureMkdirSync", () => {
  it("should call mkdirSync with recursive true by default", async () => {
    await loadModule();
    const { secureMkdirSync } = secureWriteModule;

    secureMkdirSync("/path/to/dir");

    expect(mockedMkdirSync).toHaveBeenCalledWith("/path/to/dir", { recursive: true });
  });

  it("should pass options.recursive to mkdirSync", async () => {
    await loadModule();
    const { secureMkdirSync } = secureWriteModule;

    secureMkdirSync("/path/to/dir", { recursive: false });

    expect(mockedMkdirSync).toHaveBeenCalledWith("/path/to/dir", { recursive: false });
  });

  describe("win32 platform", () => {
    it("should skip applyPermissions entirely on win32 (no icacls, no chmod)", async () => {
      await loadModule();
      const { secureMkdirSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      mockedChmodSync.mockClear();
      mockedSpawnSync.mockClear();

      secureMkdirSync("C:\\Users\\testuser\\dir");

      expect(mockedChmodSync).not.toHaveBeenCalled();
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe("unix platform", () => {
    it("should call chmodSync with 0o700", async () => {
      await loadModule();
      const { secureMkdirSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });

      secureMkdirSync("/home/testuser/dir");

      expect(mockedChmodSync).toHaveBeenCalledWith("/home/testuser/dir", 0o700);
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    });

    it("should call SecurityLogger.warn when chmodSync throws", async () => {
      await loadModule();
      const { secureMkdirSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      mockedChmodSync.mockImplementationOnce(() => {
        throw new Error("permission denied");
      });

      secureMkdirSync("/home/testuser/dir");

      expect(mockedSecurityLoggerWarn).toHaveBeenCalledWith(
        "chmod operation failed",
        expect.objectContaining({ path: "/home/testuser/dir", platform: "linux" }),
      );
    });

    it("should propagate error when mkdirSync throws", async () => {
      await loadModule();
      const { secureMkdirSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      mockedMkdirSync.mockImplementationOnce(() => {
        throw new Error("ENOENT");
      });

      expect(() => secureMkdirSync("/home/testuser/dir")).toThrow("ENOENT");
      expect(mockedChmodSync).not.toHaveBeenCalled();
    });
  });
});

// ─── Win32 platform guard ──────────────────────────────────────────────────────

describe("Win32 platform guard — applyPermissions no-op", () => {
  beforeEach(async () => {
    await loadModule();
  });

  it("should skip chmodSync when platform is win32 for file", async () => {
    const { secureWriteFileSync } = secureWriteModule;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mockedChmodSync.mockClear();
    mockedSpawnSync.mockClear();

    secureWriteFileSync("C:\\Users\\test\\file.txt", "data");

    expect(mockedChmodSync).not.toHaveBeenCalled();
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("should skip chmodSync when platform is win32 for directory", async () => {
    const { ensureSecureDir } = secureWriteModule;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mockedChmodSync.mockClear();
    mockedSpawnSync.mockClear();

    ensureSecureDir("C:\\Users\\test\\dir");

    expect(mockedChmodSync).not.toHaveBeenCalled();
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("should still call chmodSync on linux", async () => {
    const { secureWriteFileSync } = secureWriteModule;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    mockedChmodSync.mockClear();

    secureWriteFileSync("/home/test/file.txt", "data");

    expect(mockedChmodSync).toHaveBeenCalledWith("/home/test/file.txt", 0o600);
  });

  it("should still call chmodSync on darwin", async () => {
    const { secureWriteFileSync } = secureWriteModule;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    mockedChmodSync.mockClear();

    secureWriteFileSync("/Users/test/file.txt", "data");

    expect(mockedChmodSync).toHaveBeenCalledWith("/Users/test/file.txt", 0o600);
  });
});
