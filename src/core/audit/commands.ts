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

function accountsSection(): string {
  return [
    NAMED_SEP("ACCOUNTS"),
    `awk -F: '{print $1":"$3":"$7}' /etc/passwd 2>/dev/null || echo 'N/A'`,
    `awk -F: '{print $1":"$2}' /etc/shadow 2>/dev/null || echo 'N/A'`,
    `find /home -maxdepth 1 -mindepth 1 -type d 2>/dev/null | xargs stat -c '%n %U' 2>/dev/null || echo 'N/A'`,
    `ls -la /root/.rhosts /root/.netrc /root/.forward /etc/hosts.equiv 2>/dev/null || echo 'NONE'`,
    `awk -F: '($3 < 1000 && $7 != "/usr/sbin/nologin" && $7 != "/bin/false" && $7 != "/sbin/nologin") {print $1":"$7}' /etc/passwd 2>/dev/null || echo 'N/A'`,
    `stat -c '%a' /root 2>/dev/null || echo 'N/A'`,
    `cat /etc/login.defs 2>/dev/null | grep -E '^PASS_MAX_DAYS|^PASS_MIN_DAYS|^UMASK|^INACTIVE' || echo 'N/A'`,
    `awk -F: '{print $1":"$3}' /etc/passwd 2>/dev/null | sort -t: -k2 -n | uniq -d -f1 | head -10 || echo 'NONE'`,
  ].join("\n");
}

function servicesSection(): string {
  return [
    NAMED_SEP("SERVICES"),
    `systemctl is-active telnet rsh rlogin vsftpd ftp tftpd-hpa 2>/dev/null | head -10 || echo 'N/A'`,
    `systemctl is-active nfs-server rpcbind smbd nmbd avahi-daemon cups isc-dhcp-server named snmpd squid xinetd ypserv 2>/dev/null | head -15 || echo 'N/A'`,
    `test -f /etc/inetd.conf && grep -v '^#' /etc/inetd.conf 2>/dev/null || echo 'NONE'`,
    `test -f /etc/xinetd.conf && cat /etc/xinetd.conf 2>/dev/null || echo 'NONE'`,
  ].join("\n");
}

function bootSection(): string {
  return [
    NAMED_SEP("BOOT"),
    `stat -c '%a %U %G' /boot/grub/grub.cfg /boot/grub2/grub.cfg 2>/dev/null || echo 'N/A'`,
    `grep -q 'set superusers' /boot/grub/grub.cfg 2>/dev/null && echo 'GRUB_PW_SET' || echo 'GRUB_NO_PW'`,
    `mokutil --sb-state 2>/dev/null || echo 'N/A'`,
    `cat /proc/cmdline 2>/dev/null || echo 'N/A'`,
    `stat -c '%a %U %G %n' /etc/grub.d 2>/dev/null || echo 'N/A'`,
    `grep '/boot' /proc/mounts 2>/dev/null || echo 'N/A'`,
    `grep -l sulogin /usr/lib/systemd/system/rescue.service /usr/lib/systemd/system/emergency.service 2>/dev/null || echo 'N/A'`,
    `sysctl kernel.modules_disabled 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function schedulingSection(): string {
  return [
    NAMED_SEP("SCHEDULING"),
    `test -f /etc/cron.allow && echo 'cron.allow EXISTS' || echo 'cron.allow MISSING'`,
    `test -f /etc/cron.deny && echo 'cron.deny EXISTS' || echo 'cron.deny MISSING'`,
    `test -f /etc/at.allow && echo 'at.allow EXISTS' || echo 'at.allow MISSING'`,
    `test -f /etc/at.deny && echo 'at.deny EXISTS' || echo 'at.deny MISSING'`,
    `stat -c '%a %U %G %n' /etc/cron.d /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /etc/cron.hourly 2>/dev/null || echo 'N/A'`,
    `stat -c '%a %U %G %n' /etc/crontab 2>/dev/null || echo 'N/A'`,
    `find /etc/cron* -perm -o+w 2>/dev/null | head -10 || echo 'NONE'`,
  ].join("\n");
}

function timeSection(): string {
  return [
    NAMED_SEP("TIME"),
    `timedatectl 2>/dev/null || echo 'N/A'`,
    `systemctl is-active ntp chrony chronyd systemd-timesyncd 2>/dev/null | head -5 || echo 'N/A'`,
    `chronyc tracking 2>/dev/null | head -10 || echo 'N/A'`,
    `cat /etc/timezone 2>/dev/null || echo 'N/A'`,
    `hwclock --show 2>/dev/null | head -3 || echo 'N/A'`,
  ].join("\n");
}

function bannersSection(): string {
  return [
    NAMED_SEP("BANNERS"),
    `cat /etc/issue 2>/dev/null || echo 'MISSING'`,
    `cat /etc/issue.net 2>/dev/null || echo 'MISSING'`,
    `cat /etc/motd 2>/dev/null || echo 'MISSING'`,
    `grep -i '^Banner' /etc/ssh/sshd_config 2>/dev/null || sshd -T 2>/dev/null | grep -i '^banner' || echo 'N/A'`,
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
 * Batch 1 (fast):   SSH, Firewall, Updates, Auth, Accounts, Boot, Scheduling, Banners — config reads (30s timeout)
 * Batch 2 (medium): Docker, Network, Logging, Kernel, Services, Time — active probes (60s timeout)
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
      accountsSection(),
      bootSection(),
      schedulingSection(),
      bannersSection(),
    ].join("\n"),
  };

  const medium: BatchDef = {
    tier: "medium",
    command: [
      dockerSection(platform),
      networkSection(),
      loggingSection(),
      kernelSection(),
      servicesSection(),
      timeSection(),
    ].join("\n"),
  };

  const slow: BatchDef = {
    tier: "slow",
    command: filesystemSection(),
  };

  return [fast, medium, slow];
}
