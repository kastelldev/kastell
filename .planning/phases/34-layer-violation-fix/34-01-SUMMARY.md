---
phase: 34-layer-violation-fix
plan: 01
subsystem: infra
tags: [architecture, layer-violation, refactor, firewall, secure, deploy]

# Dependency graph
requires: []
provides:
  - firewallSetup function in src/core/firewall.ts
  - secureSetup function in src/core/secure.ts
  - clean import graph: core/deploy.ts imports only from core/, no commands/ dependency
affects: [35-adapter-dedup, 36-notify-module, 37-doctor-fix, 38-fleet, 39-guard-notify, 40-shell-completions]

# Tech tracking
tech-stack:
  added: []
  patterns: [commands-thin-core-fat enforced, re-export bridge pattern for backward compat]

key-files:
  created: []
  modified:
    - src/core/firewall.ts
    - src/core/secure.ts
    - src/core/deploy.ts
    - src/commands/firewall.ts
    - src/commands/secure.ts
    - tests/unit/core-deploy.test.ts
    - tests/unit/init-fullsetup.test.ts
    - tests/unit/init-bare.test.ts
    - tests/e2e/init-config.test.ts

key-decisions:
  - "Re-export bridge pattern: commands/ files re-export from core/ for backward compat — no callers need to update import paths"
  - "inquirer moved to core/secure.ts — core layer can hold interactive UI concerns when the function is orchestration-level (called from deploy, not just CLI)"

patterns-established:
  - "Re-export bridge: when moving a function from commands/ to core/, keep a re-export in commands/ so external callers and existing tests that mock commands/ still work"
  - "Jest mock paths must match the module that owns the function — after moving to core/, mocks must point to core/ not commands/"

requirements-completed: [DEBT-02]

# Metrics
duration: 25min
completed: 2026-03-14
---

# Phase 34 Plan 01: Layer Violation Fix Summary

**firewallSetup and secureSetup moved from commands/ to core/ via re-export bridges, eliminating the core/deploy.ts -> commands/ layer violation**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-14T00:00:00Z
- **Completed:** 2026-03-14T00:25:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Eliminated layer violation: `src/core/deploy.ts` no longer imports from `src/commands/`
- `firewallSetup` moved to `src/core/firewall.ts` with necessary logger/createSpinner imports
- `secureSetup` moved to `src/core/secure.ts` with necessary inquirer/logger/createSpinner imports
- `commands/firewall.ts` and `commands/secure.ts` now re-export from core/ — no breaking changes for callers
- 4 test files updated to mock `core/` paths so jest intercepts calls correctly
- All 3038 tests pass, build clean, lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Move firewallSetup and secureSetup from commands/ to core/** - `9139964` (refactor)
2. **Task 2: Update test mock paths and verify full suite** - `a76438e` (test)

## Files Created/Modified

- `src/core/firewall.ts` - Added `firewallSetup` function + logger/createSpinner imports
- `src/core/secure.ts` - Added `secureSetup` function + inquirer/logger/createSpinner imports
- `src/core/deploy.ts` - Updated imports from `../commands/firewall.js` -> `./firewall.js` and `../commands/secure.js` -> `./secure.js`
- `src/commands/firewall.ts` - Removed `firewallSetup` body; re-exports it from `../core/firewall.js`
- `src/commands/secure.ts` - Removed `secureSetup` body; re-exports it from `../core/secure.js`
- `tests/unit/core-deploy.test.ts` - Mock paths updated to `core/firewall` and `core/secure`
- `tests/unit/init-fullsetup.test.ts` - Mock paths and `jest.requireActual` paths updated
- `tests/unit/init-bare.test.ts` - Mock paths and `requireMock` accessor paths updated
- `tests/e2e/init-config.test.ts` - Import paths and mock paths updated to core/

## Decisions Made

- Re-export bridge pattern used in commands/ files so existing callers (and any mocks that pointed to commands/) continue working without changes to every consumer.
- `inquirer` moved to `core/secure.ts` — acceptable because `secureSetup` is an orchestration-level function (called from deploy with `force=true`) that legitimately needs the interactive prompt when called standalone from CLI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated 2 additional test files with wrong mock paths**

- **Found during:** Task 2 (Update test mock paths and verify full suite)
- **Issue:** Plan listed only `core-deploy.test.ts` and `init-fullsetup.test.ts`, but `init-bare.test.ts` and `init-config.test.ts` also mocked `commands/firewall` and `commands/secure`. After the function moved to core/, these mocks no longer intercepted deploy.ts calls, causing 3 test failures.
- **Fix:** Updated mock paths in `init-bare.test.ts` (jest.mock + requireMock accessor) and `init-config.test.ts` (import + jest.mock), pointing both to `core/` modules.
- **Files modified:** `tests/unit/init-bare.test.ts`, `tests/e2e/init-config.test.ts`
- **Verification:** All 3038 tests pass
- **Committed in:** `a76438e` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking test failures)
**Impact on plan:** Necessary fix to complete Task 2 goal. 2 additional test files discovered that also mocked the moved functions.

## Issues Encountered

None beyond the auto-fixed deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Layer violation fully resolved: `grep -r "from.*commands/" src/core/` returns zero import matches
- Phase 35 (Adapter Dedup) can proceed on a clean foundation
- All future phases can import firewallSetup/secureSetup from `core/` directly

---
*Phase: 34-layer-violation-fix*
*Completed: 2026-03-14*
