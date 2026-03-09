---
phase: 23-infrastructure-foundation
plan: 02
subsystem: infra
tags: [file-locking, async, migration, type-safety, concurrency]

requires:
  - phase: 23-01
    provides: "withFileLock HOF and atomicWriteServers utility"
provides:
  - "All config writes (saveServer, updateServer, removeServer) are async + locked"
  - "Audit history writes (saveAuditHistory) are async + locked"
  - "ServerRecord.mode is required type with auto-migration"
  - "removeServer uses atomic writes instead of raw writeFileSync"
affects: [24-audit-snapshot, 25-evidence-collect, 26-adapter-contracts]

tech-stack:
  added: []
  patterns:
    - "withFileLock wrapping all shared file writes"
    - "ServerRecord.mode required with auto-migration on first getServers read"
    - "All config/audit write callers use async/await"

key-files:
  created: []
  modified:
    - src/utils/config.ts
    - src/core/audit/history.ts
    - src/types/index.ts
    - src/core/manage.ts
    - src/core/deploy.ts
    - src/core/provision.ts
    - src/commands/domain.ts
    - src/commands/remove.ts
    - src/commands/transfer.ts
    - src/commands/audit.ts
    - src/core/audit/watch.ts
    - src/commands/destroy.ts
    - src/mcp/tools/serverManage.ts
    - tests/unit/config.test.ts

key-decisions:
  - "Mode migration persists atomically on first getServers read (no lazy fallback)"
  - "All 15+ callers updated to async/await in single commit for atomicity"
  - "50+ test files updated with mode field and async mock patterns"

patterns-established:
  - "withFileLock(filePath, fn) wrapping pattern for all shared file mutations"
  - "ServerRecord.mode required - no more optional mode with runtime fallbacks"

requirements-completed: [INFRA-01, INFRA-03]

duration: 35min
completed: 2026-03-09
---

# Phase 23 Plan 02: Config Lock Integration Summary

**withFileLock integrated into all config/audit writes, ServerRecord.mode made required with auto-migration, all callers updated to async/await**

## Performance

- **Duration:** 35 min
- **Started:** 2026-03-09
- **Completed:** 2026-03-09
- **Tasks:** 2
- **Files modified:** 55

## Accomplishments
- Wrapped saveServer, updateServer, removeServer with withFileLock for concurrency-safe config writes
- Wrapped saveAuditHistory with withFileLock for concurrency-safe audit history writes
- Fixed removeServer to use atomicWriteServers instead of raw writeFileSync
- Made ServerRecord.mode required in type definition with auto-migration on first read
- Updated 15+ source callers to async/await across commands, core, and MCP tools
- Updated 50+ test files with mode field additions, async mock patterns, and field count expectations

## Task Commits

Each task was committed atomically:

1. **Task 1: Integrate withFileLock into config.ts + fix removeServer + mode migration** - `38f9a96` (feat)
2. **Task 2: Update all callers to async/await + lock audit history** - `a2beb11` (feat)

## Files Created/Modified
- `src/utils/config.ts` - Async config writes wrapped with withFileLock, mode migration in getServers
- `src/core/audit/history.ts` - Async saveAuditHistory wrapped with withFileLock
- `src/types/index.ts` - ServerRecord.mode changed from optional to required
- `src/core/manage.ts` - removeServerRecord async, all save/remove calls awaited
- `src/core/deploy.ts` - await saveServer in postSetup
- `src/core/provision.ts` - await saveServer in provisionServer
- `src/commands/domain.ts` - await updateServer in domainAdd/domainRemove
- `src/commands/remove.ts` - await removeServer
- `src/commands/transfer.ts` - await saveServer, mode always set (not optional spread)
- `src/commands/audit.ts` - await saveAuditHistory
- `src/core/audit/watch.ts` - await saveAuditHistory
- `src/commands/destroy.ts` - await removeServerRecord
- `src/mcp/tools/serverManage.ts` - await removeServerRecord
- `tests/unit/config.test.ts` - 21 tests with fileLock mock, 3 new tests for migration/atomic
- 50+ test files - mode field additions, async mock patterns

## Decisions Made
- Mode migration persists atomically on first getServers read rather than lazy fallback at each call site
- All 15+ callers updated in a single commit for atomicity (cross-cutting async change)
- Used Node.js helper scripts for bulk test fixes (mode field + async mocks) then manual edge-case cleanup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added await in destroy.ts and MCP serverManage.ts**
- **Found during:** Task 2
- **Issue:** Plan listed specific callers but missed destroy.ts and mcp/tools/serverManage.ts which also call removeServerRecord
- **Fix:** Added await in both files
- **Files modified:** src/commands/destroy.ts, src/mcp/tools/serverManage.ts
- **Verification:** npm run build clean, npm test green
- **Committed in:** a2beb11

**2. [Rule 1 - Bug] Fixed transfer.ts mode handling for required type**
- **Found during:** Task 2
- **Issue:** transfer.ts used optional spread `...(server.mode ? { mode: server.mode } : {})` which doesn't satisfy required mode
- **Fix:** Changed to `mode: server.mode || "coolify"` to always provide mode
- **Files modified:** src/commands/transfer.ts
- **Verification:** Build clean, security-transfer tests pass with updated field counts
- **Committed in:** a2beb11

**3. [Rule 3 - Blocking] Fixed 50+ test files with mode field and async mock patterns**
- **Found during:** Task 2
- **Issue:** Making ServerRecord.mode required broke all test files with ServerRecord-like mock objects
- **Fix:** Added `mode: "coolify" as const` to all mock objects, changed mockReturnValue to mockResolvedValue for async functions
- **Files modified:** 50+ test files
- **Verification:** All 2494 tests pass across 115 suites
- **Committed in:** a2beb11

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 bug, 1 blocking)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
- Automated scripts for bulk test fixes occasionally placed mode field outside object braces or on non-ServerRecord types (SnapshotInfo). Required targeted cleanup scripts and manual fixes.
- Jest 30+ deprecated `--testPathPattern` flag; used positional argument syntax instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All config and audit writes are now concurrency-safe via withFileLock
- ServerRecord.mode is required everywhere, no runtime fallbacks needed
- Ready for Phase 24 (Audit Snapshot + Diff) which will use these locked write patterns

---
*Phase: 23-infrastructure-foundation*
*Completed: 2026-03-09*
