export function getBareCloudInit(serverName: string): string {
  const safeName = serverName.replace(/[^a-z0-9-]/g, "");
  return `#!/bin/bash
set +e
touch /var/log/kastell-install.log
chmod 600 /var/log/kastell-install.log
exec > >(tee /var/log/kastell-install.log) 2>&1

echo "=================================="
echo "Kastell Bare Server Setup"
echo "Server: ${safeName}"
echo "=================================="

# Wait for network connectivity
echo "Waiting for network connectivity..."
MAX_ATTEMPTS=30
ATTEMPTS=0
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  if curl -s --max-time 5 https://apt.releases.hashicorp.com > /dev/null 2>&1 || curl -s --max-time 5 https://archive.ubuntu.com > /dev/null 2>&1; then
    echo "Network is ready!"
    break
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  echo "Network not ready (attempt $ATTEMPTS/$MAX_ATTEMPTS)..."
  sleep 2
done

# Update system packages
echo "Updating system packages..."
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# Install hardening packages
echo "Installing hardening packages (fail2ban, ufw, unattended-upgrades)..."
DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban ufw unattended-upgrades

# Configure UFW firewall
echo "Configuring UFW firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
echo "y" | ufw enable || true
ufw status

# Configure unattended-upgrades for automatic security updates
echo "Configuring unattended-upgrades..."
dpkg-reconfigure -f noninteractive unattended-upgrades

# Enable and start fail2ban
echo "Enabling fail2ban..."
systemctl enable fail2ban || true
systemctl start fail2ban || true

echo "=================================="
echo "Bare server setup completed!"
echo "Server: ${safeName}"
echo "=================================="
echo ""
echo "Your server is ready. Connect via SSH:"
echo "  ssh root@YOUR_SERVER_IP"
`;
}
