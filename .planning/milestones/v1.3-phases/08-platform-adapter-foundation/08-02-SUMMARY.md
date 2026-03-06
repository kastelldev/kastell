---
phase: 08-platform-adapter-foundation
plan: 02
subsystem: adapters
tags: [adapter-routing, factory-pattern, platform-field, managed-mode, core-wiring]

# Dependency graph
requires:
  - phase: 08-platform-adapter-foundation
    plan: 01
    provides: PlatformAdapter interface, CoolifyAdapter, factory, resolvePlatform, requireManagedMode
provides:
  - Core modules (deploy, provision, status, backup) routed through adapter factory
  - Platform field persisted on new server records
  - All requireCoolifyMode call sites migrated to requireManagedMode
affects: [09-dokploy-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns: [adapter-routing-in-core, platform-field-persistence, managed-mode-guard]

key-files:
  created: []
  modified:
    - src/core/deploy.ts
    - src/core/provision.ts
    - src/core/status.ts
    - src/core/backup.ts
    - src/commands/domain.ts
    - src/commands/maintain.ts
    - src/commands/update.ts
    - src/mcp/tools/serverMaintain.ts
    - src/mcp/tools/serverSecure.ts
    - tests/unit/provision-bare.test.ts

key-decisions:
  - "deploy.ts and provision.ts derive platform from mode at call site, not inside adapter"
  - "backup.ts createBackup delegates entirely to CoolifyAdapter, keeping all other exports for backward compat"
  - "status.ts uses resolvePlatform + getAdapter for health check routing"
  - "All 5 requireCoolifyMode call sites switched to requireManagedMode (same behavior, clearer intent)"
  - "provision-bare tests updated to assert on adapter path instead of getCoolifyCloudInit mock"

patterns-established:
  - "Core adapter routing: platform = resolvePlatform(server) or derive from mode, then getAdapter(platform).method()"
  - "Platform field persistence: new server records include platform alongside deprecated mode"
  - "Managed mode guard: requireManagedMode used at all command/MCP entry points"

requirements-completed: [ADAPT-05, ADAPT-07]

# Metrics
duration: 7min
completed: 2026-03-06
---

# Phase 8 Plan 02: Core Routing Summary

**Core modules (deploy, provision, status, backup) routed through adapter factory with platform field persistence and requireManagedMode at all 5 command/MCP call sites**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-06T06:33:35Z
- **Completed:** 2026-03-06T06:40:47Z
- **Tasks:** 2
- **Files modified:** 10 (9 source + 1 test)

## Accomplishments
- deploy.ts and provision.ts route cloud-init through getAdapter(platform).getCloudInit() for managed servers, getBareCloudInit() for bare
- status.ts routes health check through getAdapter(platform).healthCheck() via resolvePlatform
- backup.ts createBackup is now a thin wrapper delegating to CoolifyAdapter.createBackup()
- New server records from deploy and provision include the platform field
- All 5 requireCoolifyMode call sites (domain, maintain, update, serverMaintain, serverSecure) switched to requireManagedMode
- Full test suite 2165 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Route core modules through adapter (deploy, provision, status, backup)** - `d071221` (feat)
2. **Task 2: Switch requireCoolifyMode call sites to requireManagedMode** - `7332c3a` (feat)

## Files Created/Modified
- `src/core/deploy.ts` - getAdapter(platform).getCloudInit() for managed servers, platform field in saveServer
- `src/core/provision.ts` - getAdapter(platform).getCloudInit() for managed servers, platform field in server record
- `src/core/status.ts` - resolvePlatform + getAdapter(platform).healthCheck() for health checks
- `src/core/backup.ts` - createBackup delegates to CoolifyAdapter.createBackup(), all other exports preserved
- `src/commands/domain.ts` - requireManagedMode(server, "domain")
- `src/commands/maintain.ts` - requireManagedMode(server, "maintain")
- `src/commands/update.ts` - requireManagedMode(server, "update")
- `src/mcp/tools/serverMaintain.ts` - requireManagedMode for update and maintain actions
- `src/mcp/tools/serverSecure.ts` - requireManagedMode for domain actions
- `tests/unit/provision-bare.test.ts` - Updated to assert on adapter path instead of getCoolifyCloudInit

## Decisions Made
- deploy.ts and provision.ts derive platform from mode at the call site (bare = undefined, coolify = "coolify") rather than relying on resolvePlatform for new servers
- backup.ts createBackup becomes a thin wrapper while keeping all other exports (buildPgDumpCommand, buildConfigTarCommand, etc.) for backward compat via commands/backup.ts re-exports
- status.ts uses resolvePlatform for existing server records (handles legacy mode normalization) while deploy/provision use explicit platform derivation for new records
- provision-bare tests updated to mock adapter factory and verify getAdapter("coolify").getCloudInit() path

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated provision-bare tests for adapter path**
- **Found during:** Task 1 (core module routing)
- **Issue:** Tests asserted getCoolifyCloudInit was called, but provision.ts now uses getAdapter("coolify").getCloudInit()
- **Fix:** Added adapter factory mock, updated test assertions to verify adapter routing
- **Files modified:** tests/unit/provision-bare.test.ts
- **Verification:** All 6 provision-bare tests pass
- **Committed in:** d071221 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 test update for changed routing)
**Impact on plan:** Necessary test update for code change. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 8 fully complete: adapter layer built (Plan 01) and integrated (Plan 02)
- All platform-specific operations flow through the adapter pattern
- Phase 9 (Dokploy) only needs: DokployAdapter class + factory case + tests
- Zero requireCoolifyMode references in commands/mcp (only modeGuard retains backward compat alias)
- All existing functionality preserved with zero behavior change

## Self-Check: PASSED

All 10 modified files verified present. Both task commits (d071221, 7332c3a) verified in git history. Build, lint, and full test suite (2165 tests) all passing.

---
*Phase: 08-platform-adapter-foundation*
*Completed: 2026-03-06*
