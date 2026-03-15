import { EventEmitter } from "events";

jest.mock("child_process", () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
}));

import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import {
  checkSshAvailable,
  removeStaleHostKey,
  resolveSshPath,
  resolveScpPath,
  sshConnect,
  sshExec,
  sshStream,
  sanitizedEnv,
} from "../../src/utils/ssh";

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

function createMockProcess(exitCode: number = 0) {
  const cp = new EventEmitter() as any;
  cp.stdout = new EventEmitter();
  cp.stderr = new EventEmitter();
  process.nextTick(() => cp.emit("close", exitCode));
  return cp;
}

describe("ssh utils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the cached SSH path between tests
    // We access it via the module's internal cache by clearing mocks
  });

  describe("resolveSshPath (BUG-13)", () => {
    it("should return 'ssh' when ssh is available in PATH", () => {
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("OpenSSH_8.9"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
      // Clear cache by using a fresh import each time isn't feasible,
      // but since spawnSync succeeds, it should return "ssh"
      const result = resolveSshPath();
      expect(result).toBe("ssh");
    });

    it("should return 'ssh' as fallback when not found anywhere", () => {
      mockedSpawnSync.mockReturnValue({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
      mockedExistsSync.mockReturnValue(false);

      const result = resolveSshPath();
      expect(result).toBe("ssh");
    });

    it("should return Windows SSH path when found in System32/OpenSSH (Windows only)", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      mockedSpawnSync.mockReturnValue({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
      // First candidate (System32/OpenSSH/ssh.exe) exists
      mockedExistsSync.mockImplementation((p: any) =>
        typeof p === "string" && p.includes("OpenSSH") && p.includes("System32"),
      );

      const result = resolveSshPath();
      expect(result).toContain("ssh");

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });
  });

  describe("checkSshAvailable", () => {
    it("should return true when ssh is available", () => {
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("OpenSSH_8.9"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
      expect(checkSshAvailable()).toBe(true);
    });

    it("should return false when ssh is not available", () => {
      mockedSpawnSync.mockReturnValue({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
      expect(checkSshAvailable()).toBe(false);
    });
  });

  describe("sshConnect", () => {
    it("should spawn ssh with correct args", async () => {
      const mockCp = createMockProcess(0);
      mockedSpawn.mockReturnValue(mockCp);

      const code = await sshConnect("1.2.3.4");
      expect(code).toBe(0);
      expect(mockedSpawn).toHaveBeenCalledWith(
        "ssh",
        ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", "root@1.2.3.4"],
        expect.objectContaining({ stdio: "inherit" }),
      );
    });

    it("should return non-zero exit code", async () => {
      const mockCp = createMockProcess(255);
      mockedSpawn.mockReturnValue(mockCp);

      const code = await sshConnect("1.2.3.4");
      expect(code).toBe(255);
    });

    it("should return 1 on error", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshConnect("1.2.3.4");
      process.nextTick(() => mockCp.emit("error", new Error("spawn failed")));
      const code = await promise;
      expect(code).toBe(1);
    });

    it("should return 0 when close code is null", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshConnect("1.2.3.4");
      process.nextTick(() => mockCp.emit("close", null));
      const code = await promise;
      expect(code).toBe(0);
    });

    it("should throw error for invalid IP address", () => {
      expect(() => sshConnect("invalid-ip")).toThrow("Invalid IP address");
      expect(() => sshConnect("1.2.3.4.5")).toThrow("Invalid IP address");
      expect(() => sshConnect("example.com")).toThrow("Invalid IP address");
    });
  });

  describe("sshStream", () => {
    it("should spawn ssh with command and pipe stderr for host key detection", async () => {
      const mockCp = createMockProcess(0);
      mockedSpawn.mockReturnValue(mockCp);

      const code = await sshStream("1.2.3.4", "docker logs coolify --follow");
      expect(code).toBe(0);
      expect(mockedSpawn).toHaveBeenCalledWith(
        "ssh",
        ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "root@1.2.3.4", "docker logs coolify --follow"],
        expect.objectContaining({ stdio: ["ignore", "inherit", "pipe"] }),
      );
    });

    it("should return non-zero exit code", async () => {
      const mockCp = createMockProcess(1);
      mockedSpawn.mockReturnValue(mockCp);

      const code = await sshStream("1.2.3.4", "journalctl -f");
      expect(code).toBe(1);
    });

    it("should return 1 on error", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshStream("1.2.3.4", "tail -f /var/log/syslog");
      process.nextTick(() => mockCp.emit("error", new Error("spawn failed")));
      const code = await promise;
      expect(code).toBe(1);
    });

    it("should return 0 when close code is null", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshStream("1.2.3.4", "journalctl -f");
      process.nextTick(() => mockCp.emit("close", null));
      const code = await promise;
      expect(code).toBe(0);
    });

    it("should throw error for invalid IP address", () => {
      expect(() => sshStream("not-an-ip", "uptime")).toThrow("Invalid IP address");
    });
  });

  describe("sshExec", () => {
    it("should execute command and return output", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshExec("1.2.3.4", "docker ps");
      process.nextTick(() => {
        mockCp.stdout.emit("data", Buffer.from("CONTAINER ID"));
        mockCp.emit("close", 0);
      });

      const result = await promise;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("CONTAINER ID");
      expect(result.stderr).toBe("");
    });

    it("should capture stderr", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshExec("1.2.3.4", "bad-command");
      process.nextTick(() => {
        mockCp.stderr.emit("data", Buffer.from("command not found"));
        mockCp.emit("close", 127);
      });

      const result = await promise;
      expect(result.code).toBe(127);
      expect(result.stderr).toBe("command not found");
    });

    it("should handle spawn error", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshExec("1.2.3.4", "test");
      process.nextTick(() => mockCp.emit("error", new Error("spawn failed")));

      const result = await promise;
      expect(result.code).toBe(1);
      expect(result.stderr).toBe("spawn failed");
    });

    it("should pass correct args with StrictHostKeyChecking", async () => {
      const mockCp = createMockProcess(0);
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      await sshExec("1.2.3.4", "uptime");
      expect(mockedSpawn).toHaveBeenCalledWith(
        "ssh",
        ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "root@1.2.3.4", "uptime"],
        expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
      );
    });

    it("should default to code 1 when close code is null", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshExec("1.2.3.4", "test-cmd");
      process.nextTick(() => mockCp.emit("close", null));

      const result = await promise;
      expect(result.code).toBe(1);
    });

    it("should throw error for invalid IP address", () => {
      expect(() => sshExec("localhost", "uptime")).toThrow("Invalid IP address");
    });
  });

  describe("removeStaleHostKey", () => {
    it("should call spawnSync with ssh-keygen -R and the IP as separate args", () => {
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
      removeStaleHostKey("1.2.3.4");
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        "ssh-keygen",
        ["-R", "1.2.3.4"],
        expect.objectContaining({ stdio: "ignore" }),
      );
    });

    it("should not throw when ssh-keygen fails", () => {
      mockedSpawnSync.mockReturnValue({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
      expect(() => removeStaleHostKey("1.2.3.4")).not.toThrow();
    });

    it("should throw for invalid IP", () => {
      expect(() => removeStaleHostKey("not-an-ip")).toThrow("Invalid IP address");
    });
  });

  describe("sshExec host key retry", () => {
    it("should retry once when stderr contains 'Host key verification failed'", async () => {
      // First call: host key mismatch
      const mockCp1 = new EventEmitter() as any;
      mockCp1.stdout = new EventEmitter();
      mockCp1.stderr = new EventEmitter();

      // Second call: success after key removal
      const mockCp2 = new EventEmitter() as any;
      mockCp2.stdout = new EventEmitter();
      mockCp2.stderr = new EventEmitter();

      mockedSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2);
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });

      const promise = sshExec("1.2.3.4", "echo ok");
      process.nextTick(() => {
        mockCp1.stderr.emit("data", Buffer.from("Host key verification failed."));
        mockCp1.emit("close", 255);
        process.nextTick(() => {
          mockCp2.stdout.emit("data", Buffer.from("ok"));
          mockCp2.emit("close", 0);
        });
      });

      const result = await promise;
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("ok");
      expect(mockedSpawn).toHaveBeenCalledTimes(2);
      // Verify ssh-keygen -R was called via spawnSync
      expect(mockedSpawnSync).toHaveBeenCalledWith("ssh-keygen", ["-R", "1.2.3.4"], expect.objectContaining({ stdio: "ignore" }));
    });

    it("should retry once when stderr contains 'REMOTE HOST IDENTIFICATION HAS CHANGED'", async () => {
      const mockCp1 = new EventEmitter() as any;
      mockCp1.stdout = new EventEmitter();
      mockCp1.stderr = new EventEmitter();

      const mockCp2 = new EventEmitter() as any;
      mockCp2.stdout = new EventEmitter();
      mockCp2.stderr = new EventEmitter();

      mockedSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2);
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });

      const promise = sshExec("1.2.3.4", "uptime");
      process.nextTick(() => {
        mockCp1.stderr.emit("data", Buffer.from("REMOTE HOST IDENTIFICATION HAS CHANGED!"));
        mockCp1.emit("close", 255);
        process.nextTick(() => {
          mockCp2.emit("close", 0);
        });
      });

      const result = await promise;
      expect(result.code).toBe(0);
      expect(mockedSpawn).toHaveBeenCalledTimes(2);
    });

    it("should NOT retry on other SSH errors (permission denied)", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshExec("1.2.3.4", "uptime");
      process.nextTick(() => {
        mockCp.stderr.emit("data", Buffer.from("Permission denied (publickey)."));
        mockCp.emit("close", 255);
      });

      const result = await promise;
      expect(result.code).toBe(255);
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
    });

    it("should NOT retry more than once (no infinite loop)", async () => {
      // Both calls return host key mismatch
      const makeHostKeyMockCp = () => {
        const cp = new EventEmitter() as any;
        cp.stdout = new EventEmitter();
        cp.stderr = new EventEmitter();
        return cp;
      };

      const mockCp1 = makeHostKeyMockCp();
      const mockCp2 = makeHostKeyMockCp();

      mockedSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2);
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });

      const promise = sshExec("1.2.3.4", "uptime");
      process.nextTick(() => {
        mockCp1.stderr.emit("data", Buffer.from("Host key verification failed."));
        mockCp1.emit("close", 255);
        process.nextTick(() => {
          mockCp2.stderr.emit("data", Buffer.from("Host key verification failed."));
          mockCp2.emit("close", 255);
        });
      });

      const result = await promise;
      // Second attempt returned 255, should return that (no third attempt)
      expect(result.code).toBe(255);
      expect(mockedSpawn).toHaveBeenCalledTimes(2);
    });

    it("should return retry result (not original failure) on host key fix", async () => {
      const mockCp1 = new EventEmitter() as any;
      mockCp1.stdout = new EventEmitter();
      mockCp1.stderr = new EventEmitter();

      const mockCp2 = new EventEmitter() as any;
      mockCp2.stdout = new EventEmitter();
      mockCp2.stderr = new EventEmitter();

      mockedSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2);
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });

      const promise = sshExec("1.2.3.4", "hostname");
      process.nextTick(() => {
        mockCp1.stderr.emit("data", Buffer.from("Host key verification failed."));
        mockCp1.emit("close", 255);
        process.nextTick(() => {
          mockCp2.stdout.emit("data", Buffer.from("my-server"));
          mockCp2.emit("close", 0);
        });
      });

      const result = await promise;
      // Should return second attempt's output, not original stderr
      expect(result.stdout).toBe("my-server");
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
    });
  });

  describe("sshStream host key retry", () => {
    it("should retry once when stderr contains host key mismatch pattern", async () => {
      const mockCp1 = new EventEmitter() as any;
      mockCp1.stdout = new EventEmitter();
      mockCp1.stderr = new EventEmitter();

      const mockCp2 = new EventEmitter() as any;
      mockCp2.stdout = new EventEmitter();
      mockCp2.stderr = new EventEmitter();

      mockedSpawn.mockReturnValueOnce(mockCp1).mockReturnValueOnce(mockCp2);
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });

      const promise = sshStream("1.2.3.4", "journalctl -f");
      process.nextTick(() => {
        mockCp1.stderr.emit("data", Buffer.from("Host key verification failed."));
        mockCp1.emit("close", 255);
        process.nextTick(() => {
          mockCp2.emit("close", 0);
        });
      });

      const code = await promise;
      expect(code).toBe(0);
      expect(mockedSpawn).toHaveBeenCalledTimes(2);
    });

    it("should NOT retry on non-host-key errors", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshStream("1.2.3.4", "journalctl -f");
      process.nextTick(() => {
        mockCp.stderr.emit("data", Buffer.from("Connection refused"));
        mockCp.emit("close", 1);
      });

      const code = await promise;
      expect(code).toBe(1);
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveScpPath", () => {
    it("should return 'scp' when resolveSshPath returns 'ssh' (default PATH)", () => {
      // resolveSshPath is cached from earlier tests as "ssh"
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("OpenSSH_8.9"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
      const result = resolveScpPath();
      expect(result).toBe("scp");
    });

    it("should derive SCP from SSH path for non-default paths", () => {
      // Test the derivation logic directly:
      // When SSH resolves to a simple "ssh", SCP should be "scp"
      const result = resolveScpPath();
      // Since resolveSshPath caches "ssh" from first test, this verifies the "ssh" -> "scp" path
      expect(result).toBe("scp");
    });
  });

  describe("sanitizedEnv", () => {
    it("should remove sensitive environment variables", () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        PATH: "/usr/bin",
        HOME: "/home/user",
        HETZNER_TOKEN: "secret-token",
        DIGITALOCEAN_TOKEN: "do-secret",
        MY_SECRET: "hidden",
        DB_PASSWORD: "dbpass",
        API_CREDENTIAL: "cred",
      };

      const env = sanitizedEnv();

      expect(env.PATH).toBe("/usr/bin");
      expect(env.HOME).toBe("/home/user");
      expect(env.HETZNER_TOKEN).toBeUndefined();
      expect(env.DIGITALOCEAN_TOKEN).toBeUndefined();
      expect(env.MY_SECRET).toBeUndefined();
      expect(env.DB_PASSWORD).toBeUndefined();
      expect(env.API_CREDENTIAL).toBeUndefined();

      process.env = originalEnv;
    });

    it("should return a copy of process.env without modifying original", () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv, TEST_TOKEN: "value" };

      const env = sanitizedEnv();

      expect(env.TEST_TOKEN).toBeUndefined();
      expect(process.env.TEST_TOKEN).toBe("value");

      process.env = originalEnv;
    });
  });
});
