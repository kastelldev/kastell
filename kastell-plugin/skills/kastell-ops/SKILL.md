---
name: kastell-ops
description: Kastell CLI patterns, architecture, anti-patterns, and decision trees. Use automatically when working in Kastell codebase or when asked about Kastell server infrastructure, security audit, hardening, lock, provision, or provider management.
user-invocable: false
allowed-tools: Bash
---

# Kastell Architecture

Kastell is a CLI toolkit for provisioning, securing, and managing self-hosted servers. TypeScript, ESM, strict mode. 31 CLI commands, 13 MCP tools, 4 cloud providers (hetzner, digitalocean, vultr, linode), 2 platform adapters (coolify, dokploy).

## Live Context

**Version:** !`node -e "import('fs').then(f=>console.log(JSON.parse(f.readFileSync('package.json','utf8')).version)).catch(()=>console.log('unknown'))"`
**Registered servers:**
!`kastell list 2>/dev/null || echo "No servers registered"`

## Architecture File Map

```
src/
  commands/     # 31 thin CLI wrappers (parse args + delegate only)
  core/         # Business logic (ALL computation here)
  providers/    # Cloud API: hetzner, digitalocean, vultr, linode
  adapters/     # Platform abstraction: coolify, dokploy
    interface.ts  # PlatformAdapter contract
    factory.ts    # getAdapter(), detectPlatform(), resolvePlatform()
  mcp/
    server.ts     # 13 tool registrations
    tools/        # Handler files (Zod schema + handler per tool)
  utils/        # ssh, config, cloudInit, modeGuard, migration
  types/        # ServerMode, ServerRecord, Platform
  constants.ts  # PROVIDER_REGISTRY (single source of truth)
  index.ts      # CLI entry point
```

## Layer Rules

| Layer    | Path            | Responsibility                          | Rule                        |
|----------|-----------------|-----------------------------------------|-----------------------------|
| Commands | src/commands/   | Parse CLI args, call core, display output | ZERO business logic        |
| Core     | src/core/       | All business logic, orchestration       | No UI/chalk/ora imports     |
| Providers| src/providers/  | Cloud API calls per provider            | Implements cloud CRUD       |
| Adapters | src/adapters/   | Platform-specific ops (Coolify/Dokploy) | Via PlatformAdapter interface |
| MCP      | src/mcp/        | MCP server + tool handlers              | Delegates to core           |
| Utils    | src/utils/      | SSH, config, modeGuard, errorMapper     | Shared infrastructure       |

## Adapter Contract

Access adapters via `getAdapter(platform)` from `src/adapters/factory.ts`. Never import `CoolifyAdapter` or `DokployAdapter` directly in commands.

```typescript
interface PlatformAdapter {
  readonly name: string;              // "coolify" | "dokploy"
  readonly port: number;              // 8000 (Coolify) | 3000 (Dokploy)
  readonly defaultLogService: string; // matches platform name
  readonly platformPorts: readonly number[]; // ports protected from firewall removal
  getCloudInit(serverName: string): string;
  healthCheck(ip: string, domain?: string): Promise<HealthResult>;
  createBackup(ip: string, serverName: string, provider: string): Promise<PlatformBackupResult>;
  getStatus(ip: string): Promise<PlatformStatusResult>;
  update(ip: string): Promise<UpdateResult>;
  restoreBackup?(ip, backupPath, manifest): Promise<PlatformRestoreResult>; // optional
}
```

**Factory exports:** `getAdapter(platform)`, `detectPlatform(ip)`, `resolvePlatform(server)`

## Provider Registry

| Provider     | Env Key             | Display Name     |
|--------------|---------------------|------------------|
| hetzner      | HETZNER_TOKEN       | Hetzner Cloud    |
| digitalocean | DIGITALOCEAN_TOKEN  | DigitalOcean     |
| vultr        | VULTR_TOKEN         | Vultr            |
| linode       | LINODE_TOKEN        | Linode (Akamai)  |

`PROVIDER_REGISTRY` in `src/constants.ts` is the single source of truth for providers.

## What Do I Want to Add?

### New CLI command
1. `src/commands/<name>.ts` — thin wrapper (parse + delegate, no logic)
2. `src/core/<name>.ts` — all business logic here
3. `src/index.ts` — register with `program`
4. `src/__tests__/` — test core, not command

### New audit check
1. `src/core/audit/<category>/` — add to existing category
2. Update check catalog in `src/core/audit/catalog.ts`
3. No new command file needed — runs through `kastell audit`

### New provider
1. `src/providers/<name>.ts` — implements base.ts contract
2. `src/constants.ts` — add to PROVIDER_REGISTRY
3. No adapter changes — providers handle cloud API only

### New MCP tool
1. `src/mcp/tools/server<Name>.ts` — Zod schema + handler
2. `src/mcp/server.ts` — import + `registerTool()`
3. Annotations: `readOnlyHint` / `destructiveHint` / `idempotentHint`

## Key Conventions

- ESM project (`"type": "module"`) — `import`, not `require`
- `KASTELL_SAFE_MODE` + `isSafeMode()` = destructive operation guard
- `assertValidIp()` before every SSH operation
- `sanitizedEnv` for subprocess calls
- `sanitizeResponseData()` whitelist approach for API error responses
- Config dir: `~/.kastell/` (auto-migrated from `~/.quicklify/`)
- `PROVIDER_REGISTRY` = single source of truth for providers
- `withProviderErrorHandling` HOF for consistent provider error handling
- `describe.each` with `jest.resetAllMocks()` (not `clearAllMocks()`)

## Reference Files

- 31 CLI commands — see [references/commands.md](references/commands.md)
- 13 MCP tools — see [references/mcp-tools.md](references/mcp-tools.md)
- Patterns and test templates — see [references/patterns.md](references/patterns.md)
- Known pitfalls — see [references/pitfalls.md](references/pitfalls.md)
