import { describe, test, expect, afterEach, beforeEach } from "@jest/globals";
import { executePluginChecks } from "../../src/core/plugin/audit.js";
import { chunkConcurrent } from "../../src/utils/concurrency.js";

jest.mock("../../src/utils/concurrency.js", () => ({
  chunkConcurrent: jest.fn(),
}));

describe("executePluginChecks concurrency", () => {
  let mockChunkConcurrent: jest.Mock;

  beforeEach(() => {
    mockChunkConcurrent = chunkConcurrent as jest.Mock;
  });

  afterEach(() => {
    delete process.env.PLUGIN_AUDIT_TIMEOUT_MS;
    jest.resetAllMocks();
  });

  // P144 T5: executePluginChecks now consumes registry-normalized read
  // checks (PluginReadCheck = LoadedPluginCheck & { read }). Fixture shape
  // uses `read.cmd` instead of legacy `checkCommand.cmd`.

  test("read checks use default cap", async () => {
    let capturedConcurrency = 0;
    const checks = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      name: `check${i}`,
      category: "test",
      severity: "info" as const,
      description: "test",
      read: { cmd: "echo" },
    }));
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));

    mockChunkConcurrent.mockImplementation(async (items: unknown[], concurrency: number) => {
      capturedConcurrency = concurrency;
      return items.map(() => ({ checkId: "x", status: "pass" as const }));
    });

    const result = await executePluginChecks(checks as never, { ssh });

    expect(capturedConcurrency).toBe(3);
    expect(result.results).toHaveLength(6);
  });

  test("normalized reads always run at default parallelism (no kind branching)", async () => {
    // P144 T5: kind-branching is gone — even reads that were "mutate-*"
    // would not appear in `readChecks` upstream. executePluginChecks no
    // longer inspects check shape, only the concurrency env override.
    const checks = [
      { id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", read: { cmd: "echo" } },
    ];
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));
    mockChunkConcurrent.mockImplementation(async () => []);

    await executePluginChecks(checks as never, { ssh });

    expect(mockChunkConcurrent).toHaveBeenCalledWith(expect.any(Array), expect.any(Number), expect.any(Function));
    expect(mockChunkConcurrent.mock.calls[0][1]).toBeGreaterThan(1);
  });

  test("passes read.cmd to ssh", async () => {
    const checks = [
      { id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", read: { cmd: "echo exact" } },
    ];
    const ssh: jest.Mock = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));
    mockChunkConcurrent.mockImplementation(async (items: unknown[], _concurrency: number, worker: (item: unknown) => Promise<unknown>) =>
      Promise.all(items.map(worker)),
    );

    await executePluginChecks(checks as never, { ssh });

    expect(ssh).toHaveBeenCalledWith("echo exact", expect.objectContaining({ timeoutMs: 15000 }));
  });

  test("partial failure — error results returned with error status", async () => {
    const checks = [
      { id: "ok-1", name: "ok", category: "test", severity: "info" as const, description: "test", read: { cmd: "echo" } },
      { id: "fail-1", name: "fail", category: "test", severity: "info" as const, description: "test", read: { cmd: "false" } },
    ];
    const ssh = jest.fn(async (_cmd: string) => {
      if (_cmd.includes("false")) return { stdout: "", stderr: "command failed", code: 1 };
      return { stdout: "ok", stderr: "", code: 0 };
    });

    mockChunkConcurrent.mockImplementation(async (items: unknown[]) => {
      return (items as Array<{ id: string; read: { cmd: string } }>).map((item) => ({
        checkId: item.id,
        status: item.read.cmd.includes("false") ? "error" as const : "pass" as const,
      }));
    });

    const result = await executePluginChecks(checks as never, { ssh });

    expect(result.results.find(r => r.checkId === "ok-1")?.status).toBe("pass");
    expect(result.results.find(r => r.checkId === "fail-1")?.status).toBe("error");
  });

  test("clearTimeout called on success (no leaked timer handle)", async () => {
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const checks = [{ id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", read: { cmd: "echo" } }];
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));

    mockChunkConcurrent.mockImplementation(async () => [
      { checkId: "c0", status: "pass" as const },
    ]);

    await executePluginChecks(checks as never, { ssh });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  test("aggregate timeout — AbortController signal aborts after ceiling", async () => {
    jest.useFakeTimers();
    try {
      const checks = [
        { id: "slow-1", name: "slow", category: "test", severity: "info" as const, description: "test", read: { cmd: "sleep 999" } },
        { id: "slow-2", name: "slow", category: "test", severity: "info" as const, description: "test", read: { cmd: "sleep 999" } },
      ];
      const capturedSignals: AbortSignal[] = [];
      const wrappedSsh = (_cmd: string, opts?: { signal?: AbortSignal }): Promise<{ stdout: string; stderr: string; code: number }> => {
        const signal = opts?.signal;
        if (signal) capturedSignals.push(signal);
        return new Promise((_, reject) => {
          if (signal) {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      };

      mockChunkConcurrent.mockImplementation(async (items: unknown[], _conc: number, worker: (item: unknown) => Promise<unknown>) => {
        const out: unknown[] = [];
        for (const item of items) {
          out.push(await worker(item));
        }
        return out;
      });

      const promise = executePluginChecks(checks as never, { ssh: wrappedSsh });
      await Promise.resolve();
      await Promise.resolve();

      await jest.runAllTimersAsync();

      const result = await promise;

      expect(capturedSignals.length).toBeGreaterThan(0);
      expect(capturedSignals[0].aborted).toBe(true);
      expect(result.results.every(r => r.status === "timeout")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});