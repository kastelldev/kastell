---
phase: 38-fleet-visibility
plan: 02
subsystem: mcp
tags: [mcp, fleet, server_fleet, typescript, zod]

# Dependency graph
requires:
  - phase: 38-01
    provides: runFleet, FleetRow, FleetOptions from src/core/fleet.ts
provides:
  - server_fleet MCP tool (13th tool) in src/mcp/tools/serverFleet.ts
  - handleServerFleet + serverFleetSchema exports
  - Registration in src/mcp/server.ts
affects: [phase-39-guard-notify, mcp-tools]

# Tech tracking
tech-stack:
  added: []
  patterns: [re-setup jest.fn mock implementation in beforeEach after resetAllMocks]

key-files:
  created:
    - src/mcp/tools/serverFleet.ts
    - tests/unit/mcp-server-fleet.test.ts
  modified:
    - src/mcp/server.ts

key-decisions:
  - "getErrorMessage mock re-setup in beforeEach after jest.resetAllMocks() — factory mock implementations are cleared by resetAllMocks, must restore in beforeEach"
  - "server_fleet is readOnly (readOnlyHint: true) — fleet probing reads state but never modifies servers"

patterns-established:
  - "MCP tool error mock pattern: jest.mock module + re-setup mock.mockImplementation in beforeEach when using resetAllMocks"

requirements-completed: [FLEET-05]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 38 Plan 02: Fleet Visibility (MCP Tool) Summary

**server_fleet registered as 13th MCP tool — Claude can now retrieve fleet-wide health and security posture (ONLINE/DEGRADED/OFFLINE) for all registered servers via handleServerFleet calling runFleet with json:true**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-14T20:01:56Z
- **Completed:** 2026-03-14T20:05:34Z
- **Tasks:** 1 (TDD — 2 commits: test + feat)
- **Files modified:** 3

## Accomplishments

- `src/mcp/tools/serverFleet.ts` exports `serverFleetSchema` (sort enum) and `handleServerFleet`
- server_fleet registered as 13th tool in `src/mcp/server.ts` with readOnlyHint:true
- Zero-server case returns mcpError with `kastell add` suggested action
- 9 new MCP fleet tests, full suite 3140 tests green (from 3111)

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing test for server_fleet** - `5cfc113` (test)
2. **Task 1 GREEN: Implement server_fleet MCP tool** - `d039d7b` (feat)

_Note: TDD tasks have two commits (test → feat)_

## Files Created/Modified

- `src/mcp/tools/serverFleet.ts` — MCP handler: empty server guard, runFleet(json:true, sort), mcpSuccess/mcpError
- `src/mcp/server.ts` — Import + register server_fleet as 13th tool
- `tests/unit/mcp-server-fleet.test.ts` — 9 tests covering success, zero-server, error cases

## Decisions Made

- `getErrorMessage` mock re-setup in `beforeEach` after `jest.resetAllMocks()`: factory mock implementations are wiped by resetAllMocks, must restore via `mockImplementation` in beforeEach to avoid undefined returns in later tests.
- `server_fleet` uses `readOnlyHint: true` — fleet probing reads server state but never modifies anything.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed jest mock implementation lost after resetAllMocks**
- **Found during:** Task 1 GREEN (test execution)
- **Issue:** `jest.resetAllMocks()` in beforeEach wiped the getErrorMessage factory mock implementation, causing `parsed.error` to be undefined in error-handling tests
- **Fix:** Added `mockedErrorMapper.getErrorMessage.mockImplementation(...)` in beforeEach to restore after each reset
- **Files modified:** tests/unit/mcp-server-fleet.test.ts
- **Verification:** All 9 tests pass including both error-handling tests
- **Committed in:** d039d7b (Task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test mock setup)
**Impact on plan:** Test-only fix. No scope creep.

## Issues Encountered

- `jest.resetAllMocks()` wiped getErrorMessage factory mock — solved by re-applying mockImplementation in beforeEach (consistent with Phase 37 lesson about assertValidIp inline mocks)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 38 complete: both plans (38-01 fleet core + CLI, 38-02 MCP tool) done
- FLEET-01 through FLEET-05 all satisfied
- Ready for Phase 39: Guard Notify integration

---
*Phase: 38-fleet-visibility*
*Completed: 2026-03-14*
