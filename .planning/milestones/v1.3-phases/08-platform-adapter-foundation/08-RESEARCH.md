# Phase 8: Platform Adapter Foundation - Research

**Researched:** 2026-03-06
**Domain:** TypeScript adapter pattern / refactoring extraction
**Confidence:** HIGH

## Summary

Phase 8 is a pure refactoring phase: extract existing Coolify-specific logic into a `PlatformAdapter` interface and `CoolifyAdapter` implementation, introduce a `platform` field on `ServerRecord`, create a factory function, and make mode guards platform-aware. The critical constraint is zero behavior change -- all 2115 existing tests must continue to pass.

This is NOT a greenfield implementation. Every line of adapter code already exists in the codebase -- it just needs to be moved behind an interface. The pattern closely mirrors the existing `CloudProvider` interface in `src/providers/base.ts`, which is a proven plugin pattern in this project. The main risk is breaking existing imports/call sites during extraction.

**Primary recommendation:** Follow the existing `CloudProvider` interface pattern. Define `PlatformAdapter` with 4 methods, extract Coolify logic into `CoolifyAdapter`, add `resolvePlatform()` normalization, and route core modules through the factory. Keep bare-specific code where it is -- bare is NOT an adapter.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- `platform` is a NEW optional field on `ServerRecord`: `platform?: "coolify" | "dokploy"`
- `platform` determines which adapter to use -- bare servers have NO platform (undefined)
- bare is NOT a platform and NOT an adapter -- it is the absence of a platform ("no managed platform installed")
- Existing `mode` field (`ServerMode = "coolify" | "bare"`) becomes deprecated but continues to be read for backward compat
- Adapter pattern is for platform abstraction (Coolify, Dokploy), NOT for mode expansion
- `requireCoolifyMode()` evolves to `requireManagedMode()` -- checks if `platform` exists (works for both coolify and future dokploy)
- 4 methods: `getCloudInit(serverName)`, `healthCheck(ip)`, `createBackup(ip, serverName, provider)`, `getStatus(ip)`
- `restore` is NOT in scope -- deferred to v1.5
- `waitForReady` (currently `waitForCoolify`) is optional for Phase 8
- Internal helpers (buildPgDumpCommand, buildCoolifyVersionCommand, etc.) become CoolifyAdapter private methods
- Bare-specific functions stay where they are -- NOT in an adapter
- NO servers.json migration -- runtime normalization only
- `resolvePlatform(server)` derives platform from existing data
- Simple factory function, NOT dependency injection
- `getAdapter(platform)` -- switch/case, throws on unknown platform
- Factory lives in `src/adapters/factory.ts`
- Adapters are stateless -- no constructor state
- Core modules use: `if (platform) { getAdapter(platform).method() } else { bareLogic() }`

### Claude's Discretion
- Exact file placement for adapter interface and implementations (proposed: `src/adapters/`)
- Whether to keep `ServerMode` type or fully replace with platform-based checks
- Internal refactoring order (types first vs core modules first)
- HealthResult / StatusResult type definitions for adapter methods
- Whether `waitForCoolify` moves into CoolifyAdapter or stays as utility

### Deferred Ideas (OUT OF SCOPE)
- Dokploy restore -- v1.5 (REQUIREMENTS.md DOKP-F01)
- `waitForReady` adapter method -- Phase 8 sonrasi
- Platform auto-detection -- v1.5 (DOKP-F04)
- Platform registry constant (PLATFORM_REGISTRY) -- Phase 9

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ADAPT-01 | `PlatformAdapter` interface with cloudInit, healthCheck, backup, status methods | Interface design section below; follows CloudProvider pattern from `src/providers/base.ts` |
| ADAPT-02 | `CoolifyAdapter` extracted from existing logic, zero behavior change | Extraction map section identifies every source function and its target location |
| ADAPT-03 | `ServerRecord` gains `platform` field, backward compat preserved | Type changes section; `resolvePlatform()` normalization pattern |
| ADAPT-04 | `getAdapter(platform)` factory function | Factory pattern section; simple switch/case in `src/adapters/factory.ts` |
| ADAPT-05 | `core/deploy.ts`, `core/status.ts`, `core/backup.ts` route through adapter | Routing map section identifies all 3 integration points |
| ADAPT-06 | `modeGuard.ts` becomes platform-aware (`requireManagedMode()`) | Mode guard evolution section; backward compat via `resolvePlatform()` |
| ADAPT-07 | All 2115 existing tests pass with zero regressions | Test strategy section; verified baseline is 80 suites, 2115 tests |

</phase_requirements>

## Standard Stack

### Core (no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ES2022, strict | Language | Already in project |
| Jest | existing | Test framework | Already in project, 2115 tests |

No new npm dependencies needed. This phase is pure refactoring of existing code into a new organizational pattern.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Simple factory function | DI container (tsyringe, inversify) | Over-engineering for 2 adapters; user explicitly rejected DI |
| Interface-based polymorphism | Abstract base class | Interface is lighter, no runtime overhead, matches CloudProvider pattern |
| Runtime normalization | servers.json migration script | Migration is fragile, normalization is safe; user explicitly chose no migration |

## Architecture Patterns

### Recommended File Structure
```
src/adapters/
  interface.ts        # PlatformAdapter interface + result types
  factory.ts          # getAdapter(platform) factory + resolvePlatform()
  coolify.ts          # CoolifyAdapter implementing PlatformAdapter
```

### Pattern 1: PlatformAdapter Interface

**What:** TypeScript interface defining the 4 platform-specific operations.
**When to use:** Any platform that can be managed by Kastell (Coolify now, Dokploy Phase 9).
**Why this structure:** Mirrors existing `CloudProvider` interface in `src/providers/base.ts` which has proven successful.

```typescript
// src/adapters/interface.ts

export interface HealthResult {
  status: "running" | "not reachable";
}

export interface PlatformStatusResult {
  platformVersion: string;
  status: "running" | "not reachable";
}

export interface PlatformBackupResult {
  success: boolean;
  backupPath?: string;
  manifest?: import("../types/index.js").BackupManifest;
  error?: string;
  hint?: string;
}

export interface PlatformAdapter {
  readonly name: string;
  getCloudInit(serverName: string): string;
  healthCheck(ip: string): Promise<HealthResult>;
  createBackup(ip: string, serverName: string, provider: string): Promise<PlatformBackupResult>;
  getStatus(ip: string): Promise<PlatformStatusResult>;
}
```

**Design decisions:**
- `getCloudInit` is synchronous (returns string) -- matches existing `getCoolifyCloudInit()` signature
- `healthCheck` returns `HealthResult` not raw string -- structured for future Dokploy which uses API key auth
- `createBackup` matches existing `BackupResult` from `core/backup.ts` -- reuse the type
- `getStatus` is separate from `healthCheck` to allow richer status info (version detection)
- `readonly name` for identification (e.g., "coolify", "dokploy")

### Pattern 2: Factory Function

**What:** Simple switch/case factory returning the correct adapter for a platform string.
**When to use:** Wherever core modules need platform-specific behavior.

```typescript
// src/adapters/factory.ts
import type { PlatformAdapter } from "./interface.js";
import type { ServerRecord, ServerMode } from "../types/index.js";
import { CoolifyAdapter } from "./coolify.js";

export type Platform = "coolify" | "dokploy";

export function getAdapter(platform: Platform): PlatformAdapter {
  switch (platform) {
    case "coolify":
      return new CoolifyAdapter();
    // case "dokploy": Phase 9
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

export function resolvePlatform(server: ServerRecord): Platform | undefined {
  if (server.platform) return server.platform;
  if (server.mode === "bare") return undefined;
  return "coolify"; // default for legacy records
}
```

**Design decisions:**
- `resolvePlatform` returns `undefined` for bare servers -- bare has no adapter
- Default to "coolify" for legacy records without `platform` field (matches existing `getServerMode` behavior)
- Factory creates new adapter instance each call -- stateless, no caching needed
- `Platform` type is a simple union, not an enum -- matches project style

### Pattern 3: Core Module Routing

**What:** How core modules decide between adapter and bare code paths.
**When to use:** In `core/deploy.ts`, `core/status.ts`, `core/backup.ts`.

```typescript
// Pattern used in core modules
import { getAdapter, resolvePlatform } from "../adapters/factory.js";

// In a core function that needs platform-specific behavior:
const platform = resolvePlatform(server);
if (platform) {
  const adapter = getAdapter(platform);
  const result = await adapter.createBackup(ip, serverName, provider);
} else {
  // bare server -- use existing bare-specific code
  const result = await createBareBackup(ip, serverName, provider);
}
```

### Pattern 4: Mode Guard Evolution

**What:** `requireCoolifyMode()` becomes `requireManagedMode()` with backward compat.
**When to use:** Commands that require a managed platform (update, maintain, domain, etc.).

```typescript
// src/utils/modeGuard.ts - evolved
import { resolvePlatform } from "../adapters/factory.js";

export function requireManagedMode(server: ServerRecord, commandName: string): string | null {
  const platform = resolvePlatform(server);
  if (!platform) {
    return `The "${commandName}" command is not available for bare servers. This command requires a managed platform (Coolify or Dokploy).`;
  }
  return null;
}

// Keep old function for backward compat during transition
export function requireCoolifyMode(server: ServerRecord, commandName: string): string | null {
  return requireManagedMode(server, commandName);
}
```

### Anti-Patterns to Avoid
- **BareAdapter class:** bare is NOT a platform. Creating a BareAdapter violates the project decision and adds unnecessary abstraction. Bare-specific code stays in its current locations.
- **Moving restore to adapter:** Restore is explicitly deferred to v1.5. CoolifyAdapter does NOT implement restore.
- **Breaking existing function signatures:** `createBackup()` in `core/backup.ts` must continue to work as-is during the transition. The adapter wraps it, doesn't replace it.
- **Circular imports:** `modeGuard.ts` will import from `adapters/factory.ts` -- ensure `factory.ts` does NOT import from `modeGuard.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Platform resolution | Custom logic in every core module | `resolvePlatform(server)` centralized | Single source of truth, avoids inconsistent behavior |
| Adapter instantiation | Direct `new CoolifyAdapter()` in core modules | `getAdapter(platform)` factory | Future extensibility for Dokploy without touching core modules |
| ServerRecord normalization | Migration script modifying servers.json | Runtime normalization in `getServers()` + `resolvePlatform()` | Non-destructive, handles all edge cases |
| Backward compat for mode | Conditional checks scattered everywhere | `resolvePlatform()` as single normalization point | Already proven pattern from Phase 7 (env var fallback) |

**Key insight:** Every piece of adapter logic already exists in the codebase. This phase is extraction and reorganization, not new feature development. The risk is in breaking existing call chains, not in writing new logic.

## Extraction Map: Existing Code to CoolifyAdapter

This is the critical reference for the planner. Each row identifies source code that moves into `CoolifyAdapter`.

| Current Location | Function/Code | Adapter Method | Notes |
|------------------|---------------|----------------|-------|
| `src/utils/cloudInit.ts:64-133` | `getCoolifyCloudInit(serverName)` | `getCloudInit(serverName)` | Move body to adapter; keep original as thin wrapper calling adapter (or remove if unused) |
| `src/core/status.ts:15-26` | `checkCoolifyHealth(ip)` | `healthCheck(ip)` | Port 8000 check; adapter returns `HealthResult` |
| `src/core/backup.ts:364-441` | `createBackup(ip, serverName, provider)` | `createBackup(ip, serverName, provider)` | Full Coolify backup flow including pg_dump + config tar |
| `src/core/backup.ts:20-33` | `buildPgDumpCommand()`, `buildConfigTarCommand()`, etc. | Private methods in CoolifyAdapter | These become implementation details of CoolifyAdapter |
| `src/core/backup.ts:32-33` | `buildCoolifyVersionCommand()` | Private method or part of `getStatus()` | Used by both backup and status |
| `src/core/status.ts:15-26` | `checkCoolifyHealth()` port 8000 HTTP check | `getStatus(ip)` | Returns platform version + health status |

### Code That Does NOT Move
| Location | Function | Reason |
|----------|----------|--------|
| `src/utils/cloudInit.ts:1-62` | `getBareCloudInit()` | Bare is not an adapter |
| `src/core/backup.ts:217-271` | `createBareBackup()` | Bare-specific, stays in core |
| `src/core/backup.ts:273-333` | `restoreBareBackup()` | Bare-specific, stays in core |
| `src/core/backup.ts:443-565` | `restoreBackup()` | Restore deferred to v1.5 |
| `src/core/backup.ts:60-107` | `listBackups()`, `loadManifest()`, etc. | Shared utilities, not platform-specific |
| `src/core/backup.ts:125-189` | `scpDownload()`, `scpUpload()` | Shared SSH utilities, adapter calls them |
| `src/utils/healthCheck.ts` | `waitForCoolify()` | Optional move; decision is Claude's discretion |

## Type Changes

### ServerRecord Evolution
```typescript
// src/types/index.ts
export type Platform = "coolify" | "dokploy";

export interface ServerRecord {
  id: string;
  name: string;
  provider: string;
  ip: string;
  region: string;
  size: string;
  createdAt: string;
  mode?: ServerMode;       // DEPRECATED but kept for backward compat
  platform?: Platform;     // NEW - undefined = bare (no platform)
}
```

### ServerMode Recommendation (Claude's Discretion Decision)
**Recommendation: Keep `ServerMode` type.** Reason: Removing it would break backward compat for existing code that reads `mode` from servers.json. The `resolvePlatform()` function bridges the gap. Mark `mode` as `@deprecated` in JSDoc.

### BackupManifest Evolution
```typescript
export interface BackupManifest {
  serverName: string;
  provider: string;
  timestamp: string;
  coolifyVersion: string;  // Keep for now -- "n/a" for bare, version string for Coolify
  files: string[];
  mode?: ServerMode;
  platform?: Platform;     // NEW - added to manifests going forward
}
```

### DeploymentConfig Evolution
```typescript
export interface DeploymentConfig {
  provider: string;
  apiToken: string;
  region: string;
  serverSize: string;
  serverName: string;
  mode?: ServerMode;       // Keep for backward compat
  platform?: Platform;     // NEW
}
```

## config.ts Changes

### getServers() Normalization
```typescript
export function getServers(): ServerRecord[] {
  // ... existing code ...
  return parsed.map((s: ServerRecord) => ({
    ...s,
    mode: s.mode || "coolify",
    // platform is NOT defaulted here -- resolvePlatform() handles derivation
    // This keeps servers.json unchanged
  }));
}
```

**Important:** `getServers()` should NOT add a default `platform` field. The `resolvePlatform()` function handles derivation at usage sites. This keeps the data layer clean and non-mutating.

### saveServer() Platform Persistence
```typescript
export function saveServer(record: ServerRecord): void {
  // Existing code works as-is
  // New records will have `platform` field when callers provide it
  // Old records without platform continue to work via resolvePlatform()
}
```

## Integration Points: Where Core Modules Change

### 1. core/deploy.ts (Line 64-65)
**Current:**
```typescript
const isBare = mode === "bare";
const cloudInit = isBare ? getBareCloudInit(serverName) : getCoolifyCloudInit(serverName);
```
**After:**
```typescript
const platform = mode === "bare" ? undefined : "coolify" as Platform;
const cloudInit = platform
  ? getAdapter(platform).getCloudInit(serverName)
  : getBareCloudInit(serverName);
```
**Also:** `saveServer()` call at line 204-213 should include `platform` field.

### 2. core/status.ts (Line 45)
**Current:**
```typescript
const coolifyStatus = isBareServer(server) ? "n/a" : await checkCoolifyHealth(server.ip);
```
**After:**
```typescript
const platform = resolvePlatform(server);
const coolifyStatus = platform
  ? (await getAdapter(platform).healthCheck(server.ip)).status
  : "n/a";
```

### 3. core/backup.ts (createBackup function, line 364)
**Current:** `createBackup()` is directly Coolify-specific.
**After:** The existing `createBackup()` function body moves into `CoolifyAdapter.createBackup()`. The original function can either:
- (a) Become a thin wrapper calling the adapter, OR
- (b) Be replaced at call sites with adapter calls
**Recommendation:** Option (a) -- keep `createBackup()` as a wrapper for backward compat. Commands and MCP tools that call it directly continue to work.

### 4. core/provision.ts (Lines 126-129)
**Current:**
```typescript
const cloudInit = mode === "bare"
  ? getBareCloudInit(config.name)
  : getCoolifyCloudInit(config.name);
```
**After:** Same pattern as deploy.ts -- resolve platform, use adapter for cloudInit.

### 5. All requireCoolifyMode() call sites (5 locations)
- `src/commands/domain.ts:51`
- `src/commands/maintain.ts:314`
- `src/commands/update.ts:128`
- `src/mcp/tools/serverMaintain.ts:61, 153`
- `src/mcp/tools/serverSecure.ts:88`

These should switch to `requireManagedMode()`. If `requireCoolifyMode()` is kept as an alias, they can be updated gradually.

### 6. All isBareServer() call sites (20+ locations)
Most `isBareServer()` calls can remain as-is. The function internally uses `getServerMode()` which works with legacy data. Consider updating the implementation to use `resolvePlatform()`:

```typescript
export function isBareServer(server: ServerRecord): boolean {
  return resolvePlatform(server) === undefined;
}
```

This keeps the API surface identical but uses the new normalization path.

## Common Pitfalls

### Pitfall 1: Circular Imports
**What goes wrong:** `modeGuard.ts` imports from `adapters/factory.ts`, and if `factory.ts` imports from `modeGuard.ts`, TypeScript silently resolves to `undefined`.
**Why it happens:** Both modules deal with server mode/platform concepts.
**How to avoid:** `adapters/factory.ts` must NOT import from `utils/modeGuard.ts`. `resolvePlatform()` lives in `factory.ts` and is self-contained. `modeGuard.ts` imports from `factory.ts`, not vice versa.
**Warning signs:** `TypeError: X is not a function` at runtime with no compile error.

### Pitfall 2: Breaking Re-exports
**What goes wrong:** `commands/backup.ts` re-exports functions from `core/backup.ts` (lines 26-37). If those functions move to `CoolifyAdapter`, the re-exports break.
**Why it happens:** The command module has `export { formatTimestamp, getBackupDir, ... }` for backward compatibility.
**How to avoid:** Keep shared utility functions (formatTimestamp, getBackupDir, listBackups, scpDownload, etc.) in `core/backup.ts`. Only move Coolify-specific logic (createBackup body, build*Command functions) to the adapter.
**Warning signs:** Import errors in test files or command files.

### Pitfall 3: Test Mock Breakage
**What goes wrong:** Tests mock `core/backup.ts` functions. If those functions move or change signatures, mocks break silently.
**Why it happens:** Jest mocks are path-based. Moving code changes import paths.
**How to avoid:** Keep `core/backup.ts` exports stable. If `createBackup` becomes a thin wrapper, tests that mock it continue to work. New adapter tests should test `CoolifyAdapter` directly.
**Warning signs:** Tests pass but don't actually test the adapter (false positives).

### Pitfall 4: Forgetting platform in saveServer Calls
**What goes wrong:** New server records saved without `platform` field, creating inconsistent data.
**Why it happens:** `saveServer()` callers in deploy.ts (line 204) and provision.ts (line 203) currently save `mode` but not `platform`.
**How to avoid:** Update both `deployServer()` and `provisionServer()` to include `platform` in the record. Use: `platform: isBare ? undefined : "coolify"`.
**Warning signs:** New servers show as platform=undefined when they should be "coolify".

### Pitfall 5: checkCoolifyHealth Reuse
**What goes wrong:** `checkCoolifyHealth()` is called directly from 5 locations outside `core/status.ts`. Moving it entirely into the adapter breaks those direct calls.
**Why it happens:** Multiple modules import and use this function directly.
**How to avoid:** Keep `checkCoolifyHealth()` as a public export from `core/status.ts` that delegates to the adapter internally. Or, keep it as-is and have the adapter call it.
**Warning signs:** Import errors in `commands/health.ts`, `commands/status.ts`, `core/maintain.ts`, MCP tools.

### Pitfall 6: ESM Import Extensions
**What goes wrong:** Forgetting `.js` extension in new import statements.
**Why it happens:** Project uses ESM (`"type": "module"`) which requires file extensions.
**How to avoid:** All imports must use `.js` suffix: `import { CoolifyAdapter } from "./coolify.js"`.
**Warning signs:** `ERR_MODULE_NOT_FOUND` at runtime, TypeScript compiles fine.

## Refactoring Order (Recommended)

Based on dependency analysis, the safest order is:

1. **Types first:** Add `Platform` type and `platform?` field to `ServerRecord` in `src/types/index.ts`. Non-breaking addition.
2. **Interface:** Create `src/adapters/interface.ts` with `PlatformAdapter` and result types. No imports from existing code.
3. **CoolifyAdapter:** Create `src/adapters/coolify.ts` extracting logic from existing modules. At this point, existing code is DUPLICATED (adapter + original).
4. **Factory:** Create `src/adapters/factory.ts` with `getAdapter()` and `resolvePlatform()`.
5. **modeGuard evolution:** Update `src/utils/modeGuard.ts` to add `requireManagedMode()` using `resolvePlatform()`.
6. **Core routing:** Update `core/deploy.ts`, `core/status.ts`, `core/backup.ts`, `core/provision.ts` to route through adapter.
7. **Tests:** Add adapter-specific tests. Run full suite after each step.
8. **Cleanup:** Remove duplicated code from original locations (only after adapter routing is verified).

**Critical rule:** At every step, ALL 2115 tests must pass. If a step breaks tests, fix before proceeding.

## Code Examples

### CoolifyAdapter Implementation Sketch

```typescript
// src/adapters/coolify.ts
import axios from "axios";
import type { PlatformAdapter, HealthResult, PlatformStatusResult, PlatformBackupResult } from "./interface.js";
import { assertValidIp } from "../utils/ssh.js";
import { sshExec } from "../utils/ssh.js";
import {
  formatTimestamp,
  getBackupDir,
  scpDownload,
} from "../core/backup.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { BackupManifest } from "../types/index.js";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../utils/errorMapper.js";

export class CoolifyAdapter implements PlatformAdapter {
  readonly name = "coolify";

  getCloudInit(serverName: string): string {
    const safeName = serverName.replace(/[^a-z0-9-]/g, "");
    return `#!/bin/bash
set +e
// ... (existing getCoolifyCloudInit body) ...
`;
  }

  async healthCheck(ip: string): Promise<HealthResult> {
    assertValidIp(ip);
    try {
      await axios.get(`http://${ip}:8000`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      return { status: "running" };
    } catch {
      return { status: "not reachable" };
    }
  }

  async createBackup(ip: string, serverName: string, provider: string): Promise<PlatformBackupResult> {
    assertValidIp(ip);
    // ... (existing createBackup body from core/backup.ts) ...
  }

  async getStatus(ip: string): Promise<PlatformStatusResult> {
    assertValidIp(ip);
    const versionResult = await sshExec(ip, this.buildVersionCommand());
    const version = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";
    const health = await this.healthCheck(ip);
    return {
      platformVersion: version,
      status: health.status,
    };
  }

  // Private helpers (moved from core/backup.ts)
  private buildPgDumpCommand(): string {
    return "docker exec coolify-db pg_dump -U coolify -d coolify | gzip > /tmp/coolify-backup.sql.gz";
  }

  private buildConfigTarCommand(): string {
    return "tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml docker-compose.prod.yml 2>/dev/null || tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml";
  }

  private buildCleanupCommand(): string {
    return "rm -f /tmp/coolify-backup.sql.gz /tmp/coolify-config.tar.gz";
  }

  private buildVersionCommand(): string {
    return "docker inspect coolify --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || echo unknown";
  }
}
```

### waitForCoolify Decision (Claude's Discretion)

**Recommendation: Keep `waitForCoolify` in `src/utils/healthCheck.ts` for Phase 8.** Reasons:
1. It has UI concerns (spinner) that don't belong in a stateless adapter
2. It's only called from `core/deploy.ts` during provisioning, not during health checks
3. Moving it adds risk with no benefit for Phase 8
4. Phase 9 can revisit if a `waitForReady` method is needed on the adapter interface

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `mode: "coolify" \| "bare"` | `platform?: "coolify" \| "dokploy"` | Phase 8 | New field, mode deprecated |
| `requireCoolifyMode()` | `requireManagedMode()` | Phase 8 | Works for all platforms |
| Direct Coolify function calls | Adapter pattern dispatch | Phase 8 | Extensible for Dokploy |
| `getCoolifyCloudInit()` direct | `getAdapter(platform).getCloudInit()` | Phase 8 | Platform-agnostic |

**Deprecated after Phase 8:**
- `ServerMode` type -- still works but `Platform` is the new way
- `mode` field on `ServerRecord` -- still read, `platform` is primary
- `requireCoolifyMode()` -- replaced by `requireManagedMode()` (kept as alias)
- `getServerMode()` -- replaced by `resolvePlatform()` (kept for backward compat)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (CJS config: `jest.config.cjs`) |
| Config file | `jest.config.cjs` |
| Quick run command | `npx jest --config jest.config.cjs --silent` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADAPT-01 | PlatformAdapter interface is defined with 4 methods | unit | `npx jest tests/unit/adapter-interface.test.ts -x` | Wave 0 |
| ADAPT-02 | CoolifyAdapter implements all 4 methods correctly | unit | `npx jest tests/unit/coolify-adapter.test.ts -x` | Wave 0 |
| ADAPT-03 | ServerRecord accepts platform field, resolvePlatform works | unit | `npx jest tests/unit/adapter-factory.test.ts -x` | Wave 0 |
| ADAPT-04 | getAdapter returns correct adapter, throws on unknown | unit | `npx jest tests/unit/adapter-factory.test.ts -x` | Wave 0 |
| ADAPT-05 | Core modules route through adapter | unit | `npx jest tests/unit/core-deploy.test.ts tests/unit/core-status.test.ts tests/unit/core-backup.test.ts -x` | Existing (need updates) |
| ADAPT-06 | requireManagedMode works for coolify and dokploy | unit | `npx jest tests/unit/modeGuard.test.ts -x` | Existing (need updates) |
| ADAPT-07 | All 2115 tests pass with zero regressions | full suite | `npm test` | Existing |

### Sampling Rate
- **Per task commit:** `npx jest --config jest.config.cjs --silent`
- **Per wave merge:** `npm test && npm run build && npm run lint`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/adapter-interface.test.ts` -- covers ADAPT-01 (interface type tests)
- [ ] `tests/unit/coolify-adapter.test.ts` -- covers ADAPT-02 (CoolifyAdapter unit tests)
- [ ] `tests/unit/adapter-factory.test.ts` -- covers ADAPT-03, ADAPT-04 (factory + resolvePlatform tests)

*(Existing test files for modeGuard.test.ts, core-status.test.ts, core-backup.test.ts, core-deploy.test.ts will need updates but already exist)*

## Open Questions

1. **Should `checkCoolifyHealth()` remain a public export from `core/status.ts`?**
   - What we know: 5 direct callers outside status.ts (health command, status command, maintain core, 2 MCP tools)
   - What's unclear: Whether to keep it as a wrapper calling adapter, or update all callers
   - Recommendation: Keep as wrapper in Phase 8 (delegates to adapter internally), consider removing in Phase 9

2. **Should commands/backup.ts re-exports be updated?**
   - What we know: Lines 26-37 re-export pure functions from core/backup.ts for backward compat
   - What's unclear: Whether build*Command functions can be removed from public API after moving to adapter private methods
   - Recommendation: Keep re-exports for build*Command in Phase 8. They're used in dry-run output (line 269-273). Remove in Phase 9 if Dokploy adapter doesn't need them.

3. **Should `getServerMode()` and `isBareServer()` be reimplemented using `resolvePlatform()`?**
   - What we know: Both functions are simple (3 lines each) and work with existing data
   - What's unclear: Whether coupling them to `resolvePlatform()` adds value or just risk
   - Recommendation: Reimplement `isBareServer()` to use `resolvePlatform() === undefined`. Keep `getServerMode()` as-is for backward compat. Both produce identical results for all inputs.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all files listed in 08-CONTEXT.md code_context section
- `src/providers/base.ts` -- CloudProvider interface pattern (proven in production)
- `src/utils/modeGuard.ts` -- Current mode guard implementation (3 functions, 17 lines)
- `src/core/backup.ts` -- Full Coolify backup/restore implementation (565 lines)
- `src/core/status.ts` -- Coolify health check implementation (65 lines)
- `src/core/deploy.ts` -- Server deployment with cloud-init routing (379 lines)
- `src/core/provision.ts` -- MCP provision with cloud-init routing (225 lines)
- `src/utils/config.ts` -- Server record persistence (64 lines)
- `src/types/index.ts` -- All type definitions (152 lines)
- Test suite: 80 suites, 2115 tests, all passing (verified 2026-03-06)

### Secondary (MEDIUM confidence)
- Project CLAUDE.md and skills docs for conventions
- Phase 7 backward compat patterns (env var fallback, deprecation warnings)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure refactoring
- Architecture: HIGH -- mirrors existing CloudProvider pattern, all source code analyzed
- Extraction map: HIGH -- every function identified with line numbers
- Pitfalls: HIGH -- based on direct codebase analysis of imports and dependencies
- Type changes: HIGH -- minimal additions, backward compatible

**Research date:** 2026-03-06
**Valid until:** Indefinite (internal refactoring, no external dependencies)
