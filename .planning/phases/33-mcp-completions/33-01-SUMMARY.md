---
phase: 33-mcp-completions
plan: "01"
subsystem: mcp
tags: [mcp, guard, doctor, lock, tools]
dependency_graph:
  requires:
    - 30-guard-daemon (startGuard, stopGuard, guardStatus)
    - 31-risk-trend (no direct dep)
    - 32-doctor (runServerDoctor)
    - 28-lock (applyLock)
  provides:
    - server_guard MCP tool
    - server_doctor MCP tool
    - server_lock MCP tool
  affects:
    - src/mcp/server.ts (12 registered tools total)
tech_stack:
  added: []
  patterns:
    - serverAudit.ts pattern (schema + handler + mcpSuccess/mcpError)
    - TDD red-green (test-first, then implement)
key_files:
  created:
    - src/mcp/tools/serverGuard.ts
    - src/mcp/tools/serverDoctor.ts
    - src/mcp/tools/serverLock.ts
    - tests/unit/mcp-server-guard.test.ts
    - tests/unit/mcp-server-doctor.test.ts
    - tests/unit/mcp-server-lock.test.ts
  modified:
    - src/mcp/server.ts
decisions:
  - serverLock uses Platform | undefined cast (same as serverAudit.ts) to pass mode/platform to applyLock
  - Tests mock findServer explicitly when server param is passed (resolveServerForMcp delegates to findServer)
  - serverDoctor json format returns raw DoctorResult JSON (not wrapped in mcpSuccess)
  - serverLock safety gate: dryRun=true bypasses production requirement, matches research recommendation
requirements_completed:
  - MCP-01
  - MCP-02
metrics:
  duration: 483s
  tasks_completed: 2
  tests_added: 35
  files_created: 6
  files_modified: 1
  completed_date: "2026-03-14"
---

# Phase 33 Plan 01: MCP Tools (Guard, Doctor, Lock) Summary

Three MCP tools wrapping v1.7 core functions so Claude can control guard daemon, run doctor analysis, and apply lock hardening without CLI — using the established serverAudit.ts pattern with Zod schemas, server resolution, and mcpSuccess/mcpError responses.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create three MCP tool files with tests (TDD) | 8faf186 | serverGuard.ts, serverDoctor.ts, serverLock.ts + 3 test files |
| 2 | Register three tools in server.ts | f082753 | src/mcp/server.ts |

## What Was Built

**src/mcp/tools/serverGuard.ts**
- Schema: `server` (optional), `action` (start/stop/status enum)
- Handler: resolves server, switches on action, calls startGuard/stopGuard/guardStatus
- Start returns `{success, message}`, stop returns `{success, message}`, status returns `{isActive, lastRunAt, breaches, logTail, installedAt}`

**src/mcp/tools/serverDoctor.ts**
- Schema: `server` (optional), `fresh` (boolean, default false), `format` (summary/json)
- Handler: resolves server, calls runServerDoctor with fresh flag
- Summary format: groups findings by severity with counts (critical/warning/info/total)
- JSON format: returns raw DoctorResult for machine parsing

**src/mcp/tools/serverLock.ts**
- Schema: `server` (optional), `production` (boolean, default false), `dryRun` (boolean), `force` (boolean)
- Safety gate: requires production=true OR dryRun=true — returns descriptive mcpError otherwise
- Platform resolution: `server.platform ?? server.mode ?? "bare"` (matches serverAudit.ts pattern)
- Returns `{success, steps, scoreBefore, scoreAfter}`

**src/mcp/server.ts**
- Added imports for all three new tools
- Registered server_guard, server_doctor, server_lock with descriptions and annotations
- Total: 12 registered MCP tools (9 existing + 3 new)

## Verification Results

- `npm run build` — passes (TypeScript compiles without errors)
- `grep -c "registerTool" src/mcp/server.ts` — 12
- `npx jest --testPathPatterns="mcp" --no-coverage` — 454 tests pass (13 test suites)
- New tests: 35 (guard: 11, doctor: 11, lock: 13)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tests needed explicit findServer mock for server-by-name resolution**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** `resolveServerForMcp` calls `findServer(params.server)` when server param is provided. Tests only mocked `getServers`, not `findServer`, causing "Server not found" errors.
- **Fix:** Added `mockedConfig.findServer.mockReturnValue(sampleServer)` to all test cases that pass a server name.
- **Files modified:** tests/unit/mcp-server-guard.test.ts, mcp-server-doctor.test.ts, mcp-server-lock.test.ts
- **Commit:** 8faf186

**2. [Rule 1 - Bug] TypeScript Platform cast in serverLock.ts**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** `server.platform ?? server.mode ?? "bare"` returns `Platform | ServerMode | "bare"` — needed cast to `Platform | undefined` for applyLock signature.
- **Fix:** Used `platformStr as Platform | undefined` cast (same runtime behavior as serverAudit.ts, which uses `server.platform ?? server.mode ?? "bare"` passed to a string parameter).
- **Files modified:** src/mcp/tools/serverLock.ts

## Decisions Made

1. **findServer mock pattern:** When a server name is provided to MCP handlers, `resolveServerForMcp` calls `findServer` from config. Tests must mock both `getServers` (for length check) and `findServer` (for lookup). This is consistent with the existing `mcp-server-audit.test.ts` pattern.

2. **Platform cast approach:** `server.platform ?? server.mode ?? "bare"` produces a string. Cast to `Platform | undefined` follows the same unsafe-but-accepted pattern as `serverAudit.ts`. TypeScript cannot narrow the union at this point without a type guard.

3. **Safety gate scope:** The safety gate in serverLock returns mcpError BEFORE calling applyLock — not inside applyLock. This keeps the gate visible at the MCP layer (per plan research recommendation).

## Self-Check: PASSED

Files exist:
- src/mcp/tools/serverGuard.ts: FOUND
- src/mcp/tools/serverDoctor.ts: FOUND
- src/mcp/tools/serverLock.ts: FOUND
- tests/unit/mcp-server-guard.test.ts: FOUND
- tests/unit/mcp-server-doctor.test.ts: FOUND
- tests/unit/mcp-server-lock.test.ts: FOUND

Commits exist:
- 1c3992b (test RED): FOUND
- 8faf186 (feat task 1): FOUND
- f082753 (feat task 2): FOUND
