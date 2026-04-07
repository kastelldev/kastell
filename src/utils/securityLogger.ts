import { appendFileSync, statSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { KASTELL_DIR } from "./paths.js";

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

function getLogPath(): string {
  return join(KASTELL_DIR, "security.log");
}

function getBakPath(): string {
  return join(KASTELL_DIR, "security.log.1");
}

function rotateIfNeeded(maxBytes: number): void {
  try {
    const stat = statSync(getLogPath());
    if (stat.size >= maxBytes) {
      renameSync(getLogPath(), getBakPath());
    }
  } catch {
    // File doesn't exist yet — no rotation needed
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

    // Remove undefined optional fields so they are absent from JSON (not null)
    const cleaned: Partial<SecurityLogEntry> = {};
    for (const [k, v] of Object.entries(fullEntry)) {
      if (v !== undefined) {
        (cleaned as Record<string, unknown>)[k] = v;
      }
    }

    appendFileSync(getLogPath(), JSON.stringify(cleaned) + "\n", {
      encoding: "utf8",
      flag: "a",
      mode: 0o600,
    });
  } catch {
    // Security log failure MUST NOT crash the main operation — silent fail
  }
}

export function detectCaller(): SecurityLogCaller {
  return process.env["KASTELL_CALLER"] === "mcp" ? "mcp" : "cli";
}
