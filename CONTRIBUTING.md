# Contributing to Kastell

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Fork & Clone**

```bash
git clone https://github.com/YOUR_USERNAME/kastell.git
cd kastell
```

2. **Install Dependencies**

```bash
npm install
```

3. **Run in Development**

```bash
npm run dev -- init
```

4. **Run Tests**

```bash
npm test                # Run all tests (2,191 tests, 84 suites)
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

5. **Build**

```bash
npm run build
```

## Project Structure

```
src/
├── index.ts              # CLI entry point (Commander.js)
├── commands/
│   ├── init.ts           # Deploy a new Coolify instance
│   ├── list.ts           # List all registered servers
│   ├── status.ts         # Check server and Coolify status
│   ├── destroy.ts        # Destroy a cloud server
│   ├── config.ts         # Manage default configuration
│   ├── ssh.ts            # SSH into a server
│   ├── update.ts         # Update Coolify on a server
│   ├── restart.ts        # Restart a server
│   ├── logs.ts           # View server logs
│   ├── monitor.ts        # Show server resource usage
│   ├── health.ts         # Health check all servers
│   ├── doctor.ts         # Check local environment
│   ├── firewall.ts       # Manage server firewall (UFW)
│   ├── domain.ts         # Manage server domain and SSL
│   ├── secure.ts         # SSH hardening and fail2ban
│   ├── backup.ts         # Backup Coolify database and config
│   ├── restore.ts        # Restore from a backup
│   ├── transfer.ts       # Export/import server list (JSON)
│   ├── add.ts            # Add an existing Coolify server
│   ├── remove.ts         # Remove server from local config
│   ├── maintain.ts       # Full maintenance cycle
│   ├── snapshot.ts       # Manage VPS snapshots
│   └── interactive.ts    # Interactive menu (no-arg mode)
├── core/                   # Pure business logic (no CLI dependencies)
│   ├── status.ts          # Server & Coolify status checks
│   ├── tokens.ts          # Non-interactive token resolution from env vars
│   ├── secure.ts          # SSH hardening + audit (pure functions)
│   ├── firewall.ts        # UFW management (pure functions)
│   ├── domain.ts          # FQDN/DNS management (pure functions)
│   ├── backup.ts          # Backup/restore operations (20 pure functions)
│   ├── snapshot.ts        # Snapshot create/list/delete + cost estimate
│   └── provision.ts       # Server provisioning (13-step flow)
├── mcp/                    # MCP (Model Context Protocol) server
│   ├── index.ts           # MCP stdio transport entry point
│   ├── server.ts          # MCP server setup + 7 tool registrations
│   └── tools/
│       ├── serverInfo.ts      # server_info (list/status/health)
│       ├── serverLogs.ts      # server_logs (logs/monitor)
│       ├── serverManage.ts    # server_manage (add/remove/destroy)
│       ├── serverMaintain.ts  # server_maintain (update/restart/maintain)
│       ├── serverSecure.ts    # server_secure (10 security subcommands)
│       ├── serverBackup.ts    # server_backup (backup/restore + snapshots)
│       └── serverProvision.ts # server_provision (create new servers)
├── providers/
│   ├── base.ts           # CloudProvider interface
│   ├── hetzner.ts        # Hetzner Cloud implementation
│   ├── digitalocean.ts   # DigitalOcean implementation
│   ├── vultr.ts          # Vultr implementation
│   └── linode.ts         # Linode (Akamai) implementation (Beta)
├── types/
│   └── index.ts          # Shared TypeScript types and interfaces
└── utils/
    ├── cloudInit.ts      # Cloud-init script generator
    ├── config.ts         # Server record CRUD (~/.kastell/)
    ├── configMerge.ts    # Multi-source config merge logic
    ├── defaults.ts       # Default config management
    ├── errorMapper.ts    # Provider/SSH/FS error → actionable hints
    ├── healthCheck.ts    # Coolify health check polling
    ├── logger.ts         # Chalk-based logging + spinner
    ├── openBrowser.ts    # Platform-aware browser open
    ├── prompts.ts        # Inquirer.js prompts with back navigation
    ├── providerFactory.ts # Provider factory (create by name)
    ├── serverSelect.ts   # Shared server selection + token prompts
    ├── ssh.ts            # SSH helpers (connect, exec, stream)
    ├── sshKey.ts         # SSH key detection + generation
    ├── templates.ts      # Template definitions (starter, production, dev)
    ├── updateCheck.ts    # npm registry update check (24h cache)
    └── yamlConfig.ts     # YAML config loader with security checks

tests/
├── __mocks__/            # Module mocks (axios, inquirer, ora, chalk)
├── unit/                 # Unit tests
├── integration/          # Provider API tests
└── e2e/                  # Full flow tests
```

## Environment Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `HETZNER_TOKEN` | Hetzner Cloud | API token (Read & Write) |
| `DIGITALOCEAN_TOKEN` | DigitalOcean | Personal access token |
| `VULTR_TOKEN` | Vultr | API key |
| `LINODE_TOKEN` | Linode (Akamai) | Personal access token |

Tokens are never stored on disk. They are prompted at runtime or read from environment variables.

## Adding a New Cloud Provider

1. Create `src/providers/yourprovider.ts` implementing `CloudProvider` interface from `base.ts`
2. Add provider regions, server sizes, and all API calls (validate, create, destroy, reboot, snapshot)
3. Add `stripSensitiveData()` to all catch blocks (prevent token leakage)
4. Write tests in `tests/unit/yourprovider.test.ts` and `tests/integration/yourprovider.test.ts`
5. Add provider selection to `src/utils/prompts.ts` and `src/utils/providerFactory.ts`
6. Add template defaults to `src/utils/templates.ts`
7. Add environment variable support to `src/commands/init.ts`
8. Update README.md and README.tr.md

## Adding a New Command

1. Create `src/commands/yourcommand.ts` with the command function
2. Register it in `src/index.ts` with Commander.js
3. Write tests in `tests/unit/yourcommand.test.ts`
4. Update README.md, README.tr.md, and CHANGELOG.md

## Pull Request Process

1. Create a feature branch from `main`

```bash
git checkout -b feature/your-feature
```

2. Make your changes following existing code style
3. Write/update tests — we maintain high coverage (~97% statements)
4. Ensure all tests pass

```bash
npm test
```

5. Ensure TypeScript compiles without errors

```bash
npx tsc --noEmit
```

6. Ensure linting passes

```bash
npm run lint
```

7. Commit with a descriptive message

```bash
git commit -m "feat: add awesome feature"
```

We follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `test:` tests
- `ci:` CI/CD changes
- `refactor:` code refactoring
- `chore:` maintenance

8. Push and open a PR against `main`

## Code Guidelines

- TypeScript strict mode is enabled
- No `any` types — use proper interfaces
- `catch (error: unknown)` with type guards, never `catch (error: any)`
- All user input must be validated
- Keep dependencies minimal (zero runtime deps beyond core 8)
- Test edge cases (network errors, invalid input, timeouts)
- All SSH connections must use `assertValidIp()` and `sanitizedEnv()`
- Provider errors must call `stripSensitiveData()` before rethrowing
- Shell commands must use `spawnSync` (not `execSync`) for user-facing inputs

## Areas for Contribution

- Better error messages and UX improvements
- New cloud provider integrations
- CLI improvements and new commands
- Documentation and examples
- Bug fixes and security improvements
- Performance optimizations

## Questions?

Open a [GitHub Discussion](https://github.com/kastelldev/kastell/discussions) or [Issue](https://github.com/kastelldev/kastell/issues).
