# Phase 9: Dokploy Adapter - Research

**Researched:** 2026-03-06
**Domain:** Platform adapter implementation (Dokploy self-hosted PaaS)
**Confidence:** HIGH

## Summary

Phase 9 implements `DokployAdapter`, the second `PlatformAdapter` implementation following the exact pattern established by `CoolifyAdapter` in Phase 8. The adapter foundation is already in place: interface (4 methods), factory, `resolvePlatform()`, `requireManagedMode()`, and core routing. This phase is primarily about filling in Dokploy-specific details for cloud-init, health check, backup, and status methods.

Dokploy is a self-hosted PaaS running on Docker Swarm with Traefik reverse proxy. It uses four Docker services (`dokploy`, `dokploy-postgres`, `dokploy-redis`, `dokploy-traefik`), stores configuration in `/etc/dokploy/`, and exposes its web UI on port 3000. The install script (`curl -sSL https://dokploy.com/install.sh | sh`) sets up Docker, Docker Swarm, Traefik, and the Dokploy application automatically. Health checks can be done via `GET /api/health` (no auth required, returns `{ status: "ok" }`) or port 3000 HTTP probe. Version detection uses `docker inspect dokploy --format '{{.Config.Image}}'` to extract the image tag.

**Primary recommendation:** Implement DokployAdapter by mirroring CoolifyAdapter structure exactly, substituting Dokploy-specific ports (3000), paths (`/etc/dokploy`), container names (`dokploy`, `dokploy-postgres`), and install script URL. The `BackupManifest.coolifyVersion` field should be reused as-is for backward compatibility, populated with the Dokploy version string.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Resmi Dokploy install script kullanilacak: `curl -sSL https://dokploy.com/install.sh | sh`
- CoolifyAdapter pattern'i takip edilecek: network wait, system update, install, firewall config
- Dokploy portlari: 3000 (web UI), 80, 443, 22, 2377 (Docker Swarm), 7946, 4789
- Docker Swarm init otomatik (Dokploy install script halleder)
- Dokploy API port 3000 uzerinden calisir
- Health check: HTTP GET ile port 3000 kontrolu (Coolify pattern ile ayni)
- API key gerektiren detayli status: `/api/admin.getOne` endpoint'i (Authorization header)
- `/etc/dokploy` dizini tar.gz ile backup alinacak
- DB dump: Dokploy PostgreSQL container'indan pg_dump
- Manifest format: CoolifyAdapter ile tutarli (dokployVersion alani)
- Restore kapsam disi (v1.5'e birakildi -- DOKP-F01)
- `--platform dokploy` flag'i InitOptions'a eklenmeyecek -- DeploymentConfig.platform zaten var
- Interactive menude platform secimi: coolify / dokploy / bare
- Factory'ye `case "dokploy"` eklenmesi yeterli
- Mevcut MCP tool'lari platform parametresi zaten destekliyor (Phase 8)
- DokployAdapter factory'ye register olunca MCP otomatik calisir

### Claude's Discretion
- Dokploy container adi tespiti (health check / version komutu icin)
- Firewall rule detaylari (UFW vs iptables, hangi portlar)
- Cloud-init bekleme suresi (sleep saniyesi)
- Backup manifest'te ek metadata

### Deferred Ideas (OUT OF SCOPE)
- DOKP-F01: Dokploy restore from backup (v1.5)
- DOKP-F02: Dokploy API ile proje/servis listeleme (v1.5)
- DOKP-F03: Dokploy versiyon tespiti (v1.5)
- DOKP-F04: Sunucuda Coolify/Dokploy otomatik algilama (v1.5)
- Docker Swarm cluster yonetimi (kapsam disi)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DOKP-01 | `DokployAdapter` implement edilir (PlatformAdapter interface) | CoolifyAdapter reference impl (225 lines) + Dokploy Docker service details documented below |
| DOKP-02 | Dokploy cloud-init script ile sunucu provision edilir | Install script URL verified, port/service details confirmed, cloud-init template pattern from CoolifyAdapter |
| DOKP-03 | Dokploy health check calisir (API key ile /api/admin.getOne) | Health endpoint `GET /api/health` (no auth) for basic check; port 3000 HTTP probe for simple health check |
| DOKP-04 | Dokploy backup SSH + SCP ile alinir (/etc/dokploy) | `/etc/dokploy` directory structure documented, `dokploy-postgres` container for pg_dump confirmed |
| DOKP-05 | CLI'da `--platform dokploy` flag'i desteklenir | `--mode` flag currently handles coolify/bare; needs expansion to `--platform` or mode values need to include dokploy |
| DOKP-06 | MCP tool'lari platform parametresi ile Dokploy'a yonlendirilir | Already supported -- factory registration sufficient |
| DOKP-07 | Interactive menude platform secimi sunulur | `promptInit()` in `interactive.ts` currently offers coolify/bare; needs dokploy option |
</phase_requirements>

## Standard Stack

### Core (No New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| axios | existing | HTTP health check to port 3000 | Already used by CoolifyAdapter |
| fs/path | Node built-in | Backup file operations | Already used by CoolifyAdapter |

### No New Libraries Needed
DokployAdapter uses the exact same dependencies as CoolifyAdapter. No new npm packages required.

## Architecture Patterns

### Recommended File Structure
```
src/adapters/
  interface.ts      # PlatformAdapter (unchanged)
  factory.ts        # + case "dokploy" (1 line change)
  coolify.ts        # Reference implementation (unchanged)
  dokploy.ts        # NEW: DokployAdapter (~200-230 lines)
```

### Pattern: Mirror CoolifyAdapter
**What:** DokployAdapter implements `PlatformAdapter` interface with identical structure to CoolifyAdapter, substituting Dokploy-specific values.
**When to use:** Always -- this is the locked decision.
**Example:**

```typescript
// src/adapters/dokploy.ts
import axios from "axios";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type {
  PlatformAdapter,
  HealthResult,
  PlatformStatusResult,
  PlatformBackupResult,
} from "./interface.js";
import type { BackupManifest } from "../types/index.js";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import {
  formatTimestamp,
  getBackupDir,
  scpDownload,
} from "../core/backup.js";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../utils/errorMapper.js";

export class DokployAdapter implements PlatformAdapter {
  readonly name = "dokploy";

  getCloudInit(serverName: string): string {
    const safeName = serverName.replace(/[^a-z0-9-]/g, "");
    return `#!/bin/bash
set +e
touch /var/log/kastell-install.log
chmod 600 /var/log/kastell-install.log
exec > >(tee /var/log/kastell-install.log) 2>&1

echo "=================================="
echo "Kastell Auto-Installer"
echo "Server: ${safeName}"
echo "Platform: Dokploy"
echo "=================================="

# Wait for network connectivity
echo "Waiting for network connectivity..."
MAX_ATTEMPTS=30
ATTEMPTS=0
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  if curl -s --max-time 5 https://dokploy.com > /dev/null 2>&1; then
    echo "Network is ready!"
    break
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  echo "Network not ready (attempt $ATTEMPTS/$MAX_ATTEMPTS)..."
  sleep 2
done

# Update system
echo "Updating system packages..."
apt-get update -y

# Install Dokploy
echo "Installing Dokploy..."
curl -sSL https://dokploy.com/install.sh | sh

# Wait for services
echo "Waiting for Dokploy services to start..."
sleep 30

# Configure firewall for Dokploy
echo "Configuring firewall..."
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 3000/tcp
  ufw allow 2377/tcp
  ufw allow 7946/tcp
  ufw allow 7946/udp
  ufw allow 4789/udp
  echo "y" | ufw enable || true
else
  iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
  iptables -A INPUT -p tcp --dport 22 -j ACCEPT
  iptables -A INPUT -p tcp --dport 80 -j ACCEPT
  iptables -A INPUT -p tcp --dport 443 -j ACCEPT
  iptables -A INPUT -p tcp --dport 2377 -j ACCEPT
  iptables -A INPUT -p tcp --dport 7946 -j ACCEPT
  iptables -A INPUT -p udp --dport 7946 -j ACCEPT
  iptables -A INPUT -p udp --dport 4789 -j ACCEPT
  iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  mkdir -p /etc/iptables
  iptables-save > /etc/iptables/rules.v4 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent || true
fi

echo "=================================="
echo "Dokploy installation completed!"
echo "=================================="
echo ""
echo "Please wait 3-5 more minutes for Dokploy to fully initialize."
echo "Then access your instance at: http://YOUR_SERVER_IP:3000"
`;
  }

  async healthCheck(ip: string): Promise<HealthResult> {
    assertValidIp(ip);
    try {
      await axios.get(`http://${ip}:3000`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      return { status: "running" };
    } catch {
      return { status: "not reachable" };
    }
  }

  async createBackup(
    ip: string,
    serverName: string,
    provider: string,
  ): Promise<PlatformBackupResult> {
    assertValidIp(ip);
    try {
      // Step 1: Get Dokploy version (best-effort)
      const versionResult = await sshExec(ip, this.buildVersionCommand());
      const dokployVersion = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";

      // Step 2: Database backup
      const dbResult = await sshExec(ip, this.buildPgDumpCommand());
      if (dbResult.code !== 0) {
        return {
          success: false,
          error: "Database backup failed",
          hint: sanitizeStderr(dbResult.stderr) || undefined,
        };
      }

      // Step 3: Config backup
      const configResult = await sshExec(ip, this.buildConfigTarCommand());
      if (configResult.code !== 0) {
        return {
          success: false,
          error: "Config backup failed",
          hint: sanitizeStderr(configResult.stderr) || undefined,
        };
      }

      // Step 4: Create local directory and download
      const timestamp = formatTimestamp(new Date());
      const backupPath = join(getBackupDir(serverName), timestamp);
      mkdirSync(backupPath, { recursive: true, mode: 0o700 });

      const dbDl = await scpDownload(
        ip,
        "/tmp/dokploy-backup.sql.gz",
        join(backupPath, "dokploy-backup.sql.gz"),
      );
      if (dbDl.code !== 0) {
        return {
          success: false,
          error: "Failed to download database backup",
          hint: sanitizeStderr(dbDl.stderr) || undefined,
        };
      }

      const configDl = await scpDownload(
        ip,
        "/tmp/dokploy-config.tar.gz",
        join(backupPath, "dokploy-config.tar.gz"),
      );
      if (configDl.code !== 0) {
        return {
          success: false,
          error: "Failed to download config backup",
          hint: sanitizeStderr(configDl.stderr) || undefined,
        };
      }

      // Step 5: Write manifest
      const manifest: BackupManifest = {
        serverName,
        provider,
        timestamp,
        coolifyVersion: dokployVersion,  // Reuse field for backward compat
        files: ["dokploy-backup.sql.gz", "dokploy-config.tar.gz"],
        platform: "dokploy",
      };
      writeFileSync(
        join(backupPath, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        { mode: 0o600 },
      );

      // Step 6: Cleanup remote (best-effort)
      await sshExec(ip, this.buildCleanupCommand()).catch(() => {});

      return { success: true, backupPath, manifest };
    } catch (error: unknown) {
      const hint = mapSshError(error, ip);
      return {
        success: false,
        error: getErrorMessage(error),
        ...(hint ? { hint } : {}),
      };
    }
  }

  async getStatus(ip: string): Promise<PlatformStatusResult> {
    assertValidIp(ip);
    const versionResult = await sshExec(ip, this.buildVersionCommand());
    const platformVersion = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";
    const health = await this.healthCheck(ip);
    return {
      platformVersion,
      status: health.status,
    };
  }

  // --- Private Helpers ---

  private buildPgDumpCommand(): string {
    return "docker exec $(docker ps -qf name=dokploy-postgres) pg_dump -U postgres -d dokploy | gzip > /tmp/dokploy-backup.sql.gz";
  }

  private buildConfigTarCommand(): string {
    return "tar czf /tmp/dokploy-config.tar.gz -C /etc/dokploy .";
  }

  private buildCleanupCommand(): string {
    return "rm -f /tmp/dokploy-backup.sql.gz /tmp/dokploy-config.tar.gz";
  }

  private buildVersionCommand(): string {
    return "docker inspect dokploy --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || echo unknown";
  }
}
```

### Pattern: Factory Registration
**What:** Add `case "dokploy"` to `getAdapter()` in `factory.ts`.
**Example:**
```typescript
// src/adapters/factory.ts (change only)
import { DokployAdapter } from "./dokploy.js";

export function getAdapter(platform: Platform): PlatformAdapter {
  switch (platform) {
    case "coolify":
      return new CoolifyAdapter();
    case "dokploy":
      return new DokployAdapter();
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}
```

### Pattern: Deploy.ts Platform Routing
**What:** `deployServer()` currently hardcodes `platform: "coolify"` for non-bare servers. Must route based on mode/platform parameter.
**Key change in deploy.ts:**
```typescript
// Current (line 66-68):
const isBare = mode === "bare";
const platform: Platform | undefined = isBare ? undefined : "coolify";

// Must become:
const isBare = mode === "bare";
const platform: Platform | undefined = isBare ? undefined : (mode === "dokploy" ? "dokploy" : "coolify");
```

### Pattern: Interactive Menu Platform Selection
**What:** `promptInit()` in `interactive.ts` currently shows coolify/bare. Needs dokploy option.
**Example:**
```typescript
const mode = await promptList("Server mode:", [
  { name: "Coolify (auto-install panel)", value: "coolify" },
  { name: "Dokploy (auto-install panel)", value: "dokploy" },
  { name: "Bare (generic VPS, no panel)", value: "bare" },
]);
```

### Anti-Patterns to Avoid
- **Don't create a separate backup flow for Dokploy:** The adapter pattern already handles routing. DokployAdapter.createBackup() handles everything internally.
- **Don't modify the PlatformAdapter interface:** The 4-method interface is sufficient. Don't add Dokploy-specific methods.
- **Don't add `--platform` as a new CLI flag:** The `--mode` flag can be extended to accept "dokploy" as a value, or `DeploymentConfig.platform` can be set from mode value. Don't create a separate flag.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dokploy install | Custom Docker commands | Official install script | Script handles Docker, Swarm, Traefik setup automatically |
| Version detection | API call for version | `docker inspect` image tag | No auth required, simpler, same pattern as Coolify |
| Health check | Complex API call with auth | HTTP GET to port 3000 | Simple, no API key needed, same pattern as Coolify |
| DB backup | Custom pg_dump wrapper | Docker exec pg_dump pipe | Same proven pattern as CoolifyAdapter |
| Config backup | File-by-file copy | `tar czf /etc/dokploy` | Single command, captures everything |

**Key insight:** Every Dokploy operation maps 1:1 to the Coolify pattern, just with different ports, paths, and container names. No novel infrastructure needed.

## Common Pitfalls

### Pitfall 1: Dokploy PostgreSQL Container Name
**What goes wrong:** Dokploy runs as Docker Swarm services. The container name is NOT simply `dokploy-postgres` -- it's a Swarm service name that produces containers with randomized suffixes like `dokploy-postgres.1.abc123`.
**Why it happens:** Docker Swarm appends `.{replica}.{id}` to service names.
**How to avoid:** Use `docker ps -qf name=dokploy-postgres` to find the container ID dynamically, then use that in `docker exec`. Command: `docker exec $(docker ps -qf name=dokploy-postgres) pg_dump ...`
**Warning signs:** "No such container: dokploy-postgres" error during backup.

### Pitfall 2: Dokploy PostgreSQL Credentials
**What goes wrong:** Using wrong username/database for pg_dump. Coolify uses `coolify` user and `coolify` database. Dokploy uses `postgres` user and `dokploy` database (password generated via `openssl rand -base64 32` and stored as Docker secret `dokploy_postgres_password`).
**Why it happens:** Assuming same credentials as Coolify.
**How to avoid:** Use `-U postgres -d dokploy` for pg_dump. The Docker secret handles auth within the container.
**Warning signs:** pg_dump authentication errors.

### Pitfall 3: Docker Swarm Port Requirements
**What goes wrong:** Forgetting Docker Swarm management ports (2377/tcp, 7946/tcp+udp, 4789/udp) in firewall rules. Single-node Swarm still needs these ports open locally.
**Why it happens:** Coolify doesn't use Docker Swarm, so these ports aren't in the CoolifyAdapter firewall rules.
**How to avoid:** Include all Swarm ports in cloud-init firewall rules.
**Warning signs:** Docker Swarm overlay network issues, service communication failures.

### Pitfall 4: BackupManifest.coolifyVersion Field Name
**What goes wrong:** The `BackupManifest` type has a `coolifyVersion: string` field (required). Changing this to `dokployVersion` or `platformVersion` would be a breaking change for existing backups.
**Why it happens:** Field was named before multi-platform support.
**How to avoid:** Reuse `coolifyVersion` field, populate with Dokploy version string. The `platform` field on `BackupManifest` already distinguishes which platform the version belongs to. This is an acceptable inconsistency until v2.0.
**Warning signs:** Type errors if field is renamed, existing backup manifests become unreadable.

### Pitfall 5: Deploy.ts Hardcoded "coolify" Platform
**What goes wrong:** `deployServer()` (line 66) hardcodes `platform = "coolify"` for non-bare mode. Passing `--mode dokploy` would still set platform to `"coolify"`.
**Why it happens:** Phase 8 only needed coolify/bare routing.
**How to avoid:** Map mode to platform correctly: `mode === "bare" ? undefined : mode === "dokploy" ? "dokploy" : "coolify"`.
**Warning signs:** Dokploy servers stored with `platform: "coolify"` in config.

### Pitfall 6: Health Check Port vs API Health Endpoint
**What goes wrong:** Using `/api/health` endpoint (no auth) vs simple port 3000 probe. The CONTEXT.md mentions both approaches.
**Why it happens:** Dokploy has both a public health endpoint and general web UI.
**How to avoid:** For `healthCheck()`, use simple HTTP GET to port 3000 (consistent with Coolify pattern). `/api/health` returns `{ status: "ok" }` and requires no auth, but a simple port probe is sufficient and more resilient. Either approach works; recommend simple port probe for consistency.
**Warning signs:** None -- both approaches are valid.

### Pitfall 7: MCP serverProvision Schema
**What goes wrong:** The MCP `serverProvisionSchema` has `mode: z.enum(["coolify", "bare"])`. If "dokploy" is a mode value, this enum needs updating.
**Why it happens:** MCP schema was defined before Dokploy support.
**How to avoid:** Add "dokploy" to the mode enum in `serverProvision.ts`.
**Warning signs:** MCP validation error when trying to provision with mode "dokploy".

### Pitfall 8: Provision.ts Hardcoded Platform
**What goes wrong:** `provisionServer()` in `core/provision.ts` (line 128) hardcodes `platform: "coolify"` for non-bare mode, same issue as deploy.ts.
**Why it happens:** Phase 8 only needed coolify/bare.
**How to avoid:** Map mode to platform correctly in provision.ts too.
**Warning signs:** Dokploy servers provisioned via MCP stored with wrong platform.

## Code Examples

### Dokploy Docker Service Details (Verified)
```
Service: dokploy           Image: dokploy/dokploy:latest   Port: 3000
Service: dokploy-postgres  Image: postgres:16              Port: internal
Service: dokploy-redis     Image: redis:7                  Port: internal
Service: dokploy-traefik   Image: traefik:v3.x             Port: 80, 443
Network: dokploy-network   Driver: overlay, attachable
```
Source: Dokploy manual installation docs

### Dokploy Directory Structure (Verified)
```
/etc/dokploy/
  traefik/              # Traefik config
    traefik.yml         # Static config
    dynamic/            # Dynamic routing
      acme.json         # Let's Encrypt certs
      middlewares.yml
      dokploy.yml
  logs/                 # Deployment logs
  compose/              # Docker Compose files
  applications/         # Application data
  backups/              # Database backups
  ssh-keys/             # Remote server SSH keys
```
Source: Dokploy manual installation docs, DeepWiki

### Version Detection Command
```bash
# Pattern: same as CoolifyAdapter
docker inspect dokploy --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || echo unknown
# Returns: "latest" or specific version tag like "v0.26.6"

# Alternative (more precise but requires exec):
# docker exec dokploy cat /app/package.json | grep '"version"'
```
Source: DeepWiki Dokploy installation analysis

### Health Check Endpoint
```bash
# Simple probe (no auth, consistent with Coolify pattern):
curl -s http://<ip>:3000
# Returns HTML page or connection refused

# API health endpoint (no auth required):
curl -s http://<ip>:3000/api/health
# Returns: { "status": "ok" }
```
Source: Dokploy OpenAPI documentation, DeepWiki

### PostgreSQL pg_dump Command
```bash
# Dokploy uses Swarm, container names have suffixes
docker exec $(docker ps -qf name=dokploy-postgres) pg_dump -U postgres -d dokploy | gzip > /tmp/dokploy-backup.sql.gz

# Alternative using docker service exec (Swarm-native):
# docker exec $(docker ps -qf name=dokploy-postgres) pg_dump ...
```
Note: Coolify uses `-U coolify -d coolify`, Dokploy uses `-U postgres -d dokploy`

### Backup Config Tar Command
```bash
# Dokploy: entire /etc/dokploy directory
tar czf /tmp/dokploy-config.tar.gz -C /etc/dokploy .

# Coolify equivalent: specific files from /data/coolify/source
tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml
```

### API Authentication (For Future Use -- NOT in Phase 9 Scope)
```bash
# Dokploy uses x-api-key header (not Authorization)
curl -H "x-api-key: YOUR_API_KEY" http://<ip>:3000/api/admin.getOne
```
Note: Phase 9 health check uses simple port probe, NOT API auth.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `--mode coolify/bare` only | `--mode coolify/dokploy/bare` | Phase 9 | Mode value determines platform |
| `coolifyVersion` field only | `coolifyVersion` + `platform` field | Phase 8 | Platform field identifies which version |
| Hardcoded `platform: "coolify"` | Dynamic platform from mode | Phase 9 | deploy.ts, provision.ts need update |

## Key Files Requiring Changes

| File | Change | Scope |
|------|--------|-------|
| `src/adapters/dokploy.ts` | NEW: DokployAdapter class | ~200-230 lines |
| `src/adapters/factory.ts` | Add `case "dokploy"` + import | 2 lines |
| `src/commands/interactive.ts` | Add Dokploy to `promptInit()` mode list | 1 line in choices array |
| `src/core/deploy.ts` | Fix hardcoded `platform: "coolify"` for non-bare | ~3 lines |
| `src/core/provision.ts` | Fix hardcoded `platform: "coolify"` for non-bare | ~3 lines |
| `src/index.ts` | Update `--mode` description to include dokploy | 1 line |
| `src/mcp/tools/serverProvision.ts` | Add "dokploy" to mode enum | 1 line |
| `src/utils/healthCheck.ts` | Consider renaming/generalizing `waitForCoolify` | Optional |
| `src/commands/backup.ts` | Already routes through adapter for non-bare | No change needed |
| `src/core/status.ts` | Already routes through adapter via `resolvePlatform` | No change needed |
| `src/core/backup.ts` | Already exports `createBackup()` via adapter | Needs update for Dokploy routing |

## Important: backup.ts Routing Issue

`core/backup.ts` line 370 hardcodes `getAdapter("coolify")`:
```typescript
export async function createBackup(...): Promise<BackupResult> {
  const adapter = getAdapter("coolify");  // BUG: hardcoded
  return adapter.createBackup(ip, serverName, provider);
}
```
This function is called from `commands/backup.ts` for non-bare servers AND from `mcp/tools/serverBackup.ts`. It needs to accept a `platform` parameter or resolve the platform from the server record.

Similarly, `commands/backup.ts` line 71 calls `buildCoolifyVersionCommand()` and `buildPgDumpCommand()` directly (not through adapter) for the non-bare CLI path. This is the legacy code path that existed before Phase 8's adapter pattern. For Dokploy to work through CLI backup, the backup command needs to route through the adapter instead.

## Open Questions

1. **Docker Swarm pg_dump container resolution**
   - What we know: Swarm services produce containers with suffixed names. `docker ps -qf name=dokploy-postgres` should resolve the container ID.
   - What's unclear: Whether the filter returns exactly one container ID in all Swarm configurations. Multi-replica scenarios shouldn't apply to Dokploy's internal services (single replica).
   - Recommendation: Use `docker ps -qf name=dokploy-postgres` approach. It handles Swarm naming. Add `--format '{{.ID}}' | head -1` if needed for safety.

2. **PostgreSQL user and database name**
   - What we know: Dokploy install script creates a Docker secret for the password and uses `postgres` as the system user. The database name appears to be `dokploy`.
   - What's unclear: Whether the database is always named `dokploy` or uses a different convention. The install script generates `DATABASE_URL` but exact format isn't fully documented.
   - Recommendation: Use `-U postgres -d dokploy` as primary approach. If pg_dump fails, provide a clear error hint. LOW confidence on exact database name -- needs live instance verification.

3. **Version detection output format**
   - What we know: `docker inspect dokploy --format '{{.Config.Image}}'` returns something like `dokploy/dokploy:latest` or `dokploy/dokploy:v0.26.6`. The `sed 's/.*://'` extracts the tag.
   - What's unclear: Whether Dokploy always tags with version numbers or uses `latest`. Users installing via default script get `latest` tag.
   - Recommendation: Return whatever tag is on the image. `latest` is a valid version string for display purposes.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (CJS config) |
| Config file | `jest.config.cjs` |
| Quick run command | `npx jest --config jest.config.cjs --testPathPattern dokploy` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOKP-01 | DokployAdapter implements PlatformAdapter | unit | `npx jest --config jest.config.cjs tests/unit/dokploy-adapter.test.ts -x` | Wave 0 |
| DOKP-02 | Cloud-init script content | unit | `npx jest --config jest.config.cjs tests/unit/dokploy-adapter.test.ts -x -t "getCloudInit"` | Wave 0 |
| DOKP-03 | Health check via port 3000 | unit | `npx jest --config jest.config.cjs tests/unit/dokploy-adapter.test.ts -x -t "healthCheck"` | Wave 0 |
| DOKP-04 | Backup via SSH/SCP | unit | `npx jest --config jest.config.cjs tests/unit/dokploy-adapter.test.ts -x -t "createBackup"` | Wave 0 |
| DOKP-05 | CLI --mode dokploy | unit | `npx jest --config jest.config.cjs tests/unit/adapter-factory.test.ts -x` | Partial (factory test exists, needs dokploy case) |
| DOKP-06 | MCP platform routing | unit | `npx jest --config jest.config.cjs tests/unit/mcp-server-provision.test.ts -x` | Partial (exists, needs dokploy mode test) |
| DOKP-07 | Interactive menu | unit | `npx jest --config jest.config.cjs tests/unit/interactive.test.ts -x` | Partial (exists, needs dokploy option test) |

### Sampling Rate
- **Per task commit:** `npx jest --config jest.config.cjs --testPathPattern "(dokploy|adapter|factory)" -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/dokploy-adapter.test.ts` -- covers DOKP-01 through DOKP-04 (mirror coolify-adapter.test.ts)
- [ ] Update `tests/unit/adapter-factory.test.ts` -- add `getAdapter("dokploy")` test
- [ ] Update `tests/unit/interactive.test.ts` -- add Dokploy option test (if interactive tests cover init prompt)
- [ ] Update `tests/unit/mcp-server-provision.test.ts` -- add mode "dokploy" test

## Sources

### Primary (HIGH confidence)
- Dokploy official installation docs: https://docs.dokploy.com/docs/core/installation -- install command, system requirements, ports
- Dokploy manual installation docs: https://docs.dokploy.com/docs/core/manual-installation -- Docker service names, images, volumes, directory structure
- Dokploy API docs: https://docs.dokploy.com/docs/api -- authentication (x-api-key), Swagger UI at :3000/swagger
- DeepWiki Dokploy analysis: https://deepwiki.com/Dokploy/dokploy/1.3-installation-and-setup -- container names, version detection, health check endpoint
- DeepWiki OpenAPI analysis: https://deepwiki.com/Dokploy/dokploy/2.3-openapi-documentation -- `/api/health` endpoint, auth details
- Docker Hub: https://hub.docker.com/r/dokploy/dokploy -- image name `dokploy/dokploy`
- CoolifyAdapter source (src/adapters/coolify.ts) -- reference implementation, 225 lines

### Secondary (MEDIUM confidence)
- Docker Swarm port documentation: https://gist.github.com/BretFisher/7233b7ecf14bc49eb47715bbeb2a2769 -- ports 2377, 7946, 4789
- MassiveGRID Dokploy multi-node guide: https://massivegrid.com/blog/dokploy-multi-node-docker-swarm/ -- Swarm network details
- Vultr Dokploy deployment guide: https://docs.vultr.com/how-to-deploy-dokploy-self-hosted-paas-for-docker-applications

### Tertiary (LOW confidence)
- PostgreSQL database name `dokploy` -- inferred from container naming convention and `DATABASE_URL` env var; needs live instance verification
- `docker exec $(docker ps -qf name=dokploy-postgres)` pattern -- standard Docker Swarm container resolution; untested with Dokploy specifically

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, mirrors existing CoolifyAdapter
- Architecture: HIGH -- PlatformAdapter interface locked, factory pattern proven, file changes well-scoped
- Dokploy specifics (ports, paths, install): HIGH -- verified via official docs and multiple sources
- Dokploy PostgreSQL details (user, db name): MEDIUM -- inferred from install script analysis, needs live verification
- Pitfalls: HIGH -- identified from code analysis and Coolify/Dokploy comparison

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable -- Dokploy install script and adapter pattern unlikely to change)
