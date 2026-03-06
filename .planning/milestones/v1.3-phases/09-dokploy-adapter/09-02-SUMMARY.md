---
phase: 09-dokploy-adapter
plan: 02
subsystem: cli-mcp-integration
tags: [dokploy, cli, mcp, backup-routing, platform-routing, interactive-menu]

# Dependency graph
requires:
  - phase: 09-dokploy-adapter
    provides: DokployAdapter class, factory registration for getAdapter("dokploy")
provides:
  - Dynamic platform routing in deploy.ts, provision.ts, backup.ts from mode string
  - Dokploy option in interactive menu and CLI --mode flag
  - MCP serverProvision accepts "dokploy" mode
  - MCP serverBackup passes platform to createBackup
  - Backup command routes all managed servers through adapter (not direct SSH)
  - Platform-specific health check port (3000 for Dokploy, 8000 for Coolify)
affects: [deploy, provision, backup, interactive, mcp]

# Tech tracking
tech-stack:
  added: []
  patterns: [adapter-routed-backup, platform-aware-health-check, mode-to-platform-mapping]

key-files:
  created: []
  modified:
    - src/core/deploy.ts
    - src/core/provision.ts
    - src/core/backup.ts
    - src/utils/healthCheck.ts
    - src/commands/backup.ts
    - src/commands/interactive.ts
    - src/index.ts
    - src/mcp/tools/serverProvision.ts
    - src/mcp/tools/serverBackup.ts
    - tests/unit/backup.test.ts

key-decisions:
  - "ProvisionConfig.mode changed from ServerMode to string to accept dokploy without expanding deprecated ServerMode type"
  - "Backup command routes all managed servers through adapter, eliminating direct Coolify SSH commands from command layer"
  - "waitForCoolify accepts port parameter (default 8000) for platform-specific health check"
  - "mode=dokploy maps to mode=coolify in server record (ServerMode only has coolify|bare, platform field is the truth)"

patterns-established:
  - "Mode-to-platform mapping: mode string -> isBare check -> platform derivation at call site"
  - "Adapter-routed backup: commands/backup.ts delegates to adapter.createBackup instead of direct SSH"
  - "Platform-aware messages: platformName and platformPort derived from platform for user-facing text"

requirements-completed: [DOKP-05, DOKP-06, DOKP-07]

# Metrics
duration: 8min
completed: 2026-03-06
---

# Phase 9 Plan 02: CLI/MCP Integration Summary

**Dokploy wired into CLI (--mode dokploy), interactive menu, MCP tools, and backup routing with adapter-based backup for all managed servers**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-06T07:46:48Z
- **Completed:** 2026-03-06T07:55:16Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- deploy.ts and provision.ts dynamically map mode "dokploy" to platform "dokploy" with correct cloud-init, port, and server record
- Backup command (both single-server and --all) routes managed servers through adapter instead of hardcoded Coolify SSH commands
- Interactive menu shows Dokploy as platform choice, CLI --mode accepts "dokploy", MCP serverProvision enum includes "dokploy"
- Health check uses port 3000 for Dokploy servers (vs 8000 for Coolify) with platform-aware spinner messages
- Full test suite green: 2191 tests, 84 suites, zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix platform routing in core modules** - `e283ed8` (feat)
2. **Task 2: Wire Dokploy into CLI, MCP, and backup** - `f8247b8` (feat)

## Files Created/Modified
- `src/core/deploy.ts` - Dynamic platform derivation, platform-specific port and messages
- `src/core/provision.ts` - Dynamic platform derivation, ProvisionConfig.mode accepts "dokploy"
- `src/core/backup.ts` - createBackup accepts platform parameter for adapter routing
- `src/utils/healthCheck.ts` - waitForCoolify accepts port parameter, platform-aware spinner text
- `src/commands/backup.ts` - Routes managed backups through adapter, cleaned up unused imports
- `src/commands/interactive.ts` - Added Dokploy option to mode choices
- `src/index.ts` - Updated --mode descriptions for init and add commands
- `src/mcp/tools/serverProvision.ts` - Added "dokploy" to mode enum and handler type
- `src/mcp/tools/serverBackup.ts` - Passes platform to createBackup via resolvePlatform
- `tests/unit/backup.test.ts` - Updated assertion for new "Platform version" output format

## Decisions Made
- Changed ProvisionConfig.mode from ServerMode to string type -- ServerMode is deprecated, adding "dokploy" to it would be incorrect since mode only has coolify|bare. The platform field is the source of truth.
- Eliminated direct Coolify SSH backup commands from commands/backup.ts -- all managed server backups now go through the adapter, making the command layer platform-agnostic.
- waitForCoolify function name kept for backward compat but made platform-generic with port parameter and dynamic spinner messages.
- For dokploy servers, mode is stored as "coolify" in server record (ServerMode constraint), platform field stores "dokploy" as the truth.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated backup test assertion for new output format**
- **Found during:** Task 2 (backup command refactoring)
- **Issue:** Test expected "Coolify version: 4.0.0" but new adapter-routed output shows "Platform version: 4.0.0"
- **Fix:** Updated test assertion from "Coolify version:" to "Platform version:"
- **Files modified:** tests/unit/backup.test.ts
- **Verification:** All 43 backup tests pass, full suite 2191 tests green
- **Committed in:** f8247b8 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test assertion update was necessary consequence of output format change. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Full Dokploy support complete across all layers: adapter, core, CLI, MCP
- Phase 9 (Dokploy Adapter) is complete (both plans executed)
- v1.3 milestone complete (phases 7, 8, 9 all done)
- Blocker from Phase 8 still applies: Dokploy PostgreSQL credentials need live instance verification

## Self-Check: PASSED

- All 10 files verified (modified)
- Both commits verified (e283ed8, f8247b8)
- Full test suite: 2191 tests, 84 suites, all green
- Build: clean
- Lint: clean

---
*Phase: 09-dokploy-adapter*
*Completed: 2026-03-06*
