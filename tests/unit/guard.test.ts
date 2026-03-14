import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import * as sshUtils from "../../src/utils/ssh";
import * as notifyModule from "../../src/core/notify";
import {
  startGuard,
  stopGuard,
  guardStatus,
  dispatchGuardBreaches,
  buildDeployGuardScriptCommand,
  buildInstallGuardCronCommand,
  buildRemoveGuardCronCommand,
  buildGuardStatusCommand,
  getGuardStates,
  saveGuardState,
  removeGuardState,
  GUARD_MARKER,
  GUARD_CRON_EXPR,
  GUARD_SCRIPT_PATH,
  GUARD_LOG_PATH,
  GUARD_METRICS_PATH,
} from "../../src/core/guard";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/notify");

const mockedNotify = notifyModule as jest.Mocked<typeof notifyModule>;
let mockedDispatchWithCooldown: jest.Mock;

const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;

const VALID_IP = "1.2.3.4";
const SERVER_NAME = "my-server";

beforeEach(() => {
  mockedDispatchWithCooldown = mockedNotify.dispatchWithCooldown as jest.Mock;
  mockedDispatchWithCooldown.mockResolvedValue({ skipped: false, results: [] });
});

// ─── constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it('GUARD_MARKER is "# kastell-guard"', () => {
    expect(GUARD_MARKER).toBe("# kastell-guard");
  });

  it('GUARD_CRON_EXPR is "*/5 * * * *"', () => {
    expect(GUARD_CRON_EXPR).toBe("*/5 * * * *");
  });

  it('GUARD_SCRIPT_PATH is "/root/kastell-guard.sh"', () => {
    expect(GUARD_SCRIPT_PATH).toBe("/root/kastell-guard.sh");
  });

  it('GUARD_LOG_PATH is "/var/log/kastell-guard.log"', () => {
    expect(GUARD_LOG_PATH).toBe("/var/log/kastell-guard.log");
  });

  it('GUARD_METRICS_PATH is "/var/lib/kastell/metrics.json"', () => {
    expect(GUARD_METRICS_PATH).toBe("/var/lib/kastell/metrics.json");
  });
});

// ─── buildDeployGuardScriptCommand ────────────────────────────────────────────

describe("buildDeployGuardScriptCommand", () => {
  it("contains shebang", () => {
    expect(buildDeployGuardScriptCommand()).toContain("#!/bin/bash");
  });

  it("contains flock -n for overlap protection (GUARD-02)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("flock -n");
  });

  it("contains exec fd lock setup", () => {
    expect(buildDeployGuardScriptCommand()).toContain("exec 200");
  });

  it("contains df for disk check (GUARD-03)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("df");
  });

  it("contains free for RAM check (GUARD-03)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("free");
  });

  it("contains /proc/loadavg for CPU check (GUARD-03)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("/proc/loadavg");
  });

  it("contains nproc for CPU core count (GUARD-03)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("nproc");
  });

  it("contains disk threshold 80 (GUARD-03)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("80");
  });

  it("contains RAM threshold 90 (GUARD-03)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("90");
  });

  it("contains sshd -T for audit proxy check (GUARD-04)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("sshd -T");
  });

  it("contains GUARD_LOG_PATH (GUARD-08)", () => {
    expect(buildDeployGuardScriptCommand()).toContain(GUARD_LOG_PATH);
  });

  it("contains GUARD_METRICS_PATH (GUARD-09)", () => {
    expect(buildDeployGuardScriptCommand()).toContain(GUARD_METRICS_PATH);
  });

  it("contains notify() stub (GUARD-10)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("notify()");
  });

  it("contains KASTELL_NOTIFY_HOOK sentinel comment (GUARD-10)", () => {
    expect(buildDeployGuardScriptCommand()).toContain("KASTELL_NOTIFY_HOOK");
  });

  it("contains mkdir -p for metrics directory", () => {
    expect(buildDeployGuardScriptCommand()).toContain("mkdir -p");
  });

  it("contains chmod +x on the script", () => {
    expect(buildDeployGuardScriptCommand()).toContain("chmod +x");
  });

  it("uses KASTELL_EOF heredoc delimiter", () => {
    expect(buildDeployGuardScriptCommand()).toContain("KASTELL_EOF");
  });
});

// ─── buildInstallGuardCronCommand ─────────────────────────────────────────────

describe("buildInstallGuardCronCommand", () => {
  it("contains grep -v GUARD_MARKER to remove old entry (GUARD-07)", () => {
    expect(buildInstallGuardCronCommand()).toContain(`grep -v '${GUARD_MARKER}'`);
  });

  it("contains GUARD_CRON_EXPR (GUARD-02)", () => {
    expect(buildInstallGuardCronCommand()).toContain(GUARD_CRON_EXPR);
  });

  it("contains GUARD_SCRIPT_PATH (GUARD-02)", () => {
    expect(buildInstallGuardCronCommand()).toContain(GUARD_SCRIPT_PATH);
  });

  it("pipes to crontab -", () => {
    expect(buildInstallGuardCronCommand()).toContain("crontab -");
  });

  it("uses crontab -l 2>/dev/null to handle empty crontab", () => {
    expect(buildInstallGuardCronCommand()).toContain("crontab -l 2>/dev/null");
  });
});

// ─── buildRemoveGuardCronCommand ──────────────────────────────────────────────

describe("buildRemoveGuardCronCommand", () => {
  it("contains grep -v GUARD_MARKER to filter out entry (GUARD-05)", () => {
    expect(buildRemoveGuardCronCommand()).toContain(`grep -v '${GUARD_MARKER}'`);
  });

  it("pipes filtered crontab back to crontab -", () => {
    expect(buildRemoveGuardCronCommand()).toContain("crontab -");
  });

  it("uses crontab -l 2>/dev/null", () => {
    expect(buildRemoveGuardCronCommand()).toContain("crontab -l 2>/dev/null");
  });
});

// ─── buildGuardStatusCommand ──────────────────────────────────────────────────

describe("buildGuardStatusCommand", () => {
  it("contains GUARD_MARKER to check cron state (GUARD-06)", () => {
    expect(buildGuardStatusCommand()).toContain(GUARD_MARKER);
  });

  it("contains tail for log reading (GUARD-06)", () => {
    expect(buildGuardStatusCommand()).toContain("tail");
  });

  it("contains GUARD_LOG_PATH", () => {
    expect(buildGuardStatusCommand()).toContain(GUARD_LOG_PATH);
  });
});

// ─── getGuardStates / saveGuardState / removeGuardState ───────────────────────

describe("getGuardStates", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns empty object when guard-state.json does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    const result = getGuardStates();
    expect(result).toEqual({});
  });

  it("returns parsed states when file exists", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ "my-server": { installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" } }),
    );
    const result = getGuardStates();
    expect(result["my-server"]).toEqual({ installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" });
  });

  it("returns empty object when file content is invalid JSON", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("not-valid-json");
    const result = getGuardStates();
    expect(result).toEqual({});
  });
});

describe("saveGuardState", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("writes guard state to file with mkdirSync", () => {
    mockedExistsSync.mockReturnValue(false);
    saveGuardState(SERVER_NAME, { installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" });
    expect(mockedWriteFileSync).toHaveBeenCalled();
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed[SERVER_NAME]).toEqual({ installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" });
  });

  it("writes with mode 0o600 for security", () => {
    mockedExistsSync.mockReturnValue(false);
    saveGuardState(SERVER_NAME, { installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" });
    const [, , opts] = mockedWriteFileSync.mock.calls[0];
    expect((opts as { mode: number }).mode).toBe(0o600);
  });

  it("merges with existing guard states", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ "other-server": { installedAt: "2026-01-02T00:00:00Z", cronExpr: "*/5 * * * *" } }),
    );
    saveGuardState(SERVER_NAME, { installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" });
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed["other-server"]).toBeDefined();
    expect(parsed[SERVER_NAME]).toBeDefined();
  });
});

describe("removeGuardState", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("removes server entry from guard-state.json", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        [SERVER_NAME]: { installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" },
        "other-server": { installedAt: "2026-01-02T00:00:00Z", cronExpr: "*/5 * * * *" },
      }),
    );
    removeGuardState(SERVER_NAME);
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed[SERVER_NAME]).toBeUndefined();
    expect(parsed["other-server"]).toBeDefined();
  });

  it("writes after removing even if server not found", () => {
    mockedExistsSync.mockReturnValue(false);
    removeGuardState("nonexistent-server");
    expect(mockedWriteFileSync).toHaveBeenCalled();
  });
});

// ─── startGuard ───────────────────────────────────────────────────────────────

describe("startGuard", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it("calls assertValidIp before any SSH call (GUARD-01)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await startGuard(VALID_IP, SERVER_NAME);

    expect(mockedSsh.assertValidIp).toHaveBeenCalledWith(VALID_IP);
  });

  it("calls sshExec twice: deploy script then install cron (GUARD-01)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await startGuard(VALID_IP, SERVER_NAME);

    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
    // First call: deploy script (contains KASTELL_EOF)
    expect(mockedSsh.sshExec.mock.calls[0][1]).toContain("KASTELL_EOF");
    // Second call: install cron (contains kastell-guard marker)
    expect(mockedSsh.sshExec.mock.calls[1][1]).toContain("kastell-guard");
  });

  it("saves local state after SSH success (GUARD-01)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await startGuard(VALID_IP, SERVER_NAME);

    expect(mockedWriteFileSync).toHaveBeenCalled();
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed[SERVER_NAME]).toBeDefined();
    expect(parsed[SERVER_NAME].cronExpr).toBe(GUARD_CRON_EXPR);
  });

  it("returns { success: true } on success", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const result = await startGuard(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
  });

  it("returns { success: false, error } when deploy SSH fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "permission denied" });

    const result = await startGuard(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("does not call second sshExec when deploy fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "fail" });

    await startGuard(VALID_IP, SERVER_NAME);

    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
  });

  it("returns { success: false, error } when cron install SSH fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "cron error" });

    const result = await startGuard(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("does not save state when cron install fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "cron error" });

    await startGuard(VALID_IP, SERVER_NAME);

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("rejects when assertValidIp throws (invalid IP)", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => {
      throw new Error("Invalid IP address format");
    });

    await expect(startGuard("invalid-ip", SERVER_NAME)).rejects.toThrow("Invalid IP");
  });
});

// ─── stopGuard ────────────────────────────────────────────────────────────────

describe("stopGuard", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it("calls assertValidIp before SSH (GUARD-05)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await stopGuard(VALID_IP, SERVER_NAME);

    expect(mockedSsh.assertValidIp).toHaveBeenCalledWith(VALID_IP);
  });

  it("calls sshExec with remove cron command (GUARD-05)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await stopGuard(VALID_IP, SERVER_NAME);

    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    expect(mockedSsh.sshExec.mock.calls[0][1]).toContain(`grep -v '${GUARD_MARKER}'`);
  });

  it("removes local state on success (GUARD-05)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ [SERVER_NAME]: { installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" } }),
    );
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await stopGuard(VALID_IP, SERVER_NAME);

    expect(mockedWriteFileSync).toHaveBeenCalled();
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed[SERVER_NAME]).toBeUndefined();
  });

  it("returns { success: true } on success", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const result = await stopGuard(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
  });

  it("returns { success: false, error } when SSH fails (GUARD-05)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "ssh error" });

    const result = await stopGuard(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("does not remove local state when SSH fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "fail" });

    await stopGuard(VALID_IP, SERVER_NAME);

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});

// ─── guardStatus ──────────────────────────────────────────────────────────────

describe("guardStatus", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it("calls assertValidIp before SSH (GUARD-06)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "CRON_ACTIVE\n[kastell-guard] 2026-01-01T00:00:00Z OK: Guard run complete\n",
      stderr: "",
    });

    await guardStatus(VALID_IP, SERVER_NAME);

    expect(mockedSsh.assertValidIp).toHaveBeenCalledWith(VALID_IP);
  });

  it("calls sshExec with status command (GUARD-06)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "CRON_ACTIVE\n[kastell-guard] 2026-01-01T00:00:00Z OK: Guard run complete\n",
      stderr: "",
    });

    await guardStatus(VALID_IP, SERVER_NAME);

    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    expect(mockedSsh.sshExec.mock.calls[0][1]).toContain(GUARD_MARKER);
  });

  it("returns isActive: true when CRON_ACTIVE in output (GUARD-06)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "CRON_ACTIVE\n[kastell-guard] 2026-01-01T00:00:00Z OK: Guard run complete\n",
      stderr: "",
    });

    const result = await guardStatus(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
    expect(result.isActive).toBe(true);
  });

  it("returns isActive: false when CRON_INACTIVE in output (GUARD-06)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "CRON_INACTIVE\nLOG_EMPTY\n",
      stderr: "",
    });

    const result = await guardStatus(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
    expect(result.isActive).toBe(false);
  });

  it("returns breaches parsed from BREACH log lines (GUARD-06)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: [
        "CRON_ACTIVE",
        "[kastell-guard] 2026-01-01T00:00:00Z BREACH: Disk usage 85% exceeds 80% threshold",
        "[kastell-guard] 2026-01-01T00:00:05Z OK: RAM 40%",
        "[kastell-guard] 2026-01-01T00:00:10Z BREACH: CPU load avg 8 >= 4 (nproc)",
      ].join("\n"),
      stderr: "",
    });

    const result = await guardStatus(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
    expect(result.breaches).toHaveLength(2);
    expect(result.breaches[0]).toContain("Disk usage 85%");
    expect(result.breaches[1]).toContain("CPU load avg 8");
  });

  it("returns empty breaches when no BREACH lines", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "CRON_ACTIVE\n[kastell-guard] 2026-01-01T00:00:00Z OK: Guard run complete\n",
      stderr: "",
    });

    const result = await guardStatus(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
    expect(result.breaches).toEqual([]);
  });

  it("returns lastRunAt parsed from most recent kastell-guard log line", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: [
        "CRON_ACTIVE",
        "[kastell-guard] 2026-01-01T00:00:00Z OK: Disk 50%",
        "[kastell-guard] 2026-01-01T00:05:00Z OK: Guard run complete",
      ].join("\n"),
      stderr: "",
    });

    const result = await guardStatus(VALID_IP, SERVER_NAME);

    expect(result.lastRunAt).toBe("2026-01-01T00:05:00Z");
  });

  it("returns { success: false } when SSH fails (GUARD-06)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "ssh error" });

    const result = await guardStatus(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns logTail in result", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    const logLine = "[kastell-guard] 2026-01-01T00:00:00Z OK: Guard run complete";
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: `CRON_ACTIVE\n${logLine}\n`,
      stderr: "",
    });

    const result = await guardStatus(VALID_IP, SERVER_NAME);

    expect(result.logTail).toContain(logLine);
  });
});

// ─── dispatchGuardBreaches (tests categorizeBreach indirectly) ────────────────

describe("dispatchGuardBreaches", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedDispatchWithCooldown = mockedNotify.dispatchWithCooldown as jest.Mock;
    mockedDispatchWithCooldown.mockResolvedValue({ skipped: false, results: [] });
  });

  it("calls dispatchWithCooldown zero times when breaches is empty", async () => {
    await dispatchGuardBreaches("prod-1", []);
    expect(mockedDispatchWithCooldown).not.toHaveBeenCalled();
  });

  it("categorizes disk breach and calls dispatchWithCooldown with findingType disk", async () => {
    await dispatchGuardBreaches("prod-1", ["Disk usage 85% exceeds 80% threshold"]);
    expect(mockedDispatchWithCooldown).toHaveBeenCalledTimes(1);
    expect(mockedDispatchWithCooldown).toHaveBeenCalledWith(
      "prod-1",
      "disk",
      expect.stringContaining("prod-1"),
    );
  });

  it("categorizes RAM breach and calls dispatchWithCooldown with findingType ram", async () => {
    await dispatchGuardBreaches("prod-1", ["RAM usage 92% exceeds 90% threshold"]);
    expect(mockedDispatchWithCooldown).toHaveBeenCalledWith(
      "prod-1",
      "ram",
      expect.stringContaining("prod-1"),
    );
  });

  it("categorizes CPU breach and calls dispatchWithCooldown with findingType cpu", async () => {
    await dispatchGuardBreaches("prod-1", ["CPU load avg 4 >= 2 (nproc)"]);
    expect(mockedDispatchWithCooldown).toHaveBeenCalledWith(
      "prod-1",
      "cpu",
      expect.stringContaining("prod-1"),
    );
  });

  it("categorizes audit regression breach and calls dispatchWithCooldown with findingType regression", async () => {
    await dispatchGuardBreaches("prod-1", [
      "Audit score regression detected (passwordauth may have changed)",
    ]);
    expect(mockedDispatchWithCooldown).toHaveBeenCalledWith(
      "prod-1",
      "regression",
      expect.stringContaining("prod-1"),
    );
  });

  it("categorizes unknown breach as 'unknown'", async () => {
    await dispatchGuardBreaches("prod-1", ["some unknown breach message"]);
    expect(mockedDispatchWithCooldown).toHaveBeenCalledWith(
      "prod-1",
      "unknown",
      expect.stringContaining("prod-1"),
    );
  });

  it("calls dispatchWithCooldown once per breach with correct serverName and message", async () => {
    const breaches = ["Disk usage 85% exceeds 80% threshold", "RAM usage 92% exceeds 90% threshold"];
    await dispatchGuardBreaches("prod-1", breaches);
    expect(mockedDispatchWithCooldown).toHaveBeenCalledTimes(2);
    expect(mockedDispatchWithCooldown.mock.calls[0][0]).toBe("prod-1");
    expect(mockedDispatchWithCooldown.mock.calls[0][2]).toContain("Disk usage 85%");
    expect(mockedDispatchWithCooldown.mock.calls[1][0]).toBe("prod-1");
    expect(mockedDispatchWithCooldown.mock.calls[1][2]).toContain("RAM usage 92%");
  });

  it("message contains serverName and breach text", async () => {
    const breach = "Disk usage 85% exceeds 80% threshold";
    await dispatchGuardBreaches("my-server", [breach]);
    const message: string = mockedDispatchWithCooldown.mock.calls[0][2];
    expect(message).toContain("my-server");
    expect(message).toContain(breach);
  });
});
