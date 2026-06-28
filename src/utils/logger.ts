import chalk from "chalk";
import ora, { type Ora } from "ora";

// ─── Machine mode (P146 Task 3) ───────────────────────────────────────────────
//
// When machine mode is enabled, diagnostic messages (info / success / step /
// title) route to stderr instead of stdout so that a command's JSON / machine
// payload on stdout is not contaminated with human-facing decorations.
// logger.error and logger.warning always go to stderr (they are not changed).
// debugLog redaction is unaffected.
let machineMode = false;

export function setMachineMode(enabled: boolean): void {
  machineMode = enabled;
}

export function isMachineMode(): boolean {
  return machineMode;
}

/**
 * Run `fn` with machine mode enabled, then restore the prior state — even
 * when `fn` throws. Use for `--json` output blocks so the enable/restore
 * pair is impossible to forget on early-return paths. Nested calls
 * snapshot and restore their own frame, so an outer human-mode caller
 * with an inner `--json` block stays in human mode after the inner
 * block exits.
 */
export async function withMachineMode<T>(fn: () => T | Promise<T>): Promise<T> {
  const previous = machineMode;
  machineMode = true;
  try {
    return await fn();
  } finally {
    machineMode = previous;
  }
}

export const logger = {
  info: (message: string) => {
    diagnosticLog(chalk.blue("ℹ"), message);
  },

  success: (message: string) => {
    diagnosticLog(chalk.green("✔"), message);
  },

  error: (message: string, context?: Record<string, unknown>) => {
    const args = context
      ? [chalk.red("✖"), message, context]
      : [chalk.red("✖"), message];
    console.error(...args.map(redactArg));
  },

  warning: (message: string) => {
    console.error(chalk.yellow("⚠"), redactString(message));
  },

  title: (message: string) => {
    const redactedMessage = redactString(message);
    if (machineMode) {
      console.error(chalk.bold.cyan(redactedMessage));
    } else {
      console.log();
      console.log(chalk.bold.cyan(redactedMessage));
      console.log();
    }
  },

  step: (message: string) => {
    diagnosticLog(chalk.gray("→"), message);
  },
};

function diagnosticLog(...args: unknown[]): void {
  const redactedArgs = args.map(redactArg);
  if (machineMode) {
    console.error(...redactedArgs);
  } else {
    console.log(...redactedArgs);
  }
}

export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: "cyan",
  });
}

// ─── Recursive secret-shape redaction (P142 Task 5) ─────────────────────────
//
// The fixed depth of 8 is the approved P142 contract, not a runtime override:
// it covers current provider, Axios, SSH error/cause, and notification payload
// shapes while bounding hostile or accidental deep structures.
export const MAX_REDACTION_DEPTH = 8;
export const REDACTED = "[REDACTED]";
export const CIRCULAR = "[Circular]";
export const MAX_DEPTH = "[MaxDepth]";
export const UNSERIALIZABLE = "[Unserializable]";

// Sensitive-key patterns: matched case-insensitively against the key name.
// EXPORTED so tests can audit the contract.
export const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /apikey/i,
  /api_key/i,
  /api[-_]?token/i,
  /authorization/i,
  /credential/i,
  /private[_-]?key/i,
];

// Provider value patterns: anchored against the whole string.
// EXPORTED so tests can audit the contract.
export const PROVIDER_TOKEN_PATTERNS: readonly RegExp[] = [
  /^[A-Za-z0-9._-]*hcic_[A-Za-z0-9]+$/, // Hetzner
  /^dop_v1_[A-Za-z0-9]+$/, // DigitalOcean
];

// String-shape patterns: matched anywhere in the value.
const BEARER_PATTERN = /(^|\W)Bearer\s+[A-Za-z0-9._+/=_-]+/i;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function looksLikeSecretValue(value: string): boolean {
  if (PROVIDER_TOKEN_PATTERNS.some((re) => re.test(value))) return true;
  if (BEARER_PATTERN.test(value)) return true;
  if (JWT_PATTERN.test(value)) return true;
  return false;
}

function redactString(value: string): string {
  if (looksLikeSecretValue(value)) return REDACTED;
  return value;
}

/**
 * Bounded recursive serializer with cycle detection, sensitive-key
 * redaction, and getter safety. Exported so the contract is testable in
 * isolation from the `debugLog` env-gated entry point.
 *
 * 1-arg form preserves the P142 default of MAX_REDACTION_DEPTH=8.
 * 2-arg form accepts an explicit `maxDepth` override; supply a smaller
 * value to surface deep structures quickly or a larger value to inspect
 * unusually nested provider/SSH error shapes.
 */
export function safeStringify(value: unknown, options?: { maxDepth?: number }): string {
  const maxDepth = options?.maxDepth ?? MAX_REDACTION_DEPTH;
  const seen = new WeakSet<object>();
  function walk(node: unknown, depth: number): unknown {
    if (node === null || node === undefined) return node;
    const t = typeof node;
    if (t === "string") return redactString(node as string);
    if (t === "number" || t === "boolean" || t === "bigint") return node;
    if (t === "function") return "[Function]";
    if (t === "symbol") return node.toString();
    if (depth > maxDepth) return MAX_DEPTH;
    if (t !== "object") return String(node);
    const obj = node as object;
    if (seen.has(obj)) return CIRCULAR;
    seen.add(obj);
    if (Array.isArray(node)) {
      return (node as unknown[]).map((item) => walk(item, depth + 1));
    }
    const out: Record<string, unknown> = {};
    try {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        try {
          if (isSensitiveKey(key)) {
            out[key] = REDACTED;
            continue;
          }
          const descriptor = Object.getOwnPropertyDescriptor(node, key);
          if (descriptor && descriptor.get) {
            try {
              out[key] = walk(descriptor.get.call(node), depth + 1);
            } catch {
              out[key] = UNSERIALIZABLE;
            }
            continue;
          }
          out[key] = walk((node as Record<string, unknown>)[key], depth + 1);
        } catch {
          out[key] = UNSERIALIZABLE;
        }
      }
    } catch {
      return UNSERIALIZABLE;
    }
    return out;
  }
  try {
    return JSON.stringify(walk(value, 0));
  } catch {
    return UNSERIALIZABLE;
  }
}

function redactArg(arg: unknown): unknown {
  if (typeof arg === "string") {
    return redactString(arg);
  }
  if (arg !== null && typeof arg === "object") {
    return safeStringify(arg);
  }
  return arg;
}

export const debugLog = process.env.KASTELL_DEBUG
  ? (...args: unknown[]) => console.error("[debug]", ...args.map(redactArg))
  : undefined;
