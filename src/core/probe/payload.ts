// src/core/probe/payload.ts
// Active Probe payload serialization, encryption, and redaction.
//
// Security boundary contracts:
//   - serializeProbePayload rejects function, symbol, class instance, cycle,
//     Buffer, and BigInt before JSON.stringify (they would either silently
//     drop or produce a lossy representation).
//   - The size check uses Buffer.byteLength(..., "utf8") so multibyte characters
//     (emoji, CJK) cannot bypass the 64 KiB limit by overflowing JS string
//     length only.
//   - encrypt/decrypt use the canonical AES-256-GCM helpers in
//     src/utils/encryption.ts. Authentication tags are verified on decrypt;
//     any tampering fails closed with ProbePayloadAuthenticationError.
//   - redactProbeDiagnostic removes secrets before diagnostic output is
//     written to logs or returned to operators.

import { encryptData, decryptData, type EncryptedPayload } from "../../utils/encryption.js";
import { ValidationError } from "../../utils/errors.js";
import type { ProbeSessionRecord } from "./types.js";

// ─── Limits ────────────────────────────────────────────────────────────────

export const MAX_PROBE_PAYLOAD_BYTES = 64 * 1024;
export const MAX_PROBE_SESSION_BYTES = 1024 * 1024;

// ─── Error classes ─────────────────────────────────────────────────────────

export class ProbePayloadLimitError extends ValidationError {
  constructor(
    message: string,
    options?: { cause?: unknown; hint?: string },
  ) {
    super(message, { code: "PROBE_PAYLOAD_LIMIT", ...options });
  }
}

export class ProbePayloadAuthenticationError extends ValidationError {
  constructor(
    message: string,
    options?: { cause?: unknown; hint?: string },
  ) {
    super(message, { code: "PROBE_PAYLOAD_AUTH", ...options });
  }
}

export class ProbePayloadTypeError extends ValidationError {
  constructor(
    message: string,
    options?: { cause?: unknown; hint?: string },
  ) {
    super(message, { code: "PROBE_PAYLOAD_TYPE", ...options });
  }
}

// ─── Type guard ────────────────────────────────────────────────────────────

/**
 * Reject values that JSON.stringify would silently drop (function, symbol,
 * undefined) or produce a structurally lossy representation of
 * (class instance state, Buffer bytes, BigInt, cycles).
 *
 * Plain JSON values (null, boolean, number, string, array, object) pass.
 */
function isPlainJsonValue(value: unknown, seen: WeakSet<object>): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "bigint") return false;
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    return false;
  }
  if (typeof value !== "object") return false;

  // Reject Buffer / typed arrays / exotic objects.
  if (Buffer.isBuffer(value)) return false;
  if (ArrayBuffer.isView(value)) return false;

  // Reject cycles.
  if (seen.has(value as object)) return false;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isPlainJsonValue(item, seen)) return false;
    }
    return true;
  }

  // Reject class instances: walk the prototype chain; if anything other than
  // Object.prototype / null is encountered, it is a class instance.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;

  for (const item of Object.values(value as Record<string, unknown>)) {
    if (!isPlainJsonValue(item, seen)) return false;
  }
  return true;
}

export function assertPlainJsonValue(value: unknown): void {
  if (!isPlainJsonValue(value, new WeakSet())) {
    throw new ProbePayloadTypeError(
      "Active Probe payload must be plain JSON (no function, symbol, BigInt, Buffer, class instance, or cycle)",
    );
  }
}

// ─── Serialization ─────────────────────────────────────────────────────────

export function serializeProbePayload(value: unknown): string {
  assertPlainJsonValue(value);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > MAX_PROBE_PAYLOAD_BYTES) {
    throw new ProbePayloadLimitError(
      `Active Probe payload exceeds ${MAX_PROBE_PAYLOAD_BYTES} bytes`,
    );
  }
  return json;
}

export function assertProbeSessionEnvelopeSize(record: ProbeSessionRecord): void {
  const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (bytes > MAX_PROBE_SESSION_BYTES) {
    throw new ProbePayloadLimitError(
      `Active Probe session exceeds ${MAX_PROBE_SESSION_BYTES} bytes`,
    );
  }
}

// ─── Encryption helpers ────────────────────────────────────────────────────

export function encryptProbePayload(value: unknown, key: Buffer): EncryptedPayload {
  const json = serializeProbePayload(value);
  return encryptData(json, key);
}

export function decryptProbePayload(envelope: EncryptedPayload, key: Buffer): string {
  try {
    return decryptData(envelope, key);
  } catch (cause) {
    // The shared helper already maps AES-GCM auth failures to a domain message;
    // surface a probe-specific typed error while preserving the cause.
    throw new ProbePayloadAuthenticationError(
      "Active Probe payload authentication failed — ciphertext or auth tag tampered",
      { cause, hint: "Inspect the active probe session log; do not retry the encrypted payload" },
    );
  }
}

// ─── Diagnostic redaction ──────────────────────────────────────────────────

const SENSITIVE_KEY_RE = /^(token|password|secret|apiKey|api_key|authorization)$/i;
const BEARER_RE = /^Bearer\s+\S+$/i;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const REDACTED = "[REDACTED]";

export function redactProbeDiagnostic(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.replace(JWT_RE, REDACTED);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactProbeDiagnostic(item));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (typeof val === "string" && BEARER_RE.test(val)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactProbeDiagnostic(val);
  }
  return out;
}
