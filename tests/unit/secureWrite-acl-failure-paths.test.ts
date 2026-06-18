/**
 * Tests for the 4 ACL failure paths in src/utils/secureWrite.ts (P142 coverage
 * gap: lines 100-112, 113-126, 128-143, 145-160). The sibling file
 * `tests/unit/secureWrite.test.ts` covers the happy path and the case where
 * icacls /inheritance:r fails (the FIRST icacls call). This file exercises:
 *   - whoami returns non-zero status
 *   - whoami returns empty identity (status 0 but stdout empty)
 *   - icacls /grant fails (the SECOND icacls call)
 * for both sensitivity=state (warn) and sensitivity=secret (throw).
 */
import { writeFileSync, appendFileSync, mkdirSync, chmodSync } from "fs";
import { spawnSync } from "child_process";

/**
 * P143-C EXEMPTION: minimal-2
 * Reason: same as `secureWrite.test.ts` — spreads `jest.requireActual("fs")` to
 *   retain real Stats/Dirent/constants; selectively mocks write/append/mkdir/chmod.
 *   createFsMock() lacks appendFileSync and fs module-level exports.
 * Verified: tests fail-path ACL behavior (whoami empty status, icacls /grant fail);
 *   cannot reach P143-C Linux parity path because mock factory is identical
 *   structure to sibling secureWrite.test.ts.
 */
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    chmodSync: jest.fn(),
  };
});

jest.mock("child_process", () => ({
  spawnSync: jest.fn(),
}));

const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedAppendFileSync = appendFileSync as jest.MockedFunction<typeof appendFileSync>;
const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
const mockedChmodSync = chmodSync as jest.MockedFunction<typeof chmodSync>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

let secureWriteModule: typeof import("../../src/utils/secureWrite");

async function loadModule() {
  jest.resetModules();
  jest.resetAllMocks();
  jest.doMock("fs", () => ({
    writeFileSync: mockedWriteFileSync,
    appendFileSync: mockedAppendFileSync,
    mkdirSync: mockedMkdirSync,
    chmodSync: mockedChmodSync,
  }));
  jest.doMock("child_process", () => ({ spawnSync: mockedSpawnSync }));
  secureWriteModule = await import("../../src/utils/secureWrite");
  return secureWriteModule;
}

beforeEach(async () => {
  jest.resetModules();
  jest.resetAllMocks();
  mockedWriteFileSync.mockReturnValue(undefined);
  mockedAppendFileSync.mockReturnValue(undefined);
  mockedMkdirSync.mockReturnValue(undefined);
  mockedChmodSync.mockReturnValue(undefined);
  mockedSpawnSync.mockReturnValue({
    stdout: "DOMAIN\\user\r\n",
    stderr: "",
    status: 0,
    pid: 0,
    output: [],
    signal: null,
  } as unknown as ReturnType<typeof spawnSync>);
  const { clearCache } = await import("../../src/utils/secureWrite");
  clearCache();
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
});

describe("applyWindowsAcl — whoami failure paths", () => {
  it("THROWS when sensitivity=secret and whoami returns non-zero status", async () => {
    await loadModule();
    mockedSpawnSync.mockImplementation(((cmd: string) => {
      if (cmd === "whoami") {
        return {
          stdout: "",
          stderr: "whoami: failed",
          status: 1,
          pid: 0,
          output: [],
          signal: null,
          error: new Error("whoami failed"),
        } as unknown as ReturnType<typeof spawnSync>;
      }
      return {
        stdout: "",
        stderr: "",
        status: 0,
        pid: 0,
        output: [],
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>;
    }) as unknown as typeof spawnSync);

    const { secureWriteFileSync } = secureWriteModule;

    expect(() =>
      secureWriteFileSync("C:\\secret.json", "data", { sensitivity: "secret" }),
    ).toThrow();
  });

  it("WARNS and does NOT throw when sensitivity=state and whoami returns non-zero status", async () => {
    await loadModule();
    const { logger } = await import("../../src/utils/logger");
    const warningSpy = jest.spyOn(logger, "warning").mockImplementation(() => {});

    mockedSpawnSync.mockImplementation(((cmd: string) => {
      if (cmd === "whoami") {
        return {
          stdout: "",
          stderr: "whoami: failed",
          status: 1,
          pid: 0,
          output: [],
          signal: null,
          error: new Error("whoami failed"),
        } as unknown as ReturnType<typeof spawnSync>;
      }
      return {
        stdout: "",
        stderr: "",
        status: 0,
        pid: 0,
        output: [],
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>;
    }) as unknown as typeof spawnSync);

    const { secureWriteFileSync } = secureWriteModule;

    expect(() =>
      secureWriteFileSync("C:\\state.json", "data"),
    ).not.toThrow();
    expect(warningSpy).toHaveBeenCalled();
    warningSpy.mockRestore();
  });

  it("THROWS when sensitivity=secret and whoami returns empty identity (status 0, no stdout)", async () => {
    await loadModule();
    mockedSpawnSync.mockImplementation(((cmd: string) => {
      if (cmd === "whoami") {
        return {
          stdout: "   \n",
          stderr: "",
          status: 0,
          pid: 0,
          output: [],
          signal: null,
        } as unknown as ReturnType<typeof spawnSync>;
      }
      return {
        stdout: "",
        stderr: "",
        status: 0,
        pid: 0,
        output: [],
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>;
    }) as unknown as typeof spawnSync);

    const { secureWriteFileSync } = secureWriteModule;

    expect(() =>
      secureWriteFileSync("C:\\secret.json", "data", { sensitivity: "secret" }),
    ).toThrow();
  });
});

describe("applyWindowsAcl — icacls /grant failure path (second icacls call)", () => {
  it("THROWS when sensitivity=secret and the second icacls call (icacls /grant) fails", async () => {
    await loadModule();
    mockedSpawnSync.mockImplementation(((cmd: string, args?: readonly string[]) => {
      if (cmd === "whoami") {
        return {
          stdout: "DOMAIN\\user\r\n",
          stderr: "",
          status: 0,
          pid: 0,
          output: [],
          signal: null,
        } as unknown as ReturnType<typeof spawnSync>;
      }
      if (cmd === "icacls" && Array.isArray(args) && args.includes("/grant")) {
        // Second icacls call (grant) fails
        return {
          stdout: "",
          stderr: "Access denied on grant",
          status: 5,
          pid: 0,
          output: [],
          signal: null,
          error: new Error("icacls grant failed"),
        } as unknown as ReturnType<typeof spawnSync>;
      }
      // First icacls call (inheritance:r) succeeds
      return {
        stdout: "",
        stderr: "",
        status: 0,
        pid: 0,
        output: [],
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>;
    }) as unknown as typeof spawnSync);

    const { secureWriteFileSync } = secureWriteModule;

    expect(() =>
      secureWriteFileSync("C:\\secret.json", "data", { sensitivity: "secret" }),
    ).toThrow();
  });

  it("WARNS and does NOT throw when sensitivity=state and the second icacls call (icacls /grant) fails", async () => {
    await loadModule();
    const { logger } = await import("../../src/utils/logger");
    const warningSpy = jest.spyOn(logger, "warning").mockImplementation(() => {});

    mockedSpawnSync.mockImplementation(((cmd: string, args?: readonly string[]) => {
      if (cmd === "whoami") {
        return {
          stdout: "DOMAIN\\user\r\n",
          stderr: "",
          status: 0,
          pid: 0,
          output: [],
          signal: null,
        } as unknown as ReturnType<typeof spawnSync>;
      }
      if (cmd === "icacls" && Array.isArray(args) && args.includes("/grant")) {
        return {
          stdout: "",
          stderr: "Access denied on grant",
          status: 5,
          pid: 0,
          output: [],
          signal: null,
          error: new Error("icacls grant failed"),
        } as unknown as ReturnType<typeof spawnSync>;
      }
      return {
        stdout: "",
        stderr: "",
        status: 0,
        pid: 0,
        output: [],
        signal: null,
      } as unknown as ReturnType<typeof spawnSync>;
    }) as unknown as typeof spawnSync);

    const { secureWriteFileSync } = secureWriteModule;

    expect(() =>
      secureWriteFileSync("C:\\state.json", "data"),
    ).not.toThrow();
    expect(warningSpy).toHaveBeenCalled();
    warningSpy.mockRestore();
  });
});
