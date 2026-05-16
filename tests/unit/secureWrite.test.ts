jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    chmodSync: jest.fn(),
  };
});

import { writeFileSync, mkdirSync, chmodSync } from "fs";

const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
const mockedChmodSync = chmodSync as jest.MockedFunction<typeof chmodSync>;

let secureWriteModule: typeof import("../../src/utils/secureWrite");

async function loadModule() {
  jest.resetModules();
  jest.clearAllMocks();
  jest.doMock("fs", () => ({
    writeFileSync: mockedWriteFileSync,
    mkdirSync: mockedMkdirSync,
    chmodSync: mockedChmodSync,
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
  });

  it("should skip applyPermissions entirely on win32 (no chmod)", async () => {
    await loadModule();
    const { ensureSecureDir } = secureWriteModule;

    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    ensureSecureDir("C:\\Users\\testuser\\secure");

    expect(mockedChmodSync).not.toHaveBeenCalled();
  });

  it("should propagate error when chmodSync throws", async () => {
    await loadModule();
    const { ensureSecureDir } = secureWriteModule;

    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    mockedChmodSync.mockImplementationOnce(() => {
      throw new Error("permission denied");
    });

    expect(() => ensureSecureDir("/secure/dir")).toThrow("permission denied");
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
    it("should skip applyPermissions entirely on win32 (no chmod)", async () => {
      await loadModule();
      const { secureWriteFileSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      mockedChmodSync.mockClear();

      secureWriteFileSync("C:\\Users\\testuser\\file.txt", "data");

      expect(mockedChmodSync).not.toHaveBeenCalled();
    });
  });

  describe("unix platform", () => {
    it("should call chmodSync with 0o600", async () => {
      await loadModule();
      const { secureWriteFileSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });

      secureWriteFileSync("/home/testuser/file.txt", "data");

      expect(mockedChmodSync).toHaveBeenCalledWith("/home/testuser/file.txt", 0o600);
    });

    it("should propagate error when chmodSync throws", async () => {
      await loadModule();
      const { secureWriteFileSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      mockedChmodSync.mockImplementationOnce(() => {
        throw new Error("chmod failed");
      });

      expect(() => secureWriteFileSync("/home/testuser/file.txt", "data")).toThrow("chmod failed");
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
    it("should skip applyPermissions entirely on win32 (no chmod)", async () => {
      await loadModule();
      const { secureMkdirSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      mockedChmodSync.mockClear();

      secureMkdirSync("C:\\Users\\testuser\\dir");

      expect(mockedChmodSync).not.toHaveBeenCalled();
    });
  });

  describe("unix platform", () => {
    it("should call chmodSync with 0o700", async () => {
      await loadModule();
      const { secureMkdirSync } = secureWriteModule;

      Object.defineProperty(process, "platform", { value: "linux", configurable: true });

      secureMkdirSync("/home/testuser/dir");

      expect(mockedChmodSync).toHaveBeenCalledWith("/home/testuser/dir", 0o700);
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

    secureWriteFileSync("C:\\Users\\test\\file.txt", "data");

    expect(mockedChmodSync).not.toHaveBeenCalled();
  });

  it("should skip chmodSync when platform is win32 for directory", async () => {
    const { ensureSecureDir } = secureWriteModule;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mockedChmodSync.mockClear();

    ensureSecureDir("C:\\Users\\test\\dir");

    expect(mockedChmodSync).not.toHaveBeenCalled();
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
