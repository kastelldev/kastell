import { describe, test, expect, afterEach, beforeEach } from "@jest/globals";
import { executePluginChecks } from "../../src/core/plugin/audit.js";

describe("executePluginChecks concurrency", () => {
  beforeEach(() => {
    const ssh = require("../../src/utils/ssh");
    jest.spyOn(ssh, "sshMasterOpen").mockResolvedValue(true);
    jest.spyOn(ssh, "sshMasterClose").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.PLUGIN_AUDIT_TIMEOUT_MS;
    jest.restoreAllMocks();
  });

  test("runs max 4 checks per host concurrently", async () => {
    let active = 0, peak = 0;
    const checks = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      name: `check${i}`,
      category: "test",
      severity: "info" as const,
      description: "test",
      checkCommand: "echo",
    }));
    jest.spyOn(require("../../src/utils/ssh"), "sshExec").mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 20));
      active--;
      return { stdout: "ok", stderr: "", code: 0 };
    });
    const result = await executePluginChecks(checks, "192.168.1.100");
    expect(peak).toBeLessThanOrEqual(4);
    expect(result).toHaveLength(10);
  });

  test("aggregate timeout aborts pending checks", async () => {
    process.env.PLUGIN_AUDIT_TIMEOUT_MS = "50";
    const checks = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      name: `check${i}`,
      category: "test",
      severity: "info" as const,
      description: "test",
      checkCommand: "sleep",
    }));
    jest.spyOn(require("../../src/utils/ssh"), "sshExec").mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 100));
      return { stdout: "", stderr: "", code: 0 };
    });
    const result = await executePluginChecks(checks, "192.168.1.100");
    expect(result.some((r: { status: string }) => r.status === "timeout")).toBe(true);
    delete process.env.PLUGIN_AUDIT_TIMEOUT_MS;
  });

  test("partial failure: settled results returned", async () => {
    const checks = [
      {
        id: "ok-1",
        name: "ok",
        category: "test",
        severity: "info" as const,
        description: "test",
        checkCommand: "echo",
      },
      {
        id: "fail-1",
        name: "fail",
        category: "test",
        severity: "info" as const,
        description: "test",
        checkCommand: "false",
      },
    ];
    jest.spyOn(require("../../src/utils/ssh"), "sshExec").mockImplementation(async (_h: unknown, _c: unknown) => {
      if ((_c as string).includes("false")) return { stdout: "", stderr: "command failed", code: 1 };
      return { stdout: "ok", stderr: "", code: 0 };
    });
    const result = await executePluginChecks(checks, "192.168.1.100");
    expect(result.find((r: { checkId: string }) => r.checkId === "ok-1")?.status).toBe("pass");
    expect(result.find((r: { checkId: string }) => r.checkId === "fail-1")?.status).toBe("error");
  });
});