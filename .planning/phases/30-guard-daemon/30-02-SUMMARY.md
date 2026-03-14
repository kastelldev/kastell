---
phase: 30-guard-daemon
plan: "02"
subsystem: guard-cli
tags: [guard, cli, commander, tdd]
dependency_graph:
  requires: [src/core/guard.ts, src/utils/serverSelect.ts, src/utils/ssh.ts, src/utils/logger.ts]
  provides: [src/commands/guard.ts, guard subcommand group in src/index.ts]
  affects: [kastell guard start|status|stop user-facing commands]
tech_stack:
  added: []
  patterns: [thin command wrapper, Commander subcommand group, TDD red-green]
key_files:
  created:
    - src/commands/guard.ts
    - tests/unit/guard-command.test.ts
  modified:
    - src/index.ts
decisions:
  - status subcommand skips checkSshAvailable pre-flight — guardStatus handles SSH errors directly
  - parent guard command has no .action() — only subcommands get actions to avoid Commander routing issue
  - chalk used directly in guard.ts for ACTIVE/INACTIVE color coding
metrics:
  duration: 173s
  completed_date: "2026-03-14"
  tasks_completed: 1
  files_created: 2
  files_modified: 1
  tests_added: 23
requirements_completed: [GUARD-01, GUARD-05, GUARD-06]
---

# Phase 30 Plan 02: Guard CLI Command Summary

**One-liner:** Guard CLI thin wrapper (start/stop/status) with Commander subcommand group, --force confirm bypass, and status skipping SSH pre-flight via TDD.

## What Was Built

`src/commands/guard.ts` is the thin CLI wrapper for the guard daemon feature. It follows the `lockCommand` pattern: SSH availability check (start/stop only), `resolveServer`, optional confirm prompt, spinner, and delegation to the core module.

Key design decisions:
- `start` and `stop` both have SSH pre-flight via `checkSshAvailable()` + confirm prompt (skipped with `--force`)
- `status` has NO SSH pre-flight — it calls `guardStatus` directly, letting the core handle SSH failures
- `kastell guard --help` shows all 3 subcommands (parent guard command has no `.action()`)

Commander registration in `src/index.ts` uses the subcommand group pattern:
```
const guard = program.command("guard")
guard.command("start [query]") ...
guard.command("status [query]") ...
guard.command("stop [query]") ...
```

## Commits

| Hash | Message |
|------|---------|
| ce69ce6 | test(30-02): add failing tests for guard CLI command |
| a22152c | feat(30-02): implement guard CLI command and Commander registration |

## Tasks

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Guard CLI command wrapper + Commander registration | Complete | a22152c |

## Test Results

- Guard command tests: 23 passed (all new)
- Guard core tests: 79 still passing (no regressions)
- Full suite: 2887 passed (0 failures)
- Build: TypeScript compiles cleanly
- `kastell guard --help`: shows start, status, stop subcommands

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/commands/guard.ts` — FOUND
- `tests/unit/guard-command.test.ts` — FOUND
- `src/index.ts` updated with guard subcommand group — FOUND
- Commits ce69ce6 and a22152c — FOUND
