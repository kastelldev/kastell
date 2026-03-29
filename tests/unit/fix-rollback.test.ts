import {
  backupFilesBeforeFix,
  rollbackFix,
  backupRemoteCleanup,
  REMOTE_BACKUP_BASE,
} from "../../src/core/audit/fix-history.js";
import { fixCommandsFromChecks } from "../../src/core/audit/fix.js";
import type { FixCheck } from "../../src/core/audit/fix.js";
import * as ssh from "../../src/utils/ssh.js";

jest.mock("../../src/utils/ssh.js");

const mockedSshExec = ssh.sshExec as jest.MockedFunction<typeof ssh.sshExec>;

type SshResult = { stdout: string; stderr: string; code: number };

function makeSshResult(overrides: Partial<SshResult> = {}): SshResult {
  return {
    stdout: "",
    stderr: "",
    code: 0,
    ...overrides,
  };
}

function makeFixCheck(overrides: Partial<FixCheck> = {}): FixCheck {
  return {
    id: "TEST-01",
    category: "Kernel",
    name: "Test Check",
    severity: "warning",
    fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1",
    ...overrides,
  };
}

describe("backupFilesBeforeFix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSshExec.mockResolvedValue(makeSshResult());
  });

  it("should create backup directory for the fixId", async () => {
    const fixId = "fix-2026-03-29-001";
    await backupFilesBeforeFix("1.2.3.4", fixId, []);

    const calls = mockedSshExec.mock.calls.map(([, cmd]) => String(cmd));
    expect(calls.some(c => c.includes(`${REMOTE_BACKUP_BASE}/${fixId}`) && c.includes("mkdir"))).toBe(true);
  });

  it("should mirror file structure for file-based fixes", async () => {
    const fixId = "fix-2026-03-29-001";
    const fixCommands = [
      { checkId: "SSH-01", fixCommand: "sed -i 's/yes/no/' /etc/ssh/sshd_config" },
    ];

    await backupFilesBeforeFix("1.2.3.4", fixId, fixCommands);

    const calls = mockedSshExec.mock.calls.map(([, cmd]) => String(cmd));
    // Should create mirror dir structure
    expect(calls.some(c => c.includes("mkdir") && c.includes("etc"))).toBe(true);
    // Should copy file with test -f guard
    expect(calls.some(c => c.includes("test -f") && c.includes("/etc/ssh/sshd_config"))).toBe(true);
  });

  it("should use test -f guard (skips non-existent files)", async () => {
    const fixCommands = [
      { checkId: "SSH-01", fixCommand: "chmod 600 /etc/ssh/sshd_config" },
    ];

    await backupFilesBeforeFix("1.2.3.4", "fix-2026-03-29-001", fixCommands);

    const calls = mockedSshExec.mock.calls.map(([, cmd]) => String(cmd));
    // test -f guard ensures non-existent files are skipped safely
    expect(calls.some(c => c.includes("test -f") && c.includes("|| true"))).toBe(true);
  });

  it("should capture sysctl current value in restore-commands.sh", async () => {
    const fixCommands = [
      { checkId: "KERN-01", fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1" },
    ];

    await backupFilesBeforeFix("1.2.3.4", "fix-2026-03-29-001", fixCommands);

    const calls = mockedSshExec.mock.calls.map(([, cmd]) => String(cmd));
    expect(calls.some(c => c.includes("restore-commands.sh") && c.includes("net.ipv4.tcp_syncookies"))).toBe(true);
  });

  it("should not create restore-commands.sh for file-based fixes", async () => {
    const fixCommands = [
      { checkId: "SSH-01", fixCommand: "sed -i 's/yes/no/' /etc/ssh/sshd_config" },
    ];

    await backupFilesBeforeFix("1.2.3.4", "fix-2026-03-29-001", fixCommands);

    const calls = mockedSshExec.mock.calls.map(([, cmd]) => String(cmd));
    // No restore-commands.sh for non-sysctl fixes
    const restoreCalls = calls.filter(c => c.includes("restore-commands.sh"));
    expect(restoreCalls).toHaveLength(0);
  });

  it("should return the backup directory path", async () => {
    const fixId = "fix-2026-03-29-001";
    const result = await backupFilesBeforeFix("1.2.3.4", fixId, []);
    expect(result).toBe(`${REMOTE_BACKUP_BASE}/${fixId}`);
  });

  it("should handle multiple fix commands", async () => {
    const fixCommands = [
      { checkId: "KERN-01", fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1" },
      { checkId: "KERN-02", fixCommand: "sysctl -w net.ipv6.conf.all.disable_ipv6=1" },
      { checkId: "SSH-01", fixCommand: "chmod 600 /etc/ssh/sshd_config" },
    ];

    await backupFilesBeforeFix("1.2.3.4", "fix-2026-03-29-001", fixCommands);

    const calls = mockedSshExec.mock.calls.map(([, cmd]) => String(cmd));
    // Both sysctl params captured
    expect(calls.some(c => c.includes("net.ipv4.tcp_syncookies"))).toBe(true);
    expect(calls.some(c => c.includes("net.ipv6.conf.all.disable_ipv6"))).toBe(true);
    // File backup
    expect(calls.some(c => c.includes("/etc/ssh/sshd_config"))).toBe(true);
  });
});

describe("rollbackFix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return error when backup directory does not exist", async () => {
    mockedSshExec.mockResolvedValue(makeSshResult({ stdout: "" })); // no "exists"

    const result = await rollbackFix("1.2.3.4", "/root/.kastell/fix-backups/fix-2026-03-29-001");

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Backup directory not found");
    expect(result.restored).toHaveLength(0);
  });

  it("should run restore-commands.sh when it exists", async () => {
    mockedSshExec
      .mockResolvedValueOnce(makeSshResult({ stdout: "exists" }))  // test -d backupPath
      .mockResolvedValueOnce(makeSshResult({ stdout: "exists" }))  // test -f restore-commands.sh
      .mockResolvedValueOnce(makeSshResult({ stdout: "", code: 0 })) // bash restore-commands.sh
      .mockResolvedValueOnce(makeSshResult({ stdout: "" }));         // find files (empty)

    const result = await rollbackFix("1.2.3.4", "/root/.kastell/fix-backups/fix-2026-03-29-001");

    expect(result.restored).toContain("restore-commands.sh");
    expect(result.errors).toHaveLength(0);
  });

  it("should record error if restore-commands.sh fails", async () => {
    mockedSshExec
      .mockResolvedValueOnce(makeSshResult({ stdout: "exists" }))   // test -d backupPath
      .mockResolvedValueOnce(makeSshResult({ stdout: "exists" }))   // test -f restore-commands.sh
      .mockResolvedValueOnce(makeSshResult({ stdout: "", code: 1 })) // bash restore-commands.sh FAILS
      .mockResolvedValueOnce(makeSshResult({ stdout: "" }));         // find files (empty)

    const result = await rollbackFix("1.2.3.4", "/root/.kastell/fix-backups/fix-2026-03-29-001");

    expect(result.errors.some(e => e.includes("restore-commands.sh failed"))).toBe(true);
    expect(result.restored).toHaveLength(0);
  });

  it("should restore backed-up files to original paths", async () => {
    mockedSshExec
      .mockResolvedValueOnce(makeSshResult({ stdout: "exists" }))          // test -d backupPath
      .mockResolvedValueOnce(makeSshResult({ stdout: "" }))                 // no restore-commands.sh
      .mockResolvedValueOnce(makeSshResult({ stdout: "etc/ssh/sshd_config\n" })) // find files
      .mockResolvedValueOnce(makeSshResult({ stdout: "", code: 0 }));       // cp sshd_config

    const backupPath = "/root/.kastell/fix-backups/fix-2026-03-29-001";
    const result = await rollbackFix("1.2.3.4", backupPath);

    expect(result.restored).toContain("/etc/ssh/sshd_config");
    expect(result.errors).toHaveLength(0);
  });

  it("should record error for files that fail to restore", async () => {
    mockedSshExec
      .mockResolvedValueOnce(makeSshResult({ stdout: "exists" }))          // test -d
      .mockResolvedValueOnce(makeSshResult({ stdout: "" }))                 // no restore script
      .mockResolvedValueOnce(makeSshResult({ stdout: "etc/ssh/sshd_config\n" })) // find files
      .mockResolvedValueOnce(makeSshResult({ stdout: "", code: 1 }));       // cp FAILS

    const result = await rollbackFix("1.2.3.4", "/root/.kastell/fix-backups/fix-2026-03-29-001");

    expect(result.restored).toHaveLength(0);
    expect(result.errors.some(e => e.includes("batch restore failed"))).toBe(true);
  });
});

describe("backupRemoteCleanup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSshExec.mockResolvedValue(makeSshResult());
  });

  it("should run cleanup command on remote server", async () => {
    await backupRemoteCleanup("1.2.3.4");

    expect(mockedSshExec).toHaveBeenCalledTimes(1);
    const [ip, cmd] = mockedSshExec.mock.calls[0];
    expect(ip).toBe("1.2.3.4");
    const cmdStr = String(cmd);
    expect(cmdStr).toContain(REMOTE_BACKUP_BASE);
    expect(cmdStr).toContain("rm -rf");
  });

  it("should keep last 20 backup directories", async () => {
    await backupRemoteCleanup("1.2.3.4");

    const cmdStr = String(mockedSshExec.mock.calls[0][1]);
    expect(cmdStr).toContain("head -n -20");
  });
});

describe("fixCommandsFromChecks", () => {
  it("should extract checkId and fixCommand from check array", () => {
    const checks: FixCheck[] = [
      makeFixCheck({ id: "KERN-01", fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1" }),
      makeFixCheck({ id: "KERN-02", fixCommand: "sysctl -w net.ipv4.conf.all.rp_filter=1" }),
      makeFixCheck({ id: "LOG-01", fixCommand: "chmod 640 /etc/rsyslog.conf" }),
    ];

    const result = fixCommandsFromChecks(checks);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ checkId: "KERN-01", fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1" });
    expect(result[1]).toEqual({ checkId: "KERN-02", fixCommand: "sysctl -w net.ipv4.conf.all.rp_filter=1" });
    expect(result[2]).toEqual({ checkId: "LOG-01", fixCommand: "chmod 640 /etc/rsyslog.conf" });
  });

  it("should return empty array for empty checks", () => {
    const result = fixCommandsFromChecks([]);
    expect(result).toEqual([]);
  });

  it("should handle single check", () => {
    const checks: FixCheck[] = [
      makeFixCheck({ id: "SSH-01", fixCommand: "chmod 600 /etc/ssh/sshd_config" }),
    ];

    const result = fixCommandsFromChecks(checks);
    expect(result).toHaveLength(1);
    expect(result[0].checkId).toBe("SSH-01");
  });
});
