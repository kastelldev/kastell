import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { executePluginChecks } from "../../src/core/plugin/audit.js";
import type { CheckResult } from "../../src/core/plugin/audit.js";
import type { PluginSeverity } from "../../src/plugin/sdk/types.js";

describe("executePluginChecks parallel", () => {
  afterEach(() => {
    delete process.env.PLUGIN_AUDIT_PARALLELISM;
    jest.restoreAllMocks();
  });

  function makeCheck(i: number) {
    return {
      id: `c${i}`, checkCommand: `cmd${i}`, name: `c${i}`, severity: "warning" as PluginSeverity,
      fixCommand: "", category: "test", description: "test",
    };
  }

  it("runs checks with concurrency cap (default 3)", async () => {
    let active = 0, peak = 0;
    const ssh = jest.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 20));
      active--;
      return { stdout: "ok", stderr: "", code: 0 };
    });

    const checks = Array.from({ length: 10 }, (_, i) => makeCheck(i));

    const result = await executePluginChecks(checks, { ssh, manifest: { name: "test", version: "1.0.0" } });

    expect(peak).toBeLessThanOrEqual(3);
    expect(ssh).toHaveBeenCalledTimes(10);
    expect(result.results).toHaveLength(10);
    expect(result.completed).toBe(10);
  });

  it("partial failure — one check errors, others still complete", async () => {
    const ssh = jest.fn<() => Promise<{ stdout: string; stderr: string; code: number }>>()
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", code: 0 })
      .mockRejectedValueOnce(new Error("ssh dead"))
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", code: 0 });

    const checks = [makeCheck(0), makeCheck(1), makeCheck(2)];

    const result = await executePluginChecks(checks, { ssh, manifest: { name: "test", version: "1.0.0" } });

    expect(result.results.filter((r: CheckResult) => r.status === "pass")).toHaveLength(2);
    expect(result.results.filter((r: CheckResult) => r.status === "error")).toHaveLength(1);
  });

  it("safeToParallel: false → sequential (cap=1)", async () => {
    let active = 0, peak = 0;
    const ssh = jest.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 20));
      active--;
      return { stdout: "ok", stderr: "", code: 0 };
    });

    const checks = Array.from({ length: 5 }, (_, i) => makeCheck(i));

    await executePluginChecks(checks, { ssh, manifest: { name: "test", version: "1.0.0", safeToParallel: false } });

    expect(peak).toBe(1); // sequential
  });
});