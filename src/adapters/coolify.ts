import type {
  PlatformAdapter,
  HealthResult,
  PlatformStatusResult,
  PlatformBackupResult,
  PlatformRestoreResult,
  UpdateResult,
} from "./interface.js";
import type { BackupManifest } from "../types/index.js";
import { COOLIFY_INSTALL_URL, COOLIFY_PORT } from "../constants.js";
import { sharedHealthCheck, sharedUpdate, sharedGetStatus, sharedCreateBackup, sharedRestoreBackup } from "./shared.js";
import type { AdapterBackupConfig, AdapterRestoreConfig } from "./shared.js";

// Download-then-execute with script validation — private to coolify adapter
const SCRIPT_VALIDATE = 'head -c2 "$1" | grep -q "#!" && [ "$(wc -c < "$1")" -gt 100 ]';
const COOLIFY_UPDATE_CMD = `curl -fsSL ${COOLIFY_INSTALL_URL} -o /tmp/coolify-install.sh && ${SCRIPT_VALIDATE.replace(/\$1/g, "/tmp/coolify-install.sh")} && bash /tmp/coolify-install.sh && rm -f /tmp/coolify-install.sh`;

export class CoolifyAdapter implements PlatformAdapter {
  readonly name = "coolify";

  getCloudInit(serverName: string): string {
    const safeName = serverName.replace(/[^a-z0-9-]/g, "");
    return `#!/bin/bash
set +e
export DEBIAN_FRONTEND=noninteractive
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

# Disable needrestart to prevent interactive prompts during Docker/package installation
echo "Disabling needrestart..."
if dpkg -l needrestart > /dev/null 2>&1; then
  apt-get remove -y needrestart || true
fi
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

# Update system
echo "Updating system packages..."
apt-get update -y

# Configure firewall BEFORE installer (prevents SSH lockout if installer hangs)
echo "Configuring firewall..."
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 8000/tcp
  ufw allow 6001/tcp
  ufw allow 6002/tcp
  echo "y" | ufw enable || true
else
  iptables -A INPUT -p tcp --dport 8000 -j ACCEPT
  iptables -A INPUT -p tcp --dport 22 -j ACCEPT
  iptables -A INPUT -p tcp --dport 80 -j ACCEPT
  iptables -A INPUT -p tcp --dport 443 -j ACCEPT
  iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  mkdir -p /etc/iptables
  iptables-save > /etc/iptables/rules.v4 || true
  apt-get install -y iptables-persistent || true
fi

# Switch from socket activation to traditional SSH service (prevents Ubuntu 24.04 ssh.socket bugs)
echo "Switching to traditional SSH service..."
systemctl disable --now ssh.socket 2>/dev/null || true
systemctl enable --now ssh.service 2>/dev/null || true

# Install Coolify
echo "Installing Coolify..."
curl -fsSL https://cdn.coollabs.io/coolify/install.sh -o /tmp/coolify-install.sh && head -c2 /tmp/coolify-install.sh | grep -q "#!" && [ "$(wc -c < /tmp/coolify-install.sh)" -gt 100 ] && env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1 bash /tmp/coolify-install.sh && rm -f /tmp/coolify-install.sh

# Ensure SSH remains accessible after Coolify installation
echo "Ensuring SSH service is active..."
if ! ss -tlnp | grep -q ':22 '; then
  systemctl restart ssh.service 2>/dev/null || systemctl restart sshd.service 2>/dev/null || true
  sleep 2
fi

# Wait for services
echo "Waiting for Coolify services to start..."
sleep 30

echo "=================================="
echo "Coolify installation completed!"
echo "=================================="
echo ""
echo "Please wait 3-5 more minutes for Coolify to fully initialize."
echo "Then access your instance at: http://YOUR_SERVER_IP:8000"
`;
  }

  async healthCheck(ip: string, domain?: string): Promise<HealthResult> {
    return sharedHealthCheck(ip, COOLIFY_PORT, domain);
  }

  async createBackup(
    ip: string,
    serverName: string,
    provider: string,
  ): Promise<PlatformBackupResult> {
    return sharedCreateBackup(ip, serverName, provider, this.backupConfig());
  }

  async restoreBackup(
    ip: string,
    backupPath: string,
    manifest: BackupManifest,
    options?: { force?: boolean },
  ): Promise<PlatformRestoreResult> {
    return sharedRestoreBackup(ip, backupPath, manifest, this.restoreConfig(), options);
  }

  async getStatus(ip: string): Promise<PlatformStatusResult> {
    return sharedGetStatus(ip, this.versionCmd(), COOLIFY_PORT);
  }

  async update(ip: string): Promise<UpdateResult> {
    return sharedUpdate(ip, COOLIFY_UPDATE_CMD);
  }

  // ─── Private Config Builders ─────────────────────────────────────────────────

  private versionCmd(): string {
    return "docker inspect coolify --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || echo unknown";
  }

  private backupConfig(): AdapterBackupConfig {
    return {
      platform: "coolify",
      pgDumpCmd: "set -o pipefail && docker exec coolify-db pg_dump -U coolify -d coolify | gzip > /tmp/coolify-backup.sql.gz",
      configTarCmd: "tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml docker-compose.prod.yml 2>/dev/null || tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml",
      versionCmd: this.versionCmd(),
      cleanupCmd: "rm -f /tmp/coolify-backup.sql.gz /tmp/coolify-config.tar.gz",
      dbFileName: "coolify-backup.sql.gz",
      configFileName: "coolify-config.tar.gz",
    };
  }

  private restoreConfig(): AdapterRestoreConfig {
    return {
      platform: "coolify",
      stopCmd: "cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml stop",
      startDbCmd: "cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres && sleep 3",
      restoreDbCmd: "gunzip -c /tmp/coolify-backup.sql.gz | docker exec -i coolify-db psql -U coolify -d coolify",
      restoreConfigCmd: "tar xzf /tmp/coolify-config.tar.gz -C /data/coolify/source",
      startCmd: "cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d",
      cleanupCmd: "rm -f /tmp/coolify-backup.sql.gz /tmp/coolify-config.tar.gz",
      tryRestartCmd: "cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d",
      dbFileName: "coolify-backup.sql.gz",
      configFileName: "coolify-config.tar.gz",
    };
  }
}
