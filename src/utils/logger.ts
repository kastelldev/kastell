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
    console.error(...args.map(redactArg)); // codeql[js/clear-text-logging] false-positive: args flow through redactArg → redactString/safeStringify
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
    // codeql[js/clear-text-logging] false-positive: redactedArgs pre-redacted via redactArg → redactString/safeStringify
    console.error(...redactedArgs);
  } else {
    console.log(...redactedArgs); // codeql[js/clear-text-logging] false-positive: redactedArgs pre-redacted via redactArg → redactString/safeStringify
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
  /^vltc[._-]?[A-Za-z0-9]{20,}$/, // Vultr v2 (security-cleanup-1) — `vltc` prefix + opt separator + 20+ alnum body
];

// String-shape patterns.
//
// WHOLE_STRING_PATTERNS: anchored regexes that match the entire value.
// Used by looksLikeSecretValue() to detect "the whole value IS a secret"
// (e.g. caller passes a JWT as the message string directly).
//
// SUBSTRING_PATTERNS: unanchored regexes that match anywhere in the value.
// Used by redactString() for in-place replacement so embedded secrets
// (e.g. `auth failed with token=hcic_xxx`) are scrubbed without losing
// the surrounding diagnostic context.
//
// JWT min segment length 20 avoids false positives like IPv4 addresses
// (e.g. "203.0.113.42" → "203.0.113" would match the 3-segment dot
// pattern without the length floor).
// WHOLE_STRING_PATTERNS: provider-token shapes (hcic_, dop_v1_) are NOT
// duplicated here — `looksLikeSecretValue()` already checks
// PROVIDER_TOKEN_PATTERNS first, so adding them here would create a
// maintenance drift trap. Only WHOLE shapes that lack a PROVIDER_TOKEN
// counterpart remain:
//   - Bearer (Authorization header as the entire string), with a minimum
//     8-char token floor so legitimate short diagnostic strings like
//     "Bearer missing in config" are not collapsed to [REDACTED].
//   - JWT (3-segment dot-separated with 20+ char segments — the floor
//     prevents IPv4 like "203.0.113.42" matching "203.0.113").
//   - Long opaque token (security-cleanup-1) — 50+ char alphanumeric with
//     no spaces/dots/slashes. Catches Linode-style tokens (no public prefix).
//     The 50-char floor avoids false-positives on SHA-1 (40 hex), SHA-256
//     truncated base64 (43 chars), and UUIDs (32-36 chars).
const WHOLE_STRING_PATTERNS: readonly RegExp[] = [
  /^Bearer\s+[A-Za-z0-9._+/=_-]{8,}$/i,
  /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/,
  /^[A-Za-z0-9]{50,}$/,
];

// SUBSTRING_PATTERNS: BEARER substring match uses a (^|\W) word-boundary
// anchor to avoid identifier-internal false positives like "XBearer abc",
// AND a minimum 8-char token floor so legitimate short diagnostic phrases
// like "Bearer missing in config" are not collapsed. Pre-153c715 the pattern
// had the anchor but no length floor; the redesign dropped the anchor.
// Both guards are restored here. `replace` consumes the boundary character,
// so "auth: Bearer xyz" → "auth[REDACTED]".
const SUBSTRING_PATTERNS: readonly RegExp[] = [
  /(^|\W)Bearer\s+[A-Za-z0-9._+/=_-]{8,}/gi,
  /hcic_[A-Za-z0-9]+/g,
  /dop_v1_[A-Za-z0-9]+/g,
  /vltc[._-]?[A-Za-z0-9]{20,}/g, // Vultr v2 embedded (security-cleanup-1)
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function looksLikeSecretValue(value: string): boolean {
  if (PROVIDER_TOKEN_PATTERNS.some((re) => re.test(value))) return true;
  return WHOLE_STRING_PATTERNS.some((re) => re.test(value));
}

function redactString(value: string): string {
  // Whole-string match: the entire value IS a secret → collapse to REDACTED.
  if (looksLikeSecretValue(value)) return REDACTED;

  // Substring match: a secret is embedded inside a longer message
  // (e.g. `auth failed with token=hcic_xxx`). Replace each occurrence in
  // place, preserve surrounding context for operator diagnosis.
  let result = value;
  let changed = false;
  for (const pattern of SUBSTRING_PATTERNS) {
    if (pattern.test(result)) {
      result = result.replace(pattern, REDACTED);
      changed = true;
    }
  }
  return changed ? result : value;
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
