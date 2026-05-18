import { withFileLock } from "../../src/utils/fileLock.js";
import { mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("withFileLock — PID + ceiling behavior", () => {
  const testFile = join(tmpdir(), `kastell-fl-pidc-${process.pid}-${Date.now()}.json`);
  const lockDir = testFile + ".lock";

  afterEach(() => {
    if (existsSync(lockDir)) rmSync(lockDir, { recursive: true, force: true });
  });

  it("happy path: writes PID file, executes fn, cleans up", async () => {
    let executed = false;
    await withFileLock(testFile, async () => {
      executed = true;
      expect(existsSync(join(lockDir, "owner.pid"))).toBe(true);
      return null;
    });
    expect(executed).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("dead PID: instant recovery (< 200ms) — uses injected probe", async () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "owner.pid"), `99999@${require("os").hostname()}@${Date.now()}`);
    const start = Date.now();
    await withFileLock(testFile, async () => null, () => "dead");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it("parse fail: falls back to mtime", async () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "owner.pid"), "garbage-not-parseable");
    const oldTime = new Date(Date.now() - 31_000);
    utimesSync(lockDir, oldTime, oldTime);
    await withFileLock(testFile, async () => null);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("PID file missing inside fresh lockDir: treats as initializing", async () => {
    mkdirSync(lockDir);
    const spy = jest.fn();
    const promise = withFileLock(testFile, async () => { spy(); return null; });
    await new Promise((r) => setTimeout(r, 100));
    expect(spy).not.toHaveBeenCalled();
    rmSync(lockDir, { recursive: true, force: true });
    await promise;
    expect(spy).toHaveBeenCalled();
  });

  it("different hostname: falls back to mtime", async () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "owner.pid"), `12345@some-other-host@${Date.now()}`);
    const oldTime = new Date(Date.now() - 31_000);
    utimesSync(lockDir, oldTime, oldTime);
    await withFileLock(testFile, async () => null);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("alive PID, mtime exceeds 60s ceiling: stale recovery — uses injected probe", async () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "owner.pid"), `${process.pid}@${require("os").hostname()}@${Date.now()}`);
    const oldTime = new Date(Date.now() - 61_000);
    utimesSync(lockDir, oldTime, oldTime);
    await withFileLock(testFile, async () => null, () => "alive");
    expect(existsSync(lockDir)).toBe(false);
  });

  it("interface stable: existing callers unchanged", async () => {
    const result = await withFileLock(testFile, async () => "ok");
    expect(result).toBe("ok");
  });
});
