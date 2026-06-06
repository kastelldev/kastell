// Shared action constants for server secure MCP tool
// Used by serverSecureSchema (src/mcp/tools/serverSecure.ts) and tests

import { z } from "zod";

export const SECURE_ACTIONS = [
  "audit",
  "secure-setup",
  "secure-audit",
  "firewall-setup",
  "firewall-add",
  "firewall-remove",
  "firewall-status",
  "domain-set",
  "domain-remove",
  "domain-check",
  "domain-info",
] as const;

/**
 * Co-located Zod schema. Consumers should import this instead of re-deriving
 * `z.enum(SECURE_ACTIONS)` at the call site (one source of truth).
 */
export const serverSecureActionSchema = z.enum(SECURE_ACTIONS);

export type SecureAction = z.infer<typeof serverSecureActionSchema>;