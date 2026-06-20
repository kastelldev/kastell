# Plugin SDK Migration Guide (v2 → v3)

This guide helps plugin authors migrate a v2 plugin to v3, explains the
rejection rules, and clarifies what Kastell does **not** do for you
automatically.

> **Migrating an existing v2 plugin?** See
> [`docs/plugin-sdk-v3.md`](./plugin-sdk-v3.md) for the v3 manifest and check
> shapes.

## Compatibility overview

| v2 feature                                     | v3 disposition                                                |
|------------------------------------------------|---------------------------------------------------------------|
| `apiVersion: "2"` with `checkCommand.kind: "read"` | **Accepted** — read-only v2 plugins continue to work       |
| `apiVersion: "2"` with `checkCommand.kind: "mutate-local"` or `"mutate-global"` | **Rejected** — see [Mutating checks](#mutating-checks-rejected) |
| `apiVersion: "2"` with top-level `fixCommand` string | **Rejected** — see [Raw `fixCommand`](#raw-fixcommand-rejected) |
| `apiVersion: "2"` with `checkCommand.kind: "fix"` | **Rejected** — same rationale as raw `fixCommand`        |
| `apiVersion: "3"`                              | **Required for new functionality**                            |
| `activeProbe` in v3                           | **New** — Active Probe lifecycle                              |
| `read` in v3                                  | **New** — explicit read-only check shape                      |

## Mutating checks (rejected)

Kastell v2.3 deliberately drops the v2 `checkCommand.kind: "mutate-local"`
and `"mutate-global"` shapes. Those shapes invited plugins to silently
reconfigure production servers during a routine audit, which contradicts
Kastell's read-only audit guarantee. They are also incompatible with the v3
read + activeProbe split, where side effects are confined to the Active Probe
stage and require an explicit operator action.

A v2 plugin that declares a mutating `checkCommand` is loaded with status
`failed` and the loader emits a migration guidance error. The audit pipeline
never reaches the mutating command.

### Migration recipe (mutate → activeProbe)

1. Bump `apiVersion` to `"3"` and the plugin `version` (e.g. `1.0.0` →
   `2.0.0`).
2. Move the side effect into a probe module under `probes/<name>.js`. Export
   `prepare`, `execute`, `verify`, `rollback` per
   [`docs/plugin-sdk-v3.md`](./plugin-sdk-v3.md#lifecycle-signatures).
3. Replace the mutating `checkCommand` with:
   - a `read` block (low-cost pre-check, e.g. `test -d /target`); and
   - an `activeProbe` block pointing at the new probe module.
4. Document in the plugin's `README.md` that the side effect runs only when
   the operator invokes `kastell probe run <server> <plugin>:<checkId>`.
5. Bump the plugin's `kastell` constraint to `">=2.3.0"`.

The audit pipeline will only ever execute the `read` block. The `activeProbe`
is gated behind the operator's explicit decision.

## Raw `fixCommand` (rejected)

Kastell v2.3 drops the v2 "raw fix string" shape (`fixCommand: "chmod 600 /etc/passwd"`)
and `checkCommand.kind: "fix"`. Both shapes lack a typed contract, accept any
shell string, and bypass the v3 lifecycle.

A v2 plugin that declares a raw `fixCommand` is loaded with status `failed`
and the loader emits a migration guidance error. The fix never runs.

### Migration recipe (raw fix → v3 lifecycle)

1. Reframe the fix as a v3 Active Probe where the `execute` stage performs
   the corrective action, `verify` asserts the post-state, and `rollback`
   restores the prior state. This gives Kastell a structured, audited, and
   idempotent surface.
2. If the fix is genuinely one-shot and cannot be expressed as a probe
   (e.g. provisioning), move it out of the plugin model and into a
   `kastell <command>` flow under `commands/`. Commands are still in-process
   and trusted, but they are gated by `KASTELL_SAFE_MODE` and never executed
   during a routine audit.

## Manual lifecycle redesign checklist

Use this checklist when a v2 mutating check or raw `fixCommand` must be
re-expressed as a v3 Active Probe:

- [ ] Identify the smallest possible side effect that proves the check.
      Prefer a single file in a session-scoped path over a stateful service
      reconfiguration.
- [ ] Confirm the side effect can be **rolled back** without operator
      intervention. If not, the check is not probe-shaped — move it to a
      `kastell <command>` flow.
- [ ] Author `prepare` to derive a session-scoped path or reservation
      (e.g. a deterministic SHA-256 marker derived from `ctx.sessionId`).
- [ ] Author `execute` to perform the side effect **only** on the prepared
      path or reservation.
- [ ] Author `verify` to assert the post-state via a read-only shell call.
- [ ] Author `rollback` to remove the prepared path or reservation
      idempotently (no-op if it is already gone).
- [ ] Add a `read` block that gates the probe (e.g.
      `test -d /target && echo ready`).
- [ ] Set `activeProbe.risk` to the smallest tier that fits
      (`"low" | "medium" | "high"`).
- [ ] Set `activeProbe.timeoutMs` to the smallest budget that fits
      (5 000 ≤ timeout ≤ 300 000 ms).
- [ ] Document the lifecycle in the plugin's `README.md` and link to
      [`docs/plugin-sdk-v3.md`](./plugin-sdk-v3.md).
- [ ] Bump the plugin's `version` and `kastell` constraint.

## No automatic installed-plugin rewrite

Kastell does **not** automatically rewrite an installed v2 plugin to v3.
Reasons:

- The plugin source is owned by its author, not by Kastell.
- An automatic rewrite would silently change audit behavior (e.g. a v2
  mutating check would change shape) and break the audit guarantee.
- A rewrite would still leave the plugin's external dependencies (npm
  registry, GitHub releases, etc.) out of date, so the user would have to
  reinstall the rewritten version manually anyway.

Kastell's role is to **detect** the v2 shape, **reject** the plugin load with
migration guidance, and **leave the plugin's source under the user's
control**. The user (or the plugin author) re-releases the plugin; the user
then runs `kastell plugin update <name>` (or re-installs manually).

## Maintained example migration

The `examples/plugins/` directory ships two maintained plugins migrated to
v3 in this release:

### `kastell-plugin-wordpress` (1.0.0 → 1.1.0)

- 3 v2 mutating checks were rewritten as 3 v3 read-only checks
  (`WP-FILE-PERMS`, `WP-CONFIG-SECURE`, `WP-DEBUG-OFF`).
- `apiVersion` bumped to `"3"`; `kastell` constraint bumped to `">=2.3.0"`.
- The plugin's `index.js` is now ESM with a single named export
  `export const checks = [...]`.
- The plugin's `README.md` documents the read-only behavior and links to
  [`docs/plugin-sdk-v3.md`](./plugin-sdk-v3.md).

### `kastell-plugin-auditor` (1.1.0 → 1.2.0)

- 1 read-only check retained (`AUD-SSH-CUSTOM-PORT`).
- 1 mutating check rewritten as a combined read + Active Probe check
  (`AUD-TMP-MODE-ACTIVE`) backed by `probes/tmp-mode-round-trip.js`.
- `apiVersion` bumped to `"3"`. The plugin retains its `audit`, `command`,
  and `mcp-tool` capabilities.
- Command and MCP handlers are now ESM named exports
  (`export async function handler(args, ctx) { ... }`).
- The probe module is the canonical example of a v3 lifecycle. It uses
  `node:crypto` to derive a session-scoped path from `ctx.sessionId`,
  performs the round-trip via `ctx.ssh`, and rolls back idempotently.

The audit pipeline for both plugins is now strictly read-only. The
`AUD-TMP-MODE-ACTIVE` Active Probe runs only when an operator invokes
`kastell probe run` (or the equivalent MCP call).
