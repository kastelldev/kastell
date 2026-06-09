import { appendFileSync, statSync, renameSync, mkdirSync } from "fs";
import { KASTELL_DIR, SECURITY_LOG } from "./paths.js";
import { debugLog } from "./logger.js";

export type SecurityLogLevel = "info" | "warn" | "error";
export type SecurityLogCategory = "destructive" | "auth" | "ssh" | "mcp" | "config";
export type SecurityLogCaller = "cli" | "mcp";
export type SecurityLogResult = "allow" | "block" | "success" | "failure";

export interface SecurityLogEntry {
  ts: string;
  level: SecurityLogLevel;
  action: string;
  category: SecurityLogCategory;
  server?: string;
  ip?: string;
  result: SecurityLogResult;
  reason?: string;
  caller: SecurityLogCaller;
  duration_ms?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ROTATE_ATTEMPTS = 3;
const ROTATE_DELAY_MS = 10;
const PERMISSION_ERROR_CODES = new Set(["EPERM", "EACCES"]);

function isPermissionError(err: unknown): boolean {
  return PERMISSION_ERROR_CODES.has((err as NodeJS.ErrnoException).code ?? "");
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rotateSecurityLogBestEffort(): void {
  for (let attempt = 1; attempt <= ROTATE_ATTEMPTS; attempt++) {
    try {
      renameSync(SECURITY_LOG, SECURITY_LOG + ".1");
      return;
    } catch (err: unknown) {
      if (!isPermissionError(err)) {
        debugLog?.("security log rotation failed", { cause: err });
        return;
      }
      if (attempt < ROTATE_ATTEMPTS) {
        sleepSync(ROTATE_DELAY_MS);
      }
    }
  }
  debugLog?.("security log rotation failed after retries");
}

function rotateIfNeeded(maxBytes: number): void {
  try {
    const stat = statSync(SECURITY_LOG);
    if (stat.size >= maxBytes) {
      rotateSecurityLogBestEffort();
    }
  } catch (error) {
    // File doesn't exist yet — no rotation needed
    debugLog?.("security log rotation check failed", { cause: error });
  }
}

export function logSecurityEvent(
  entry: Omit<SecurityLogEntry, "ts" | "caller">,
  options?: { maxBytes?: number }
): void {
  try {
    mkdirSync(KASTELL_DIR, { recursive: true });
    rotateIfNeeded(options?.maxBytes ?? DEFAULT_MAX_BYTES);

    const fullEntry: SecurityLogEntry = {
      ts: new Date().toISOString(),
      caller: detectCaller(),
      ...entry,
    };

    appendFileSync(SECURITY_LOG, JSON.stringify(fullEntry) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    // Security log failure MUST NOT crash the main operation — silent fail
    debugLog?.("security log write failed", { cause: error });
  }
}

export function detectCaller(): SecurityLogCaller {
  return process.env["KASTELL_CALLER"] === "mcp" ? "mcp" : "cli";
}

export class SecurityLogger {
  static warn(message: string, context?: Record<string, unknown>): void {
    // Fallback warn for modules that can't use logSecurityEvent
    try {
      console.warn(`[SECURITY] ${message}`, context ?? {});
    } catch (error) {
      // Silent fail - security logging must never crash the main operation
      debugLog?.("security log flush failed", { cause: error });
    }
  }
}
