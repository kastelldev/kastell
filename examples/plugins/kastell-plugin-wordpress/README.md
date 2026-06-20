# kastell-plugin-wordpress

WordPress security audit checks for Kastell — Plugin API **v3** read-only example.

## Checks

| ID | Name | Severity |
|----|------|----------|
| WP-FILE-PERMS | World-writable file detection | warning |
| WP-CONFIG-SECURE | wp-config.php permissions | critical |
| WP-DEBUG-OFF | WP_DEBUG disabled in production | warning |

## Plugin API v3 contract

All three checks are declared with the v3 `read` object. The plugin is **read-only** —
no `activeProbe` is declared. Audit consumers run the `read.cmd` shell command on the
target server and match `read.passPattern` against the trimmed stdout. Lifecycle stages
(`prepare`/`execute`/`verify`/`rollback`) and the controlled SSH surface are not used.

```json
{
  "id": "WP-FILE-PERMS",
  "name": "WordPress file permissions",
  "category": "WordPress",
  "severity": "warning",
  "description": "Checks for world-writable files in the WordPress directory",
  "read": {
    "cmd": "find /var/www/html -type f -perm -002 | wc -l",
    "passPattern": "^0$"
  }
}
```

The IDs, order, severity, and pass patterns are preserved 1:1 from the v2 contract.
There is **no behavioral drift** between v2 and v3 for this plugin.

## Install

```bash
kastell plugin install kastell-plugin-wordpress
```

> **Note:** This is an example plugin. To use it, first publish to npm with `npm publish`, then install via `kastell plugin install kastell-plugin-wordpress`.

## Security

Kastell plugins run SSH commands with root privileges on your servers. This plugin is an
example — review all `read.cmd` entries before installing any plugin. Kastell v2.3 uses
the same trust model as `npm install` — no sandbox, no GPG verification. GPG signature
and tiered trust are planned for v2.4.

For the full Plugin API v3 contract, see
[`docs/plugin-sdk-v3.md`](../../../docs/plugin-sdk-v3.md) and the migration guide at
[`docs/plugin-sdk-migration-v3.md`](../../../docs/plugin-sdk-migration-v3.md).
