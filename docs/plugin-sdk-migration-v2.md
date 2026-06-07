# Plugin SDK v2 Migration Guide

Plugin SDK v2 is a breaking contract change for audit plugins. Kastell now requires explicit command intent per check and manifest `apiVersion: "2"`.

## Manifest Version

```json
{
  "apiVersion": "2"
}
```

Kastell rejects `apiVersion: "1"` plugin manifests for the v2 command contract.

## Command Shape

v1:

```js
{
  checkCommand: "cat /etc/os-release"
}
```

v2:

```js
{
  checkCommand: {
    kind: "read",
    cmd: "cat /etc/os-release"
  }
}
```

## Command Kinds

| Kind | Use For | v2.3.0 Behavior |
|---|---|---|
| `read` | File reads, process listing, status probes, config inspection | Runs in `kastell audit` plugin batch |
| `mutate-local` | Package install/remove, service restart, config file edits on the audited host | Sequential in `executePluginChecks()`; not run by `kastell audit` |
| `mutate-global` | Provider API calls, account-wide firewall/network changes, multi-host orchestration | Sequential in `executePluginChecks()`; not run by `kastell audit` |

`mutate-local` and `mutate-global` have the same runtime behavior in v2.3.0. The distinction is metadata for the SDK contract and future scheduling decisions.

## Removed Manifest Fields

Remove these fields from `kastell-plugin.json`:

```json
{
  "mutates": true,
  "safeToParallel": false
}
```

Mutation intent now belongs to each check:

```js
const checks = [
  {
    id: "WP-STATUS",
    name: "WordPress status",
    category: "WordPress",
    severity: "info",
    description: "Check WordPress status",
    checkCommand: {
      kind: "read",
      cmd: "wp core version"
    },
    passPattern: ".+"
  },
  {
    id: "WP-RESTART",
    name: "Restart WordPress runtime",
    category: "WordPress",
    severity: "warning",
    description: "Restart local runtime",
    checkCommand: {
      kind: "mutate-local",
      cmd: "systemctl restart php-fpm"
    }
  }
];

module.exports = { checks };
```

## TypeScript Example

```ts
import type { PluginCheck } from "./src/plugin/sdk/types.js";

const check: PluginCheck = {
  id: "WP-UPDATES",
  name: "WordPress updates",
  category: "WordPress",
  severity: "warning",
  description: "Check WordPress core updates",
  checkCommand: {
    kind: "read",
    cmd: "wp core check-update"
  },
  passPattern: "^$"
};
```
