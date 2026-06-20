# kastell-plugin-auditor

Custom SSH audit checks for Kastell — Plugin API **v3** example that demonstrates
both a pure read-only check and a combined `read + activeProbe` check.

## Checks

| ID | Name | Severity | Shape |
|----|------|----------|-------|
| AUD-SSH-CUSTOM-PORT | SSH on non-default port | critical | read-only |
| AUD-TMP-MODE-ACTIVE | /tmp file mode round-trip | info | read + Active Probe |

## Plugin API v3 contract

### Read-only check

```json
{
  "id": "AUD-SSH-CUSTOM-PORT",
  "name": "SSH custom port",
  "category": "Custom Audit",
  "severity": "critical",
  "description": "Verifies SSH is not running on default port 22",
  "read": {
    "cmd": "grep '^Port ' /etc/ssh/sshd_config | awk '{print $2}'",
    "failPattern": "^22$"
  }
}
```

### Combined read + Active Probe

```json
{
  "id": "AUD-TMP-MODE-ACTIVE",
  "name": "temporary file mode round-trip",
  "category": "Custom Audit",
  "severity": "info",
  "description": "Checks /tmp and verifies a session-scoped mode-0600 file round-trip",
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

## Active Probe lifecycle

`probes/tmp-mode-round-trip.js` exports four named lifecycle functions:

| Stage | Purpose | Notes |
|-------|---------|-------|
| `prepare` | derive one session-scoped path under `/tmp`; confirm it does not already exist | deterministic digest of `ctx.sessionId` |
| `execute` | create that file with mode `0600` and a non-secret marker derived from the UUID session ID | uses the controlled SSH surface |
| `verify`  | confirm ownership, mode, and marker through the controlled SSH surface | returns `passed: boolean` |
| `rollback` | idempotently remove only the prepared session-scoped path | refuses to remove paths outside the probe prefix |

`/tmp` is the REMOTE Linux server path used through the controlled SSH surface — NOT
the local test runner's temp dir. The probe is deterministic and bounded: one file,
session-scoped, mode 0600, idempotent rollback. **No top-level side effects** —
importing the module does not invoke any shell commands.

## Install

```bash
kastell plugin install kastell-plugin-auditor
```

> **Note:** This is an example plugin. To use it, first publish to npm with `npm publish`, then install via `kastell plugin install kastell-plugin-auditor`.

## Security

Kastell plugins run SSH commands with root privileges on your servers. This plugin is
an example — review all `read.cmd` and `activeProbe.handler` entries before installing
any plugin. Kastell v2.3 uses the same trust model as `npm install` — no sandbox, no
GPG verification. GPG signature and tiered trust are planned for v2.4.

For the full Plugin API v3 contract, see
[`docs/plugin-sdk-v3.md`](../../../docs/plugin-sdk-v3.md) and the migration guide at
[`docs/plugin-sdk-migration-v3.md`](../../../docs/plugin-sdk-migration-v3.md).
