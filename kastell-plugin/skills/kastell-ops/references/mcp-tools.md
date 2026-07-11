# Kastell MCP Tools

All MCP tools are registered in `src/mcp/server.ts` and delegate to `src/core/` functions.

| Tool             | File                 | Purpose                                    | Key Parameters                              |
|------------------|----------------------|--------------------------------------------|---------------------------------------------|
| server_info      | serverInfo.ts        | Server list, status, health, sizes         | action: list/status/health/sizes, server?   |
| server_logs      | serverLogs.ts        | Logs and system metrics via SSH            | server, lines?, service?                    |
| server_manage    | serverManage.ts      | Add/remove/destroy servers                 | action: add/remove/destroy, server          |
| server_maintain  | serverMaintain.ts    | Update, restart, maintenance tasks         | action: update/restart/maintain, server     |
| server_secure    | serverSecure.ts      | SSH setup, firewall, domain management     | action: secure/firewall/domain, server      |
| server_backup    | serverBackup.ts      | Backup creation and snapshot management    | action: backup/snapshot/restore, server     |
| server_provision | serverProvision.ts   | New server provisioning                    | provider, name, size, region                |
| server_audit     | serverAudit.ts       | Security audit across all categories | server, category?, format?                  |
| server_lock      | serverLock.ts        | One-shot server hardening          | server                                      |
| server_evidence  | serverEvidence.ts    | Forensic evidence collection               | server                                      |
| server_guard     | serverGuard.ts       | Autonomous security daemon control         | server, action: start/stop/status           |
| server_doctor    | serverDoctor.ts      | Proactive health analysis                  | server                                      |
| server_fleet     | serverFleet.ts       | Fleet-wide server visibility               | format?                                     |

## Routing Rules

All MCP tools follow this delegation chain:
```
MCP Client -> tool handler (Zod validation) -> src/core/ function -> result
```

**Tool handlers NEVER contain business logic.** They:
1. Validate input with Zod schema
2. Delegate to the corresponding `src/core/` function
3. Format the result as `{ content: [{ type: 'text', text: ... }] }`

## Annotations

Each tool registration in `server.ts` includes MCP annotations:

| Annotation       | When to use                                         | Examples                          |
|------------------|-----------------------------------------------------|-----------------------------------|
| readOnlyHint     | Tool reads data, no side effects                    | server_info (list/status/health)  |
| destructiveHint  | Tool causes irreversible changes                    | server_manage (destroy), server_lock |
| idempotentHint   | Safe to call multiple times with same result        | server_audit, server_health       |

## Error Handling

On error, tools return:
```typescript
{ content: [{ type: 'text', text: errorMessage }], isError: true }
```

Never throw from tool handlers — all errors must be caught and returned as structured error content.
