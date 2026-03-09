import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type {
  PlatformAdapter,
  HealthResult,
  PlatformStatusResult,
  PlatformBackupResult,
  PlatformRestoreResult,
  UpdateResult,
} from "./interface.js";
import type { BackupManifest } from "../types/index.js";
import { DOKPLOY_UPDATE_CMD } from "../constants.js";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import {
  formatTimestamp,
  getBackupDir,
  scpDownload,
  scpUpload,
} from "../core/backup.js";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../utils/errorMapper.js";
import { sharedHealthCheck, sharedUpdate, sharedGetStatus } from "./shared.js";

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
curl -sSL https://dokploy.com/install.sh -o /tmp/dokploy-install.sh && head -c2 /tmp/dokploy-install.sh | grep -q "#!" && [ "$(wc -c < /tmp/dokploy-install.sh)" -gt 100 ] && sh /tmp/dokploy-install.sh && rm -f /tmp/dokploy-install.sh

# Wait for services
echo "Waiting for Dokploy services to start..."
sleep 30

# Configure firewall for Dokploy + Docker Swarm
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

  async healthCheck(ip: string, domain?: string): Promise<HealthResult> {
    return sharedHealthCheck(ip, 3000, domain);
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
        coolifyVersion: dokployVersion, // Reuse field for backward compat
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

  async restoreBackup(
    ip: string,
    backupPath: string,
    _manifest: BackupManifest,
  ): Promise<PlatformRestoreResult> {
    assertValidIp(ip);

    const steps: Array<{
      name: string;
      status: "success" | "failure";
      error?: string;
    }> = [];

    try {
      // Upload backup files (before stopping Dokploy -- safe to fail here)
      const dbUpload = await scpUpload(
        ip,
        join(backupPath, "dokploy-backup.sql.gz"),
        "/tmp/dokploy-backup.sql.gz",
      );
      if (dbUpload.code !== 0) {
        return {
          success: false,
          steps: [
            {
              name: "Upload database backup",
              status: "failure",
              error: sanitizeStderr(dbUpload.stderr),
            },
          ],
          error: "Failed to upload database backup",
        };
      }
      steps.push({ name: "Upload database backup", status: "success" });

      const configUpload = await scpUpload(
        ip,
        join(backupPath, "dokploy-config.tar.gz"),
        "/tmp/dokploy-config.tar.gz",
      );
      if (configUpload.code !== 0) {
        return {
          success: false,
          steps: [
            ...steps,
            {
              name: "Upload config backup",
              status: "failure",
              error: sanitizeStderr(configUpload.stderr),
            },
          ],
          error: "Failed to upload config backup",
        };
      }
      steps.push({ name: "Upload config backup", status: "success" });

      // Step 1: Stop Dokploy (scale to 0)
      const stopResult = await sshExec(ip, "docker service scale dokploy=0");
      if (stopResult.code !== 0) {
        steps.push({
          name: "Stop Dokploy",
          status: "failure",
          error: sanitizeStderr(stopResult.stderr),
        });
        return { success: false, steps, error: "Failed to stop Dokploy" };
      }
      steps.push({ name: "Stop Dokploy", status: "success" });

      // Step 2: Start postgres (ensure DB is running)
      const dbStartResult = await sshExec(
        ip,
        "docker service scale dokploy-postgres=1 && sleep 5",
      );
      if (dbStartResult.code !== 0) {
        steps.push({
          name: "Start database",
          status: "failure",
          error: sanitizeStderr(dbStartResult.stderr),
        });
        await this.tryRestartDokploy(ip);
        return { success: false, steps, error: "Failed to start database" };
      }
      steps.push({ name: "Start database", status: "success" });

      // Step 3: Restore database
      const restoreDbResult = await sshExec(
        ip,
        "gunzip -c /tmp/dokploy-backup.sql.gz | docker exec -i $(docker ps -qf name=dokploy-postgres --no-trunc | head -1) psql -U postgres -d dokploy",
      );
      if (restoreDbResult.code !== 0) {
        steps.push({
          name: "Restore database",
          status: "failure",
          error: sanitizeStderr(restoreDbResult.stderr),
        });
        await this.tryRestartDokploy(ip);
        return { success: false, steps, error: "Database restore failed" };
      }
      steps.push({ name: "Restore database", status: "success" });

      // Step 4: Restore config
      const restoreConfigResult = await sshExec(
        ip,
        "tar xzf /tmp/dokploy-config.tar.gz -C /etc/dokploy",
      );
      if (restoreConfigResult.code !== 0) {
        steps.push({
          name: "Restore config",
          status: "failure",
          error: sanitizeStderr(restoreConfigResult.stderr),
        });
        await this.tryRestartDokploy(ip);
        return { success: false, steps, error: "Config restore failed" };
      }
      steps.push({ name: "Restore config", status: "success" });

      // Step 5: Start Dokploy
      const startResult = await sshExec(ip, "docker service scale dokploy=1");
      if (startResult.code !== 0) {
        steps.push({
          name: "Start Dokploy",
          status: "failure",
          error: sanitizeStderr(startResult.stderr),
        });
        return { success: false, steps, error: "Failed to start Dokploy" };
      }
      steps.push({ name: "Start Dokploy", status: "success" });

      // Cleanup remote (best-effort)
      await sshExec(ip, this.buildCleanupCommand()).catch(() => {});

      return { success: true, steps };
    } catch (error: unknown) {
      const hint = mapSshError(error, ip);
      return {
        success: false,
        steps,
        error: getErrorMessage(error),
        ...(hint ? { hint } : {}),
      };
    }
  }

  async getStatus(ip: string): Promise<PlatformStatusResult> {
    return sharedGetStatus(ip, this.buildVersionCommand(), 3000);
  }

  async update(ip: string): Promise<UpdateResult> {
    return sharedUpdate(ip, DOKPLOY_UPDATE_CMD);
  }

  // --- Private Helpers -------------------------------------------------------

  private async tryRestartDokploy(ip: string): Promise<void> {
    try {
      await sshExec(ip, "docker service scale dokploy=1");
    } catch {
      // Best-effort -- swallow errors
    }
  }

  private buildPgDumpCommand(): string {
    return "set -o pipefail && docker exec $(docker ps -qf name=dokploy-postgres --no-trunc | head -1) pg_dump -U postgres -d dokploy | gzip > /tmp/dokploy-backup.sql.gz";
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
