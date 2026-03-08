/**
 * SSH batch command builder for server auditing.
 * Produces 2 batched commands with ---SEPARATOR--- delimiters between sections.
 * Section order is deterministic — parsers index into split output by SECTION_INDICES.
 */

/** Deterministic section indices for parsers to locate their output */
export const SECTION_INDICES = {
  // Batch 1 (config reads — fast)
  SSH: 0,
  FIREWALL: 1,
  UPDATES: 2,
  AUTH: 3,
  // Batch 2 (active probes — slower)
  DOCKER: 4,
  NETWORK: 5,
  FILESYSTEM: 6,
  LOGGING: 7,
  KERNEL: 8,
} as const;

/** Number of sections in batch 1 */
const BATCH1_COUNT = 4;

const SEPARATOR = "echo '---SEPARATOR---'";

function sshSection(): string {
  return [
    // sshd_config contents
    `cat /etc/ssh/sshd_config 2>/dev/null || echo 'N/A'`,
    // SSH port
    `ss -tlnp 2>/dev/null | grep ssh || netstat -tlnp 2>/dev/null | grep ssh || echo 'N/A'`,
    // SSH key-only auth status
    `sshd -T 2>/dev/null | grep -iE 'passwordauthentication|permitrootlogin|permitemptypasswords|pubkeyauthentication|protocol|maxauthtries|x11forwarding' || echo 'N/A'`,
  ].join("\n");
}

function firewallSection(): string {
  return [
    // UFW status
    `command -v ufw >/dev/null 2>&1 && ufw status verbose 2>/dev/null || echo 'N/A'`,
    // iptables rules count
    `command -v iptables >/dev/null 2>&1 && iptables -L -n 2>/dev/null | wc -l || echo 'N/A'`,
    // fail2ban status
    `command -v fail2ban-client >/dev/null 2>&1 && fail2ban-client status 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function updatesSection(): string {
  return [
    // Pending security updates (Debian/Ubuntu)
    `command -v apt >/dev/null 2>&1 && apt list --upgradable 2>/dev/null | grep -i security | wc -l || echo 'N/A'`,
    // Unattended upgrades status
    `dpkg -l unattended-upgrades 2>/dev/null | grep '^ii' || echo 'N/A'`,
    // Last update time
    `stat -c '%Y' /var/lib/apt/lists/ 2>/dev/null || echo 'N/A'`,
    // Reboot required
    `test -f /var/run/reboot-required && echo 'REBOOT_REQUIRED' || echo 'NO_REBOOT'`,
  ].join("\n");
}

function authSection(): string {
  return [
    // PAM config
    `cat /etc/pam.d/common-auth 2>/dev/null | head -20 || echo 'N/A'`,
    // sudo users
    `getent group sudo 2>/dev/null || echo 'N/A'`,
    // Password aging policy
    `cat /etc/login.defs 2>/dev/null | grep -E '^PASS_MAX_DAYS|^PASS_MIN_DAYS|^PASS_WARN_AGE' || echo 'N/A'`,
    // Users with empty passwords
    `awk -F: '($2 == "" || $2 == "!") {print $1}' /etc/shadow 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function dockerSection(platform: string): string {
  const base = [
    // Docker version and info
    `command -v docker >/dev/null 2>&1 && docker info --format '{{json .}}' 2>/dev/null || echo 'N/A'`,
    // Docker daemon config
    `cat /etc/docker/daemon.json 2>/dev/null || echo 'N/A'`,
    // Running containers
    `command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null || echo 'N/A'`,
    // Docker socket permissions
    `ls -la /var/run/docker.sock 2>/dev/null || echo 'N/A'`,
  ];

  if (platform === "coolify") {
    base.push(
      `test -d /data/coolify && ls -la /data/coolify/ 2>/dev/null || echo 'N/A'`,
      `docker inspect coolify 2>/dev/null | grep -i 'restartpolicy' || echo 'N/A'`,
    );
  } else if (platform === "dokploy") {
    base.push(
      `test -d /etc/dokploy && ls -la /etc/dokploy/ 2>/dev/null || echo 'N/A'`,
      `docker inspect dokploy 2>/dev/null | grep -i 'restartpolicy' || echo 'N/A'`,
    );
  }

  return base.join("\n");
}

function networkSection(): string {
  return [
    // Listening ports
    `ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo 'N/A'`,
    // Open UDP ports
    `ss -ulnp 2>/dev/null || netstat -ulnp 2>/dev/null || echo 'N/A'`,
    // IP forwarding
    `sysctl net.ipv4.ip_forward 2>/dev/null || echo 'N/A'`,
    // DNS resolver
    `cat /etc/resolv.conf 2>/dev/null | grep nameserver || echo 'N/A'`,
  ].join("\n");
}

function filesystemSection(): string {
  return [
    // World-writable files in key dirs (limit output)
    `find /etc /usr -maxdepth 2 -perm -o+w -type f 2>/dev/null | head -20 || echo 'N/A'`,
    // SUID binaries
    `find /usr/bin /usr/sbin -perm -4000 -type f 2>/dev/null | head -20 || echo 'N/A'`,
    // /tmp permissions
    `stat -c '%a %U %G' /tmp 2>/dev/null || echo 'N/A'`,
    // Disk usage
    `df -h / 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function loggingSection(): string {
  return [
    // Syslog / rsyslog / journald
    `systemctl is-active rsyslog 2>/dev/null || echo 'N/A'`,
    `systemctl is-active systemd-journald 2>/dev/null || echo 'N/A'`,
    // Log rotation
    `cat /etc/logrotate.conf 2>/dev/null | head -10 || echo 'N/A'`,
    // Auth log exists
    `test -f /var/log/auth.log && echo 'EXISTS' || test -f /var/log/secure && echo 'EXISTS' || echo 'MISSING'`,
  ].join("\n");
}

function kernelSection(): string {
  return [
    // Key sysctl security params
    `sysctl -a 2>/dev/null | grep -E 'randomize_va_space|accept_redirects|accept_source_route|log_martians|syncookies|core_uses_pid' || echo 'N/A'`,
    // Kernel version
    `uname -r 2>/dev/null || echo 'N/A'`,
    // Loaded security modules
    `cat /sys/kernel/security/lsm 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

/**
 * Build 2 batched SSH commands for server auditing.
 *
 * Batch 1: Config reads (fast) — SSH, Firewall, Updates, Auth
 * Batch 2: Active probes (slower) — Docker, Network, Filesystem, Logging, Kernel
 *
 * Sections within each batch are separated by `---SEPARATOR---`.
 * Parsers use SECTION_INDICES to locate their data in the combined output.
 */
export function buildAuditBatchCommands(platform: string): string[] {
  // Batch 1: Config reads — fast operations
  const batch1 = [
    sshSection(),
    SEPARATOR,
    firewallSection(),
    SEPARATOR,
    updatesSection(),
    SEPARATOR,
    authSection(),
  ].join("\n");

  // Batch 2: Active probes — slower operations
  const batch2 = [
    dockerSection(platform),
    SEPARATOR,
    networkSection(),
    SEPARATOR,
    filesystemSection(),
    SEPARATOR,
    loggingSection(),
    SEPARATOR,
    kernelSection(),
  ].join("\n");

  return [batch1, batch2];
}
