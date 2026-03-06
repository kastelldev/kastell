---
phase: 09-dokploy-adapter
verified: 2026-03-06T08:10:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 9: Dokploy Adapter Verification Report

**Phase Goal:** Users can provision, health-check, and back up Dokploy servers through the same CLI commands and MCP tools used for Coolify, selecting Dokploy via `--mode dokploy` or interactive menu
**Verified:** 2026-03-06T08:10:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DokployAdapter implements all 4 PlatformAdapter methods (getCloudInit, healthCheck, createBackup, getStatus) | VERIFIED | `src/adapters/dokploy.ts` (231 lines) -- all 4 methods with substantive implementations |
| 2 | getCloudInit returns bash script with official Dokploy install command and Docker Swarm ports in firewall rules | VERIFIED | Line 56: `dokploy.com/install.sh`, lines 68-72: ports 3000, 2377, 7946, 4789 in UFW and iptables |
| 3 | healthCheck probes port 3000 (not 8000) and returns running/not-reachable | VERIFIED | Line 101: `http://${ip}:3000`, returns `{ status: "running" }` or `{ status: "not reachable" }` |
| 4 | createBackup dumps Dokploy PostgreSQL via docker exec pg_dump and tars /etc/dokploy | VERIFIED | Line 217: `docker ps -qf name=dokploy-postgres`, `pg_dump -U postgres -d dokploy`, line 221: `/etc/dokploy` |
| 5 | getAdapter('dokploy') returns a DokployAdapter instance | VERIFIED | `factory.ts` line 13-14: `case "dokploy": return new DokployAdapter()` |
| 6 | kastell init --mode dokploy provisions with Dokploy cloud-init and stores platform: dokploy | VERIFIED | `deploy.ts` line 66, `provision.ts` line 130: dynamic platform derivation. Both store `platform` in server record |
| 7 | kastell backup on a Dokploy server routes through DokployAdapter.createBackup | VERIFIED | `commands/backup.ts` lines 72-92: adapter routing via `resolvePlatform` + `getAdapter`. `core/backup.ts` line 369: accepts `platform` param |
| 8 | MCP serverProvision accepts mode dokploy and provisions correctly | VERIFIED | `serverProvision.ts` line 38: `z.enum(["coolify", "dokploy", "bare"])`, handler type includes `"dokploy"` |
| 9 | Interactive menu shows Dokploy as a platform option alongside Coolify and Bare | VERIFIED | `interactive.ts` line 116: `{ name: "Dokploy (auto-install panel)", value: "dokploy" }` |
| 10 | Health check after deploy polls port 3000 for Dokploy servers | VERIFIED | `deploy.ts` line 205: `platformPort = platform === "dokploy" ? 3000 : 8000`. `healthCheck.ts` line 9: `port` parameter |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/adapters/dokploy.ts` | DokployAdapter class implementing PlatformAdapter (min 180 lines) | VERIFIED | 231 lines, all 4 methods + 4 private helpers |
| `tests/unit/dokploy-adapter.test.ts` | Unit tests for all 4 adapter methods (min 100 lines) | VERIFIED | 269 lines, 24 tests across 5 describe blocks |
| `src/core/deploy.ts` | Dynamic platform routing from mode | VERIFIED | Line 66: dokploy platform derivation, line 205: port 3000 |
| `src/core/provision.ts` | Dynamic platform routing from mode for MCP | VERIFIED | Line 130: dokploy platform derivation, line 216: platform stored |
| `src/commands/interactive.ts` | Dokploy option in interactive init menu | VERIFIED | Line 116: Dokploy choice present |
| `src/mcp/tools/serverProvision.ts` | dokploy in MCP mode enum | VERIFIED | Line 38: enum includes "dokploy" |
| `src/core/backup.ts` | createBackup accepts platform parameter | VERIFIED | Line 369: `platform: Platform = "coolify"` parameter |
| `src/commands/backup.ts` | Adapter-routed backup for managed servers | VERIFIED | Lines 72-92 (backupSingleServer), lines 243-268 (backupCommand) |
| `src/mcp/tools/serverBackup.ts` | Passes platform to createBackup | VERIFIED | Lines 81-84: `resolvePlatform(server)` + `createBackup(..., platform)` |
| `src/utils/healthCheck.ts` | Port parameter for platform-specific health check | VERIFIED | Line 9: `port: number = 8000`, line 22: dynamic URL |
| `src/adapters/factory.ts` | DokployAdapter registered in factory | VERIFIED | Lines 5, 13-14: import + case "dokploy" |
| `tests/unit/adapter-factory.test.ts` | getAdapter("dokploy") test | VERIFIED | Lines 51-53: test asserts adapter.name === "dokploy" |
| `src/index.ts` | --mode descriptions include dokploy | VERIFIED | Lines 61, 201: "coolify (default), dokploy, or bare" |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/adapters/dokploy.ts` | `src/adapters/interface.ts` | `implements PlatformAdapter` | WIRED | Line 19: `class DokployAdapter implements PlatformAdapter` |
| `src/adapters/factory.ts` | `src/adapters/dokploy.ts` | case "dokploy" in switch | WIRED | Line 5: import, line 14: `return new DokployAdapter()` |
| `src/adapters/dokploy.ts` | `src/utils/ssh.ts` | assertValidIp and sshExec imports | WIRED | Line 11: `import { assertValidIp, sshExec }` -- used in all 4 methods |
| `src/core/deploy.ts` | `src/adapters/factory.ts` | getAdapter(platform) where platform can be dokploy | WIRED | Line 66: `mode === "dokploy" ? "dokploy"`, line 68: `getAdapter(platform)` |
| `src/core/provision.ts` | `src/adapters/factory.ts` | getAdapter(platform) where platform can be dokploy | WIRED | Line 130: `modeStr === "dokploy" ? "dokploy"`, line 132: `getAdapter(platform)` |
| `src/core/backup.ts` | `src/adapters/factory.ts` | createBackup accepts platform parameter | WIRED | Line 9: import, line 371: `getAdapter(platform)` |
| `src/commands/backup.ts` | `src/adapters/factory.ts` | non-bare backup routes through adapter | WIRED | Line 9: `import { resolvePlatform, getAdapter }`, lines 72-92: adapter routing |
| `src/mcp/tools/serverProvision.ts` | `src/core/provision.ts` | mode dokploy flows through to provision | WIRED | Line 38: enum includes "dokploy", line 66-72: `provisionServer({ mode })` |
| `src/mcp/tools/serverBackup.ts` | `src/core/backup.ts` | platform passed to createBackup | WIRED | Line 18: `import { resolvePlatform }`, line 84: `createBackup(..., platform \|\| "coolify")` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DOKP-01 | 09-01 | DokployAdapter implement edilir (PlatformAdapter interface) | SATISFIED | `src/adapters/dokploy.ts` (231 lines, implements PlatformAdapter) |
| DOKP-02 | 09-01 | Dokploy cloud-init script ile sunucu provision edilir | SATISFIED | `getCloudInit()` returns Dokploy install script with `dokploy.com/install.sh` |
| DOKP-03 | 09-01 | Dokploy health check calisir (port 3000 HTTP probe) | SATISFIED | `healthCheck()` probes port 3000, returns running/not-reachable |
| DOKP-04 | 09-01 | Dokploy backup SSH + SCP ile alinir (/etc/dokploy) | SATISFIED | `createBackup()` does pg_dump + /etc/dokploy tar + SCP download |
| DOKP-05 | 09-02 | CLI'da `--mode dokploy` flag'i desteklenir | SATISFIED | `index.ts` lines 61, 201: --mode accepts dokploy. deploy.ts/provision.ts route correctly |
| DOKP-06 | 09-02 | MCP tool'lari platform parametresi ile Dokploy'a yonlendirilir | SATISFIED | `serverProvision.ts` enum includes dokploy. `serverBackup.ts` passes platform to createBackup |
| DOKP-07 | 09-02 | Interactive menude platform secimi sunulur | SATISFIED | `interactive.ts` line 116: Dokploy option in mode choices |

No orphaned requirements found. All 7 DOKP requirements mapped to Phase 9 in REQUIREMENTS.md are claimed and satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | - |

No TODO, FIXME, PLACEHOLDER, stub returns, or empty handlers found in any Phase 9 files. The `catch(() => {})` on `dokploy.ts:190` is intentional best-effort cleanup (mirrors CoolifyAdapter pattern).

### Human Verification Required

### 1. Dokploy Cloud-Init Provisioning

**Test:** Run `kastell init --mode dokploy --provider hetzner` and let a real server provision
**Expected:** Server boots with Docker Swarm + Dokploy installed, accessible at `http://IP:3000`
**Why human:** Cloud-init script correctness requires a real cloud provider API call and live server

### 2. Dokploy Backup on Live Server

**Test:** Run `kastell backup` on a Dokploy server after it's been provisioned
**Expected:** PostgreSQL dump and /etc/dokploy config are downloaded to local machine with valid manifest
**Why human:** Dokploy PostgreSQL credentials (`-U postgres -d dokploy`) and Swarm container naming (`dokploy-postgres`) need live instance verification

### 3. Interactive Menu Dokploy Flow

**Test:** Run `kastell` (no args) and select "Deploy a new server", then choose "Dokploy"
**Expected:** Mode is set to "dokploy" and provisioning proceeds with Dokploy cloud-init
**Why human:** Interactive terminal UI behavior cannot be verified programmatically

### Gaps Summary

No gaps found. All 10 observable truths verified across both plans. All 13 artifacts exist, are substantive (not stubs), and are properly wired into the system. All 9 key links confirmed. All 7 DOKP requirements satisfied. Build, test (2191/2191), and lint all pass clean.

---

_Verified: 2026-03-06T08:10:00Z_
_Verifier: Claude (gsd-verifier)_
