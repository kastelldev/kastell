---
phase: 08-platform-adapter-foundation
plan: 01
subsystem: adapters
tags: [adapter-pattern, typescript-interface, factory-function, platform-abstraction, coolify]

# Dependency graph
requires:
  - phase: 07-kastell-rebrand
    provides: Kastell brand applied to all source, types, config paths
provides:
  - PlatformAdapter interface with 4 methods (getCloudInit, healthCheck, createBackup, getStatus)
  - CoolifyAdapter implementing PlatformAdapter with exact existing Coolify behavior
  - Factory function (getAdapter) and platform resolution (resolvePlatform)
  - Platform type on ServerRecord, BackupManifest, DeploymentConfig
  - Platform-aware mode guards (requireManagedMode)
affects: [08-02-core-routing, 09-dokploy-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns: [adapter-pattern, factory-function, runtime-normalization, backward-compat-alias]

key-files:
  created:
    - src/adapters/interface.ts
    - src/adapters/coolify.ts
    - src/adapters/factory.ts
    - tests/unit/adapter-interface.test.ts
    - tests/unit/adapter-factory.test.ts
    - tests/unit/coolify-adapter.test.ts
  modified:
    - src/types/index.ts
    - src/utils/modeGuard.ts
    - tests/unit/modeGuard.test.ts

key-decisions:
  - "PlatformAdapter interface uses import type for BackupManifest (avoids circular dependency)"
  - "CoolifyAdapter duplicates existing logic intentionally (Plan 02 will rewire core modules)"
  - "isBareServer reimplemented to use resolvePlatform() for consistent normalization"
  - "requireCoolifyMode kept as backward compat alias calling requireManagedMode"
  - "mode fields marked @deprecated in JSDoc while keeping full backward compat"

patterns-established:
  - "Adapter pattern: PlatformAdapter interface -> CoolifyAdapter/DokployAdapter implementations"
  - "Factory function: getAdapter(platform) with switch/case for platform dispatch"
  - "Platform resolution: resolvePlatform(server) normalizes legacy mode to platform at runtime"
  - "No circular imports: modeGuard imports from factory, factory never imports from modeGuard"

requirements-completed: [ADAPT-01, ADAPT-02, ADAPT-03, ADAPT-04, ADAPT-06]

# Metrics
duration: 8min
completed: 2026-03-06
---

# Phase 8 Plan 01: Adapter Layer Summary

**PlatformAdapter interface with 4 methods, CoolifyAdapter extracting exact Coolify behavior, factory with resolvePlatform normalization, and platform-aware modeGuard evolution**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-06T06:22:18Z
- **Completed:** 2026-03-06T06:30:32Z
- **Tasks:** 2
- **Files modified:** 9 (3 created source, 3 created test, 1 modified source, 1 modified source, 1 modified test)

## Accomplishments
- PlatformAdapter interface defined with name, getCloudInit, healthCheck, createBackup, getStatus
- CoolifyAdapter fully implements all 4 methods, duplicating exact logic from cloudInit.ts, status.ts, backup.ts
- Factory function with getAdapter() dispatch and resolvePlatform() for legacy record normalization
- Platform type added to ServerRecord, BackupManifest, DeploymentConfig with backward compat
- modeGuard evolved: requireManagedMode() supports all platforms, isBareServer() uses resolvePlatform()
- 50 new tests added, full suite 2165 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Define types, PlatformAdapter interface, and factory with resolvePlatform** - `be3063d` (feat)
2. **Task 2: Implement CoolifyAdapter and evolve modeGuard** - `12a1f6d` (feat)

## Files Created/Modified
- `src/types/index.ts` - Added Platform type, platform field to ServerRecord/BackupManifest/DeploymentConfig
- `src/adapters/interface.ts` - PlatformAdapter interface with HealthResult, PlatformStatusResult, PlatformBackupResult types
- `src/adapters/coolify.ts` - CoolifyAdapter implementing all 4 PlatformAdapter methods
- `src/adapters/factory.ts` - getAdapter() factory function and resolvePlatform() normalization
- `src/utils/modeGuard.ts` - Added requireManagedMode(), updated isBareServer() to use resolvePlatform()
- `tests/unit/adapter-interface.test.ts` - 8 tests verifying PlatformAdapter shape and result types
- `tests/unit/adapter-factory.test.ts` - 13 tests for getAdapter, resolvePlatform, Platform type
- `tests/unit/coolify-adapter.test.ts` - 20 tests for CoolifyAdapter methods with mocked SSH/SCP/axios
- `tests/unit/modeGuard.test.ts` - Updated with 20 tests including requireManagedMode platform-aware cases

## Decisions Made
- PlatformAdapter interface uses `import type` for BackupManifest from types to avoid circular deps
- CoolifyAdapter intentionally duplicates logic from existing modules (Plan 02 will rewire core to use adapter)
- Private helper methods (buildPgDumpCommand, etc.) moved into CoolifyAdapter class, same implementations as core/backup.ts
- isBareServer() reimplemented using resolvePlatform() for single normalization path
- requireCoolifyMode() kept as alias for requireManagedMode() to avoid breaking existing callers
- mode fields marked @deprecated in JSDoc on ServerRecord and DeploymentConfig

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test for cloud-init sanitization false positive**
- **Found during:** Task 2 (CoolifyAdapter tests)
- **Issue:** Test checked `not.toContain("!")` on full cloud-init string, but `#!/bin/bash` shebang contains `!`
- **Fix:** Updated test to check only the Server name line, not the entire output
- **Files modified:** tests/unit/coolify-adapter.test.ts
- **Verification:** Test correctly validates sanitization without false positive
- **Committed in:** 12a1f6d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test)
**Impact on plan:** Minor test correction, no scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Adapter infrastructure complete: interface, implementation, factory, mode guards all in place
- Plan 02 can now wire core modules (deploy, status, backup, provision) through the adapter factory
- Phase 9 (Dokploy) only needs to add DokployAdapter class and a factory case
- All existing functionality preserved with zero behavior change

## Self-Check: PASSED

All 9 files verified present. Both task commits (be3063d, 12a1f6d) verified in git history. Build, lint, and full test suite (2165 tests) all passing.

---
*Phase: 08-platform-adapter-foundation*
*Completed: 2026-03-06*
