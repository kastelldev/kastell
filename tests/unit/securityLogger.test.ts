import * as fs from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  rmdirSync,
} = fs;

// Mock paths module before importing securityLogger
let mockKastellDir: string;

jest.mock("../../src/utils/paths.js", () => ({
  get KASTELL_DIR() {
    return mockKastellDir;
  },
  get BACKUPS_DIR() {
    return join(mockKastellDir, "backups");
  },
  get SECURITY_LOG() {
    return join(mockKastellDir, "security.log");
  },
}));

// P145: mock logger.debugLog so catch branches can verify silent-fail path
jest.mock("../../src/utils/logger.js", () => {
  const actual = jest.requireActual("../../src/utils/logger.js");
  return {
    ...actual,
    debugLog: jest.fn(),
  };
});

import {
  logSecurityEvent,
  detectCaller,
  getSecurityLogEntriesForTesting,
  resetSecurityLogForTesting,
  SecurityLogger,
  type SecurityLogLevel,
  type SecurityLogCategory,
  type SecurityLogCaller,
  type SecurityLogResult,
  type SecurityLogEntry,
} from "../../src/utils/securityLogger.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "kastell-test-"));
}

function cleanDir(dir: string) {
  try {
    const files = [
      join(dir, "security.log"),
      join(dir, "security.log.1"),
    ];
    for (const f of files) {
      try {
        unlinkSync(f);
      } catch {
        // ignore
      }
    }
    try {
      rmdirSync(dir);
    } catch {
      // ignore — may have subdirs
    }
  } catch {
    // ignore
  }
}

const baseEntry: Omit<SecurityLogEntry, "ts" | "caller"> = {
  level: "info",
  action: "server.lock",
  category: "destructive",
  server: "test-server",
  ip: "1.2.3.4",
  result: "allow",
  reason: "user confirmed",
  duration_ms: 250,
};

describe("securityLogger", () => {
  beforeEach(() => {
    mockKastellDir = makeTempDir();
    jest.resetModules();
  });

  afterEach(() => {
    cleanDir(mockKastellDir);
  });

  describe("logSecurityEvent — JSON line write", () => {
    it("creates security.log with one valid JSON line", () => {
      logSecurityEvent(baseEntry);

      const logPath = join(mockKastellDir, "security.log");
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]) as SecurityLogEntry;
      expect(parsed.ts).toBeDefined();
      expect(parsed.level).toBe("info");
      expect(parsed.action).toBe("server.lock");
      expect(parsed.category).toBe("destructive");
      expect(parsed.server).toBe("test-server");
      expect(parsed.ip).toBe("1.2.3.4");
      expect(parsed.result).toBe("allow");
      expect(parsed.reason).toBe("user confirmed");
      expect(parsed.caller).toBeDefined();
      expect(parsed.duration_ms).toBe(250);
    });

    it("produces ISO 8601 timestamp in ts field", () => {
      logSecurityEvent(baseEntry);
      const content = readFileSync(join(mockKastellDir, "security.log"), "utf8");
      const parsed = JSON.parse(content.trim()) as SecurityLogEntry;
      expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
    });
  });

  describe("logSecurityEvent — multiple writes (JSONL)", () => {
    it("two calls produce two newline-separated lines", () => {
      logSecurityEvent(baseEntry);
      logSecurityEvent({ ...baseEntry, action: "server.restore" });

      const content = readFileSync(join(mockKastellDir, "security.log"), "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]) as SecurityLogEntry;
      const second = JSON.parse(lines[1]) as SecurityLogEntry;
      expect(first.action).toBe("server.lock");
      expect(second.action).toBe("server.restore");
    });
  });

  describe("logSecurityEvent — optional fields", () => {
    it("omits undefined optional fields from JSON output", () => {
      const minimalEntry: Omit<SecurityLogEntry, "ts" | "caller"> = {
        level: "warn",
        action: "mcp.call",
        category: "mcp",
        result: "block",
      };

      logSecurityEvent(minimalEntry);

      const content = readFileSync(join(mockKastellDir, "security.log"), "utf8");
      const parsed = JSON.parse(content.trim()) as Record<string, unknown>;

      // Required fields must be present
      expect(parsed["ts"]).toBeDefined();
      expect(parsed["level"]).toBe("warn");
      expect(parsed["action"]).toBe("mcp.call");
      expect(parsed["category"]).toBe("mcp");
      expect(parsed["result"]).toBe("block");
      expect(parsed["caller"]).toBeDefined();

      // Optional fields must be absent (not null)
      expect("server" in parsed).toBe(false);
      expect("ip" in parsed).toBe(false);
      expect("reason" in parsed).toBe(false);
      expect("duration_ms" in parsed).toBe(false);
    });
  });

  describe("logSecurityEvent — rotation", () => {
    it("rotates when file exceeds maxBytes", () => {
      const logPath = join(mockKastellDir, "security.log");
      const bakPath = join(mockKastellDir, "security.log.1");

      // Write content larger than our test threshold
      const oldContent = "x".repeat(60) + "\n";
      writeFileSync(logPath, oldContent);

      logSecurityEvent(baseEntry, { maxBytes: 50 });

      // Backup must have old content
      expect(existsSync(bakPath)).toBe(true);
      expect(readFileSync(bakPath, "utf8")).toBe(oldContent);

      // Active log must have new entry only
      const newContent = readFileSync(logPath, "utf8").trim();
      const parsed = JSON.parse(newContent) as SecurityLogEntry;
      expect(parsed.action).toBe("server.lock");
    });

    it("overwrites existing backup on second rotation", () => {
      const logPath = join(mockKastellDir, "security.log");
      const bakPath = join(mockKastellDir, "security.log.1");

      // Pre-seed an old backup
      writeFileSync(bakPath, "old backup content\n");

      // Write content exceeding threshold
      writeFileSync(logPath, "y".repeat(60) + "\n");

      logSecurityEvent(baseEntry, { maxBytes: 50 });

      // Old backup must be replaced
      const bakContent = readFileSync(bakPath, "utf8");
      expect(bakContent).not.toContain("old backup content");
      expect(bakContent).toContain("y".repeat(60));
    });

    it("does not rotate when file is below maxBytes", () => {
      const logPath = join(mockKastellDir, "security.log");

      writeFileSync(logPath, "small\n");
      logSecurityEvent(baseEntry, { maxBytes: 10 * 1024 * 1024 });

      // No backup should be created
      expect(existsSync(join(mockKastellDir, "security.log.1"))).toBe(false);

      const content = readFileSync(logPath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(2); // "small" + new entry
    });

    it("should retry rotation without throwing when renameSync throws transient EPERM", () => {
      const logPath = join(mockKastellDir, "security.log");
      writeFileSync(logPath, "x".repeat(60) + "\n");

      let capturedRename: jest.Mock;
      let isolatedLogSecurityEvent: typeof logSecurityEvent;

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
        const isolatedFs = require("fs") as typeof fs;
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
        const mod = require("../../src/utils/securityLogger.js") as typeof import("../../src/utils/securityLogger.js");
        capturedRename = jest
          .spyOn(isolatedFs, "renameSync")
          .mockImplementation(() => {
            const err = Object.assign(new Error("EPERM"), { code: "EPERM" }) as NodeJS.ErrnoException;
            throw err;
          }) as unknown as jest.Mock;
        isolatedLogSecurityEvent = mod.logSecurityEvent;
      });

      expect(() => isolatedLogSecurityEvent!(baseEntry, { maxBytes: 50 })).not.toThrow();
      expect(capturedRename!).toHaveBeenCalledTimes(3);
    });
  });

  describe("logSecurityEvent — directory creation", () => {
    it("creates KASTELL_DIR if it does not exist", () => {
      // Use a nested temp dir that doesn't exist yet
      const nestedDir = join(mockKastellDir, "nested", "kastell");
      mockKastellDir = nestedDir;

      logSecurityEvent(baseEntry);

      expect(existsSync(join(nestedDir, "security.log"))).toBe(true);
    });
  });

  describe("logSecurityEvent — silent fail", () => {
    it("does not throw when logSecurityEvent is called (baseline)", () => {
      expect(() => logSecurityEvent(baseEntry)).not.toThrow();
    });

    it("does not throw when appendFileSync throws", () => {
      // Use a file path as directory (impossible to mkdirSync into a file)
      const savedDir = mockKastellDir;
      const impossibleDir = join(savedDir, "security.log", "subdir");
      writeFileSync(join(savedDir, "security.log"), "existing\n");
      mockKastellDir = impossibleDir;

      // Must not throw — silent fail
      expect(() => logSecurityEvent(baseEntry)).not.toThrow();

      // Restore so afterEach cleanup works correctly
      mockKastellDir = savedDir;
    });
  });

  describe("detectCaller", () => {
    const origCallerEnv = process.env["KASTELL_CALLER"];

    afterEach(() => {
      if (origCallerEnv === undefined) {
        delete process.env["KASTELL_CALLER"];
      } else {
        process.env["KASTELL_CALLER"] = origCallerEnv;
      }
    });

    it("returns 'mcp' when KASTELL_CALLER=mcp", () => {
      process.env["KASTELL_CALLER"] = "mcp";
      expect(detectCaller()).toBe("mcp");
    });

    it("returns 'cli' when KASTELL_CALLER is not set", () => {
      delete process.env["KASTELL_CALLER"];
      expect(detectCaller()).toBe("cli");
    });

    it("returns 'cli' when KASTELL_CALLER has a different value", () => {
      process.env["KASTELL_CALLER"] = "daemon";
      expect(detectCaller()).toBe("cli");
    });
  });

  describe("getSecurityLogEntriesForTesting", () => {
    it("returns empty array when no events have been logged", () => {
      resetSecurityLogForTesting();
      const entries = getSecurityLogEntriesForTesting();
      expect(entries).toEqual([]);
    });

    it("returns captured entries after logSecurityEvent calls", () => {
      resetSecurityLogForTesting();
      logSecurityEvent({ ...baseEntry, action: "event-1" });
      logSecurityEvent({ ...baseEntry, action: "event-2" });

      const entries = getSecurityLogEntriesForTesting();
      expect(entries).toHaveLength(2);
      expect(entries[0]["action"]).toBe("event-1");
      expect(entries[1]["action"]).toBe("event-2");
    });

    it("returns a shallow copy (not the same array reference)", () => {
      resetSecurityLogForTesting();
      logSecurityEvent(baseEntry);

      const entries = getSecurityLogEntriesForTesting();
      entries.push({ foo: "bar" }); // mutate returned array

      const next = getSecurityLogEntriesForTesting();
      expect(next).toHaveLength(1); // original buffer unaffected
    });
  });

  describe("resetSecurityLogForTesting", () => {
    it("clears the internal buffer", () => {
      logSecurityEvent(baseEntry);
      logSecurityEvent({ ...baseEntry, action: "another" });

      resetSecurityLogForTesting();

      expect(getSecurityLogEntriesForTesting()).toEqual([]);
    });

    it("allows fresh entries after reset", () => {
      resetSecurityLogForTesting();
      logSecurityEvent({ ...baseEntry, action: "fresh" });

      const entries = getSecurityLogEntriesForTesting();
      expect(entries).toHaveLength(1);
      expect(entries[0]["action"]).toBe("fresh");
    });
  });

  describe("SecurityLogger.warn", () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it("calls console.warn with [SECURITY] prefix and message", () => {
      SecurityLogger.warn("test message");
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[SECURITY] test message", {});
    });

    it("passes context object as second argument", () => {
      const context = { server: "my-server", ip: "1.2.3.4" };
      SecurityLogger.warn("auth failure", context);
      expect(consoleWarnSpy).toHaveBeenCalledWith("[SECURITY] auth failure", context);
    });

    it("passes empty object when context is undefined", () => {
      SecurityLogger.warn("no context");
      expect(consoleWarnSpy).toHaveBeenCalledWith("[SECURITY] no context", {});
    });

    it("does not throw when console.warn throws", () => {
      consoleWarnSpy.mockImplementation(() => {
        throw new Error("console warn blocked");
      });
      expect(() => SecurityLogger.warn("test")).not.toThrow();
    });
  });

  describe("type exports", () => {
    it("SecurityLogLevel type is usable", () => {
      const level: SecurityLogLevel = "info";
      expect(["info", "warn", "error"]).toContain(level);
    });

    it("SecurityLogCategory type is usable", () => {
      const category: SecurityLogCategory = "destructive";
      expect(["destructive", "auth", "ssh", "mcp", "config"]).toContain(category);
    });

    it("SecurityLogCategory accepts the new 'plugin-probe' value", () => {
      const category: SecurityLogCategory = "plugin-probe";
      expect(["destructive", "auth", "ssh", "mcp", "config", "plugin-probe"]).toContain(category);
    });

    it("SecurityLogCaller type is usable", () => {
      const caller: SecurityLogCaller = "cli";
      expect(["cli", "mcp"]).toContain(caller);
    });

    it("SecurityLogResult type is usable", () => {
      const result: SecurityLogResult = "success";
      expect(["allow", "block", "success", "failure"]).toContain(result);
    });
  });

  // ---- P145: silent-fail catch branches ----

  describe("logSecurityEvent — silent fail catch branches", () => {
    let mockedDebugLog: jest.Mock;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- logger.js is CJS, require() for isolated mock access
      const loggerModule = require("../../src/utils/logger.js");
      mockedDebugLog = loggerModule.debugLog as jest.Mock;
      mockedDebugLog.mockReset();
    });

    it("should silently fail when renameSync throws beyond retry budget (L68)", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
      const isolatedFs = require("fs") as typeof fs;
      const logPath = join(mockKastellDir, "security.log");
      writeFileSync(logPath, "x".repeat(60) + "\n");

      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
      const mod = require("../../src/utils/securityLogger.js") as typeof import("../../src/utils/securityLogger.js");

      // Mock fs.renameSync to always throw non-EPERM (not retryable)
      const err = Object.assign(new Error("EROFS"), { code: "EROFS" }) as NodeJS.ErrnoException;
      const renameSpy = jest
        .spyOn(isolatedFs, "renameSync")
        .mockImplementation(() => {
          throw err;
        });

      expect(() => mod.logSecurityEvent(baseEntry, { maxBytes: 50 })).not.toThrow();
      expect(renameSpy).toHaveBeenCalled();
      expect(mockedDebugLog).toHaveBeenCalledWith(
        "security log rotation failed",
        expect.objectContaining({ cause: err }),
      );
    });

    it("should silently fail when statSync throws (L80)", () => {
      const logPath = join(mockKastellDir, "security.log");
      writeFileSync(logPath, "x".repeat(60) + "\n");

      const statErr = Object.assign(new Error("EACCES"), { code: "EACCES" }) as NodeJS.ErrnoException;

      let isolatedLogSecurityEvent: typeof logSecurityEvent;

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
        const isolatedFs = require("fs") as typeof fs;
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
        const mod = require("../../src/utils/securityLogger.js") as typeof import("../../src/utils/securityLogger.js");
        jest.spyOn(isolatedFs, "statSync").mockImplementation(() => {
          throw statErr;
        });
        isolatedLogSecurityEvent = mod.logSecurityEvent;
      });

      expect(() => isolatedLogSecurityEvent!(baseEntry, { maxBytes: 50 })).not.toThrow();
      expect(mockedDebugLog).toHaveBeenCalledWith(
        "security log rotation check failed",
        expect.objectContaining({ cause: statErr }),
      );
    });

    it("should silently fail when secureAppendFileSync throws (L105)", () => {
      let isolatedLogSecurityEvent: typeof logSecurityEvent;

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
        const secureWrite = require("../../src/utils/secureWrite.js") as typeof import("../../src/utils/secureWrite.js");
        jest.spyOn(secureWrite, "secureAppendFileSync").mockImplementation(() => {
          throw new Error("disk full");
        });
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
        const mod = require("../../src/utils/securityLogger.js") as typeof import("../../src/utils/securityLogger.js");
        isolatedLogSecurityEvent = mod.logSecurityEvent;
      });

      expect(() => isolatedLogSecurityEvent!(baseEntry)).not.toThrow();
      expect(mockedDebugLog).toHaveBeenCalledWith(
        "security log write failed",
        expect.anything(),
      );
    });

    it("should silently fail when console.warn throws in SecurityLogger.warn (L120)", () => {
      let isolatedSecurityLogger: typeof import("../../src/utils/securityLogger.js");

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs require() for CJS interop
        isolatedSecurityLogger = require("../../src/utils/securityLogger.js") as typeof import("../../src/utils/securityLogger.js");
      });

      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
        throw new Error("console warn blocked");
      });

      expect(() => isolatedSecurityLogger!.SecurityLogger.warn("test", { server: "x" })).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(mockedDebugLog).toHaveBeenCalledWith(
        "security log flush failed",
        expect.anything(),
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
