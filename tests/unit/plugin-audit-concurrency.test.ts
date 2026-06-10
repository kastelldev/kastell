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

  test("read checks use default cap", async () => {
    let capturedConcurrency = 0;
    const checks = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      name: `check${i}`,
      category: "test",
      severity: "info" as const,
      description: "test",
      checkCommand: { kind: "read" as const, cmd: "echo" },
    }));
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));

    mockChunkConcurrent.mockImplementation(async (items: unknown[], concurrency: number) => {
      capturedConcurrency = concurrency;
      return items.map(() => ({ checkId: "x", status: "pass" as const }));
    });

    const result = await executePluginChecks(checks, { ssh });

    expect(capturedConcurrency).toBe(3);
    expect(result.results).toHaveLength(6);
  });

  test("mutate-local check forces cap=1", async () => {
    const checks = [
      { id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", checkCommand: { kind: "mutate-local" as const, cmd: "systemctl restart nginx" } },
    ];
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));
    mockChunkConcurrent.mockImplementation(async () => []);

    await executePluginChecks(checks, { ssh });

    expect(mockChunkConcurrent).toHaveBeenCalledWith(expect.any(Array), 1, expect.any(Function));
  });

  test("mutate-global check forces cap=1", async () => {
    const checks = [
      { id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", checkCommand: { kind: "mutate-global" as const, cmd: "hcloud firewall apply-to-resource" } },
    ];
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));
    mockChunkConcurrent.mockImplementation(async () => []);

    await executePluginChecks(checks, { ssh });

    expect(mockChunkConcurrent).toHaveBeenCalledWith(expect.any(Array), 1, expect.any(Function));
  });

  test("passes checkCommand.cmd to ssh", async () => {
    const checks = [
      { id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", checkCommand: { kind: "read" as const, cmd: "echo exact" } },
    ];
    const ssh: jest.Mock = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));
    mockChunkConcurrent.mockImplementation(async (items: unknown[], _concurrency: number, worker: (item: unknown) => Promise<unknown>) =>
      Promise.all(items.map(worker)),
    );

    await executePluginChecks(checks, { ssh });

    expect(ssh).toHaveBeenCalledWith("echo exact", expect.objectContaining({ timeoutMs: 15000 }));
  });

  test("partial failure — error results returned with error status", async () => {
    const checks = [
      { id: "ok-1", name: "ok", category: "test", severity: "info" as const, description: "test", checkCommand: { kind: "read" as const, cmd: "echo" } },
      { id: "fail-1", name: "fail", category: "test", severity: "info" as const, description: "test", checkCommand: { kind: "read" as const, cmd: "false" } },
    ];
    const ssh = jest.fn(async (_cmd: string) => {
      if (_cmd.includes("false")) return { stdout: "", stderr: "command failed", code: 1 };
      return { stdout: "ok", stderr: "", code: 0 };
    });

    mockChunkConcurrent.mockImplementation(async (items: unknown[]) => {
      return (items as Array<{ id: string; checkCommand: { cmd: string } }>).map((item) => ({
        checkId: item.id,
        status: item.checkCommand.cmd.includes("false") ? "error" as const : "pass" as const,
      }));
    });

    const result = await executePluginChecks(checks, { ssh });

    expect(result.results.find(r => r.checkId === "ok-1")?.status).toBe("pass");
    expect(result.results.find(r => r.checkId === "fail-1")?.status).toBe("error");
  });

  test("clearTimeout called on success (no leaked timer handle)", async () => {
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
    const checks = [{ id: "c0", name: "check0", category: "test", severity: "info" as const, description: "test", checkCommand: { kind: "read" as const, cmd: "echo" } }];
    const ssh = jest.fn(async () => ({ stdout: "ok", stderr: "", code: 0 }));

    mockChunkConcurrent.mockImplementation(async () => [
      { checkId: "c0", status: "pass" as const },
    ]);

    await executePluginChecks(checks, { ssh });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  test("aggregate timeout — AbortController signal aborts after ceiling", async () => {
    jest.useFakeTimers();
    try {
      const checks = [
        { id: "slow-1", name: "slow", category: "test", severity: "info" as const, description: "test", checkCommand: { kind: "read" as const, cmd: "sleep 999" } },
        { id: "slow-2", name: "slow", category: "test", severity: "info" as const, description: "test", checkCommand: { kind: "read" as const, cmd: "sleep 999" } },
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

      const promise = executePluginChecks(checks, { ssh: wrappedSsh });
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
