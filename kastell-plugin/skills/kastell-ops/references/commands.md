# Kastell CLI Commands (31)

All commands follow the thin wrapper pattern: parse args in `src/commands/`, delegate to `src/core/`.

| Command     | Description                                          | Key Arguments                              |
|-------------|------------------------------------------------------|--------------------------------------------|
| add         | Add existing server to kastell config                | --ip, --provider, --platform               |
| audit       | Security audit                            | --server, --category, --format, --explain  |
| auth        | Authenticate with a cloud provider                   | --provider                                 |
| backup      | Create a platform backup (DB + config files)         | --server                                   |
| completions | Generate shell completions                           | --shell (bash/zsh/fish)                    |
| config      | View or edit kastell configuration                   | --edit                                     |
| destroy     | Destroy a cloud server permanently                   | --server, --force                          |
| doctor      | Proactive health analysis and recommendations        | --server                                   |
| domain      | Manage custom domains and SSL certificates           | --server, --domain                         |
| evidence    | Collect forensic evidence from server                | --server                                   |
| firewall    | Manage server firewall rules                         | --server, --add, --remove, --list          |
| fleet       | Fleet-wide server visibility and status              | --format                                   |
| guard       | Start/stop autonomous security daemon                | --server, --start, --stop, --status        |
| health      | Check server and platform health                     | --server                                   |
| init        | Initialize kastell and provision first server        | (interactive prompts)                      |
| interactive | Launch interactive TUI menu                          | (none)                                     |
| list        | List all configured servers                          | --format                                   |
| lock        | One-shot server hardening                            | --server                                   |
| logs        | View server or platform logs                         | --server, --lines, --service               |
| maintain    | Run maintenance tasks (updates, cleanup)             | --server                                   |
| monitor     | Real-time server monitoring                          | --server                                   |
| notify      | Send notifications via configured channels           | --channel, --message                       |
| remove      | Remove server from kastell config                    | --server                                   |
| restart     | Restart server or platform services                  | --server                                   |
| restore     | Restore server from a previous backup                | --server, --backup                         |
| secure      | Set up SSH keys and firewall rules                   | --server                                   |
| snapshot    | Create, list, or restore server snapshots            | --server, --list, --restore                |
| ssh         | Open interactive SSH session to server               | --server                                   |
| status      | Display server status overview                       | --server                                   |
| transfer    | Transfer server configuration between providers      | --server, --target-provider                |
| update      | Update server packages and platform                  | --server                                   |

## Notes

- All commands validate input and delegate to `src/core/` — no business logic in commands
- Destructive commands (`destroy`, `lock`, `restore`) check `isSafeMode()` before executing
- Commands that need SSH call `assertValidIp()` before any SSH operation
- `--format` accepts `table` (default) and `json` for machine-readable output
- Provider-specific commands (`auth`, `list`, `fleet`) use `PROVIDER_REGISTRY` from `constants.ts`
