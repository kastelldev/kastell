# Plugin SDK v3

Kastell v2.3 introduces **Plugin API v3** for plugin authors. v3 separates the
read-only audit check (`read`) from the optional lifecycle-driven Active Probe
(`activeProbe`), giving plugin authors a deterministic, session-scoped surface
for checks that need a temporary side effect to verify behavior — while
preserving full read-only support for plugins that never touch the server.

> **Migrating an existing v2 plugin?** See
> [`docs/plugin-sdk-migration-v3.md`](./plugin-sdk-migration-v3.md) for the
> step-by-step migration path and rejection rules.

## v3 manifest

A v3 manifest declares `apiVersion: "3"` and the `kastell` version range that
introduced v3 (currently `>=2.3.0`).

```json
{
  "name": "kastell-plugin-example",
  "version": "1.0.0",
  "apiVersion": "3",
  "kastell": ">=2.3.0",
  "capabilities": ["audit"],
  "checkPrefix": "EXA",
  "entry": "index.js"
}
```

Supported `apiVersion` values are `"2"` (read-only compatibility) and `"3"`
(current). See [Migration guide](./plugin-sdk-migration-v3.md) for v2 → v3
disposition.

## v3 check shapes

A v3 check declares **either or both** of `read` and `activeProbe`. The loader
rejects any v3 check that omits both.

### Read-only check

```json
{
  "id": "EXA-EXAMPLE-CHECK",
  "name": "Example read check",
  "category": "Example",
  "severity": "info",
  "description": "A read-only v3 check",
  "read": {
    "cmd": "test -d /tmp && echo ready",
    "passPattern": "^ready$"
  }
}
```

- `read.cmd` — shell command executed on the target server through the
  controlled SSH surface.
- `read.passPattern` / `read.failPattern` — regex applied to the trimmed stdout.
  When `passPattern` matches, the check passes. When `failPattern` matches,
  the check fails. When neither matches, the check is reported as
  "score-neutral" (audit only, no score impact).
- The `cmd` is guarded against `---SECTION:`, `KASTELL_PLUGIN_CHECK_EOF`, and
  CR characters.

### Probe-only check

```json
{
  "id": "EXA-EXAMPLE-PROBE",
  "name": "Example Active Probe",
  "category": "Example",
  "severity": "info",
  "description": "Probe-only v3 check",
  "activeProbe": {
    "handler": "./probes/example-probe.js",
    "risk": "low",
    "timeoutMs": 30000
  }
}
```

- `activeProbe.handler` — relative `./path.js` to a module that exports
  `prepare`, `execute`, `verify`, `rollback` (see
  [Lifecycle signatures](#lifecycle-signatures)).
- `activeProbe.risk` — one of `"low"`, `"medium"`, `"high"`. The runtime uses
  this to scope which servers accept the probe.
- `activeProbe.timeoutMs` — integer, `5000` ≤ `timeoutMs` ≤ `300000`. The
  runtime bounds the full prepare → execute → verify → rollback cycle.

### Combined read + Active Probe

```json
{
  "id": "EXA-TMP-MODE-ACTIVE",
  "name": "/tmp file mode round-trip",
  "category": "Example",
  "severity": "info",
  "description": "Read probes /tmp writability; Active Probe verifies a 0600 round-trip",
  "read": {
    "cmd": "test -d /tmp && test -w /tmp && echo ready",
    "passPattern": "^ready$"
  },
  "activeProbe": {
    "handler": "./probes/tmp-mode-round-trip.js",
    "risk": "low",
    "timeoutMs": 30000
  }
}
```

The read step is a fast, low-impact pre-check. If the read fails, the
Active Probe is **not** executed. The audit report distinguishes "skipped due
to read failure" from "passed/failed".

## Lifecycle signatures

An Active Probe module exports **four named functions** as ESM exports:

```js
// probes/example-probe.js
export async function prepare(ctx) { /* ... */ return prepared; }
export async function execute(ctx, prepared) { /* ... */ return executed; }
export async function verify(ctx, prepared, executed) { /* ... */ return { passed, summary?, data? }; }
export async function rollback(ctx, prepared, executed?) { /* ... */ return { success, summary?, data? }; }
```

| Stage | Receives | Returns | Notes |
|-------|----------|---------|-------|
| `prepare`  | `ctx` | any (opaque to runtime, passed to next stage) | one session-scoped side effect: derive a path, allocate a reservation. Must be idempotent within a session. |
| `execute`  | `ctx`, `prepared` | any | the only stage that performs the side effect. Must touch only the prepared path. |
| `verify`   | `ctx`, `prepared`, `executed` | `{ passed: boolean, summary?: string, data?: Record<string, unknown> }` | read-only check that the side effect landed. |
| `rollback` | `ctx`, `prepared`, `executed?` | `{ success: boolean, summary?: string, data?: Record<string, unknown> }` | idempotent removal of the prepared path. Runs even on `verify` failure. |

### `PluginProbeContext`

```ts
interface PluginProbeContext {
  readonly target: { serverId: string; provider: string; cloudId?: string; ip: string };
  readonly sessionId: string;        // UUID per audit invocation
  readonly pluginName: string;
  readonly checkId: string;
  readonly signal: AbortSignal;      // per-probe cancellation
  readonly deadlineMs: number;
  ssh: (cmd: string, opts?: { timeoutMs?: number }) => Promise<{ stdout: string; stderr: string; code: number }>;
  logger: { info(msg, fields?): void; warn(msg, fields?): void; error(msg, fields?): void };
}
```

- The probe **must not** spawn its own SSH clients; it must use `ctx.ssh`.
- The probe **must not** perform any side effect outside the path it prepared.
  Rollback refuses to remove paths outside the probe prefix.
- The probe **must** treat the `sessionId` as opaque. The runtime derives
  session-scoped paths and markers from a digest of `sessionId`.

## Payload limits and encryption

Active Probes can carry structured data through `prepared`, `executed`, and the
`data` field of `verify` / `rollback` results. The runtime applies:

- **Bounded JSON** — the encoded payload is capped at the
  `PLUGIN_PROBE_PAYLOAD_MAX_BYTES` limit (default 16 KiB). Exceeding the cap
  fails the probe with a `PayloadOversize` error.
- **Field redaction** — the `safeStringify` redactor strips tokens, IP
  addresses, and known secret shapes from log fields before they are written
  to the audit log.
- **Encrypted at rest** — completed probe sessions are encrypted under the
  Kastell data-encryption key before being written to
  `~/.kastell/probe-sessions/`. The encryption uses AES-256-GCM with a
  per-session nonce.

## Context capabilities and in-process trust warning

Plugin code runs **in-process** with the Kastell CLI. There is no sandbox, no
GPG verification, and no tiered trust — Kastell uses the same trust model as
`npm install`. The runtime exposes only the documented `PluginProbeContext`
fields to probes; the plugin module can `import` arbitrary Node.js APIs.

**Treat plugin code as you would treat a `postinstall` script.** Review
`read.cmd`, `activeProbe.handler`, and the probe module's source before
installing. Kastell v2.4 plans a tiered-trust model with GPG signature
verification.

The probe is also subject to:

- **File-system path containment** — the loader rejects handler paths that
  escape the plugin directory via lexical + realpath checks.
- **SHA-256 fingerprint** — the loader records the SHA-256 of the probe module
  at load time. The fingerprint is included in the audit log.
- **Risk-based server filter** — servers flagged as `production` (or any other
  Kastell label that the operator configures) can opt out of probes with
  `risk: "high"`.

## Normal audit non-execution statement

**Kastell never executes an Active Probe during a normal audit run.** Active
Probes are gated behind an explicit operator action (`kastell probe run
<server> <plugin>:<checkId>` or the equivalent MCP call). The audit pipeline
performs only the `read` step; if a check declares `activeProbe` but no
`read`, the check is reported as "read absent, probe-only — skipped during
audit". The probe is exercised only when the operator invokes the probe
dispatcher, which is rate-limited and per-server by default.

This separation ensures that the routine security audit is fully read-only,
deterministic, and idempotent. Side-effecting checks require an explicit
operator decision.
