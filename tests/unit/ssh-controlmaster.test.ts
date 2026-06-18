/**
 * Tests for SSH ControlMaster in src/utils/ssh.ts (P142 coverage gap: lines
 * 437-531). sshMasterOpen / sshMasterClose / getControlArgs are P142 additions
 * for connection multiplexing (prevents MaxStartups exhaustion). The internal
 * `activeMasters` Map is module-private; we exercise it through the public
 * API (open → args populated → close → args cleared).
 *
 * Uses jest.useFakeTimers() per LESSONS — sshMasterOpen's master-establishment
 * wait is a real 3s setTimeout. Fake timers + runAllTimersAsync avoids the
 * 3s real wait while still exercising the timeout callback.
 */
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { EventEmitter } from "events";
import { sshMasterOpen, sshMasterClose, getControlArgs } from "../../src/utils/ssh";

jest.mock("child_process", () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock("fs", () => {
  const { createFsMock } = require("../helpers/fsMock.js");
  return createFsMock({
    statSync: jest.fn(() => ({ mtimeMs: Date.now(), dev: 0 })),
  });
});

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

/**
 * Like mockProcess but also exposes unref() and kill() — needed for
 * sshMasterOpen which calls child.unref() on success and killChild() on
 * failure.
 */
function masterProcess(): ChildProcess {
  const ee = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: null;
    pid: number;
    unref: () => void;
    kill: (signal?: string) => boolean;
  };
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.stdin = null;
  ee.pid = 12345;
  ee.unref = jest.fn();
  ee.kill = jest.fn().mockReturnValue(true);
  return ee as unknown as ChildProcess;
}

describe("SSH ControlMaster", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // mockReset (not clearAllMocks) per LESSONS — clearAllMocks leaves mockReturnValue
    // queues intact and silently leaks between tests.
    mockedSpawn.mockReset();
    mockedSpawnSync.mockReset();
    mockedExistsSync.mockReset();
    // Default: spawnSync probes return success so resolveSshPath returns "ssh"
    // and the -O check inside sshMasterOpen passes.
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      pid: 1,
      output: [],
      signal: null,
    });
    mockedExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    // Close any open masters so the module-level Map is clean for the next test
    sshMasterClose("1.2.3.4");
    sshMasterClose("10.0.0.5");
    sshMasterClose("203.0.113.1");
  });

  it("sshMasterOpen returns true and populates getControlArgs on success", async () => {
    mockedSpawn.mockReturnValue(masterProcess());

    const promise = sshMasterOpen("1.2.3.4");
    // Advance past the 3s master-establishment wait
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    const args = getControlArgs("1.2.3.4");
    expect(args.length).toBeGreaterThan(0);
    expect(args.some((a) => a.startsWith("-o"))).toBe(true);
    expect(args.some((a) => a.startsWith("ControlPath="))).toBe(true);
  });

  it("sshMasterOpen returns true immediately if a master is already open (no new spawn)", async () => {
    mockedSpawn.mockReturnValue(masterProcess());

    // First call establishes the master
    const first = sshMasterOpen("1.2.3.4");
    await jest.runAllTimersAsync();
    expect(await first).toBe(true);

    // Second call should short-circuit: no new spawn
    mockedSpawn.mockClear();
    const second = await sshMasterOpen("1.2.3.4");
    expect(second).toBe(true);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it("sshMasterOpen returns false and does NOT populate getControlArgs when -O check fails", async () => {
    // spawnSync: -O check returns failure; everything else succeeds
    mockedSpawnSync.mockImplementation(((cmd: string, args?: readonly string[]) => {
      if (Array.isArray(args) && args.includes("-O") && args.includes("check")) {
        return { status: 1, stdout: Buffer.from(""), stderr: Buffer.from("Control socket not found"), pid: 1, output: [], signal: null };
      }
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null };
    }) as unknown as jest.MockedFunction<typeof spawnSync>);
    mockedSpawn.mockReturnValue(masterProcess());

    const promise = sshMasterOpen("10.0.0.5");
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(false);
    expect(getControlArgs("10.0.0.5")).toEqual([]);
  });

  it("sshMasterOpen returns false when -O check returns non-zero (general failure)", async () => {
    mockedSpawnSync.mockImplementation(((cmd: string, args?: readonly string[]) => {
      if (Array.isArray(args) && args.includes("check")) {
        return { status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null };
      }
      return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null };
    }) as unknown as jest.MockedFunction<typeof spawnSync>);
    mockedSpawn.mockReturnValue(masterProcess());

    const promise = sshMasterOpen("203.0.113.1");
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(false);
  });

  it("sshMasterClose runs ssh -O exit and clears getControlArgs", async () => {
    mockedSpawn.mockReturnValue(masterProcess());

    // Open first
    const open = sshMasterOpen("1.2.3.4");
    await jest.runAllTimersAsync();
    expect(await open).toBe(true);
    expect(getControlArgs("1.2.3.4").length).toBeGreaterThan(0);

    // Close — spawnSync should be called with -O exit, and Map should be cleared
    const spawnSyncCallsBefore = mockedSpawnSync.mock.calls.length;
    sshMasterClose("1.2.3.4");

    const closeCalls = mockedSpawnSync.mock.calls.slice(spawnSyncCallsBefore);
    expect(closeCalls.some(([, args]) => Array.isArray(args) && args.includes("-O") && args.includes("exit"))).toBe(true);
    expect(getControlArgs("1.2.3.4")).toEqual([]);
  });

  it("sshMasterClose is a no-op when no master is open for the IP", () => {
    const spawnSyncCallsBefore = mockedSpawnSync.mock.calls.length;
    sshMasterClose("10.0.0.5");
    // No new spawnSync call for the close
    expect(mockedSpawnSync.mock.calls.length).toBe(spawnSyncCallsBefore);
  });

  it("getControlArgs returns empty array when no master is open for the IP", () => {
    expect(getControlArgs("203.0.113.1")).toEqual([]);
  });
});
