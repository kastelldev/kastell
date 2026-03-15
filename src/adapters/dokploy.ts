import type {
  PlatformAdapter,
  HealthResult,
  PlatformStatusResult,
  PlatformBackupResult,
  PlatformRestoreResult,
  UpdateResult,
} from "./interface.js";
import type { BackupManifest } from "../types/index.js";
import { DOKPLOY_UPDATE_CMD, DOKPLOY_PORT } from "../constants.js";
import { sharedHealthCheck, sharedUpdate, sharedGetStatus, sharedCreateBackup, sharedRestoreBackup } from "./shared.js";
import type { AdapterBackupConfig, AdapterRestoreConfig } from "./shared.js";

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
    return sharedHealthCheck(ip, DOKPLOY_PORT, domain);
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
    return sharedGetStatus(ip, this.versionCmd(), DOKPLOY_PORT);
  }

  async update(ip: string): Promise<UpdateResult> {
    return sharedUpdate(ip, DOKPLOY_UPDATE_CMD);
  }

  // --- Private Config Builders ------------------------------------------------

  private versionCmd(): string {
    return "docker inspect dokploy --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || echo unknown";
  }

  private backupConfig(): AdapterBackupConfig {
    return {
      platform: "dokploy",
      pgDumpCmd: "set -o pipefail && docker exec $(docker ps -qf name=dokploy-postgres --no-trunc | head -1) pg_dump -U dokploy -d dokploy | gzip > /tmp/dokploy-backup.sql.gz",
      configTarCmd: "tar czf /tmp/dokploy-config.tar.gz -C /etc/dokploy .",
      versionCmd: this.versionCmd(),
      cleanupCmd: "rm -f /tmp/dokploy-backup.sql.gz /tmp/dokploy-config.tar.gz",
      dbFileName: "dokploy-backup.sql.gz",
      configFileName: "dokploy-config.tar.gz",
    };
  }

  private restoreConfig(): AdapterRestoreConfig {
    return {
      platform: "dokploy",
      stopCmd: "docker service scale dokploy=0",
      startDbCmd: "docker service scale dokploy-postgres=1 && sleep 5",
      restoreDbCmd: "gunzip -c /tmp/dokploy-backup.sql.gz | docker exec -i $(docker ps -qf name=dokploy-postgres --no-trunc | head -1) psql -U dokploy -d dokploy",
      restoreConfigCmd: "tar xzf /tmp/dokploy-config.tar.gz -C /etc/dokploy",
      startCmd: "docker service scale dokploy=1",
      cleanupCmd: "rm -f /tmp/dokploy-backup.sql.gz /tmp/dokploy-config.tar.gz",
      tryRestartCmd: "docker service scale dokploy=1",
      dbFileName: "dokploy-backup.sql.gz",
      configFileName: "dokploy-config.tar.gz",
    };
  }
}
