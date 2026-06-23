import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { executePluginChecks } from "../../src/core/plugin/audit.js";
import type { CheckResult } from "../../src/core/plugin/audit.js";
import type { PluginSeverity } from "../../src/plugin/sdk/types.js";

describe("executePluginChecks parallel", () => {
  afterEach(() => {
    delete process.env.PLUGIN_AUDIT_PARALLELISM;
    jest.resetAllMocks();
  });

  // P144 T5: executePluginChecks now consumes registry-normalized read
  // checks (PluginReadCheck). Fixture shape uses `read.cmd` instead of
  // legacy `checkCommand.cmd`. Kind branching removed — all reads run at
  // the default (or env-overridden) parallelism.

  function makeCheck(i: number) {
    return {
      id: `c${i}`,
      read: { cmd: `cmd${i}` },
      name: `c${i}`,
      severity: "warning" as PluginSeverity,
      fixCommand: "",
      category: "test",
      description: "test",
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

    const result = await executePluginChecks(checks as never, { ssh });

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

    const result = await executePluginChecks(checks as never, { ssh });

    expect(result.results.filter((r: CheckResult) => r.status === "pass")).toHaveLength(2);
    expect(result.results.filter((r: CheckResult) => r.status === "error")).toHaveLength(1);
  });

  it("default parallelism (no mutating-kind branching)", async () => {
    // P144 T5: kind branching removed — concurrency comes from
    // PLUGIN_AUDIT_PARALLELISM (default 3) regardless of check shape.
    let active = 0, peak = 0;
    const ssh = jest.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 20));
      active--;
      return { stdout: "ok", stderr: "", code: 0 };
    });

    const checks = [makeCheck(0), makeCheck(1), makeCheck(2), makeCheck(3), makeCheck(4)];

    await executePluginChecks(checks as never, { ssh });

    expect(peak).toBeLessThanOrEqual(3);
  });
});