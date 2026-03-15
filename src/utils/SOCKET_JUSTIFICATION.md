# Socket.dev Supply Chain Justification

This document addresses the remaining Socket.dev security alerts for `kastell`.
Current score: 74/100. Target: no unresolved critical alerts.

## Resolved Alerts (Phase 43)

### execSync → spawnSync migration (Plan 43-01)
- **Alert type:** `shell` — execSync passes commands through a shell (injection risk)
- **Resolution:** Migrated all `execSync` calls to `spawnSync` with argument arrays
- **Files migrated:** `src/utils/ssh.ts`, `src/core/backup.ts`, `src/core/snapshot.ts`,
  `src/core/secure.ts`, `src/core/firewall.ts`, `src/core/domain.ts`,
  `src/core/guard.ts`, `src/core/manage.ts`, `src/commands/init.ts`,
  `src/utils/updateCheck.ts`, `src/mcp/server.ts`
- **Additional protection:** `SshCommand` branded type + `shellEscape` prevents
  injection at SSH command construction layer (Phase 42-02)

## Remaining Alerts

### axios (network access)
- **Alert type:** `network` — axios makes outbound HTTP requests
- **Justification:** `axios` is the intentional HTTP client for all cloud provider
  API calls. Kastell must communicate with Hetzner, DigitalOcean, Vultr, and Linode
  REST APIs to provision, list, and destroy servers. There is no alternative
  implementation path that does not involve network access.
- **Risk mitigation:**
  - All API tokens are stored in OS keychain (Phase 42-01, `@napi-rs/keyring`)
  - `sanitizeResponseData()` whitelist approach prevents token/secret leakage in
    error messages (src/utils/config.ts)
  - axios is a well-maintained, widely-audited package (>50M weekly downloads)
- **Verdict:** False positive for a CLI tool that intentionally makes API calls.
  Elimination is not possible without rewriting all 4 provider modules.

## Summary

| Alert | Type | Status | Reason |
|-------|------|--------|--------|
| execSync | shell | Resolved (43-01) | Migrated to spawnSync |
| axios | network | Justified | Required for cloud provider APIs |

The remaining `network` alert from axios is a known, accepted trade-off.
Kastell's core functionality (server provisioning, management) requires HTTP API
access to cloud providers. The alert correctly identifies that network calls
occur — this is intentional and documented behavior, not a supply chain risk.
