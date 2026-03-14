import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import * as sshUtils from "../../src/utils/ssh";
import {
  scheduleBackup,
  listBackupSchedule,
  removeBackupSchedule,
  buildDeployBackupScriptCommand,
  buildInstallCronCommand,
  buildListCronCommand,
  buildRemoveCronCommand,
  getSchedules,
  saveSchedule,
  removeSchedule,
} from "../../src/core/backupSchedule";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock("../../src/utils/ssh");

const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;

const VALID_IP = "1.2.3.4";
const SERVER_NAME = "my-server";
const CRON_EXPR = "0 3 * * *";

describe("buildDeployBackupScriptCommand", () => {
  it("contains shebang", () => {
    const cmd = buildDeployBackupScriptCommand();
    expect(cmd).toContain("#!/bin/bash");
  });

  it("contains flock -n 200 for overlap protection (BKUP-05)", () => {
    const cmd = buildDeployBackupScriptCommand();
    expect(cmd).toContain("flock -n 200");
  });

  it("contains exec 200 file descriptor lock setup", () => {
    const cmd = buildDeployBackupScriptCommand();
    expect(cmd).toContain("exec 200");
  });

  it("contains kastell-backup marker", () => {
    const cmd = buildDeployBackupScriptCommand();
    expect(cmd).toContain("kastell-backup");
  });

  it("contains docker/coolify runtime detection", () => {
    const cmd = buildDeployBackupScriptCommand();
    expect(cmd).toContain("docker");
    expect(cmd).toContain("coolify");
  });

  it("writes to /var/backups/kastell/ output path", () => {
    const cmd = buildDeployBackupScriptCommand();
    expect(cmd).toContain("/var/backups/kastell");
  });

  it("ends with chmod +x on the script", () => {
    const cmd = buildDeployBackupScriptCommand();
    expect(cmd).toContain("chmod +x /root/kastell-backup.sh");
  });

  it("uses KASTELL_EOF heredoc delimiter", () => {
    const cmd = buildDeployBackupScriptCommand();
    expect(cmd).toContain("KASTELL_EOF");
  });
});

describe("buildInstallCronCommand", () => {
  it("contains grep -v '# kastell-backup' to remove old entry (BKUP-04)", () => {
    const cmd = buildInstallCronCommand(CRON_EXPR);
    expect(cmd).toContain("grep -v '# kastell-backup'");
  });

  it("appends new entry with '# kastell-backup' marker", () => {
    const cmd = buildInstallCronCommand(CRON_EXPR);
    expect(cmd).toContain("# kastell-backup");
    expect(cmd).toContain("echo");
  });

  it("pipes to crontab -", () => {
    const cmd = buildInstallCronCommand(CRON_EXPR);
    expect(cmd).toContain("crontab -");
  });

  it("includes the cron expression in output", () => {
    const cmd = buildInstallCronCommand(CRON_EXPR);
    expect(cmd).toContain(CRON_EXPR);
  });

  it("uses crontab -l 2>/dev/null to handle empty crontab (Pitfall 2)", () => {
    const cmd = buildInstallCronCommand(CRON_EXPR);
    expect(cmd).toContain("crontab -l 2>/dev/null");
  });

  it("calls /root/kastell-backup.sh in the cron entry", () => {
    const cmd = buildInstallCronCommand(CRON_EXPR);
    expect(cmd).toContain("/root/kastell-backup.sh");
  });
});

describe("buildListCronCommand", () => {
  it("greps for '# kastell-backup' marker", () => {
    const cmd = buildListCronCommand();
    expect(cmd).toContain("grep '# kastell-backup'");
  });

  it("uses crontab -l 2>/dev/null", () => {
    const cmd = buildListCronCommand();
    expect(cmd).toContain("crontab -l 2>/dev/null");
  });
});

describe("buildRemoveCronCommand", () => {
  it("contains grep -v '# kastell-backup' to filter out entry", () => {
    const cmd = buildRemoveCronCommand();
    expect(cmd).toContain("grep -v '# kastell-backup'");
  });

  it("pipes filtered crontab back to crontab -", () => {
    const cmd = buildRemoveCronCommand();
    expect(cmd).toContain("crontab -");
  });

  it("uses crontab -l 2>/dev/null", () => {
    const cmd = buildRemoveCronCommand();
    expect(cmd).toContain("crontab -l 2>/dev/null");
  });
});

describe("getSchedules", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns empty object when schedules.json does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    const result = getSchedules();
    expect(result).toEqual({});
  });

  it("returns parsed schedules when file exists", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ "my-server": "0 3 * * *" }));
    const result = getSchedules();
    expect(result).toEqual({ "my-server": "0 3 * * *" });
  });

  it("returns empty object when file content is invalid JSON", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("not-valid-json");
    const result = getSchedules();
    expect(result).toEqual({});
  });
});

describe("saveSchedule", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("writes merged schedules to file", () => {
    mockedExistsSync.mockReturnValue(false);
    saveSchedule(SERVER_NAME, CRON_EXPR);
    expect(mockedWriteFileSync).toHaveBeenCalled();
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed[SERVER_NAME]).toBe(CRON_EXPR);
  });

  it("writes with mode 0o600 for security", () => {
    mockedExistsSync.mockReturnValue(false);
    saveSchedule(SERVER_NAME, CRON_EXPR);
    const [, , opts] = mockedWriteFileSync.mock.calls[0];
    expect((opts as any).mode).toBe(0o600);
  });

  it("merges with existing schedules", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ "other-server": "0 4 * * *" }));
    saveSchedule(SERVER_NAME, CRON_EXPR);
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed["other-server"]).toBe("0 4 * * *");
    expect(parsed[SERVER_NAME]).toBe(CRON_EXPR);
  });
});

describe("removeSchedule", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("removes the server entry from schedules.json", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ [SERVER_NAME]: CRON_EXPR, "other-server": "0 4 * * *" }),
    );
    removeSchedule(SERVER_NAME);
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed[SERVER_NAME]).toBeUndefined();
    expect(parsed["other-server"]).toBe("0 4 * * *");
  });

  it("writes after removing even if server not found", () => {
    mockedExistsSync.mockReturnValue(false);
    removeSchedule("nonexistent-server");
    expect(mockedWriteFileSync).toHaveBeenCalled();
  });
});

describe("scheduleBackup", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it("calls assertValidIp before any SSH call (BKUP-01)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await scheduleBackup(VALID_IP, SERVER_NAME, CRON_EXPR);

    expect(mockedSsh.assertValidIp).toHaveBeenCalledWith(VALID_IP);
  });

  it("calls sshExec twice: deploy script then install cron (BKUP-01)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await scheduleBackup(VALID_IP, SERVER_NAME, CRON_EXPR);

    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
    // First call: deploy script (contains KASTELL_EOF)
    expect(mockedSsh.sshExec.mock.calls[0][1]).toContain("KASTELL_EOF");
    // Second call: install cron (contains kastell-backup marker)
    expect(mockedSsh.sshExec.mock.calls[1][1]).toContain("kastell-backup");
  });

  it("saves schedule locally after SSH success (BKUP-01)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await scheduleBackup(VALID_IP, SERVER_NAME, CRON_EXPR);

    expect(mockedWriteFileSync).toHaveBeenCalled();
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed[SERVER_NAME]).toBe(CRON_EXPR);
  });

  it("returns { success: true } on success", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const result = await scheduleBackup(VALID_IP, SERVER_NAME, CRON_EXPR);

    expect(result.success).toBe(true);
  });

  it("returns { success: false, error } when deploy script sshExec fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "permission denied" });

    const result = await scheduleBackup(VALID_IP, SERVER_NAME, CRON_EXPR);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("does not call second sshExec when deploy script fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "fail" });

    await scheduleBackup(VALID_IP, SERVER_NAME, CRON_EXPR);

    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
  });

  it("returns { success: false, error } when cron install sshExec fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "cron error" });

    const result = await scheduleBackup(VALID_IP, SERVER_NAME, CRON_EXPR);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("does not save schedule locally when cron install fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "cron error" });

    await scheduleBackup(VALID_IP, SERVER_NAME, CRON_EXPR);

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("throws synchronously when assertValidIp throws (invalid IP)", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => {
      throw new Error("Invalid IP address format");
    });

    expect(() => scheduleBackup("invalid-ip", SERVER_NAME, CRON_EXPR)).toThrow("Invalid IP");
  });

  it("rejects empty cron expression", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);

    const result = await scheduleBackup(VALID_IP, SERVER_NAME, "");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects cron expression with fewer than 5 fields", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);

    const result = await scheduleBackup(VALID_IP, SERVER_NAME, "0 3 * *");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("listBackupSchedule", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it("calls assertValidIp before SSH", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: `${CRON_EXPR} /root/kastell-backup.sh # kastell-backup\n`,
      stderr: "",
    });

    await listBackupSchedule(VALID_IP, SERVER_NAME);

    expect(mockedSsh.assertValidIp).toHaveBeenCalledWith(VALID_IP);
  });

  it("calls sshExec with list command (BKUP-02)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: `${CRON_EXPR} /root/kastell-backup.sh # kastell-backup\n`,
      stderr: "",
    });

    await listBackupSchedule(VALID_IP, SERVER_NAME);

    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    expect(mockedSsh.sshExec.mock.calls[0][1]).toContain("kastell-backup");
  });

  it("returns { success: true, cronExpr } parsed from stdout", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: `${CRON_EXPR} /root/kastell-backup.sh # kastell-backup\n`,
      stderr: "",
    });

    const result = await listBackupSchedule(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
    expect(result.cronExpr).toBe(CRON_EXPR);
  });

  it("returns localCronExpr from schedules.json when available (BKUP-02)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ [SERVER_NAME]: "0 4 * * *" }));
    mockedSsh.sshExec.mockResolvedValueOnce({
      code: 0,
      stdout: `${CRON_EXPR} /root/kastell-backup.sh # kastell-backup\n`,
      stderr: "",
    });

    const result = await listBackupSchedule(VALID_IP, SERVER_NAME);

    expect(result.localCronExpr).toBe("0 4 * * *");
  });

  it("returns { success: false, error } when sshExec fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "ssh error" });

    const result = await listBackupSchedule(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns { success: true, cronExpr: undefined } when no schedule installed", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const result = await listBackupSchedule(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
    expect(result.cronExpr).toBeUndefined();
  });
});

describe("removeBackupSchedule", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it("calls assertValidIp before SSH (BKUP-03)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await removeBackupSchedule(VALID_IP, SERVER_NAME);

    expect(mockedSsh.assertValidIp).toHaveBeenCalledWith(VALID_IP);
  });

  it("calls sshExec with remove command (BKUP-03)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await removeBackupSchedule(VALID_IP, SERVER_NAME);

    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    expect(mockedSsh.sshExec.mock.calls[0][1]).toContain("grep -v '# kastell-backup'");
  });

  it("removes local schedule from schedules.json (BKUP-03)", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ [SERVER_NAME]: CRON_EXPR, "other-server": "0 4 * * *" }),
    );
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await removeBackupSchedule(VALID_IP, SERVER_NAME);

    expect(mockedWriteFileSync).toHaveBeenCalled();
    const [, content] = mockedWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed[SERVER_NAME]).toBeUndefined();
  });

  it("returns { success: true } on success", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const result = await removeBackupSchedule(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(true);
  });

  it("returns { success: false, error } when sshExec fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "cron error" });

    const result = await removeBackupSchedule(VALID_IP, SERVER_NAME);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("does not remove local schedule when sshExec fails", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "fail" });

    await removeBackupSchedule(VALID_IP, SERVER_NAME);

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});
