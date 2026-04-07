/**
 * Integration tests: verify logSafeModeBlock produces correct security log entries,
 * including config.yaml maxBytes support (D-10) and KASTELL_CALLER detection.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import os from "os";
import { randomBytes } from "crypto";

// We need to control KASTELL_DIR so security.log lands in a temp dir.
// safeMode.ts and securityLogger.ts read KASTELL_DIR from paths.js at import time,
// so we mock the module to point to a temp directory.

const tempDir = join(os.tmpdir(), `kastell-test-${randomBytes(6).toString("hex")}`);
const tempSecurityLog = join(tempDir, "security.log");
const tempConfigYaml = join(tempDir, "config.yaml");

jest.mock("../../src/utils/paths.js", () => ({
  KASTELL_DIR: tempDir,
  SECURITY_LOG: join(tempDir, "security.log"),
}));

// Import AFTER mock is registered
import { logSafeModeBlock, _resetConfigCache } from "../../src/utils/safeMode.js";

function readLastLogEntry(): Record<string, unknown> {
  const content = readFileSync(tempSecurityLog, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

beforeEach(() => {
  mkdirSync(tempDir, { recursive: true });
  // Remove security.log, its rotation backup, and config.yaml before each test
  try { unlinkSync(tempSecurityLog); } catch { /* ok */ }
  try { unlinkSync(tempSecurityLog + ".1"); } catch { /* ok */ }
  try { unlinkSync(tempConfigYaml); } catch { /* ok */ }
  _resetConfigCache();
  // Reset env
  delete process.env["KASTELL_CALLER"];
});

afterEach(() => {
  delete process.env["KASTELL_CALLER"];
});

// ─── Basic log entry correctness ──────────────────────────────────────────────

describe("logSafeModeBlock — basic log entry", () => {
  it("writes a warn-level destructive/block entry", () => {
    logSafeModeBlock("server:destroy", { server: "test-srv", ip: "1.2.3.4" });

    const entry = readLastLogEntry();
    expect(entry["level"]).toBe("warn");
    expect(entry["action"]).toBe("server:destroy");
    expect(entry["category"]).toBe("destructive");
    expect(entry["result"]).toBe("block");
    expect(entry["reason"]).toBe("KASTELL_SAFE_MODE=true");
    expect(entry["server"]).toBe("test-srv");
    expect(entry["ip"]).toBe("1.2.3.4");
    expect(typeof entry["ts"]).toBe("string");
  });

  it("defaults category to destructive when not specified", () => {
    logSafeModeBlock("server:restore");

    const entry = readLastLogEntry();
    expect(entry["category"]).toBe("destructive");
  });

  it("uses provided category override", () => {
    logSafeModeBlock("config:edit", { category: "config" });

    const entry = readLastLogEntry();
    expect(entry["category"]).toBe("config");
  });

  it("omits server and ip when not provided", () => {
    logSafeModeBlock("server:destroy");

    const entry = readLastLogEntry();
    expect(entry["server"]).toBeUndefined();
    expect(entry["ip"]).toBeUndefined();
  });
});

// ─── Caller detection ─────────────────────────────────────────────────────────

describe("logSafeModeBlock — caller detection", () => {
  it("uses cli caller when KASTELL_CALLER is not set", () => {
    delete process.env["KASTELL_CALLER"];
    logSafeModeBlock("server:destroy");

    const entry = readLastLogEntry();
    expect(entry["caller"]).toBe("cli");
  });

  it("uses mcp caller when KASTELL_CALLER=mcp", () => {
    process.env["KASTELL_CALLER"] = "mcp";
    logSafeModeBlock("server:destroy");

    const entry = readLastLogEntry();
    expect(entry["caller"]).toBe("mcp");
  });
});

// ─── D-10: config.yaml maxBytes integration ───────────────────────────────────

describe("logSafeModeBlock — D-10 config.yaml maxBytes", () => {
  it("rotates security.log when size exceeds config.yaml maxBytes threshold", () => {
    // Write config.yaml with a very small maxBytes (100 bytes)
    writeFileSync(tempConfigYaml, "securityLog:\n  maxBytes: 100\n", "utf-8");

    // Pre-fill security.log with >100 bytes of content
    const padding = "x".repeat(110) + "\n";
    writeFileSync(tempSecurityLog, padding, { encoding: "utf8", mode: 0o600 });

    // logSafeModeBlock should trigger rotation because file > 100 bytes
    logSafeModeBlock("test:rotate");

    // After rotation, the old file becomes security.log.1
    expect(existsSync(tempSecurityLog + ".1")).toBe(true);
  });

  it("does not rotate when log is small and no config.yaml maxBytes override", () => {
    // No config.yaml — uses default 10MB
    const smallContent = '{"ts":"2026-01-01T00:00:00.000Z"}\n';
    writeFileSync(tempSecurityLog, smallContent, { encoding: "utf8", mode: 0o600 });

    logSafeModeBlock("test:no-rotate");

    // Should not have created a .1 file (log is far below 10MB)
    expect(existsSync(tempSecurityLog + ".1")).toBe(false);
  });

  it("uses default maxBytes when config.yaml has no securityLog key", () => {
    writeFileSync(tempConfigYaml, "provider: hetzner\n", "utf-8");

    const smallContent = '{"ts":"2026-01-01T00:00:00.000Z"}\n';
    writeFileSync(tempSecurityLog, smallContent, { encoding: "utf8", mode: 0o600 });

    logSafeModeBlock("test:no-rotate-partial-config");

    expect(existsSync(tempSecurityLog + ".1")).toBe(false);
  });

  it("uses default maxBytes when config.yaml is malformed YAML", () => {
    writeFileSync(tempConfigYaml, ": invalid: yaml: {{{", "utf-8");

    const smallContent = '{"ts":"2026-01-01T00:00:00.000Z"}\n';
    writeFileSync(tempSecurityLog, smallContent, { encoding: "utf8", mode: 0o600 });

    // Should not throw
    expect(() => logSafeModeBlock("test:malformed-config")).not.toThrow();
    expect(existsSync(tempSecurityLog + ".1")).toBe(false);
  });
});
