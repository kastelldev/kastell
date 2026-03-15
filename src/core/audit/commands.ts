/**
 * SSH batch command builder for server auditing.
 * Produces 3 tiered batches with ---SECTION:NAME--- named separators.
 * Parsers locate their output by section name, not integer index.
 */

export type BatchTier = "fast" | "medium" | "slow";

export interface BatchDef {
  tier: BatchTier;
  command: string;
}

export const BATCH_TIMEOUTS: Record<BatchTier, number> = {
  fast: 30_000,
  medium: 60_000,
  slow: 120_000,
} as const;

const NAMED_SEP = (name: string): string => `echo '---SECTION:${name}---'`;

function sshSection(): string {
  return [
    NAMED_SEP("SSH"),
    `cat /etc/ssh/sshd_config 2>/dev/null || echo 'N/A'`,
    `ss -tlnp 2>/dev/null | grep ssh || netstat -tlnp 2>/dev/null | grep ssh || echo 'N/A'`,
    `sshd -T 2>/dev/null | grep -iE 'passwordauthentication|permitrootlogin|permitemptypasswords|pubkeyauthentication|protocol|maxauthtries|x11forwarding' || echo 'N/A'`,
  ].join("\n");
}

function firewallSection(): string {
  return [
    NAMED_SEP("FIREWALL"),
    `command -v ufw >/dev/null 2>&1 && ufw status verbose 2>/dev/null || echo 'N/A'`,
    `command -v iptables >/dev/null 2>&1 && iptables -L -n 2>/dev/null | wc -l || echo 'N/A'`,
    `command -v fail2ban-client >/dev/null 2>&1 && fail2ban-client status 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function updatesSection(): string {
  return [
    NAMED_SEP("UPDATES"),
    `command -v apt >/dev/null 2>&1 && apt list --upgradable 2>/dev/null | grep -i security | wc -l || echo 'N/A'`,
    `dpkg -l unattended-upgrades 2>/dev/null | grep '^ii' || echo 'N/A'`,
    `stat -c '%Y' /var/lib/apt/lists/ 2>/dev/null || echo 'N/A'`,
    `test -f /var/run/reboot-required && echo 'REBOOT_REQUIRED' || echo 'NO_REBOOT'`,
  ].join("\n");
}

function authSection(): string {
  return [
    NAMED_SEP("AUTH"),
    `cat /etc/pam.d/common-auth 2>/dev/null | head -20 || echo 'N/A'`,
    `getent group sudo 2>/dev/null || echo 'N/A'`,
    `cat /etc/login.defs 2>/dev/null | grep -E '^PASS_MAX_DAYS|^PASS_MIN_DAYS|^PASS_WARN_AGE' || echo 'N/A'`,
    `awk -F: '($2 == "" || $2 == "!") {print $1}' /etc/shadow 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function dockerSection(platform: string): string {
  const base = [
    NAMED_SEP("DOCKER"),
    `command -v docker >/dev/null 2>&1 && docker info --format '{{json .}}' 2>/dev/null || echo 'N/A'`,
    `cat /etc/docker/daemon.json 2>/dev/null || echo 'N/A'`,
    `command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null || echo 'N/A'`,
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
    NAMED_SEP("NETWORK"),
    `ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo 'N/A'`,
    `ss -ulnp 2>/dev/null || netstat -ulnp 2>/dev/null || echo 'N/A'`,
    `sysctl net.ipv4.ip_forward 2>/dev/null || echo 'N/A'`,
    `cat /etc/resolv.conf 2>/dev/null | grep nameserver || echo 'N/A'`,
    `timedatectl 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function loggingSection(): string {
  return [
    NAMED_SEP("LOGGING"),
    `systemctl is-active rsyslog 2>/dev/null || echo 'N/A'`,
    `systemctl is-active systemd-journald 2>/dev/null || echo 'N/A'`,
    `cat /etc/logrotate.conf 2>/dev/null | head -10 || echo 'N/A'`,
    `test -f /var/log/auth.log && echo 'EXISTS' || test -f /var/log/secure && echo 'EXISTS' || echo 'MISSING'`,
  ].join("\n");
}

function kernelSection(): string {
  return [
    NAMED_SEP("KERNEL"),
    `sysctl -a 2>/dev/null | grep -E 'randomize_va_space|accept_redirects|accept_source_route|log_martians|syncookies|core_uses_pid' || echo 'N/A'`,
    `uname -r 2>/dev/null || echo 'N/A'`,
    `cat /sys/kernel/security/lsm 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function filesystemSection(): string {
  return [
    NAMED_SEP("FILESYSTEM"),
    `find /etc /usr -maxdepth 2 -perm -o+w -type f 2>/dev/null | head -20 || echo 'N/A'`,
    `find /usr/bin /usr/sbin -perm -4000 -type f 2>/dev/null | head -20 || echo 'N/A'`,
    `stat -c '%a %U %G' /tmp 2>/dev/null || echo 'N/A'`,
    `df -h / 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

/**
 * Build 3 tiered SSH batch commands for server auditing.
 *
 * Batch 1 (fast):   SSH, Firewall, Updates, Auth — config reads (30s timeout)
 * Batch 2 (medium): Docker, Network, Logging, Kernel — active probes (60s timeout)
 * Batch 3 (slow):   Filesystem — find commands that can take time (120s timeout)
 *
 * Each section is preceded by an ---SECTION:NAME--- named separator.
 * Parsers route by section name, not integer index.
 */
export function buildAuditBatchCommands(platform: string): BatchDef[] {
  const fast: BatchDef = {
    tier: "fast",
    command: [
      sshSection(),
      firewallSection(),
      updatesSection(),
      authSection(),
    ].join("\n"),
  };

  const medium: BatchDef = {
    tier: "medium",
    command: [
      dockerSection(platform),
      networkSection(),
      loggingSection(),
      kernelSection(),
    ].join("\n"),
  };

  const slow: BatchDef = {
    tier: "slow",
    command: filesystemSection(),
  };

  return [fast, medium, slow];
}
