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
    jest.restoreAllMocks();
  });

  test("runs max 3 checks concurrently by default", async () => {
    let capturedConcurrency = 0;
    const checks = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, name: `check${i}`, category: "test", severity: "info" as const,
      description: "test", checkCommand: "echo",
    }));

    const ssh = jest.fn(async () => {
      await new Promise(r => setTimeout(r, 10));
      return { stdout: "ok", stderr: "", code: 0 };
    });

    mockChunkConcurrent.mockImplementation(async (items: unknown[], concurrency: number) => {
      capturedConcurrency = concurrency;
      return items.map(() => ({ checkId: "x", status: "pass" as const }));
    });

    const result = await executePluginChecks(checks, { ssh, manifest: {} });

    expect(capturedConcurrency).toBe(3);
    expect(result.results).toHaveLength(6);
  });

  test("safeToParallel: false → cap=1", async () => {
    const checks = [{ id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", checkCommand: "echo" }];
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));

    mockChunkConcurrent.mockImplementation(async () => []);

    await executePluginChecks(checks, { ssh, manifest: { safeToParallel: false } });

    expect(mockChunkConcurrent).toHaveBeenCalledWith(expect.any(Array), 1, expect.any(Function));
  });

  test("partial failure — error results returned with error status", async () => {
    const checks = [
      { id: "ok-1", name: "ok", category: "test", severity: "info" as const, description: "test", checkCommand: "echo" },
      { id: "fail-1", name: "fail", category: "test", severity: "info" as const, description: "test", checkCommand: "false" },
    ];
    const ssh = jest.fn(async (_cmd: string) => {
      if (_cmd.includes("false")) return { stdout: "", stderr: "command failed", code: 1 };
      return { stdout: "ok", stderr: "", code: 0 };
    });

    mockChunkConcurrent.mockImplementation(async (items: unknown[]) => {
      return (items as Array<{ id: string; checkCommand: string }>).map((item) => ({
        checkId: item.id,
        status: item.checkCommand.includes("false") ? "error" as const : "pass" as const,
      }));
    });

    const result = await executePluginChecks(checks, { ssh, manifest: {} });

    expect(result.results.find(r => r.checkId === "ok-1")?.status).toBe("pass");
    expect(result.results.find(r => r.checkId === "fail-1")?.status).toBe("error");
  });

  test("clearTimeout called on success (no leaked timer handle)", async () => {
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const checks = [{ id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", checkCommand: "echo" }];
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));

    mockChunkConcurrent.mockImplementation(async () => [
      { checkId: "c0", status: "pass" as const },
    ]);

    await executePluginChecks(checks, { ssh, manifest: {} });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  test("aggregate timeout — AbortController signal aborts after ceiling", async () => {
    jest.useFakeTimers();
    try {
      const checks = [
        { id: "slow-1", name: "slow", category: "test", severity: "info" as const, description: "test", checkCommand: "sleep 999" },
        { id: "slow-2", name: "slow", category: "test", severity: "info" as const, description: "test", checkCommand: "sleep 999" },
      ];
      // ssh is signal-aware: rejects when AbortController fires
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

      const promise = executePluginChecks(checks, { ssh: wrappedSsh, manifest: {} });
      // Yield so runCheck captures signal before timers fire
      await Promise.resolve();
      await Promise.resolve();

      // Fire all pending timers (LESSONS: use runAllTimersAsync, not advanceTimersByTime)
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(capturedSignals.length).toBeGreaterThan(0);
      expect(capturedSignals[0].aborted).toBe(true);
      // All checks should be marked as timeout once signal aborts
      expect(result.results.every(r => r.status === "timeout")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
