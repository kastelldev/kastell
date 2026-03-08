---
phase: 19-code-quality-refactoring
plan: 04
subsystem: infra
tags: [composition, hof, adapter, provider, deduplication]

# Dependency graph
requires:
  - phase: 19-code-quality-refactoring (plan 01)
    provides: getLogCommand removed from adapter interface
provides:
  - adapters/shared.ts with sharedHealthCheck, sharedUpdate, sharedGetStatus
  - withProviderErrorHandling HOF in providers/base.ts
affects: [adapters, providers]

# Tech tracking
tech-stack:
  added: []
  patterns: [composition-over-inheritance for adapter shared utilities, higher-order function for provider error handling]

key-files:
  created: [src/adapters/shared.ts]
  modified: [src/adapters/coolify.ts, src/adapters/dokploy.ts, src/providers/base.ts, src/providers/hetzner.ts, src/providers/digitalocean.ts, src/providers/vultr.ts, src/providers/linode.ts]

key-decisions:
  - "Composition with plain functions (not inheritance) for adapter shared utilities"
  - "HOF applied only to standard error-handling methods (getServerDetails, getServerStatus); methods with typed API error responses left unchanged"

patterns-established:
  - "Adapter shared utilities: import from adapters/shared.ts, pass platform-specific constants"
  - "Provider error handling HOF: use withProviderErrorHandling for standard try/catch patterns"

requirements-completed: [REFACTOR-ADAPTER-SHARED, REFACTOR-PROVIDER-HOF]

# Metrics
duration: 5min
completed: 2026-03-08
---

# Phase 19 Plan 04: Adapter Shared Utilities + Provider Error Handling HOF Summary

**Composition-based shared adapter utilities (healthCheck/update/getStatus) and withProviderErrorHandling HOF eliminating duplicate error handling across 4 providers**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T12:58:54Z
- **Completed:** 2026-03-08T13:04:13Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created adapters/shared.ts with sharedHealthCheck, sharedUpdate, sharedGetStatus using composition (no inheritance)
- Both CoolifyAdapter and DokployAdapter now delegate identical methods to shared functions, differing only by constants (port, commands)
- Added withProviderErrorHandling() HOF to providers/base.ts, applied to getServerDetails and getServerStatus in all 4 providers
- Full test suite green (2296 tests), build clean, lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create adapters/shared.ts + refactor adapters** - `54a5fea` (refactor)
2. **Task 2: Add withProviderErrorHandling HOF + apply to 4 providers** - `1b9f69b` (refactor)

## Files Created/Modified
- `src/adapters/shared.ts` - Shared utility functions for platform adapters (composition pattern)
- `src/adapters/coolify.ts` - Delegates healthCheck/getStatus/update to shared functions
- `src/adapters/dokploy.ts` - Delegates healthCheck/getStatus/update to shared functions
- `src/providers/base.ts` - Added withProviderErrorHandling() HOF
- `src/providers/hetzner.ts` - Uses HOF for getServerDetails, getServerStatus
- `src/providers/digitalocean.ts` - Uses HOF for getServerDetails, getServerStatus
- `src/providers/vultr.ts` - Uses HOF for getServerDetails, getServerStatus
- `src/providers/linode.ts` - Uses HOF for getServerDetails, getServerStatus

## Decisions Made
- Used composition with plain functions (not inheritance/base class) for adapter shared utilities, per project convention
- HOF applied only to methods with the standard try/catch+stripSensitiveData+throw pattern (getServerDetails, getServerStatus = 8 methods across 4 providers). Methods with custom error handling (uploadSshKey with 409/422, createServer/destroyServer/etc. with typed API error response extraction) were left unchanged to preserve provider-specific error messages.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 19 (Code Quality Refactoring) complete - all 4 plans executed
- Ready for Phase 20 (kastell audit)

---
*Phase: 19-code-quality-refactoring*
*Completed: 2026-03-08*
