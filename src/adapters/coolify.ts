import axios from "axios";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type {
  PlatformAdapter,
  HealthResult,
  PlatformStatusResult,
  PlatformBackupResult,
  UpdateResult,
} from "./interface.js";
import type { BackupManifest } from "../types/index.js";
import { COOLIFY_UPDATE_CMD } from "../constants.js";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import {
  formatTimestamp,
  getBackupDir,
  scpDownload,
} from "../core/backup.js";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../utils/errorMapper.js";

export class CoolifyAdapter implements PlatformAdapter {
  readonly name = "coolify";

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
echo "=================================="

# Wait for network connectivity (DO cloud-init may start before network is ready)
echo "Waiting for network connectivity..."
MAX_ATTEMPTS=30
ATTEMPTS=0
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  if curl -s --max-time 5 https://cdn.coollabs.io > /dev/null 2>&1; then
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

# Install Coolify
echo "Installing Coolify..."
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Wait for services
echo "Waiting for Coolify services to start..."
sleep 30

# Configure firewall for Coolify
echo "Configuring firewall..."
if command -v ufw &> /dev/null; then
  # DigitalOcean and UFW-enabled systems
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 8000/tcp
  ufw allow 6001/tcp
  ufw allow 6002/tcp
  echo "y" | ufw enable || true
else
  # Hetzner and iptables-based systems
  iptables -A INPUT -p tcp --dport 8000 -j ACCEPT
  iptables -A INPUT -p tcp --dport 22 -j ACCEPT
  iptables -A INPUT -p tcp --dport 80 -j ACCEPT
  iptables -A INPUT -p tcp --dport 443 -j ACCEPT
  iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  mkdir -p /etc/iptables
  iptables-save > /etc/iptables/rules.v4 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent || true
fi

echo "=================================="
echo "Coolify installation completed!"
echo "=================================="
echo ""
echo "Please wait 3-5 more minutes for Coolify to fully initialize."
echo "Then access your instance at: http://YOUR_SERVER_IP:8000"
`;
  }

  async healthCheck(ip: string): Promise<HealthResult> {
    assertValidIp(ip);
    try {
      await axios.get(`http://${ip}:8000`, {
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
      // Step 1: Get Coolify version (best-effort)
      const versionResult = await sshExec(ip, this.buildVersionCommand());
      const coolifyVersion = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";

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
        "/tmp/coolify-backup.sql.gz",
        join(backupPath, "coolify-backup.sql.gz"),
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
        "/tmp/coolify-config.tar.gz",
        join(backupPath, "coolify-config.tar.gz"),
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
        coolifyVersion,
        files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
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

  async update(ip: string): Promise<UpdateResult> {
    assertValidIp(ip);
    try {
      const result = await sshExec(ip, COOLIFY_UPDATE_CMD);
      if (result.code === 0) {
        return { success: true, output: result.stdout || undefined };
      }
      return {
        success: false,
        error: `Update failed (exit code ${result.code})`,
        output: result.stderr || result.stdout || undefined,
      };
    } catch (error: unknown) {
      const hint = mapSshError(error, ip);
      return {
        success: false,
        error: getErrorMessage(error),
        ...(hint ? { hint } : {}),
      };
    }
  }

  getLogCommand(lines: number, follow: boolean): string {
    return `docker logs coolify --tail ${lines}${follow ? " --follow" : ""}`;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private buildPgDumpCommand(): string {
    return "docker exec coolify-db pg_dump -U coolify -d coolify | gzip > /tmp/coolify-backup.sql.gz";
  }

  private buildConfigTarCommand(): string {
    return "tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml docker-compose.prod.yml 2>/dev/null || tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml";
  }

  private buildCleanupCommand(): string {
    return "rm -f /tmp/coolify-backup.sql.gz /tmp/coolify-config.tar.gz";
  }

  private buildVersionCommand(): string {
    return "docker inspect coolify --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || echo unknown";
  }
}
