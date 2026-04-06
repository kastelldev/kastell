import { spawn } from "child_process";
import { EventEmitter } from "events";
import { scpDownload, scpUpload, assertSafePath } from "../../src/utils/scp";
import * as sshUtils from "../../src/utils/ssh";

jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  sanitizedEnv: jest.fn(() => ({})),
  resolveScpPath: jest.fn(() => "/usr/bin/scp"),
  resolveSshPath: jest.fn(() => "ssh"),
}));

function createMockProcess(): EventEmitter & { stderr: EventEmitter; kill: jest.Mock } {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: jest.Mock };
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
}

describe("SCP utilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("assertSafePath", () => {
    it("should accept safe paths", () => {
      expect(() => assertSafePath("/tmp/backup.tar.gz")).not.toThrow();
      expect(() => assertSafePath("/var/lib/data_2024/file.txt")).not.toThrow();
    });

    it("should reject paths with shell metacharacters", () => {
      expect(() => assertSafePath("/tmp/file;rm -rf /")).toThrow("Unsafe remote path rejected");
      expect(() => assertSafePath("/tmp/$(whoami)")).toThrow("Unsafe remote path rejected");
      expect(() => assertSafePath("/tmp/file|cat")).toThrow("Unsafe remote path rejected");
      expect(() => assertSafePath("/tmp/file&bg")).toThrow("Unsafe remote path rejected");
      expect(() => assertSafePath("/tmp/`id`")).toThrow("Unsafe remote path rejected");
    });
  });

  describe("scpDownload", () => {
    it("should use stdio ignore for stdin", async () => {
      const proc = createMockProcess();
      (spawn as jest.Mock).mockReturnValue(proc);
      const promise = scpDownload("1.2.3.4", "/remote/file", "/local/file");
      proc.emit("close", 0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
      );
    });

    it("should include BatchMode=yes in args", async () => {
      const proc = createMockProcess();
      (spawn as jest.Mock).mockReturnValue(proc);
      const promise = scpDownload("1.2.3.4", "/remote/file", "/local/file");
      proc.emit("close", 0);
      await promise;

      const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
      expect(args).toContain("BatchMode=yes");
    });

    it("should use resolveScpPath for binary", async () => {
      const proc = createMockProcess();
      (spawn as jest.Mock).mockReturnValue(proc);
      const promise = scpDownload("1.2.3.4", "/remote/file", "/local/file");
      proc.emit("close", 0);
      await promise;

      expect(sshUtils.resolveScpPath).toHaveBeenCalled();
      expect((spawn as jest.Mock).mock.calls[0][0]).toBe("/usr/bin/scp");
    });

    it("should fire SIGTERM on timeout", async () => {
      jest.useFakeTimers();
      const proc = createMockProcess();
      (spawn as jest.Mock).mockReturnValue(proc);
      const promise = scpDownload("1.2.3.4", "/remote/file", "/local/file", 5000);

      jest.advanceTimersByTime(5000);
      await expect(promise).rejects.toThrow("SCP download timeout");
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      jest.useRealTimers();
    });
  });

  describe("scpUpload", () => {
    it("should use stdio ignore for stdin", async () => {
      const proc = createMockProcess();
      (spawn as jest.Mock).mockReturnValue(proc);
      const promise = scpUpload("1.2.3.4", "/local/file", "/remote/file");
      proc.emit("close", 0);
      await promise;

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
      );
    });

    it("should include BatchMode=yes in upload args", async () => {
      const proc = createMockProcess();
      (spawn as jest.Mock).mockReturnValue(proc);
      const promise = scpUpload("1.2.3.4", "/local/file", "/remote/file");
      proc.emit("close", 0);
      await promise;

      const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
      expect(args).toContain("BatchMode=yes");
    });

    it("should fire SIGTERM on upload timeout", async () => {
      jest.useFakeTimers();
      const proc = createMockProcess();
      (spawn as jest.Mock).mockReturnValue(proc);
      const promise = scpUpload("1.2.3.4", "/local/file", "/remote/file", 5000);

      jest.advanceTimersByTime(5000);
      await expect(promise).rejects.toThrow("SCP upload timeout");
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
      jest.useRealTimers();
    });
  });
});
