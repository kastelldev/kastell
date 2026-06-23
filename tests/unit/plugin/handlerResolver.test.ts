/**
 * handlerResolver unit tests — P-H coverage fix.
 * Tests the REAL resolvePluginHandler function via ESM dynamic import
 * with real temporary handler files (no module mock).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

// Real import — no mock
import { resolvePluginHandler } from "../../../src/plugin/handlerResolver.js";

describe("resolvePluginHandler", () => {
  let tmpDir: string;

  beforeEach(() => {
    const tmp = os.tmpdir() ?? "/tmp";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tmpDir = mkdirSync(join(tmp, `kastell-handler-test-${Date.now()}`), {
      recursive: true,
    } as any) as string;
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("resolves default export function", async () => {
    const handlerFile = join(tmpDir, "handler-default-fn.ts");
    writeFileSync(
      handlerFile,
      "export default function() { return 'default-fn-result'; }\n",
    );
    const handler = await resolvePluginHandler(tmpDir, "handler-default-fn.ts");
    expect(typeof handler).toBe("function");
    expect(handler()).toBe("default-fn-result");
  });

  it("resolves default.handler export", async () => {
    const handlerFile = join(tmpDir, "handler-default-obj.ts");
    writeFileSync(
      handlerFile,
      "export default { handler() { return 'default-handler-result'; } }\n",
    );
    const handler = await resolvePluginHandler(tmpDir, "handler-default-obj.ts");
    expect(typeof handler).toBe("function");
    expect(handler()).toBe("default-handler-result");
  });

  it("resolves named handler export", async () => {
    const handlerFile = join(tmpDir, "handler-named.ts");
    writeFileSync(
      handlerFile,
      "export function handler() { return 'named-handler-result'; }\n",
    );
    const handler = await resolvePluginHandler(tmpDir, "handler-named.ts");
    expect(typeof handler).toBe("function");
    expect(handler()).toBe("named-handler-result");
  });

  it("resolves named fix export", async () => {
    const handlerFile = join(tmpDir, "handler-fix.ts");
    writeFileSync(
      handlerFile,
      "export function fix() { return 'fix-result'; }\n",
    );
    const handler = await resolvePluginHandler(tmpDir, "handler-fix.ts");
    expect(typeof handler).toBe("function");
    expect(handler()).toBe("fix-result");
  });

  it("resolves named run export", async () => {
    const handlerFile = join(tmpDir, "handler-run.ts");
    writeFileSync(
      handlerFile,
      "export function run() { return 'run-result'; }\n",
    );
    const handler = await resolvePluginHandler(tmpDir, "handler-run.ts");
    expect(typeof handler).toBe("function");
    expect(handler()).toBe("run-result");
  });

  it("throws error when no handler-like export exists", async () => {
    const handlerFile = join(tmpDir, "handler-empty.ts");
    writeFileSync(handlerFile, "export const data = 42;\n");
    await expect(
      resolvePluginHandler(tmpDir, "handler-empty.ts"),
    ).rejects.toThrow("Plugin handler not found");
  });

  it("prefers default function over named handler/fix/run", async () => {
    const handlerFile = join(tmpDir, "handler-prefer-default.ts");
    writeFileSync(
      handlerFile,
      "export default function() { return 'default'; }\n" +
        "export function handler() { return 'handler'; }\n" +
        "export function fix() { return 'fix'; }\n" +
        "export function run() { return 'run'; }\n",
    );
    const handler = await resolvePluginHandler(tmpDir, "handler-prefer-default.ts");
    expect(handler()).toBe("default");
  });

  it("prefers handler over fix and run when default is not a function", async () => {
    const handlerFile = join(tmpDir, "handler-prefer-named.ts");
    writeFileSync(
      handlerFile,
      "export default { notAFunction: true };\n" +
        "export function handler() { return 'handler'; }\n" +
        "export function fix() { return 'fix'; }\n" +
        "export function run() { return 'run'; }\n",
    );
    const handler = await resolvePluginHandler(tmpDir, "handler-prefer-named.ts");
    expect(handler()).toBe("handler");
  });

  it("passes arguments through to the resolved handler", async () => {
    const handlerFile = join(tmpDir, "handler-args.ts");
    writeFileSync(
      handlerFile,
      "export function handler(a: number, b: number) { return a + b; }\n",
    );
    const handler = await resolvePluginHandler(tmpDir, "handler-args.ts");
    expect(handler(2, 3)).toBe(5);
  });

  it("throws when handler file does not exist", async () => {
    await expect(
      resolvePluginHandler(tmpDir, "nonexistent-handler.ts"),
    ).rejects.toThrow();
  });
});
