import { readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import chalk from "chalk";
import { logSecurityEvent } from "./securityLogger.js";
import type { SecurityLogCategory } from "./securityLogger.js";
import { KASTELL_DIR } from "./paths.js";
import { debugLog } from "./logger.js";

let _safeModeWarningShown = false;

const TRUTHY = new Set(["true", "1", "yes", "on"]);
const FALSY = new Set(["false", "0", "no", "off"]);

function parseBoolEnv(value: string, varName: string): boolean {
  const lower = value.toLowerCase();
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  process.stderr.write(
    `Warning: ${varName}="${value}" is not a recognized boolean. Use "true" or "false". Defaulting to safe mode.\n`,
  );
  return true;
}

export function isSafeMode(): boolean {
  // KASTELL_SAFE_MODE takes precedence — no deprecation warning
  const kastell = process.env.KASTELL_SAFE_MODE;
  if (kastell !== undefined) {
    return parseBoolEnv(kastell, "KASTELL_SAFE_MODE");
  }

  // Backward compat: QUICKLIFY_SAFE_MODE with one-time deprecation warning
  const quicklify = process.env.QUICKLIFY_SAFE_MODE;
  if (quicklify !== undefined) {
    if (!_safeModeWarningShown) {
      _safeModeWarningShown = true;
      process.stderr.write(
        chalk.yellow(
          "QUICKLIFY_SAFE_MODE is deprecated. Use KASTELL_SAFE_MODE instead.\n",
        ),
      );
    }
    return parseBoolEnv(quicklify, "QUICKLIFY_SAFE_MODE");
  }

  // Default: safe mode OFF for CLI (interactive confirmations protect CLI users).
  // MCP server sets KASTELL_SAFE_MODE=true explicitly in mcp/index.ts.
  return false;
}

/** Read securityLog.maxBytes from ~/.kastell/config.yaml (per D-10). Cached after first read. */
let _cachedMaxBytes: number | undefined | null = null; // null = not yet read
function getSecurityLogMaxBytes(): number | undefined {
  if (_cachedMaxBytes !== null) return _cachedMaxBytes;
  try {
    const content = readFileSync(join(KASTELL_DIR, "config.yaml"), "utf-8");
    const raw = yaml.load(content, { schema: yaml.JSON_SCHEMA });
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const cfg = raw as Record<string, unknown>;
      const secLog = cfg["securityLog"];
      if (secLog !== null && typeof secLog === "object" && !Array.isArray(secLog)) {
        const val = (secLog as Record<string, unknown>)["maxBytes"];
        if (typeof val === "number" && Number.isFinite(val) && val > 0) {
          _cachedMaxBytes = val;
          return val;
        }
      }
    }
  } catch (error) {
    debugLog?.("config read failed, using default safe mode", { cause: error });
  }
  _cachedMaxBytes = undefined;
  return undefined;
}

/**
 * Log a security event when SAFE_MODE blocks a destructive operation.
 * Call this inside `if (isSafeMode()) { ... }` blocks.
 * Reads maxBytes from config.yaml per D-10. Silent — never throws.
 */
/** Reset cached config — for testing only. */
export function _resetConfigCache(): void {
  _cachedMaxBytes = null;
}

export function logSafeModeBlock(
  action: string,
  options?: {
    category?: SecurityLogCategory;
    server?: string;
    ip?: string;
  },
): void {
  const maxBytes = getSecurityLogMaxBytes();
  logSecurityEvent(
    {
      level: "warn",
      action,
      category: options?.category ?? "destructive",
      server: options?.server,
      ip: options?.ip,
      result: "block",
      reason: "KASTELL_SAFE_MODE=true",
    },
    { maxBytes },
  );
}
