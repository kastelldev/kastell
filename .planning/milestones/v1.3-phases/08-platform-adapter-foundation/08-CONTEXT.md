# Phase 8: Platform Adapter Foundation - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract existing Coolify-specific logic into a `PlatformAdapter` interface and `CoolifyAdapter` implementation. Introduce `platform` field on `ServerRecord`, factory function for adapter resolution, and platform-aware mode guards. Zero user-facing behavior change. bare mode is NOT an adapter — it remains a separate code path representing "no platform installed."

Dokploy adapter implementation is Phase 9 — this phase only builds the abstraction layer and extracts Coolify into it.

</domain>

<decisions>
## Implementation Decisions

### Mode vs Platform Separation
- `platform` is a NEW optional field on `ServerRecord`: `platform?: "coolify" | "dokploy"`
- `platform` determines which adapter to use — bare servers have NO platform (undefined)
- bare is NOT a platform and NOT an adapter — it is the absence of a platform ("no managed platform installed")
- Existing `mode` field (`ServerMode = "coolify" | "bare"`) becomes deprecated but continues to be read for backward compat
- Adapter pattern is for platform abstraction (Coolify, Dokploy), NOT for mode expansion (confirmed PROJECT.md decision)
- `requireCoolifyMode()` evolves to `requireManagedMode()` — checks if `platform` exists (works for both coolify and future dokploy)

### Adapter Interface Scope
- 4 methods matching ADAPT-01 requirements:
  - `getCloudInit(serverName: string): string`
  - `healthCheck(ip: string): Promise<HealthResult>`
  - `createBackup(ip: string, serverName: string, provider: string): Promise<BackupResult>`
  - `getStatus(ip: string): Promise<StatusResult>`
- `restore` is NOT in scope — Dokploy restore deferred to v1.5 (existing Coolify restore stays in backup.ts for now)
- `waitForReady` (currently `waitForCoolify`) is optional for Phase 8 — can stay as utility or move to adapter later
- Internal helpers (buildPgDumpCommand, buildCoolifyVersionCommand, etc.) become CoolifyAdapter private methods
- Bare-specific functions (createBareBackup, restoreBareBackup, getBareCloudInit) stay where they are — NOT in an adapter

### Backward Compatibility Strategy
- NO servers.json migration — runtime normalization only
- `resolvePlatform(server)` function derives platform from existing data:
  - If `server.platform` exists: use it directly
  - If `server.mode === "bare"`: return undefined (no platform)
  - If `server.mode === "coolify"` or mode is missing: return `"coolify"` (default)
- New server records are saved WITH `platform` field going forward
- Old server records without `platform` field continue to work via normalization
- Same pattern as Phase 7 backward compat (KASTELL_SAFE_MODE primary, QUICKLIFY_SAFE_MODE fallback with deprecation)

### Factory & Routing Mechanism
- Simple factory function, NOT dependency injection — avoids over-engineering
- `getAdapter(platform: string): PlatformAdapter` — switch/case, throws on unknown platform
- Factory lives in `src/adapters/factory.ts`
- Core modules use: `const platform = resolvePlatform(server); if (platform) { getAdapter(platform).method() } else { bareLogic() }`
- Adapters are stateless — no constructor state, just command generators + HTTP calls
- Test mocking: mock the factory or import adapter directly — no DI container needed

### Claude's Discretion
- Exact file placement for adapter interface and implementations (proposed: `src/adapters/`)
- Whether to keep `ServerMode` type or fully replace with platform-based checks
- Internal refactoring order (types first vs core modules first)
- HealthResult / StatusResult type definitions for adapter methods
- Whether `waitForCoolify` moves into CoolifyAdapter or stays as utility

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/utils/modeGuard.ts`: `getServerMode()`, `isBareServer()`, `requireCoolifyMode()` — evolves to platform-aware guards
- `src/utils/cloudInit.ts`: `getCoolifyCloudInit()`, `getBareCloudInit()` — Coolify version moves to adapter
- `src/utils/healthCheck.ts`: `waitForCoolify()` — Coolify health polling, candidate for adapter method
- `src/core/backup.ts`: Full Coolify backup/restore logic + separate bare backup/restore — Coolify portion extracts to adapter
- `src/core/status.ts`: `checkCoolifyHealth()` port 8000 hard-coded — moves to CoolifyAdapter
- `src/core/deploy.ts`: `deployServer()` line 65 — `isBare ? getBareCloudInit() : getCoolifyCloudInit()` — adapter routing point

### Established Patterns
- Commands (thin) -> Core (logic) -> Providers (plugin) — adapters slot between Core and platform-specific logic
- `PROVIDER_REGISTRY` in constants.ts = single source of truth pattern — same approach for platform registry if needed
- `KastellResult<T>` return pattern in core/ — adapter methods should follow same pattern
- `assertValidIp()` before SSH — existing security pattern, adapters must maintain this
- `sanitizedEnv()` for subprocess — adapters that spawn processes must use this

### Integration Points
- `src/types/index.ts`: `ServerRecord` gains `platform?` field, `BackupManifest` may gain platform field
- `src/utils/config.ts`: `saveServer()` — needs to persist `platform` on new records
- `src/core/deploy.ts`: Primary consumer — cloudInit selection routes through adapter
- `src/core/status.ts`: Health check routes through adapter for managed servers
- `src/core/backup.ts`: Backup creation routes through adapter for managed servers
- `src/mcp/tools/`: 7 MCP tools — mode checks evolve to platform checks
- `src/commands/`: 23 CLI commands — thin wrappers, minimal changes expected

</code_context>

<specifics>
## Specific Ideas

- "Adapter = platform (Coolify, Dokploy). bare bir adapter degil, platform yoklugu."
- Mevcut bare-specific kodlar (createBareBackup, getBareCloudInit vb.) oldugu yerde kaliyor — adapter'a tasinmiyor
- Phase 7'deki backward compat pattern'i referans: otomatik default + deprecation uyarisi + runtime normalization
- `resolvePlatform()` normalization fonksiyonu `getServers()` icinde veya config okuma noktasinda calisir
- Sifir davranis degisikligi hedefi: tum 2115 test degisiklik sonrasi da gecmeli

</specifics>

<deferred>
## Deferred Ideas

- Dokploy restore — v1.5 (REQUIREMENTS.md DOKP-F01)
- `waitForReady` adapter metodu olarak eklenmesi — Phase 8 sonrasi degerlendirilir
- Platform auto-detection (sunucuda Coolify/Dokploy otomatik algilama) — v1.5 (DOKP-F04)
- Platform registry constant (PLATFORM_REGISTRY) — gerekirse Phase 9'da

</deferred>

---

*Phase: 08-platform-adapter-foundation*
*Context gathered: 2026-03-06*
