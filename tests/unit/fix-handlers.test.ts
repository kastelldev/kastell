/**
 * Unit tests for programmatic fix handler module.
 * Covers: matchHandler, resolveHandlerChain, executeHandlerChain,
 * and all 4 handler types (sysctl, file-append, package-install, chmod/chown).
 */

jest.mock("../../src/utils/ssh.js");

import { sshExec } from "../../src/utils/ssh.js";
import {
  matchHandler,
  resolveHandlerChain,
  executeHandlerChain,
} from "../../src/core/audit/handlers/index.js";
import { sysctlHandler } from "../../src/core/audit/handlers/sysctl.js";
import { fileAppendHandler } from "../../src/core/audit/handlers/fileAppend.js";
import { packageInstallHandler } from "../../src/core/audit/handlers/packageInstall.js";
import { chmodChownHandler } from "../../src/core/audit/handlers/chmodChown.js";

const mockedSshExec = sshExec as jest.MockedFunction<typeof sshExec>;

const MOCK_IP = "1.2.3.4";

// ─── matchHandler ─────────────────────────────────────────────────────────────

describe("matchHandler", () => {
  it("returns sysctl handler for sysctl -w command", () => {
    const result = matchHandler("sysctl -w kernel.randomize_va_space=2");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({
      type: "sysctl",
      key: "kernel.randomize_va_space",
      value: "2",
    });
    expect(result!.handler).toBe(sysctlHandler);
  });

  it("returns file-append handler for echo with single quotes and >>", () => {
    const result = matchHandler("echo 'Defaults log_output' >> /etc/sudoers.d/kastell-logging");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({
      type: "file-append",
      line: "Defaults log_output",
      path: "/etc/sudoers.d/kastell-logging",
    });
    expect(result!.handler).toBe(fileAppendHandler);
  });

  it("returns file-append handler for echo with double quotes and >>", () => {
    const result = matchHandler('echo "kernel.randomize_va_space=2" >> /etc/sysctl.conf');
    expect(result).not.toBeNull();
    expect(result!.params.type).toBe("file-append");
    expect(result!.params.line).toBe("kernel.randomize_va_space=2");
    expect(result!.params.path).toBe("/etc/sysctl.conf");
  });

  it("returns package-install handler for apt-get install -y", () => {
    const result = matchHandler("apt-get install -y rsync");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: "package-install", package: "rsync" });
    expect(result!.handler).toBe(packageInstallHandler);
  });

  it("returns package-install handler for apt install -y", () => {
    const result = matchHandler("apt install -y libpam-pwquality");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: "package-install", package: "libpam-pwquality" });
  });

  it("returns chmod handler for chmod with octal mode", () => {
    const result = matchHandler("chmod 700 /root");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: "chmod-chown", mode: "700", path: "/root" });
    expect(result!.handler).toBe(chmodChownHandler);
  });

  it("returns chown handler for chown owner:group /path", () => {
    const result = matchHandler("chown root:root /etc/crontab");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: "chmod-chown", owner: "root:root", path: "/etc/crontab" });
  });

  it("returns null for unrecognized commands", () => {
    expect(matchHandler("unknown-command foo")).toBeNull();
    expect(matchHandler("rm -rf /")).toBeNull();
    expect(matchHandler("")).toBeNull();
  });
});

// ─── sysctl handler ───────────────────────────────────────────────────────────

describe("sysctl handler", () => {
  beforeEach(() => {
    mockedSshExec.mockReset();
  });

  it("returns skipped=true when current value already matches (idempotent)", async () => {
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "2\n", stderr: "" });

    const params = { type: "sysctl" as const, key: "kernel.randomize_va_space", value: "2" };
    const result = await sysctlHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockedSshExec).toHaveBeenCalledTimes(1);
  });

  it("applies sysctl and returns rollback step on success", async () => {
    // First call: read current value (different)
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "0\n", stderr: "" });
    // Second call: apply
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const params = { type: "sysctl" as const, key: "kernel.randomize_va_space", value: "2" };
    const result = await sysctlHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.rollbackStep).toBeDefined();
    expect(mockedSshExec).toHaveBeenCalledTimes(2);
    // Verify read call uses cmd("sysctl", "-n", key)
    expect(mockedSshExec.mock.calls[0][1]).toContain("sysctl -n kernel.randomize_va_space");
    // Verify apply call uses cmd("sysctl", "-w", "key=value")
    expect(mockedSshExec.mock.calls[1][1]).toContain("sysctl -w kernel.randomize_va_space=2");
  });

  it("returns failure when apply exits non-zero", async () => {
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "0\n", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "permission denied" });

    const params = { type: "sysctl" as const, key: "kernel.randomize_va_space", value: "2" };
    const result = await sysctlHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(false);
    expect(result.error).toBe("permission denied");
  });

  it("rollback function restores old value", async () => {
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "0\n", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const params = { type: "sysctl" as const, key: "kernel.randomize_va_space", value: "2" };
    const result = await sysctlHandler.execute(MOCK_IP, params);

    expect(result.rollbackStep).toBeDefined();
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await result.rollbackStep!.rollback(MOCK_IP);
    // Rollback should restore the old value (0)
    expect(mockedSshExec.mock.calls[2][1]).toContain("sysctl -w kernel.randomize_va_space=0");
  });
});

// ─── file-append handler ──────────────────────────────────────────────────────

describe("file-append handler", () => {
  beforeEach(() => {
    mockedSshExec.mockReset();
  });

  it("returns skipped=true when line already in file (idempotent)", async () => {
    mockedSshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "Defaults log_output\nsome other line\n",
      stderr: "",
    });

    const params = {
      type: "file-append" as const,
      line: "Defaults log_output",
      path: "/etc/sudoers.d/kastell-logging",
    };
    const result = await fileAppendHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockedSshExec).toHaveBeenCalledTimes(1);
  });

  it("appends line when not present and returns rollback step", async () => {
    // First call: cat file (line not present)
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "other line\n", stderr: "" });
    // Second call: append
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const params = {
      type: "file-append" as const,
      line: "Defaults log_output",
      path: "/etc/sudoers.d/kastell-logging",
    };
    const result = await fileAppendHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.rollbackStep).toBeDefined();
    // Verify useStdin was used for the append
    const appendCall = mockedSshExec.mock.calls[1];
    expect(appendCall[2]).toMatchObject({ useStdin: true });
  });

  it("returns failure when append fails", async () => {
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "permission denied" });

    const params = {
      type: "file-append" as const,
      line: "Defaults log_output",
      path: "/etc/sudoers.d/kastell-logging",
    };
    const result = await fileAppendHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(false);
    expect(result.error).toBe("permission denied");
  });

  it("rollback removes the appended line", async () => {
    // Initial state: line not in file
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "existing line\n", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const params = {
      type: "file-append" as const,
      line: "Defaults log_output",
      path: "/etc/sudoers.d/kastell-logging",
    };
    const result = await fileAppendHandler.execute(MOCK_IP, params);

    expect(result.rollbackStep).toBeDefined();

    // For rollback: read file, then write back without the line
    mockedSshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "existing line\nDefaults log_output\n",
      stderr: "",
    });
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await result.rollbackStep!.rollback(MOCK_IP);
    expect(mockedSshExec).toHaveBeenCalledTimes(4);
  });
});

// ─── resolveHandlerChain ──────────────────────────────────────────────────────

describe("resolveHandlerChain", () => {
  it("returns 1-element chain for single command", () => {
    const chain = resolveHandlerChain("sysctl -w kernel.randomize_va_space=2");
    expect(chain).not.toBeNull();
    expect(chain!.length).toBe(1);
    expect(chain![0].params.type).toBe("sysctl");
  });

  it("splits compound && command and matches each part", () => {
    const cmd = "sysctl -w kernel.randomize_va_space=2 && echo 'kernel.randomize_va_space=2' >> /etc/sysctl.conf";
    const chain = resolveHandlerChain(cmd);
    expect(chain).not.toBeNull();
    expect(chain!.length).toBe(2);
    expect(chain![0].params.type).toBe("sysctl");
    expect(chain![1].params.type).toBe("file-append");
  });

  it("returns null when any part is unmatched (D-15)", () => {
    const cmd = "sysctl -w kernel.randomize_va_space=2 && some-unknown-command";
    expect(resolveHandlerChain(cmd)).toBeNull();
  });

  it("returns null for fully unrecognized command", () => {
    expect(resolveHandlerChain("cat /etc/passwd | grep root")).toBeNull();
  });
});

// ─── package-install handler ──────────────────────────────────────────────────

describe("package-install handler", () => {
  beforeEach(() => {
    mockedSshExec.mockReset();
  });

  it("matchHandler returns package-install for apt-get install -y rsync", () => {
    const result = matchHandler("apt-get install -y rsync");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: "package-install", package: "rsync" });
  });

  it("matchHandler returns package-install for apt install -y libpam-pwquality", () => {
    const result = matchHandler("apt install -y libpam-pwquality");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: "package-install", package: "libpam-pwquality" });
  });

  it("matchHandler returns null for apt install with malicious package name", () => {
    const result = matchHandler("apt install -y bad;cmd");
    expect(result).toBeNull();
  });

  it("skips if package already installed (dpkg ii check)", async () => {
    mockedSshExec.mockResolvedValueOnce({
      code: 0,
      stdout: "ii  rsync          3.2.3-4  amd64  ...\n",
      stderr: "",
    });

    const params = { type: "package-install" as const, package: "rsync" };
    const result = await packageInstallHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockedSshExec).toHaveBeenCalledTimes(1);
    expect(mockedSshExec.mock.calls[0][1]).toContain("dpkg -l rsync");
  });

  it("installs package when not installed", async () => {
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const params = { type: "package-install" as const, package: "rsync" };
    const result = await packageInstallHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.rollbackStep).toBeDefined();
    // Install call should use DEBIAN_FRONTEND=noninteractive
    const installCall = mockedSshExec.mock.calls[1];
    expect(installCall[1]).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(installCall[2]).toMatchObject({ useStdin: true });
  });

  it("returns failure when install exits non-zero", async () => {
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "E: Unable to locate package" });

    const params = { type: "package-install" as const, package: "rsync" };
    const result = await packageInstallHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unable to locate package");
  });
});

// ─── chmod/chown handler ──────────────────────────────────────────────────────

describe("chmod/chown handler", () => {
  beforeEach(() => {
    mockedSshExec.mockReset();
  });

  it("matchHandler returns chmod params for chmod 700 /root", () => {
    const result = matchHandler("chmod 700 /root");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: "chmod-chown", mode: "700", path: "/root" });
  });

  it("matchHandler returns chown params for chown root:root /etc/crontab", () => {
    const result = matchHandler("chown root:root /etc/crontab");
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: "chmod-chown", owner: "root:root", path: "/etc/crontab" });
  });

  it("matchHandler returns null for symbolic chmod mode", () => {
    const result = matchHandler("chmod o-w /path");
    expect(result).toBeNull();
  });

  it("skips chmod if mode already correct (idempotent)", async () => {
    // stat output: "700 root:root"
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "700 root:root\n", stderr: "" });

    const params = { type: "chmod-chown" as const, mode: "700", path: "/root" };
    const result = await chmodChownHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockedSshExec.mock.calls[0][1]).toContain("stat -c");
  });

  it("applies chmod and returns rollback step", async () => {
    // stat: current mode 755
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "755 root:root\n", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const params = { type: "chmod-chown" as const, mode: "700", path: "/root" };
    const result = await chmodChownHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.rollbackStep).toBeDefined();
  });

  it("glob path uses useStdin for stat and chmod", async () => {
    // stat for glob path
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "755 root:root\n", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const params = { type: "chmod-chown" as const, mode: "700", path: "/etc/cron.d/*" };
    await chmodChownHandler.execute(MOCK_IP, params);

    // Both calls should use useStdin because path contains *
    expect(mockedSshExec.mock.calls[0][2]).toMatchObject({ useStdin: true });
    expect(mockedSshExec.mock.calls[1][2]).toMatchObject({ useStdin: true });
  });

  it("applies chown and returns rollback step", async () => {
    // stat: current owner root:root
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "644 root:root\n", stderr: "" });
    mockedSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const params = { type: "chmod-chown" as const, owner: "root:shadow", path: "/etc/shadow" };
    const result = await chmodChownHandler.execute(MOCK_IP, params);

    expect(result.success).toBe(true);
    expect(result.rollbackStep).toBeDefined();
    expect(mockedSshExec.mock.calls[1][1]).toContain("chown root:shadow /etc/shadow");
  });
});

// ─── executeHandlerChain atomic rollback ──────────────────────────────────────

describe("executeHandlerChain atomic rollback", () => {
  beforeEach(() => {
    mockedSshExec.mockReset();
  });

  it("2-step chain: step2 fail triggers step1 rollback (D-16)", async () => {
    const rollbackFn = jest.fn().mockResolvedValue(undefined);

    // Build a 2-step chain manually
    const handler1 = {
      match: jest.fn(),
      execute: jest.fn().mockResolvedValue({
        success: true,
        rollbackStep: { rollback: rollbackFn },
      }),
    };
    const handler2 = {
      match: jest.fn(),
      execute: jest.fn().mockResolvedValue({
        success: false,
        error: "step 2 failed",
      }),
    };

    const chain = [
      { handler: handler1, params: { type: "sysctl" as const, key: "k", value: "v" } },
      { handler: handler2, params: { type: "sysctl" as const, key: "k2", value: "v2" } },
    ];

    const result = await executeHandlerChain(MOCK_IP, chain);

    expect(result.success).toBe(false);
    expect(rollbackFn).toHaveBeenCalledWith(MOCK_IP);
  });

  it("returns success when all steps succeed", async () => {
    const handler1 = {
      match: jest.fn(),
      execute: jest.fn().mockResolvedValue({ success: true }),
    };
    const handler2 = {
      match: jest.fn(),
      execute: jest.fn().mockResolvedValue({ success: true }),
    };

    const chain = [
      { handler: handler1, params: { type: "sysctl" as const, key: "k", value: "v" } },
      { handler: handler2, params: { type: "sysctl" as const, key: "k2", value: "v2" } },
    ];

    const result = await executeHandlerChain(MOCK_IP, chain);
    expect(result.success).toBe(true);
  });
});

// ─── compound real-world patterns ─────────────────────────────────────────────

describe("compound real-world patterns", () => {
  it("resolves sysctl+echo compound from kernel.ts KRN-01 fixCommand", () => {
    const fixCmd = "sysctl -w kernel.randomize_va_space=2 && echo 'kernel.randomize_va_space=2' >> /etc/sysctl.conf";
    const chain = resolveHandlerChain(fixCmd);
    expect(chain).not.toBeNull();
    expect(chain!.length).toBe(2);
    expect(chain![0].params.type).toBe("sysctl");
    expect(chain![0].params.key).toBe("kernel.randomize_va_space");
    expect(chain![0].params.value).toBe("2");
    expect(chain![1].params.type).toBe("file-append");
    expect(chain![1].params.line).toBe("kernel.randomize_va_space=2");
    expect(chain![1].params.path).toBe("/etc/sysctl.conf");
  });

  it("resolves chmod+chown compound for /etc/shadow", () => {
    const fixCmd = "chmod 640 /etc/shadow && chown root:shadow /etc/shadow";
    const chain = resolveHandlerChain(fixCmd);
    expect(chain).not.toBeNull();
    expect(chain!.length).toBe(2);
    expect(chain![0].params.type).toBe("chmod-chown");
    expect(chain![0].params.mode).toBe("640");
    expect(chain![1].params.type).toBe("chmod-chown");
    expect(chain![1].params.owner).toBe("root:shadow");
  });
});
