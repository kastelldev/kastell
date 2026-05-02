# kastell-plugin-auditor

Custom SSH audit checks for Kastell — demonstrates how to write a plugin with critical and warning severity checks.

## Checks

| ID | Name | Severity |
|----|------|----------|
| AUD-SSH-CUSTOM-PORT | SSH on non-default port | critical |
| AUD-FAIL2BAN-ACTIVE | fail2ban service running | warning |

## Install

```bash
kastell plugin install kastell-plugin-auditor
```

## Security

Kastell plugins run SSH commands with root privileges on your servers. This plugin is an example — review all `checkCommand` entries before installing any plugin. Kastell v2.2 uses the same trust model as `npm install` — no sandbox, no GPG verification. GPG signature and tiered trust are planned for v2.3.