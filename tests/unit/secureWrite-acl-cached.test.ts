/**
 * Tests for cached Windows identity resolution in src/utils/secureWrite.ts
 * (P143-F Task 8). The whoami process is expensive on Windows; we cache the
 * identity for the process lifetime. The cache must be exposed with a
 * test-only reset hook so the global module state does not leak across tests.
 */
import { writeFileSync, appendFileSync, mkdirSync, chmodSync } from "fs";
import { spawnSync } from "child_process";

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

interface SpawnSyncCall {
  cmd: string;
  args: string[];
}

function getSpawnCalls(): SpawnSyncCall[] {
  return mockedSpawnSync.mock.calls.map((c) => ({
    cmd: c[0] as string,
    args: (c[1] as string[] | undefined) ?? [],
  }));
}

let secureWriteModule: typeof import("../../src/utils/secureWrite");

async function loadModule() {
  jest.resetModules();
  jest.clearAllMocks();
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

function defaultSpawnOk(): ReturnType<typeof spawnSync> {
  return {
    stdout: "DOMAIN\\user\r\n",
    stderr: "",
    status: 0,
    pid: 0,
    output: [],
    signal: null,
  } as unknown as ReturnType<typeof spawnSync>;
}

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockedWriteFileSync.mockReturnValue(undefined);
  mockedAppendFileSync.mockReturnValue(undefined);
  mockedMkdirSync.mockReturnValue(undefined);
  mockedChmodSync.mockReturnValue(undefined);
  mockedSpawnSync.mockImplementation(((cmd: string, args?: readonly string[]) => ({
    stdout:
      cmd === "whoami"
        ? "DOMAIN\\user\r\n"
        : args?.length === 1
          ? `${args[0]} DOMAIN\\user:(F)\r\n`
          : `processed file: ${args?.[0] ?? ""}\r\n`,
    stderr: "",
    status: 0,
    pid: 0,
    output: [],
    signal: null,
  })) as unknown as typeof spawnSync);
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
});

afterEach(async () => {
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  // CRITICAL: reset the module-level identity cache between tests so the
  // first-call/skip-on-subsequent-call behavior is observable per test.
  const mod = await import("../../src/utils/secureWrite");
  if (typeof mod.resetWindowsIdentityCacheForTesting === "function") {
    mod.resetWindowsIdentityCacheForTesting();
  }
});

// ─── getCurrentWindowsIdentity / resetWindowsIdentityCacheForTesting ────────

describe("getCurrentWindowsIdentity", () => {
  it("is exported and is a function", async () => {
    await loadModule();
    expect(typeof secureWriteModule.getCurrentWindowsIdentity).toBe("function");
  });

  it("invokes whoami on first call and returns the trimmed identity", async () => {
    await loadModule();
    mockedSpawnSync.mockClear();

    const identity = secureWriteModule.getCurrentWindowsIdentity();

    const whoamiCalls = getSpawnCalls().filter((c) => c.cmd === "whoami");
    expect(whoamiCalls).toHaveLength(1);
    expect(whoamiCalls[0].args).toEqual([]);
    expect(identity).toBe("DOMAIN\\user");
  });

  it("returns the cached identity on subsequent calls without invoking whoami again", async () => {
    await loadModule();
    secureWriteModule.getCurrentWindowsIdentity();
    mockedSpawnSync.mockClear();

    const second = secureWriteModule.getCurrentWindowsIdentity();
    const third = secureWriteModule.getCurrentWindowsIdentity();

    const whoamiCalls = getSpawnCalls().filter((c) => c.cmd === "whoami");
    expect(whoamiCalls).toHaveLength(0);
    expect(second).toBe("DOMAIN\\user");
    expect(third).toBe("DOMAIN\\user");
  });

  it("trims trailing whitespace from whoami stdout", async () => {
    await loadModule();
    mockedSpawnSync.mockImplementation((() => ({
      stdout: "DOMAIN\\user   \r\n\r\n",
      stderr: "",
      status: 0,
      pid: 0,
      output: [],
      signal: null,
    })) as unknown as typeof spawnSync);

    const identity = secureWriteModule.getCurrentWindowsIdentity();

    expect(identity).toBe("DOMAIN\\user");
  });
});

describe("resetWindowsIdentityCacheForTesting", () => {
  it("is exported and is a function", async () => {
    await loadModule();
    expect(typeof secureWriteModule.resetWindowsIdentityCacheForTesting).toBe("function");
  });

  it("clears the cache so the next call invokes whoami again", async () => {
    await loadModule();
    secureWriteModule.getCurrentWindowsIdentity();
    mockedSpawnSync.mockClear();

    secureWriteModule.resetWindowsIdentityCacheForTesting();

    secureWriteModule.getCurrentWindowsIdentity();

    const whoamiCalls = getSpawnCalls().filter((c) => c.cmd === "whoami");
    expect(whoamiCalls).toHaveLength(1);
  });
});

// ─── ACL step integration: whoami runs once across multiple writes ──────────

describe("applyWindowsAcl integration — whoami cached across writes", () => {
  it("should invoke whoami only once across multiple secureWriteFileSync calls", async () => {
    await loadModule();
    const { secureWriteFileSync } = secureWriteModule;

    secureWriteFileSync("C:\\Users\\test\\a.txt", "data");
    secureWriteFileSync("C:\\Users\\test\\b.txt", "data");
    secureWriteFileSync("C:\\Users\\test\\c.txt", "data");

    const whoamiCalls = getSpawnCalls().filter((c) => c.cmd === "whoami");
    expect(whoamiCalls).toHaveLength(1);
  });

  it("should re-invoke whoami after resetWindowsIdentityCacheForTesting", async () => {
    await loadModule();
    const { secureWriteFileSync } = secureWriteModule;

    secureWriteFileSync("C:\\Users\\test\\a.txt", "data");
    secureWriteFileSync("C:\\Users\\test\\b.txt", "data");
    expect(getSpawnCalls().filter((c) => c.cmd === "whoami")).toHaveLength(1);

    secureWriteModule.resetWindowsIdentityCacheForTesting();
    secureWriteFileSync("C:\\Users\\test\\c.txt", "data");

    expect(getSpawnCalls().filter((c) => c.cmd === "whoami")).toHaveLength(2);
  });
});

// ─── Sensitivity failure policy remains intact with cached identity ─────────

describe("cached identity does not change sensitivity failure policy", () => {
  it("THROWS on first secret-file write when whoami fails", async () => {
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
        } as unknown as ReturnType<typeof spawnSync>;
      }
      return defaultSpawnOk();
    }) as unknown as typeof spawnSync);

    const { secureWriteFileSync } = secureWriteModule;
    expect(() =>
      secureWriteFileSync("C:\\secret.json", "data", { sensitivity: "secret" }),
    ).toThrow();
  });

  it("WARNS (no throw) on state-file write when whoami fails", async () => {
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
        } as unknown as ReturnType<typeof spawnSync>;
      }
      return defaultSpawnOk();
    }) as unknown as typeof spawnSync);

    const { secureWriteFileSync } = secureWriteModule;
    expect(() => secureWriteFileSync("C:\\state.json", "data")).not.toThrow();
  });
});
