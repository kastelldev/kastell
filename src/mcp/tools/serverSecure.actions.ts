// Shared action constants for server secure MCP tool
// Used by serverSecureSchema (src/mcp/tools/serverSecure.ts) and tests

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

export type SecureAction = (typeof SECURE_ACTIONS)[number];