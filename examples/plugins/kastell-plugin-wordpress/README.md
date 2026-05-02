# kastell-plugin-wordpress

WordPress security audit checks for Kastell.

## Checks

| ID | Name | Severity |
|----|------|----------|
| WP-FILE-PERMS | World-writable file detection | warning |
| WP-CONFIG-SECURE | wp-config.php permissions | critical |
| WP-DEBUG-OFF | WP_DEBUG disabled in production | warning |

## Install

```bash
kastell plugin install kastell-plugin-wordpress
```

> **Note:** This is an example plugin. To use it, first publish to npm with `npm publish`, then install via `kastell plugin install kastell-plugin-wordpress`.

## Security

Kastell plugins run SSH commands with root privileges on your servers. This plugin is an example — review all `checkCommand` entries before installing any plugin. Kastell v2.2 uses the same trust model as `npm install` — no sandbox, no GPG verification. GPG signature and tiered trust are planned for v2.3.