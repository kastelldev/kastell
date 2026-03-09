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
import { COOLIFY_UPDATE_CMD } from "../constants.js";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import {
  formatTimestamp,
  getBackupDir,
  scpDownload,
  scpUpload,
  buildStopCoolifyCommand,
  buildStartCoolifyCommand,
  buildStartDbCommand,
  buildRestoreDbCommand,
  buildRestoreConfigCommand,
  buildCleanupCommand,
  tryRestartCoolify,
} from "../core/backup.js";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../utils/errorMapper.js";
import { sharedHealthCheck, sharedUpdate, sharedGetStatus } from "./shared.js";

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
curl -fsSL https://cdn.coollabs.io/coolify/install.sh -o /tmp/coolify-install.sh && head -c2 /tmp/coolify-install.sh | grep -q "#!" && [ "$(wc -c < /tmp/coolify-install.sh)" -gt 100 ] && bash /tmp/coolify-install.sh && rm -f /tmp/coolify-install.sh

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

  async healthCheck(ip: string, domain?: string): Promise<HealthResult> {
    return sharedHealthCheck(ip, 8000, domain);
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
      // Upload backup files (before stopping Coolify -- safe to fail here)
      const dbUpload = await scpUpload(
        ip,
        join(backupPath, "coolify-backup.sql.gz"),
        "/tmp/coolify-backup.sql.gz",
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
        join(backupPath, "coolify-config.tar.gz"),
        "/tmp/coolify-config.tar.gz",
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

      // Step 1: Stop Coolify
      const stopResult = await sshExec(ip, buildStopCoolifyCommand());
      if (stopResult.code !== 0) {
        steps.push({
          name: "Stop Coolify",
          status: "failure",
          error: sanitizeStderr(stopResult.stderr),
        });
        return { success: false, steps, error: "Failed to stop Coolify" };
      }
      steps.push({ name: "Stop Coolify", status: "success" });

      // Step 2: Start DB only
      const dbStartResult = await sshExec(ip, buildStartDbCommand());
      if (dbStartResult.code !== 0) {
        steps.push({
          name: "Start database",
          status: "failure",
          error: sanitizeStderr(dbStartResult.stderr),
        });
        await tryRestartCoolify(ip);
        return { success: false, steps, error: "Failed to start database" };
      }
      steps.push({ name: "Start database", status: "success" });

      // Step 3: Restore database
      const restoreDbResult = await sshExec(ip, buildRestoreDbCommand());
      if (restoreDbResult.code !== 0) {
        steps.push({
          name: "Restore database",
          status: "failure",
          error: sanitizeStderr(restoreDbResult.stderr),
        });
        await tryRestartCoolify(ip);
        return { success: false, steps, error: "Database restore failed" };
      }
      steps.push({ name: "Restore database", status: "success" });

      // Step 4: Restore config
      const restoreConfigResult = await sshExec(ip, buildRestoreConfigCommand());
      if (restoreConfigResult.code !== 0) {
        steps.push({
          name: "Restore config",
          status: "failure",
          error: sanitizeStderr(restoreConfigResult.stderr),
        });
        await tryRestartCoolify(ip);
        return { success: false, steps, error: "Config restore failed" };
      }
      steps.push({ name: "Restore config", status: "success" });

      // Step 5: Start Coolify
      const startResult = await sshExec(ip, buildStartCoolifyCommand());
      if (startResult.code !== 0) {
        steps.push({
          name: "Start Coolify",
          status: "failure",
          error: sanitizeStderr(startResult.stderr),
        });
        return { success: false, steps, error: "Failed to start Coolify" };
      }
      steps.push({ name: "Start Coolify", status: "success" });

      // Cleanup remote (best-effort)
      await sshExec(ip, buildCleanupCommand()).catch(() => {});

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
    return sharedGetStatus(ip, this.buildVersionCommand(), 8000);
  }

  async update(ip: string): Promise<UpdateResult> {
    return sharedUpdate(ip, COOLIFY_UPDATE_CMD);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private buildPgDumpCommand(): string {
    return "set -o pipefail && docker exec coolify-db pg_dump -U coolify -d coolify | gzip > /tmp/coolify-backup.sql.gz";
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
