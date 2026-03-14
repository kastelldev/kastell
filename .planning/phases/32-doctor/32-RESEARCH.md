# Phase 32: Doctor - Research

**Researched:** 2026-03-14
**Domain:** Proactive server health analysis — local cache reads, SSH live checks, linear regression, output formatting
**Confidence:** HIGH

## Summary

Phase 32 extends the existing `kastell doctor` command (which currently only checks the local environment) into a per-server proactive health analysis command. The new `kastell doctor <server>` form runs deterministic checks across six categories — disk trend, swap, stale packages, fail2ban bans, audit regression streaks, backup age, and Docker disk — and presents findings grouped by severity with a concrete remediation command for each.

The command already exists in `src/commands/doctor.ts` and is registered in `src/index.ts`. Phase 32 does NOT replace the no-argument local-environment check; it adds a server argument mode alongside it. The current `doctor` Commander registration (`program.command("doctor")`) accepts no arguments and no server name. The registration must be changed to `program.command("doctor [server]")` to support the new mode while preserving backward compatibility.

The critical architectural decision is the data source: by default, doctor reads cached `MetricSnapshot` data from `~/.kastell/` (written by guard via SSH) and `audit-history.json` without making a live SSH connection. When `--fresh` is passed, it SSHes to collect a fresh snapshot first, then runs the same analysis. All check logic will live in `src/core/doctor.ts` as pure or near-pure functions, following the "commands thin, core fat" convention.

**Primary recommendation:** Create `src/core/doctor.ts` with typed `DoctorFinding` and pure check functions; update `src/commands/doctor.ts` to dispatch on presence of a server argument; extend the Commander registration to accept `[server]`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DOC-01 | `kastell doctor <server>` — proactive per-server analysis grouped by severity (critical/warning/info) | Commander registration change + new `runServerDoctor` orchestrator in core |
| DOC-02 | Disk trending full — linear extrapolation from 2+ MetricSnapshot data points, projected time-to-full | Pure `checkDiskTrend()` function reading `metrics.json` history; MetricSnapshot already written by guard (GUARD-09) |
| DOC-03 | High swap, stale packages, elevated fail2ban ban rate | SSH commands (or --fresh SSHed snapshot); swap from `free`, packages from `apt list --upgradable`, fail2ban from `fail2ban-client status` |
| DOC-04 | Audit regression streaks, old backups | Regression from `audit-history.json` via `loadAuditHistory()`; backup age from backup log timestamp on VPS |
| DOC-05 | Reclaimable Docker disk space | `docker system df` parsing via SSH (or --fresh); report `reclaimable` field |
| DOC-06 | Each finding: severity, description, recommended `kastell`/shell command | Typed `DoctorFinding` interface; check functions return `DoctorFinding | null` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript (strict) | ES2022 | All source | Project-wide |
| Commander.js | existing | CLI argument parsing | Already used for all commands |
| Chalk | existing | Terminal colouring | Already used by `logger` utilities |
| Ora | existing | Spinner for SSH --fresh mode | Already used by guard/audit commands |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/utils/ssh.ts` | internal | SSH execution via `sshExec` | --fresh live data collection |
| `src/utils/config.ts` | internal | `CONFIG_DIR`, `getServers()` | Reading cached data paths |
| `src/utils/serverSelect.ts` | internal | `resolveServer()` | Server fuzzy-matching from name/IP |
| `src/core/audit/history.ts` | internal | `loadAuditHistory()` | Audit regression streak detection (DOC-04) |
| `src/types/index.ts` | internal | `MetricSnapshot` type | Reading guard-written metric data |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reading single `metrics.json` | Full SSH on every run | `metrics.json` is only ONE snapshot — guard overwrites it each run. DOC-02 requires 2+ points, so doctor needs a metrics HISTORY file or must collect via --fresh |
| New metrics history file | Reuse `audit-history.json` | Different schema — MetricSnapshot vs AuditHistoryEntry. Separate file is cleaner. |

**Installation:** No new packages required. All dependencies already in project.

## Architecture Patterns

### Critical Discovery: MetricSnapshot Storage Gap

The guard script (Phase 30) writes a **single** `metrics.json` file at `/var/lib/kastell/metrics.json` — it overwrites on every run (every 5 minutes). Doctor running `kastell doctor <server>` reads from `~/.kastell/` (local config), not from the remote VPS.

This creates a problem for DOC-02 (disk trending from 2+ data points): there is no local metrics history file. The remote `metrics.json` contains only the most recent snapshot.

**Two viable solutions:**

1. **--fresh collects and caches locally**: When `--fresh` is passed, sshExec reads `/var/lib/kastell/metrics.json` from the remote, and doctor stores it in a local `~/.kastell/metrics-history-<serverip>.json` file. Without `--fresh`, only the cached entries are available.

2. **Guard appends to a local history during `guard status`**: Not the right phase to change guard behavior.

**Recommended pattern (consistent with MEMORY.md note on Phase 32):** Doctor keeps a local `~/.kastell/doctor-metrics-<serverip>.json` that is a JSON array of MetricSnapshot entries. When `--fresh` is passed, doctor fetches the current remote snapshot via SSH and appends it to the local array before running analysis. Without `--fresh`, it reads whatever local entries exist. This means: if the user has never run `kastell doctor <server> --fresh`, disk trend will have 0 data points and DOC-02 will gracefully report "insufficient data."

The requirement states: "Doctor completes using cached snapshots without making a live SSH connection unless `--fresh` is passed" — this confirms the above approach.

### Recommended Project Structure

```
src/
  commands/
    doctor.ts           # Updated: handles both no-arg (local) and [server] (remote) modes
  core/
    doctor.ts           # NEW: DoctorFinding type + all check functions + orchestrator
  types/
    index.ts            # MetricSnapshot already present — no changes needed
tests/
  unit/
    doctor.test.ts      # Existing (local checks only) — extend
    doctor-server.test.ts  # NEW: pure server check functions
```

### Pattern 1: DoctorFinding Type

**What:** A finding is a typed object with severity, description, and a recommended command. Every check function returns `DoctorFinding | null` (null = no finding, condition not met).

**When to use:** All six check categories follow this return contract.

```typescript
// src/core/doctor.ts
export type DoctorSeverity = "critical" | "warning" | "info";

export interface DoctorFinding {
  id: string;                   // e.g. "DISK_TREND"
  severity: DoctorSeverity;
  description: string;          // human-readable problem statement
  command: string;              // kastell or shell command to address it
}

export interface DoctorResult {
  serverName: string;
  serverIp: string;
  findings: DoctorFinding[];    // sorted: critical first, then warning, then info
  ranAt: string;                // ISO timestamp
  usedFreshData: boolean;
}
```

### Pattern 2: Pure Check Functions

**What:** Each check is a pure function accepting data (MetricSnapshot[], AuditHistoryEntry[], string output from SSH) and returning `DoctorFinding | null`.

**When to use:** All six DOC requirements map to a pure check function. SSHing is isolated to the orchestrator.

```typescript
// DOC-02: disk trending
export function checkDiskTrend(snapshots: MetricSnapshot[]): DoctorFinding | null {
  if (snapshots.length < 2) return null;
  // sort by timestamp, linear regression on diskPct vs time
  // project when diskPct reaches 95
  // return finding if projected_days < 30, severity based on projected_days
}

// DOC-03: swap
export function checkSwapUsage(snapshot: MetricSnapshot): DoctorFinding | null { ... }

// DOC-03: stale packages (needs SSH output string)
export function checkStalePackages(aptOutput: string): DoctorFinding | null { ... }

// DOC-03: fail2ban ban rate (needs SSH output string)
export function checkFail2banBanRate(fail2banOutput: string): DoctorFinding | null { ... }

// DOC-04: audit regression streak
export function checkAuditRegressionStreak(history: AuditHistoryEntry[]): DoctorFinding | null { ... }

// DOC-04: backup age (needs SSH output string — timestamp from backup log)
export function checkBackupAge(backupLogOutput: string): DoctorFinding | null { ... }

// DOC-05: docker disk reclaimable (needs SSH output string from docker system df)
export function checkDockerDisk(dockerDfOutput: string): DoctorFinding | null { ... }
```

### Pattern 3: Orchestrator Separation

**What:** `runServerDoctor(ip, serverName, options)` handles all I/O (SSH calls, file reads) and calls pure check functions with the collected data.

```typescript
export async function runServerDoctor(
  ip: string,
  serverName: string,
  options: { fresh?: boolean }
): Promise<KastellResult<DoctorResult>> { ... }
```

### Pattern 4: MetricSnapshot Local Cache

**What:** Doctor maintains a local array of MetricSnapshot per server. Guard writes the remote single-entry `metrics.json`; doctor fetches it via SSH when `--fresh` is passed and appends to local history.

```typescript
// ~/.kastell/doctor-metrics-<serverip>.json  — array of MetricSnapshot
// Written by runServerDoctor when fresh=true
// Read by runServerDoctor for disk trend analysis (DOC-02)
```

**Cache file path builder:**
```typescript
function metricsHistoryPath(serverIp: string): string {
  return join(CONFIG_DIR, `doctor-metrics-${serverIp.replace(/\./g, "-")}.json`);
}
```

### Pattern 5: Linear Extrapolation for Disk Trend

**What:** DOC-02 requires "linear extrapolation from 2+ data points" and "projected time-to-full estimate."

**Algorithm:**
- Sort snapshots by timestamp ascending
- Compute slope: `(diskPct[last] - diskPct[first]) / (time[last] - time[first])` in hours
- If slope <= 0: no trend (disk not growing)
- Project hours until diskPct reaches 95: `(95 - diskPct[last]) / slope`
- Convert to days for display
- Severity: critical if < 3 days, warning if < 14 days, info if < 30 days
- Return null if slope <= 0 or projected > 30 days

```typescript
function projectDaysToFull(snapshots: MetricSnapshot[]): number | null {
  const sorted = [...snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const dtHours = (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 3_600_000;
  if (dtHours <= 0) return null;
  const slope = (last.diskPct - first.diskPct) / dtHours;
  if (slope <= 0) return null;
  const hoursToFull = (95 - last.diskPct) / slope;
  return hoursToFull / 24;
}
```

### Pattern 6: SSH Commands for --fresh Checks

**What:** When `--fresh` is passed, doctor runs specific SSH commands to collect live data.

```bash
# Fetch current MetricSnapshot from guard's output file
cat /var/lib/kastell/metrics.json 2>/dev/null || echo "{}"

# Stale packages (DOC-03)
apt list --upgradable 2>/dev/null | wc -l

# Fail2ban ban count (DOC-03) — total bans across all jails
fail2ban-client status 2>/dev/null | grep -oP 'Jail list:\s*\K.*' | tr ',' '\n' | xargs -I{} fail2ban-client status {} 2>/dev/null | grep 'Total banned' | awk '{sum+=$NF} END {print sum+0}'

# Backup age — timestamp of most recent kastell backup log entry
tail -1 /var/log/kastell-backup.log 2>/dev/null || echo ""

# Docker disk reclaimable (DOC-05)
docker system df --format '{{json .}}' 2>/dev/null || echo "[]"
```

### Pattern 7: Commander Registration Change

**What:** The current `program.command("doctor")` accepts no arguments. Must change to `program.command("doctor [server]")` to add the new mode.

```typescript
// index.ts change
program
  .command("doctor [server]")
  .description("Check local environment and configuration, or run proactive analysis on a server")
  .option("--check-tokens", "Validate provider API tokens (local mode only)")
  .option("--fresh", "Fetch live data from server via SSH before analysis")
  .option("--json", "Output findings as JSON")
  .action((server?: string, options?: { checkTokens?: boolean; fresh?: boolean; json?: boolean }) =>
    doctorCommand(server, options, pkg.version)
  );
```

### Anti-Patterns to Avoid

- **Checking MetricSnapshot at remote path directly**: Doctor is a local command reading local cache; SSH only on `--fresh`.
- **Building a single-file all-inclusive SSH command**: Collect data in separate targeted SSH calls; parse each output independently — easier to unit-test.
- **Throwing on missing data**: Always return null from check functions when data is insufficient — graceful degradation is required.
- **Mutating the existing `doctorCommand` signature blindly**: The current `doctorCommand(options?, version?)` must become `doctorCommand(server?, options?, version?)` — old call sites in tests must be updated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Server fuzzy-match | Custom name search | `resolveServer()` in `serverSelect.ts` | Already handles partial name + IP matching |
| Audit history loading | Custom file read | `loadAuditHistory(serverIp)` in `audit/history.ts` | Handles missing file, corrupt JSON, per-server filter |
| Atomic file writes | Manual write | Pattern from `history.ts` (tmp + rename) | Prevents corruption on crash |
| SSH execution | Raw `child_process` | `sshExec(ip, command)` from `utils/ssh.ts` | Handles timeout, stderr, exit code |
| IP validation | Regex check | `assertValidIp(ip)` from `utils/ssh.ts` | Consistent with all other commands |
| Config dir path | `join(homedir(), ...)` | `CONFIG_DIR` from `utils/config.ts` | Single source of truth |

**Key insight:** All infrastructure (SSH, file I/O, config) is already built. Phase 32 is almost entirely business logic in pure functions.

## Common Pitfalls

### Pitfall 1: MetricSnapshot Is Single-Entry, Not History
**What goes wrong:** Developer reads `/var/lib/kastell/metrics.json` and tries to extrapolate trend from one data point — gets no findings.
**Why it happens:** Guard overwrites `metrics.json` each run. There is no remote history array.
**How to avoid:** Doctor maintains `~/.kastell/doctor-metrics-<ip>.json` as a local append-only array. Each `--fresh` run appends one entry.
**Warning signs:** `checkDiskTrend` always returning null even after many guard runs.

### Pitfall 2: Commander Signature Breaking Old Local Mode
**What goes wrong:** Changing `program.command("doctor")` to `program.command("doctor [server]")` without updating the action handler breaks `kastell doctor` (no-arg) for existing users.
**Why it happens:** Commander passes `server=undefined` when no argument given; handler must branch on `server !== undefined`.
**How to avoid:** Early return in `doctorCommand`: if `!server`, run existing local checks; else run `runServerDoctor`.

### Pitfall 3: Swap Not in MetricSnapshot
**What goes wrong:** Developer tries to read swap from MetricSnapshot — it's not there (MetricSnapshot only has diskPct, ramPct, cpuLoad1, ncpu, auditScore).
**Why it happens:** Guard script doesn't collect swap data.
**How to avoid:** Swap check (DOC-03) always requires SSH — it is always a `--fresh`-dependent check OR requires adding swap to the guard metrics. For cached mode: skip swap check gracefully with info message. Recommended: collect swap when `--fresh` via SSH (`free | awk '/Swap:/{print $3/$2*100}'`).

### Pitfall 4: fail2ban Not Present on All Servers
**What goes wrong:** `fail2ban-client status` fails with non-zero exit code on servers without fail2ban — sshExec returns code != 0, developer treats as SSH error.
**Why it happens:** Not every server has fail2ban installed.
**How to avoid:** In check function, treat empty/error output as "fail2ban not present = no finding" rather than error.

### Pitfall 5: Docker Not Present on All Servers
**What goes wrong:** `docker system df` fails with command-not-found on bare servers.
**Why it happens:** Bare servers may not have Docker.
**How to avoid:** Wrap docker SSH command with `command -v docker &>/dev/null && docker system df --format '{{json .}}' || echo ""`. Empty output = no finding.

### Pitfall 6: Regression Streak Definition
**What goes wrong:** Developer detects "regression" as any single negative delta — too noisy.
**Why it happens:** DOC-04 says "regression streaks" (plural, implying consecutive).
**How to avoid:** `checkAuditRegressionStreak` should detect N consecutive entries where delta < 0 (recommend N=2 minimum). Single regressions are noise.

### Pitfall 7: Backup Age With No Backup Log
**What goes wrong:** `kastell-backup.log` doesn't exist if backup was never scheduled — SSH returns empty, parse fails.
**Why it happens:** Backup log only exists if `kastell backup --schedule` was used and at least one run occurred.
**How to avoid:** Empty backup log output = no finding (not a critical error).

## Code Examples

Verified patterns from existing codebase:

### Loading Audit History (DOC-04 support)
```typescript
// Source: src/core/audit/history.ts
import { loadAuditHistory } from "../core/audit/history.js";
const history = loadAuditHistory(serverIp); // AuditHistoryEntry[]
```

### SSH Execution Pattern
```typescript
// Source: src/core/guard.ts (guardStatus)
import { sshExec, assertValidIp } from "../utils/ssh.js";
assertValidIp(ip);
const result = await sshExec(ip, "cat /var/lib/kastell/metrics.json 2>/dev/null || echo {}");
if (result.code !== 0) { /* handle error */ }
const data = JSON.parse(result.stdout);
```

### Server Resolution Pattern
```typescript
// Source: src/commands/audit.ts
import { resolveServer } from "../utils/serverSelect.js";
const server = await resolveServer(serverName, "Select a server for doctor analysis:");
if (!server) return;
const { ip, name } = server;
```

### KastellResult Return Pattern
```typescript
// Source: src/types/index.ts
export interface KastellResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  hint?: string;
}
// Usage in orchestrators: return { success: true, data: doctorResult }
```

### Local Cache Atomic Write (for metrics history)
```typescript
// Source: src/core/audit/history.ts (atomic write pattern)
const tmpFile = cacheFile + ".tmp";
writeFileSync(tmpFile, JSON.stringify(entries, null, 2), "utf-8");
renameSync(tmpFile, cacheFile);
```

### Test: Pure Function Pattern (from audit-trend.test.ts)
```typescript
// tests/unit/audit-trend.test.ts — model for doctor-server tests
import { computeTrend } from "../../src/core/audit/history.js";
// No mocks needed — pure function test
it("returns null when fewer than 2 data points", () => {
  const result = checkDiskTrend([singleSnapshot]);
  expect(result).toBeNull();
});
```

### Test: SSH-Dependent Orchestrator (from guard.test.ts)
```typescript
// tests/unit/guard.test.ts — model for orchestrator tests
jest.mock("../../src/utils/ssh");
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: '{"diskPct":45}', stderr: "" });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `kastell doctor` = local env check only | `kastell doctor [server]` = local OR per-server proactive analysis | Phase 32 | Two modes in one command |
| MetricSnapshot = remote single-entry file | MetricSnapshot history = local cache per server | Phase 32 | Enables DOC-02 trend analysis |
| Guard writes single metrics.json | Doctor appends to local history on --fresh | Phase 32 | Preserves guard simplicity |

**Deprecated/outdated:**
- Current `doctorCommand(options?, version?)` signature: Must become `doctorCommand(server?, options?, version?)` in Phase 32.

## Open Questions

1. **Swap data in cached mode (no --fresh)**
   - What we know: MetricSnapshot does not include swap. DOC-03 requires swap detection.
   - What's unclear: Should cached mode skip swap silently or add swap to MetricSnapshot?
   - Recommendation: Collect swap via SSH when `--fresh`; skip swap check in cached mode with no error (just no finding). This is simpler than changing guard's MetricSnapshot schema, which would break existing data.

2. **Minimum regression streak length for DOC-04**
   - What we know: DOC-04 says "regression streaks" — plural implies > 1.
   - What's unclear: Is 2 consecutive regressions sufficient? 3?
   - Recommendation: 2 consecutive declining scores = warning severity. This matches what a user would consider actionable.

3. **Stale packages threshold**
   - What we know: `apt list --upgradable` output line count includes a header line.
   - What's unclear: What count triggers a finding?
   - Recommendation: > 10 upgradable packages = warning; > 50 = critical. Subtract 1 for the "Listing..." header line.

4. **fail2ban ban rate — absolute count or rate?**
   - What we know: DOC-03 says "elevated fail2ban ban rate."
   - What's unclear: Rate implies time-windowed — but guard doesn't track historical ban counts.
   - Recommendation: Use total-banned count as a proxy. > 100 total bans = warning. This is a snapshot metric, not a true rate, but it's actionable and deterministic.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (CJS config) |
| Config file | `jest.config.cjs` |
| Quick run command | `npm test -- --testPathPattern="doctor"` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOC-01 | `doctorCommand(server, options)` dispatches to `runServerDoctor` | unit | `npm test -- --testPathPattern="doctor-server"` | Wave 0 |
| DOC-02 | `checkDiskTrend` returns null < 2 points; returns finding with projected days >= 2 points | unit | `npm test -- --testPathPattern="doctor-server"` | Wave 0 |
| DOC-03 | `checkSwapUsage`, `checkStalePackages`, `checkFail2banBanRate` pure function contracts | unit | `npm test -- --testPathPattern="doctor-server"` | Wave 0 |
| DOC-04 | `checkAuditRegressionStreak` detects N consecutive regressions; `checkBackupAge` detects stale | unit | `npm test -- --testPathPattern="doctor-server"` | Wave 0 |
| DOC-05 | `checkDockerDisk` parses `docker system df` output; returns null when docker absent | unit | `npm test -- --testPathPattern="doctor-server"` | Wave 0 |
| DOC-06 | Every returned `DoctorFinding` has severity, description, command fields populated | unit | `npm test -- --testPathPattern="doctor-server"` | Wave 0 |
| DOC-01 | `kastell doctor` (no server) still runs local checks | unit | `npm test -- --testPathPattern="doctor.test"` | ✅ exists |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern="doctor"`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/doctor-server.test.ts` — covers DOC-01 through DOC-06 pure function checks

*(Existing `tests/unit/doctor.test.ts` covers local-environment mode — no changes needed there for Wave 0)*

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `src/core/guard.ts` — MetricSnapshot write behavior, GUARD_METRICS_PATH constant
- Direct codebase read: `src/types/index.ts` — MetricSnapshot interface definition
- Direct codebase read: `src/core/audit/history.ts` — loadAuditHistory, computeTrend patterns
- Direct codebase read: `src/commands/doctor.ts` — existing doctor command structure
- Direct codebase read: `src/index.ts` — Commander registration, current doctor signature
- Direct codebase read: `.planning/REQUIREMENTS.md` — DOC-01 through DOC-06 text
- Direct codebase read: `.planning/STATE.md` — accumulated architectural decisions

### Secondary (MEDIUM confidence)
- `tests/unit/guard.test.ts` — SSH mock patterns for orchestrator tests
- `tests/unit/audit-trend.test.ts` — pure function test patterns
- `jest.config.cjs` — test roots and transform configuration

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, no new dependencies
- Architecture: HIGH — data flow is directly constrained by existing guard/audit infrastructure; patterns confirmed by reading source
- Pitfalls: HIGH — discovered from reading actual MetricSnapshot schema, guard script, and Commander registration
- Open questions: MEDIUM — thresholds (stale package count, ban count) are judgment calls not specified in requirements

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable codebase, no external dependencies)
