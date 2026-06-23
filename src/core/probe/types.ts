// src/core/probe/types.ts
// Active Probe session types and encrypted payload contracts.
//
// These types are the public contract for the Active Probe lifecycle:
//   preparing -> prepared -> executing -> executed -> verifying -> verified
//   rollback-pending -> rolling-back -> rolled-back
//   unresolved (terminal failure state)
//
// All payload fields (prepared/executed/verification/rollback) are encrypted
// before being written to disk. See `src/core/probe/payload.ts`.

import type { EncryptedPayload } from "../../utils/encryption.js";

// ─── Session lifecycle ──────────────────────────────────────────────────────

export const PROBE_SESSION_STATES = [
  "preparing",
  "prepared",
  "executing",
  "executed",
  "verifying",
  "verified",
  "rollback-pending",
  "rolling-back",
  "rolled-back",
  "unresolved",
] as const;

export type ProbeSessionState = (typeof PROBE_SESSION_STATES)[number];

export const PROBE_RISK_LEVELS = ["safe", "caution", "dangerous"] as const;
export type ActiveProbeRisk = (typeof PROBE_RISK_LEVELS)[number];

// ─── Target identity ────────────────────────────────────────────────────────

export interface ProbeTargetIdentity {
  serverId: string;
  provider: string;
  cloudId?: string;
  ip: string;
}

// ─── Session transition log ────────────────────────────────────────────────

export interface ProbeSessionTransition {
  from: ProbeSessionState;
  to: ProbeSessionState;
  at: string;
  reason?: string;
}

// ─── Encrypted payload alias ───────────────────────────────────────────────

export type EncryptedProbePayload = EncryptedPayload;

// ─── Redacted error shape (for diagnostic projection) ──────────────────────

export interface RedactedProbeError {
  code: string;
  message: string;
  stack?: string;
}

// ─── Top-level session record ──────────────────────────────────────────────

export interface ProbeSessionRecord {
  schemaVersion: 1;
  revision: number;
  sessionId: string;
  targetKeyHash: string;
  state: ProbeSessionState;
  pluginName: string;
  pluginVersion: string;
  checkId: string;
  handlerPath: string;
  handlerSha256: string;
  risk: ActiveProbeRisk;
  timeoutMs: number;
  target: ProbeTargetIdentity;
  createdAt: string;
  updatedAt: string;
  history: ProbeSessionTransition[];
  prepared?: EncryptedProbePayload;
  executed?: EncryptedProbePayload;
  verification?: EncryptedProbePayload;
  rollback?: EncryptedProbePayload;
  lastError?: RedactedProbeError;
  terminalAt?: string;
}
