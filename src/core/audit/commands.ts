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
    `sshd -T 2>/dev/null | grep -iE 'clientaliveinterval|clientalivecountmax|logingracetime|maxsessions|allowusers|allowgroups|denyusers|denygroups' || echo 'N/A'`,
    `sshd -T 2>/dev/null | grep -iE 'hostbasedauthentication|ignorerhosts|usedns|permituserenvironment|loglevel|banner' || echo 'N/A'`,
    `sshd -T 2>/dev/null | grep -iE '^ciphers|^macs|^kexalgorithms' || echo 'N/A'`,
  ].join("\n");
}

function firewallSection(): string {
  return [
    NAMED_SEP("FIREWALL"),
    `command -v ufw >/dev/null 2>&1 && ufw status verbose 2>/dev/null || echo 'N/A'`,
    `command -v iptables >/dev/null 2>&1 && iptables -L -n 2>/dev/null | wc -l || echo 'N/A'`,
    `command -v fail2ban-client >/dev/null 2>&1 && fail2ban-client status 2>/dev/null || echo 'N/A'`,
    // NEW: nftables detection
    `command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | head -20 || echo 'N/A'`,
    // NEW: iptables INPUT chain details
    `iptables -L INPUT -n --line-numbers 2>/dev/null | head -20 || echo 'N/A'`,
    // NEW: iptables INPUT default policy
    `iptables -L INPUT -n 2>/dev/null | head -1 || echo 'N/A'`,
    // NEW: outbound rules
    `iptables -L OUTPUT -n 2>/dev/null | head -1 || echo 'N/A'`,
    // NEW: rate limiting presence
    `iptables -L -n 2>/dev/null | grep -i 'limit' | head -5 || echo 'NONE'`,
  ].join("\n");
}

function updatesSection(): string {
  return [
    NAMED_SEP("UPDATES"),
    `command -v apt >/dev/null 2>&1 && apt list --upgradable 2>/dev/null | grep -i security | wc -l || echo 'N/A'`,
    `dpkg -l unattended-upgrades 2>/dev/null | grep '^ii' || echo 'N/A'`,
    `stat -c '%Y' /var/lib/apt/lists/ 2>/dev/null || echo 'N/A'`,
    `test -f /var/run/reboot-required && echo 'REBOOT_REQUIRED' || echo 'NO_REBOOT'`,
    // NEW: last upgrade timestamp
    `stat -c '%Y' /var/log/dpkg.log 2>/dev/null || echo 'N/A'`,
    // NEW: CVE scanner presence
    `which trivy grype 2>/dev/null || echo 'NONE'`,
    // NEW: half-installed packages
    `dpkg --audit 2>/dev/null | wc -l || echo '0'`,
    // NEW: running kernel version
    `uname -r 2>/dev/null || echo 'N/A'`,
    `dpkg -l 'linux-image-*' 2>/dev/null | grep '^ii' | tail -1 | awk '{print $3}' || echo 'N/A'`,
    // NEW: auto-upgrades config
    `cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function authSection(): string {
  return [
    NAMED_SEP("AUTH"),
    `cat /etc/pam.d/common-auth 2>/dev/null | head -20 || echo 'N/A'`,
    `getent group sudo 2>/dev/null || echo 'N/A'`,
    `cat /etc/login.defs 2>/dev/null | grep -E '^PASS_MAX_DAYS|^PASS_MIN_DAYS|^PASS_WARN_AGE' || echo 'N/A'`,
    `awk -F: '($2 == "" || $2 == "!") {print $1}' /etc/shadow 2>/dev/null || echo 'N/A'`,
    // NEW: shadow file permissions
    `stat -c '%a' /etc/shadow 2>/dev/null || echo 'N/A'`,
    // NEW: sudo logging
    `grep -E '^Defaults.*log_output|^Defaults.*syslog' /etc/sudoers /etc/sudoers.d/* 2>/dev/null | head -5 || echo 'NONE'`,
    // NEW: sudo requiretty
    `grep -E '^Defaults.*requiretty' /etc/sudoers /etc/sudoers.d/* 2>/dev/null | head -3 || echo 'NONE'`,
    // NEW: UID 0 accounts
    `awk -F: '($3 == 0) {print $1}' /etc/passwd 2>/dev/null || echo 'N/A'`,
    // NEW: faillock/pam_tally2
    `grep -E 'pam_faillock|pam_tally2' /etc/pam.d/common-auth /etc/pam.d/system-auth 2>/dev/null || echo 'NONE'`,
    // NEW: MFA packages
    `dpkg -l libpam-google-authenticator libpam-oath 2>/dev/null | grep '^ii' | head -5 || echo 'NONE'`,
    // NEW: login.defs extras (INACTIVE)
    `grep -E '^INACTIVE' /etc/default/useradd 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function dockerSection(platform: string): string {
  const base = [
    NAMED_SEP("DOCKER"),
    `command -v docker >/dev/null 2>&1 && docker info --format '{{json .}}' 2>/dev/null || echo 'N/A'`,
    `cat /etc/docker/daemon.json 2>/dev/null || echo 'N/A'`,
    `command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null || echo 'N/A'`,
    `ls -la /var/run/docker.sock 2>/dev/null || echo 'N/A'`,
    // NEW: container security inspection (top 5 running containers)
    `command -v docker >/dev/null 2>&1 && docker ps -q 2>/dev/null | head -5 | xargs -r docker inspect --format '{{.Name}} SecurityOpt={{.HostConfig.SecurityOpt}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} User={{.Config.User}} Privileged={{.HostConfig.Privileged}}' 2>/dev/null || echo 'N/A'`,
    // NEW: Docker content trust env
    `echo "DOCKER_CONTENT_TRUST=\${DOCKER_CONTENT_TRUST:-unset}" 2>/dev/null`,
    // NEW: Docker socket permissions detail
    `stat -c '%a %U %G' /var/run/docker.sock 2>/dev/null || echo 'N/A'`,
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
    `test -f /etc/hosts.allow && cat /etc/hosts.allow 2>/dev/null | head -10 || echo 'NO_HOSTS_ALLOW'`,
    `test -f /etc/hosts.deny && cat /etc/hosts.deny 2>/dev/null | head -10 || echo 'NO_HOSTS_DENY'`,
    `sysctl net.ipv6.conf.all.disable_ipv6 net.ipv4.conf.all.send_redirects net.ipv4.conf.all.secure_redirects net.ipv6.conf.all.accept_source_route net.ipv4.conf.all.rp_filter net.ipv4.tcp_syn_retries 2>/dev/null || echo 'N/A'`,
    `ss -tlnp 2>/dev/null | grep -E ':8080 |:8443 |:9000 |:3000 ' | grep '0.0.0.0' | head -10 || echo 'NONE'`,
  ].join("\n");
}

function loggingSection(): string {
  return [
    NAMED_SEP("LOGGING"),
    `systemctl is-active rsyslog 2>/dev/null || echo 'N/A'`,
    `systemctl is-active systemd-journald 2>/dev/null || echo 'N/A'`,
    `cat /etc/logrotate.conf 2>/dev/null | head -10 || echo 'N/A'`,
    `test -f /var/log/auth.log && echo 'EXISTS' || test -f /var/log/secure && echo 'EXISTS' || echo 'MISSING'`,
    // NEW: auditd rules
    `auditctl -l 2>/dev/null | head -20 || echo 'NO_RULES'`,
    // NEW: auditd active status
    `systemctl is-active auditd 2>/dev/null || echo 'inactive'`,
    // NEW: /var/log permissions
    `stat -c '%a' /var/log 2>/dev/null || echo 'N/A'`,
    // NEW: journald persistent storage
    `grep -E '^Storage' /etc/systemd/journald.conf 2>/dev/null || echo 'N/A'`,
    // NEW: centralized logging tools
    `which vector promtail fluent-bit 2>/dev/null || echo 'NONE'`,
  ].join("\n");
}

function kernelSection(): string {
  return [
    NAMED_SEP("KERNEL"),
    `sysctl -a 2>/dev/null | grep -E 'randomize_va_space|accept_redirects|accept_source_route|log_martians|syncookies|core_uses_pid|dmesg_restrict|kptr_restrict|ptrace_scope|perf_event_paranoid|tcp_timestamps|icmp_echo_ignore_broadcasts|rp_filter|ip_forward|modules_disabled|unprivileged_bpf_disabled|send_redirects|secure_redirects' || echo 'N/A'`,
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

function fileIntegritySection(): string {
  return [
    NAMED_SEP("FILEINTEGRITY"),
    `dpkg -l aide 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'`,
    `dpkg -l tripwire 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'`,
    `test -f /var/lib/aide/aide.db.gz && echo 'AIDE_DB_EXISTS' || test -f /var/lib/aide/aide.db && echo 'AIDE_DB_EXISTS' || echo 'AIDE_DB_MISSING'`,
    `grep -r 'aide' /etc/cron.daily /etc/cron.weekly /var/spool/cron/crontabs/ 2>/dev/null | head -5 || echo 'NO_AIDE_CRON'`,
    `dpkg -l auditd 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'`,
    `systemctl is-active auditd 2>/dev/null || echo 'inactive'`,
    `auditctl -l 2>/dev/null | grep -E '/etc/passwd|/etc/shadow|/etc/sudoers' | head -5 || echo 'NO_RULES'`,
  ].join("\n");
}

function malwareSection(): string {
  return [
    NAMED_SEP("MALWARE"),
    `dpkg -l chkrootkit 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'`,
    `dpkg -l rkhunter 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'`,
    `find /tmp -perm -4000 -type f 2>/dev/null | head -10 || echo 'NONE'`,
    `find /dev -perm -4000 -type f 2>/dev/null | head -5 || echo 'NONE'`,
    `find /root -perm -o+w -type f -maxdepth 3 2>/dev/null | head -5 || echo 'NONE'`,
    `test -f /var/log/rkhunter.log && tail -30 /var/log/rkhunter.log 2>/dev/null | grep -i 'system checks summary' | tail -1 || echo 'NO_SCAN'`,
  ].join("\n");
}

function macSection(): string {
  return [
    NAMED_SEP("MAC"),
    `cat /sys/kernel/security/lsm 2>/dev/null || echo 'N/A'`,
    `aa-status 2>/dev/null | head -20 || apparmor_status 2>/dev/null | head -20 || echo 'N/A'`,
    `systemctl is-active apparmor 2>/dev/null || echo 'inactive'`,
    `command -v getenforce >/dev/null 2>&1 && getenforce 2>/dev/null || echo 'NOT_INSTALLED'`,
    `test -f /etc/selinux/config && grep '^SELINUX=' /etc/selinux/config 2>/dev/null || echo 'N/A'`,
    `cat /proc/self/status 2>/dev/null | grep Seccomp || echo 'N/A'`,
  ].join("\n");
}

function memorySection(): string {
  return [
    NAMED_SEP("MEMORY"),
    `sysctl vm.overcommit_memory vm.overcommit_ratio vm.oom_kill_allocating_task 2>/dev/null || echo 'N/A'`,
    `cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo 'N/A'`,
    `ps aux 2>/dev/null | grep -c ' Z ' || echo '0'`,
    `cat /proc/sys/kernel/pid_max 2>/dev/null || echo 'N/A'`,
    `ulimit -a 2>/dev/null | head -20 || echo 'N/A'`,
    `sysctl fs.suid_dumpable 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function cryptoSection(): string {
  return [
    NAMED_SEP("CRYPTO"),
    `openssl version 2>/dev/null || echo 'NOT_INSTALLED'`,
    `sshd -T 2>/dev/null | grep -iE '^ciphers|^macs|^kexalgorithms|^hostkeyalgorithms' || echo 'N/A'`,
    `ls /etc/ssh/ssh_host_*_key 2>/dev/null || echo 'N/A'`,
    `lsblk -f 2>/dev/null | grep -i 'crypto_luks' || echo 'NO_LUKS'`,
    `cat /etc/ssl/openssl.cnf 2>/dev/null | grep -iE 'MinProtocol|CipherString' || echo 'N/A'`,
    `ss -tlnp 2>/dev/null | grep -E ':443 |:8443 ' | head -5 || echo 'NO_TLS_PORTS'`,
    `ss -tlnp 2>/dev/null | grep -q ':443' && timeout 5 openssl s_client -connect localhost:443 -servername localhost 2>/dev/null < /dev/null | openssl x509 -noout -enddate 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function filesystemSection(): string {
  return [
    NAMED_SEP("FILESYSTEM"),
    `find /etc /usr -maxdepth 2 -perm -o+w -type f 2>/dev/null | head -20 || echo 'N/A'`,
    `find /usr/bin /usr/sbin -perm -4000 -type f 2>/dev/null | head -20 || echo 'N/A'`,
    `stat -c '%a %U %G' /tmp 2>/dev/null || echo 'N/A'`,
    `df -h / 2>/dev/null || echo 'N/A'`,
    // NEW: mount option checks
    `findmnt -o TARGET,OPTIONS --raw 2>/dev/null || cat /proc/mounts 2>/dev/null || echo 'N/A'`,
    // NEW: /dev/shm permissions
    `stat -c '%a %U %G' /dev/shm 2>/dev/null || echo 'N/A'`,
    // NEW: umask
    `umask 2>/dev/null || echo 'N/A'`,
    // NEW: home directory permissions
    `find /home -maxdepth 1 -mindepth 1 -type d -exec stat -c '%a %n' {} \\; 2>/dev/null | head -20 || echo 'N/A'`,
    // NEW: /var/tmp permissions
    `stat -c '%a %U %G' /var/tmp 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function secretsSection(): string {
  return [
    NAMED_SEP("SECRETS"),
    `find /root /home /etc -maxdepth 3 -name ".env" -perm -o+r 2>/dev/null | head -10 || echo 'NONE'`,
    `find /root /home /etc -maxdepth 3 -name "*.env" -perm -o+r 2>/dev/null | head -10 || echo 'NONE'`,
    `stat -c '%a %n' /root/.ssh/id_rsa /root/.ssh/id_ed25519 /root/.ssh/id_ecdsa 2>/dev/null || echo 'NO_KEYS'`,
    `git config --global --get-regexp 'url.*token' 2>/dev/null | head -5 || echo 'NO_GIT_TOKENS'`,
    `grep -rEl '(password|secret|token|api_key|apikey|passwd)\s*=' /etc 2>/dev/null | grep -v '\.bak' | head -10 || echo 'NONE'`,
  ].join("\n");
}

function cloudMetaSection(): string {
  return [
    NAMED_SEP("CLOUDMETA"),
    `VPS=$(systemd-detect-virt 2>/dev/null || dmidecode -s system-product-name 2>/dev/null | head -1 || echo 'none'); if [ "$VPS" = "none" ]; then echo 'BARE_METAL'; else echo "VPS_TYPE:$VPS"; curl -sf --connect-timeout 2 http://169.254.169.254/latest/meta-data/ 2>/dev/null && echo 'METADATA_ACCESSIBLE' || { curl -sf --connect-timeout 2 http://metadata.google.internal/computeMetadata/v1/ -H "Metadata-Flavor: Google" 2>/dev/null && echo 'METADATA_ACCESSIBLE' || echo 'METADATA_BLOCKED'; }; iptables -S OUTPUT 2>/dev/null | grep -q '169.254.169.254' && echo 'METADATA_FIREWALL_OK' || echo 'METADATA_FIREWALL_MISSING'; fi`,
    `grep -i 'password\|secret\|token\|key' /var/log/cloud-init.log 2>/dev/null | head -5 || echo 'CLOUDINIT_CLEAN'`,
    `grep -iE '(DB_PASSWORD|API_KEY|SECRET_KEY|AWS_SECRET|PRIVATE_KEY)' /var/lib/cloud/instances/*/user-data.txt 2>/dev/null && echo 'SENSITIVE_ENV_IN_CLOUDINIT' || echo 'CLOUDINIT_NO_SENSITIVE_ENV'`,
    `curl -sf --connect-timeout 2 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null && echo 'IMDSV2_AVAILABLE' || echo 'IMDSV2_UNAVAILABLE'`,
  ].join("\n");
}

function supplyChainSection(): string {
  return [
    NAMED_SEP("SUPPLYCHAIN"),
    `apt-cache policy 2>/dev/null | grep -E '^\s+[0-9]' | grep 'http://' | head -10 || echo 'NO_HTTP_REPOS'`,
    `ls /etc/apt/trusted.gpg.d/ 2>/dev/null || echo 'NONE'`,
    `dpkg --audit 2>/dev/null | head -10 || echo 'NONE'`,
    `apt-key list 2>&1 | head -20 || echo 'NONE'`,
  ].join("\n");
}

function backupSection(): string {
  return [
    NAMED_SEP("BACKUP"),
    `stat /root/.kastell/backups/ 2>/dev/null | head -5 || echo 'NO_BACKUP_DIR'`,
    `ls /var/backups/ 2>/dev/null | head -10 || echo 'NONE'`,
    `grep -rE '(rsync|borg|restic|tar.*backup)' /etc/cron.d /etc/cron.daily /etc/crontab /var/spool/cron/crontabs/ 2>/dev/null | head -10 || echo 'NO_BACKUP_CRON'`,
    `which rsync borg restic 2>/dev/null || echo 'NO_BACKUP_TOOLS'`,
    `find /var/backups /root/.kastell/backups -maxdepth 2 -type f -perm /o+r 2>/dev/null | head -10 || echo 'NONE'`,
  ].join("\n");
}

function resourceLimitsSection(): string {
  return [
    NAMED_SEP("RESOURCELIMITS"),
    `cat /sys/fs/cgroup/cgroup.controllers 2>/dev/null || echo 'N/A'`,
    `ulimit -u 2>/dev/null || echo 'N/A'`,
    `sysctl kernel.threads-max 2>/dev/null || echo 'N/A'`,
    `grep -E 'nproc|maxlogins' /etc/security/limits.conf /etc/security/limits.d/*.conf 2>/dev/null | head -10 || echo 'NONE'`,
  ].join("\n");
}

function incidentReadySection(): string {
  return [
    NAMED_SEP("INCIDENTREADY"),
    `dpkg -l auditd 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'`,
    `systemctl is-active auditd 2>/dev/null || echo 'inactive'`,
    `sudo auditctl -l 2>/dev/null || auditctl -l 2>/dev/null || echo 'AUDITCTL_UNAVAIL'`,
    `systemctl is-active rsyslog vector fluent-bit promtail 2>/dev/null | head -5 || echo 'N/A'`,
    `last 2>/dev/null | head -3 && lastb 2>/dev/null | head -3 || echo 'NO_LAST'`,
    `grep -E 'wtmp|lastb' /etc/logrotate.conf /etc/logrotate.d/* 2>/dev/null | head -5 || echo 'NO_LOGROTATE_WTMP'`,
  ].join("\n");
}

function dnsSection(): string {
  return [
    NAMED_SEP("DNS"),
    `resolvectl status 2>/dev/null | head -30 || echo 'N/A'`,
    `cat /etc/resolv.conf 2>/dev/null || echo 'N/A'`,
    `which stubby dnscrypt-proxy 2>/dev/null || echo 'NONE'`,
    `lsattr /etc/resolv.conf 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

/**
 * Build 3 tiered SSH batch commands for server auditing.
 *
 * Batch 1 (fast):   SSH, Firewall, Updates, Auth, Accounts, Boot, Scheduling, Banners — config reads (30s timeout)
 * Batch 2 (medium): Docker, Network, Logging, Kernel, Services, Time, MAC, Memory,
 *                   CloudMeta, Backup, ResourceLimits, IncidentReady, DNS — active probes (60s timeout)
 * Batch 3 (slow):   Filesystem, Crypto, FileIntegrity, Malware, Secrets, SupplyChain — find commands (120s timeout)
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
      macSection(),
      memorySection(),
      cloudMetaSection(),
      backupSection(),
      resourceLimitsSection(),
      incidentReadySection(),
      dnsSection(),
    ].join("\n"),
  };

  const slow: BatchDef = {
    tier: "slow",
    command: [
      filesystemSection(),
      cryptoSection(),
      fileIntegritySection(),
      malwareSection(),
      secretsSection(),
      supplyChainSection(),
    ].join("\n"),
  };

  return [fast, medium, slow];
}
