import { EventEmitter } from "events";

jest.mock("child_process", () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn(),
}));

import { spawn, spawnSync } from "child_process";
import {
  checkSshAvailable,
  sshConnect,
  sshExec,
  sshStream,
  sanitizedEnv,
} from "../../src/utils/ssh";

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

function createMockProcess(exitCode: number = 0) {
  const cp = new EventEmitter() as any;
  cp.stdout = new EventEmitter();
  cp.stderr = new EventEmitter();
  process.nextTick(() => cp.emit("close", exitCode));
  return cp;
}

describe("security-ssh E2E", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // resolveSshPath() uses spawnSync to check if ssh is in PATH
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("OpenSSH_8.9"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("IP validation security", () => {
    it("sshConnect should throw 'Invalid IP address' for non-IP strings", () => {
      expect(() => sshConnect("example.com")).toThrow("Invalid IP address");
      expect(() => sshConnect("localhost")).toThrow("Invalid IP address");
      expect(() => sshConnect("invalid-ip")).toThrow("Invalid IP address");
      expect(() => sshConnect("")).toThrow("Invalid IP address");
    });

    it("sshConnect should throw for IPs with extra octets", () => {
      expect(() => sshConnect("1.2.3.4.5")).toThrow("Invalid IP address");
    });

    it("sshExec should throw 'Invalid IP address' for non-IP strings", () => {
      expect(() => sshExec("malicious; rm -rf /", "uptime")).toThrow("Invalid IP address");
      expect(() => sshExec("$(whoami)", "id")).toThrow("Invalid IP address");
      expect(() => sshExec("`hostname`", "pwd")).toThrow("Invalid IP address");
    });

    it("sshStream should throw 'Invalid IP address' for non-IP strings", () => {
      expect(() => sshStream("not-an-ip", "tail -f /var/log/syslog")).toThrow("Invalid IP address");
      expect(() => sshStream("1.2.3", "journalctl")).toThrow("Invalid IP address");
    });

    it("should accept valid IPv4 addresses", async () => {
      const mockCp = createMockProcess(0);
      mockedSpawn.mockReturnValue(mockCp);

      const code = await sshConnect("192.168.1.1");
      expect(code).toBe(0);
      expect(mockedSpawn).toHaveBeenCalled();
    });

    it("should accept edge case valid IPs", async () => {
      const mockCp = createMockProcess(0);
      mockedSpawn.mockReturnValue(mockCp);

      await sshConnect("255.255.255.255");
      expect(mockedSpawn).toHaveBeenCalled();
    });

    it("should reject reserved IPs", () => {
      expect(() => sshConnect("0.0.0.0")).toThrow("Reserved IP address not allowed");
      expect(() => sshConnect("127.0.0.1")).toThrow("Reserved IP address not allowed");
    });
  });

  describe("StrictHostKeyChecking security", () => {
    it("sshConnect should use StrictHostKeyChecking=accept-new", async () => {
      const mockCp = createMockProcess(0);
      mockedSpawn.mockReturnValue(mockCp);

      await sshConnect("1.2.3.4");

      expect(mockedSpawn).toHaveBeenCalledWith(
        "ssh",
        ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", "root@1.2.3.4"],
        expect.any(Object),
      );
    });

    it("sshExec should use StrictHostKeyChecking=accept-new", async () => {
      const mockCp = createMockProcess(0);
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      await sshExec("1.2.3.4", "uptime");

      expect(mockedSpawn).toHaveBeenCalledWith(
        "ssh",
        ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "root@1.2.3.4", "uptime"],
        expect.any(Object),
      );
    });

    it("sshStream should use StrictHostKeyChecking=accept-new", async () => {
      const mockCp = createMockProcess(0);
      mockedSpawn.mockReturnValue(mockCp);

      await sshStream("1.2.3.4", "docker logs coolify --follow");

      expect(mockedSpawn).toHaveBeenCalledWith(
        "ssh",
        ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "root@1.2.3.4", "docker logs coolify --follow"],
        expect.any(Object),
      );
    });
  });

  describe("sanitizedEnv security - sensitive env var filtering", () => {
    it("should remove HETZNER_TOKEN from environment", () => {
      process.env.HETZNER_TOKEN = "secret-hetzner-token";
      process.env.PATH = "/usr/bin";

      const env = sanitizedEnv();

      expect(env.HETZNER_TOKEN).toBeUndefined();
      expect(env.PATH).toBe("/usr/bin");
    });

    it("should remove DIGITALOCEAN_TOKEN from environment", () => {
      process.env.DIGITALOCEAN_TOKEN = "secret-do-token";

      const env = sanitizedEnv();

      expect(env.DIGITALOCEAN_TOKEN).toBeUndefined();
    });

    it("should remove MY_SECRET from environment", () => {
      process.env.MY_SECRET = "hidden-value";

      const env = sanitizedEnv();

      expect(env.MY_SECRET).toBeUndefined();
    });

    it("should remove DB_PASSWORD from environment", () => {
      process.env.DB_PASSWORD = "database-pass";

      const env = sanitizedEnv();

      expect(env.DB_PASSWORD).toBeUndefined();
    });

    it("should remove API_CREDENTIAL from environment", () => {
      process.env.API_CREDENTIAL = "api-cred";

      const env = sanitizedEnv();

      expect(env.API_CREDENTIAL).toBeUndefined();
    });

    it("should keep PATH and HOME in environment", () => {
      process.env.PATH = "/usr/bin:/bin";
      process.env.HOME = "/home/user";

      const env = sanitizedEnv();

      expect(env.PATH).toBe("/usr/bin:/bin");
      expect(env.HOME).toBe("/home/user");
    });

    it("should handle case-insensitive TOKEN patterns", () => {
      process.env.my_token = "lowercase";
      process.env.MY_TOKEN = "uppercase";
      process.env.MyToken = "mixed";

      const env = sanitizedEnv();

      expect(env.my_token).toBeUndefined();
      expect(env.MY_TOKEN).toBeUndefined();
      expect(env.MyToken).toBeUndefined();
    });

    it("should handle case-insensitive SECRET patterns", () => {
      process.env.aws_secret = "aws";
      process.env.CLIENT_SECRET = "client";

      const env = sanitizedEnv();

      expect(env.aws_secret).toBeUndefined();
      expect(env.CLIENT_SECRET).toBeUndefined();
    });

    it("should handle case-insensitive PASSWORD patterns", () => {
      process.env.DB_PASSWORD = "db";
      process.env.admin_password = "admin";
      process.env.RootPassword = "root";

      const env = sanitizedEnv();

      expect(env.DB_PASSWORD).toBeUndefined();
      expect(env.admin_password).toBeUndefined();
      expect(env.RootPassword).toBeUndefined();
    });

    it("should handle case-insensitive CREDENTIAL patterns", () => {
      process.env.GCP_CREDENTIALS = "gcp";
      process.env.credential = "cred";

      const env = sanitizedEnv();

      expect(env.GCP_CREDENTIALS).toBeUndefined();
      expect(env.credential).toBeUndefined();
    });

    it("should not modify the original process.env", () => {
      process.env.TEST_TOKEN = "original";

      const env = sanitizedEnv();

      expect(env.TEST_TOKEN).toBeUndefined();
      expect(process.env.TEST_TOKEN).toBe("original");
    });

    it("should return a new object, not reference to process.env", () => {
      const env = sanitizedEnv();

      expect(env).not.toBe(process.env);
    });
  });

  describe("SSH spawn calls include sanitizedEnv", () => {
    it("sshConnect should pass sanitizedEnv to spawn", async () => {
      process.env.HETZNER_TOKEN = "secret-token";
      process.env.PATH = "/usr/bin";

      const mockCp = createMockProcess(0);
      mockedSpawn.mockReturnValue(mockCp);

      await sshConnect("1.2.3.4");

      const spawnCall = mockedSpawn.mock.calls[0];
      const options = spawnCall[2] as { env: NodeJS.ProcessEnv };

      expect(options.env).toBeDefined();
      expect(options.env.HETZNER_TOKEN).toBeUndefined();
      expect(options.env.PATH).toBe("/usr/bin");
    });

    it("sshExec should pass sanitizedEnv to spawn", async () => {
      process.env.DIGITALOCEAN_TOKEN = "do-secret";
      process.env.HOME = "/home/test";

      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshExec("1.2.3.4", "test");
      process.nextTick(() => mockCp.emit("close", 0));
      await promise;

      const spawnCall = mockedSpawn.mock.calls[0];
      const options = spawnCall[2] as { env: NodeJS.ProcessEnv };

      expect(options.env).toBeDefined();
      expect(options.env.DIGITALOCEAN_TOKEN).toBeUndefined();
      expect(options.env.HOME).toBe("/home/test");
    });

    it("sshStream should pass sanitizedEnv to spawn", async () => {
      process.env.MY_SECRET = "secret";
      process.env.TERM = "xterm";

      const mockCp = createMockProcess(0);
      mockedSpawn.mockReturnValue(mockCp);

      await sshStream("1.2.3.4", "tail -f /var/log/syslog");

      const spawnCall = mockedSpawn.mock.calls[0];
      const options = spawnCall[2] as { env: NodeJS.ProcessEnv };

      expect(options.env).toBeDefined();
      expect(options.env.MY_SECRET).toBeUndefined();
      expect(options.env.TERM).toBe("xterm");
    });
  });

  describe("SSH availability check", () => {
    it("should return true when ssh is available", () => {
      mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("OpenSSH_8.9"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });

      expect(checkSshAvailable()).toBe(true);
    });

    it("should return false when ssh is not available", () => {
      mockedSpawnSync.mockReturnValue({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), pid: 1, output: [], signal: null });

      expect(checkSshAvailable()).toBe(false);
    });
  });

  describe("error handling", () => {
    it("sshConnect should return 1 on spawn error", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshConnect("1.2.3.4");
      process.nextTick(() => mockCp.emit("error", new Error("spawn failed")));
      const code = await promise;

      expect(code).toBe(1);
    });

    it("sshExec should return error details on spawn error", async () => {
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

    it("sshStream should return 1 on spawn error", async () => {
      const mockCp = new EventEmitter() as any;
      mockCp.stdout = new EventEmitter();
      mockCp.stderr = new EventEmitter();
      mockedSpawn.mockReturnValue(mockCp);

      const promise = sshStream("1.2.3.4", "journalctl -f");
      process.nextTick(() => mockCp.emit("error", new Error("spawn failed")));
      const code = await promise;

      expect(code).toBe(1);
    });
  });
});
