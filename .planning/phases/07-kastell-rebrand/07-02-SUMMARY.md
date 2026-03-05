---
phase: 07-kastell-rebrand
plan: 02
subsystem: branding
tags: [rebrand, string-replacement, cli, mcp, tests, backward-compat]

# Dependency graph
requires:
  - phase: 07-01
    provides: "Type renames (KastellYamlConfig etc.), config paths (~/.kastell), env var migration (KASTELL_SAFE_MODE), migration utility"
provides:
  - "All source files use kastell branding in user-facing strings"
  - "All test files updated to match source renames"
  - "CLI program name is kastell"
  - "MCP tool descriptions use Kastell branding"
  - "Linode dual-prefix backward compat for snapshots"
  - "SSH key prefix kastell-"
  - "Default export filename kastell-export.json"
affects: [07-03, npm-publish, documentation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-prefix pattern for backward-compat snapshot filtering (kastell- || quicklify-)"
    - "Context-aware string replacement (not blind find-and-replace)"

key-files:
  created:
    - ".planning/phases/07-kastell-rebrand/07-02-SUMMARY.md"
  modified:
    - "src/index.ts"
    - "src/core/deploy.ts"
    - "src/commands/doctor.ts"
    - "src/utils/cloudInit.ts"
    - "src/utils/sshKey.ts"
    - "src/mcp/server.ts"
    - "src/mcp/tools/*.ts (7 files)"
    - "src/providers/linode.ts"
    - "src/commands/*.ts (18 command files)"
    - "src/core/snapshot.ts"
    - "src/utils/errorMapper.ts"
    - "src/utils/serverSelect.ts"
    - "tests/unit/*.test.ts (17 files)"
    - "tests/e2e/*.test.ts (4 files)"
    - "tests/integration/*.test.ts (4 files)"

key-decisions:
  - "Linode snapshot filter uses dual-prefix (kastell- || quicklify-) for backward compat with existing snapshots"
  - "GitHub org URLs updated from omrfc/quicklify to kastelldev/kastell in deploy.ts"
  - "Test files for QUICKLIFY_SAFE_MODE backward compat left intentionally unchanged (manage-safemode, restore-bare, mcp-server-manage)"
  - "Migration.ts left untouched (intentional .quicklify reference for OLD_CONFIG_DIR)"

patterns-established:
  - "Dual-prefix snapshot filter: new code creates kastell-* but reads both kastell-* and quicklify-*"

requirements-completed: [BRAND-01, BRAND-03, BRAND-04, BRAND-08]

# Metrics
duration: 12min
completed: 2026-03-05
---

# Phase 7 Plan 2: Source and Test Rebrand Summary

**Renamed all quicklify references to kastell across 35 source files and 25 test files with dual-prefix backward compat for Linode snapshots**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-05T10:26:51Z
- **Completed:** 2026-03-05T10:38:49Z
- **Tasks:** 2/2
- **Files modified:** 60 (35 source + 25 test)

## Accomplishments
- Zero unintentional "quicklify" references remain in src/ (only migration.ts OLD_CONFIG_DIR)
- Zero unintentional "quicklify" references remain in tests/ (only backward compat env var tests)
- All 2115 tests pass across 80 suites with zero regressions
- Build and lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Rename all quicklify references in src/ files** - `3735e34` (feat)
2. **Task 2: Update all test files to match source renames** - `f48a524` (test)

## Files Created/Modified

### Source Files (35 files)
- `src/index.ts` - CLI name "kastell", description, config help text
- `src/core/deploy.ts` - 19 references: CLI commands, GitHub org URLs, banner text
- `src/core/snapshot.ts` - Snapshot name prefix kastell-
- `src/commands/doctor.ts` - Function rename checkKastellVersion, output strings
- `src/commands/init.ts` - process.title = "kastell", title text
- `src/commands/*.ts` (16 other command files) - CLI command references in messages
- `src/utils/cloudInit.ts` - kastell-install.log, Kastell banners
- `src/utils/sshKey.ts` - SSH key comment "kastell", key name prefix kastell-
- `src/utils/errorMapper.ts` - CLI references in error hints
- `src/utils/serverSelect.ts` - "kastell init" message
- `src/mcp/server.ts` - 7 tool descriptions with Kastell branding
- `src/mcp/index.ts` - "kastell-mcp server started"
- `src/mcp/tools/*.ts` (7 files) - CLI suggestions, KASTELL_SAFE_MODE in descriptions
- `src/providers/linode.ts` - Dual-prefix snapshot filter (kastell- || quicklify-)

### Test Files (25 files)
- `tests/unit/*.test.ts` (17 files) - Mock values, assertions, test descriptions
- `tests/e2e/*.test.ts` (4 files) - SSH key mocks, output assertions, process.title
- `tests/integration/*.test.ts` (4 files) - Snapshot name mocks across all 4 providers

### Intentionally Unchanged Files
- `src/utils/migration.ts` - OLD_CONFIG_DIR references .quicklify (migration source)
- `src/core/manage.ts` - QUICKLIFY_SAFE_MODE backward compat env var check
- `tests/unit/manage-safemode.test.ts` - Tests QUICKLIFY_SAFE_MODE backward compat
- `tests/unit/restore-bare.test.ts` - QUICKLIFY_SAFE_MODE env var cleanup
- `tests/unit/mcp-server-manage.test.ts` - QUICKLIFY_SAFE_MODE backward compat tests
- `tests/unit/migration.test.ts` - Tests .quicklify migration paths

## Decisions Made
- **Linode dual-prefix:** New snapshots use kastell- prefix, but filter accepts both kastell- and quicklify- to ensure existing user snapshots remain visible
- **GitHub org URLs:** Changed from omrfc/quicklify to kastelldev/kastell in deploy.ts post-install message
- **Backward compat tests preserved:** Tests explicitly verifying QUICKLIFY_SAFE_MODE env var backward compatibility were left unchanged since the underlying code still supports the old env var
- **restore-safemode assertion updated:** The error message assertion was updated from QUICKLIFY_SAFE_MODE to KASTELL_SAFE_MODE since the source now references KASTELL_SAFE_MODE in the error text

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All source and test files rebranded to kastell
- Ready for Plan 03: Package metadata, CHANGELOG, and documentation updates
- Build, test, and lint all clean

## Self-Check: PASSED

- FOUND: 07-02-SUMMARY.md
- FOUND: 3735e34 (Task 1 commit)
- FOUND: f48a524 (Task 2 commit)

---
*Phase: 07-kastell-rebrand*
*Completed: 2026-03-05*
