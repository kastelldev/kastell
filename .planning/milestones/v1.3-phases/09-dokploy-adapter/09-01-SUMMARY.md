---
phase: 09-dokploy-adapter
plan: 01
subsystem: adapters
tags: [dokploy, docker-swarm, platform-adapter, backup, cloud-init, health-check]

# Dependency graph
requires:
  - phase: 08-platform-adapter-foundation
    provides: PlatformAdapter interface, factory pattern, resolvePlatform
provides:
  - DokployAdapter class implementing PlatformAdapter (4 methods)
  - Factory registration for getAdapter("dokploy")
  - Comprehensive unit tests for DokployAdapter (24 tests)
affects: [09-02-cli-mcp-integration, deploy, provision, backup, interactive]

# Tech tracking
tech-stack:
  added: []
  patterns: [dokploy-adapter-mirror-coolify, swarm-container-resolution]

key-files:
  created:
    - src/adapters/dokploy.ts
    - tests/unit/dokploy-adapter.test.ts
  modified:
    - src/adapters/factory.ts
    - tests/unit/adapter-factory.test.ts

key-decisions:
  - "Reuse BackupManifest.coolifyVersion field for Dokploy version (backward compat, platform field distinguishes)"
  - "Docker Swarm container resolution via docker ps -qf name=dokploy-postgres for pg_dump"
  - "Simple port 3000 HTTP probe for health check (not /api/health endpoint)"

patterns-established:
  - "DokployAdapter mirrors CoolifyAdapter structure exactly with Dokploy-specific values"
  - "Swarm-aware container resolution: docker ps -qf name=<service> for docker exec"

requirements-completed: [DOKP-01, DOKP-02, DOKP-03, DOKP-04]

# Metrics
duration: 4min
completed: 2026-03-06
---

# Phase 9 Plan 01: DokployAdapter Summary

**DokployAdapter with Dokploy cloud-init, port 3000 health check, Swarm-aware pg_dump backup, and factory registration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-06T07:39:52Z
- **Completed:** 2026-03-06T07:43:32Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- DokployAdapter implements all 4 PlatformAdapter methods (getCloudInit, healthCheck, createBackup, getStatus) with Dokploy-specific values
- Cloud-init uses official Dokploy install script with Docker Swarm ports (2377, 7946, 4789) and web UI port 3000
- Backup uses Swarm-aware container resolution (docker ps -qf) with Dokploy PostgreSQL credentials (-U postgres -d dokploy)
- Factory returns DokployAdapter for getAdapter("dokploy"), full test suite green (2191 tests, 84 suites)

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests for DokployAdapter** - `e389581` (test)
2. **Task 1 GREEN: Implement DokployAdapter and factory registration** - `0ad58bc` (feat)

## Files Created/Modified
- `src/adapters/dokploy.ts` - DokployAdapter class implementing PlatformAdapter (231 lines)
- `src/adapters/factory.ts` - Added case "dokploy" and DokployAdapter import (2 lines changed)
- `tests/unit/dokploy-adapter.test.ts` - Unit tests for all 4 adapter methods (269 lines, 24 tests)
- `tests/unit/adapter-factory.test.ts` - Added getAdapter("dokploy") test (1 test added)

## Decisions Made
- Reused BackupManifest.coolifyVersion field for Dokploy version string (backward compat -- platform field distinguishes which platform the version belongs to)
- Used docker ps -qf name=dokploy-postgres for Swarm container resolution instead of hardcoded container name (Swarm appends random suffixes)
- Simple HTTP GET to port 3000 for health check (consistent with CoolifyAdapter pattern, no API auth needed)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- DokployAdapter and factory registration complete
- Plan 09-02 can proceed: CLI/MCP integration (deploy.ts, provision.ts routing fix, interactive menu, MCP schema update)
- Blocker from Phase 8 still applies: Dokploy PostgreSQL credentials need live instance verification

## Self-Check: PASSED

- All 5 files verified (created + modified)
- Both commits verified (e389581, 0ad58bc)
- Artifact line counts verified (dokploy.ts: 231 >= 180, tests: 269 >= 100)
- Full test suite: 2191 tests, 84 suites, all green
- Build: clean
- Lint: clean

---
*Phase: 09-dokploy-adapter*
*Completed: 2026-03-06*
