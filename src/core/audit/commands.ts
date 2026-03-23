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
    // NEW: maxstartups, strictmodes, allowagentforwarding, printmotd
    `sshd -T 2>/dev/null | grep -iE 'maxstartups|strictmodes|allowagentforwarding|printmotd' || echo 'N/A'`,
  ].join("\n");
}

function firewallSection(): string {
  return [
    NAMED_SEP("FIREWALL"),
    `command -v ufw >/dev/null 2>&1 && ufw status verbose 2>/dev/null || echo 'N/A'`,
    `echo '---IPTABLES_COUNT---'`,
    `command -v iptables >/dev/null 2>&1 && iptables -L -n 2>/dev/null | wc -l || echo 'N/A'`,
    `command -v fail2ban-client >/dev/null 2>&1 && fail2ban-client status 2>/dev/null || echo 'N/A'`,
    // nftables detection
    `command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | head -20 || echo 'N/A'`,
    // iptables INPUT chain details
    `iptables -L INPUT -n --line-numbers 2>/dev/null | head -20 || echo 'N/A'`,
    // iptables INPUT default policy
    `iptables -L INPUT -n 2>/dev/null | head -1 || echo 'N/A'`,
    // outbound rules
    `iptables -L OUTPUT -n 2>/dev/null | head -1 || echo 'N/A'`,
    // rate limiting presence
    `iptables -L -n 2>/dev/null | grep -i 'limit' | head -5 || echo 'NONE'`,
    // FORWARD chain policy
    `iptables -L FORWARD -n 2>/dev/null | head -1 || echo 'N/A'`,
    `echo '---IPV6_RULE_COUNT---'`,
    // IPv6 firewall rule count
    `ip6tables -L INPUT -n 2>/dev/null | wc -l || echo '0'`,
    `echo '---CONNTRACK_MAX---'`,
    // conntrack max
    `cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null || echo 'N/A'`,
    `echo '---LOG_RULE_COUNT---'`,
    // LOG rule count for dropped packets
    `iptables -L -n 2>/dev/null | grep -c 'LOG' || echo '0'`,
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
    // NEW: security repository presence
    `grep -rE 'security' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | head -5 || echo 'NONE'`,
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
    // NEW: su restricted to wheel group via pam_wheel
    `grep -E '^auth.*pam_wheel' /etc/pam.d/su 2>/dev/null || echo 'NONE'`,
    // NEW: gshadow permissions
    `stat -c '%a' /etc/gshadow 2>/dev/null || echo 'N/A'`,
    // NEW: password quality PAM modules
    `grep -rE 'pam_pwquality|pam_cracklib' /etc/pam.d/ 2>/dev/null | head -3 || echo 'NONE'`,
    // NEW: login UMASK
    `grep -E '^UMASK' /etc/login.defs 2>/dev/null || echo 'N/A'`,
    // NEW: password hash algorithm
    `grep -E '^ENCRYPT_METHOD' /etc/login.defs 2>/dev/null || echo 'N/A'`,
    // NEW: pwquality settings
    `cat /etc/security/pwquality.conf 2>/dev/null | grep -E 'minlen|dcredit|ucredit|lcredit|ocredit' | head -5 || echo 'NONE'`,
  ].join("\n");
}

function dockerSection(platform: string): string {
  const base = [
    NAMED_SEP("DOCKER"),
    `command -v docker >/dev/null 2>&1 && docker info --format '{{json .}}' 2>/dev/null || echo 'N/A'`,
    `echo '---DAEMON_JSON---'`,
    `cat /etc/docker/daemon.json 2>/dev/null || echo '{}'`,
    `echo '---END_DAEMON_JSON---'`,
    `command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null || echo 'N/A'`,
    `ls -la /var/run/docker.sock 2>/dev/null || echo 'N/A'`,
    // NEW: container security inspection (top 5 running containers)
    `command -v docker >/dev/null 2>&1 && docker ps -q 2>/dev/null | head -5 | xargs -r docker inspect --format '{{.Name}} SecurityOpt={{.HostConfig.SecurityOpt}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} User={{.Config.User}} Privileged={{.HostConfig.Privileged}}' 2>/dev/null || echo 'N/A'`,
    // NEW: Docker content trust env
    `echo "DOCKER_CONTENT_TRUST=\${DOCKER_CONTENT_TRUST:-unset}" 2>/dev/null`,
    // NEW: Docker socket permissions detail
    `stat -c '%a %U %G' /var/run/docker.sock 2>/dev/null || echo 'N/A'`,
    // NEW: Docker network listing
    `command -v docker >/dev/null 2>&1 && docker network ls --format '{{.Name}} {{.Driver}}' 2>/dev/null | head -10 || echo 'N/A'`,
    // NEW: Docker volume listing
    `command -v docker >/dev/null 2>&1 && docker volume ls --format '{{.Name}} {{.Driver}}' 2>/dev/null | head -10 || echo 'N/A'`,
    // NEW: docker info security options detail (seccomp/userns)
    `docker info --format '{{.SecurityOptions}}' 2>/dev/null || echo 'N/A'`,
    // NEW: bridge network nf-call settings
    `docker network inspect bridge --format '{{json .Options}}' 2>/dev/null || echo 'N/A'`,
    // NEW: authorization plugins
    `docker info --format '{{.Plugins.Authorization}}' 2>/dev/null || echo 'N/A'`,
    // NEW: registry TLS certs directory
    `ls -la /etc/docker/certs.d/ 2>/dev/null || echo 'NO_CERTS_DIR'`,
    // NEW: insecure registry CIDRs
    `docker info --format '{{.RegistryConfig.InsecureRegistryCIDRs}}' 2>/dev/null || echo 'N/A'`,
    // NEW: swarm state
    `docker system info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo 'N/A'`,
    // NEW: experimental build flag
    `docker info --format '{{.ExperimentalBuild}}' 2>/dev/null || echo 'N/A'`,
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
    // NEW: mail service ports
    `ss -tlnp 2>/dev/null | grep -E ':25 |:110 |:143 ' | head -5 || echo 'NONE'`,
    // NEW: promiscuous interfaces
    `ip link show 2>/dev/null | grep -i 'PROMISC' | head -5 || echo 'NONE'`,
    // NEW: ARP spoofing protection
    `sysctl net.ipv4.conf.all.arp_announce net.ipv4.conf.all.arp_ignore 2>/dev/null || echo 'N/A'`,
    // NEW: TCP wrappers allow rules content
    `cat /etc/hosts.allow 2>/dev/null | grep -v '^#' | grep -v '^\\s*$' | head -5 || echo 'EMPTY'`,
    // NEW: bogus ICMP error responses
    `sysctl net.ipv4.icmp_ignore_bogus_error_responses 2>/dev/null || echo 'N/A'`,
    // NEW: total listening port count
    `ss -tlnp 2>/dev/null | grep -c ':' || echo '0'`,
    // NEW: TCP SYN backlog
    `sysctl net.ipv4.tcp_max_syn_backlog 2>/dev/null || echo 'N/A'`,
  ].join("\n");
}

function loggingSection(): string {
  return [
    NAMED_SEP("LOGGING"),
    `systemctl is-active rsyslog 2>/dev/null || echo 'N/A'`,
    `systemctl is-active systemd-journald 2>/dev/null || echo 'N/A'`,
    `cat /etc/logrotate.conf 2>/dev/null | head -10 || echo 'N/A'`,
    `test -f /var/log/auth.log && echo 'EXISTS' || test -f /var/log/secure && echo 'EXISTS' || echo 'MISSING'`,
    // auditd rules — single fetch covers all categories (time/network/module/watch)
    `auditctl -l 2>/dev/null | head -50 || echo 'NO_RULES'`,
    // NEW: auditd active status
    `systemctl is-active auditd 2>/dev/null || echo 'inactive'`,
    // NEW: /var/log permissions
    `stat -c '%a' /var/log 2>/dev/null || echo 'N/A'`,
    // NEW: journald persistent storage
    `grep -E '^Storage' /etc/systemd/journald.conf 2>/dev/null || echo 'N/A'`,
    // NEW: centralized logging tools
    `which vector promtail fluent-bit 2>/dev/null || echo 'NONE'`,
    // NEW: world-readable log files count
    `find /var/log -maxdepth 1 -perm -o+r -type f 2>/dev/null | wc -l || echo '0'`,
    // NEW: remote syslog forwarding
    `grep -E '^\\s*@@?' /etc/rsyslog.conf /etc/rsyslog.d/*.conf 2>/dev/null | head -5 || echo 'NONE'`,
    // NEW: logrotate timer or cron
    `systemctl is-active logrotate.timer 2>/dev/null || ls /etc/cron.daily/logrotate 2>/dev/null || echo 'inactive'`,
    // NEW: file watch rule count
    `auditctl -l 2>/dev/null | grep -c 'watch' || echo '0'`,
    // NEW: auditd retention config
    `grep -rE '^max_log_file_action|^space_left_action' /etc/audit/auditd.conf 2>/dev/null | head -3 || echo 'N/A'`,
  ].join("\n");
}

function kernelSection(): string {
  return [
    NAMED_SEP("KERNEL"),
    `sysctl -a 2>/dev/null | grep -E 'randomize_va_space|accept_redirects|accept_source_route|log_martians|syncookies|core_uses_pid|dmesg_restrict|kptr_restrict|ptrace_scope|perf_event_paranoid|tcp_timestamps|icmp_echo_ignore_broadcasts|rp_filter|ip_forward|modules_disabled|unprivileged_bpf_disabled|send_redirects|secure_redirects|sysrq|exec_shield|core_pattern|unprivileged_userns_clone|panic_on_oops|nmi_watchdog|kernel\\.panic\\b|bpf_jit_harden|suid_dumpable' || echo 'N/A'`,
    `uname -r 2>/dev/null || echo 'N/A'`,
    `cat /sys/kernel/security/lsm 2>/dev/null || echo 'N/A'`,
    // NEW: blacklisted filesystem modules loaded
    `lsmod 2>/dev/null | grep -cE 'cramfs|freevxfs|jffs2|hfs|hfsplus|udf' || echo '0'`,
    // NEW: sysctl hardening config count in /etc/sysctl.d/
    `ls /etc/sysctl.d/*.conf 2>/dev/null | wc -l || echo '0'`,
    // NEW: systemd coredump config
    `cat /etc/systemd/coredump.conf 2>/dev/null | grep -E 'Storage|ProcessSizeMax' | head -3 || echo 'N/A'`,
    // NEW: kernel lockdown mode
    `cat /sys/kernel/security/lockdown 2>/dev/null || echo 'N/A'`,
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
    // NEW: inactive accounts (90+ days)
    `lastlog -b 90 2>/dev/null | tail +2 | head -20 || echo 'N/A'`,
    // NEW: total account count
    `grep -c '^' /etc/passwd 2>/dev/null || echo 'N/A'`,
    // NEW: UID/GID ranges from login.defs
    `grep -E 'UID_MAX|UID_MIN|GID_MAX|GID_MIN' /etc/login.defs 2>/dev/null | head -4 || echo 'N/A'`,
    // NEW: duplicate GIDs
    `awk -F: '{print $3}' /etc/group 2>/dev/null | sort | uniq -d | head -5 || echo 'NONE'`,
    // NEW: accounts with login shells count
    `awk -F: '($7 != "/usr/sbin/nologin" && $7 != "/bin/false" && $7 != "/sbin/nologin") {print $1}' /etc/passwd 2>/dev/null | wc -l || echo '0'`,
  ].join("\n");
}

function servicesSection(): string {
  return [
    NAMED_SEP("SERVICES"),
    `systemctl is-active telnet rsh rlogin vsftpd ftp tftpd-hpa 2>/dev/null | head -10 || echo 'N/A'`,
    `systemctl is-active nfs-server rpcbind smbd nmbd avahi-daemon cups isc-dhcp-server named snmpd squid xinetd ypserv 2>/dev/null | head -15 || echo 'N/A'`,
    `test -f /etc/inetd.conf && grep -v '^#' /etc/inetd.conf 2>/dev/null || echo 'NONE'`,
    `test -f /etc/xinetd.conf && cat /etc/xinetd.conf 2>/dev/null || echo 'NONE'`,
    // NEW: running service count
    `systemctl list-units --type=service --state=running --no-pager 2>/dev/null | wc -l || echo 'N/A'`,
    // NEW: wildcard listener count
    `ss -tlnp 2>/dev/null | grep -c '0.0.0.0:' || echo '0'`,
    // NEW: wildcard listener details
    `ss -tlnp 2>/dev/null | grep '0.0.0.0:' | head -10 || echo 'NONE'`,
    // NEW: xinetd service status
    `systemctl is-active xinetd 2>/dev/null || echo 'inactive'`,
    // NEW: world-readable service configs
    `find /etc -maxdepth 2 -name '*.conf' -perm -o+r -path '*/systemd/*' 2>/dev/null | head -5 || echo 'NONE'`,
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
    // NEW: UEFI vs BIOS detection
    `[ -d /sys/firmware/efi ] && echo 'UEFI' || echo 'BIOS'`,
    // NEW: GRUB superuser/password authentication
    `grep -rE 'set superusers|password_pbkdf2' /boot/grub/grub.cfg /etc/grub.d/ 2>/dev/null | head -3 || echo 'NONE'`,
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
    // NEW: cron.d file count
    `find /etc/cron.d/ -type f 2>/dev/null | wc -l || echo '0'`,
    // NEW: world-readable user crontabs
    `find /var/spool/cron/crontabs/ -type f -perm -o+r 2>/dev/null | head -5 || echo 'NONE'`,
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
    // NEW: NTP peer status
    `ntpq -p 2>/dev/null | head -5 || echo 'N/A'`,
    // NEW: timedatectl show for NTPSynchronized property
    `timedatectl show 2>/dev/null | grep -E 'NTPSynchronized|Timezone' | head -3 || echo 'N/A'`,
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
    `grep -r 'aide' /etc/cron.daily /etc/cron.weekly /etc/cron.d/ /var/spool/cron/crontabs/ 2>/dev/null | head -5 || echo 'NO_AIDE_CRON'`,
    `dpkg -l auditd 2>/dev/null | grep '^ii' || echo 'NOT_INSTALLED'`,
    `systemctl is-active auditd 2>/dev/null || echo 'inactive'`,
    `auditctl -l 2>/dev/null | grep -E '/etc/passwd|/etc/shadow|/etc/sudoers' | head -5 || echo 'NO_RULES'`,
    // NEW: AIDE database modification timestamp
    `stat -c '%Y' /var/lib/aide/aide.db 2>/dev/null || stat -c '%Y' /var/lib/aide/aide.db.gz 2>/dev/null || echo 'N/A'`,
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
    // NEW: hidden files in /tmp and /dev/shm
    `find /tmp /dev/shm -name ".*" -type f 2>/dev/null | head -10 || echo 'NONE'`,
    // NEW: high CPU processes
    `ps aux 2>/dev/null | awk '{if($3>50)print $0}' | head -5 || echo 'NONE'`,
    // NEW: hidden files in /tmp and /var/tmp
    `find /tmp /var/tmp -name '.*' -type f 2>/dev/null | wc -l || echo '0'`,
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
    // NEW: AppArmor enforce count
    `aa-status 2>/dev/null | grep -c 'enforce mode' || echo '0'`,
    // NEW: AppArmor base abstraction exists
    `cat /etc/apparmor.d/abstractions/base 2>/dev/null | wc -l || echo '0'`,
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
    // NEW: swappiness
    `cat /proc/sys/vm/swappiness 2>/dev/null || echo 'N/A'`,
    // NEW: swap info
    `swapon --show=NAME,TYPE 2>/dev/null | tail +2 | head -5 || echo 'NO_SWAP'`,
    // NEW: max_map_count
    `cat /proc/sys/vm/max_map_count 2>/dev/null || echo 'N/A'`,
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
    // NEW: host key permissions
    `stat -c '%a %n' /etc/ssh/ssh_host_*_key 2>/dev/null || echo 'N/A'`,
    // NEW: weak cipher count in OpenSSL
    `openssl ciphers -v 'ALL:eNULL' 2>/dev/null | grep -ci 'NULL\\|RC4\\|DES\\|MD5' || echo '0'`,
    // NEW: certificate count in /etc/ssl/certs/
    `find /etc/ssl/certs/ -name '*.pem' 2>/dev/null | wc -l || echo '0'`,
    // NEW: DH param validation
    `openssl dhparam -check -in /etc/ssl/dhparams.pem 2>/dev/null | head -3 || echo 'NO_DH_PARAMS'`,
    // NEW: world-readable private keys
    `find /etc/ssl/ /etc/pki/ -name '*.key' -perm -o+r 2>/dev/null | head -5 || echo 'NONE'`,
    // NEW: nginx TLS config
    `grep -rE 'ssl_protocols|ssl_ciphers' /etc/nginx/ 2>/dev/null | head -5 || echo 'NO_NGINX'`,
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
    // NEW: /var mount options
    `findmnt -o TARGET,OPTIONS /var 2>/dev/null || echo 'N/A'`,
    // NEW: system-wide SUID count
    `find / -xdev -type f -perm -4000 2>/dev/null | wc -l || echo '0'`,
  ].join("\n");
}

function secretsSection(): string {
  return [
    NAMED_SEP("SECRETS"),
    // World-readable .env files — sentinel-producing
    `ENVWR=$(find /root /home /etc -maxdepth 3 \\( -name ".env" -o -name "*.env" \\) -perm -o+r 2>/dev/null | head -10); if [ -n "$ENVWR" ]; then echo "$ENVWR"; echo 'WORLD_READABLE_ENV'; else echo 'NO_WORLD_READABLE_ENV'; fi`,
    // SSH private key permissions
    `stat -c '%a %n' /root/.ssh/id_rsa /root/.ssh/id_ed25519 /root/.ssh/id_ecdsa 2>/dev/null || echo 'NO_KEYS'`,
    // Git config tokens
    `git config --global --get-regexp 'url.*token' 2>/dev/null | head -5 || echo 'NO_GIT_TOKENS'`,
    // Plaintext credentials in /etc
    `grep -rEl '(password|secret|token|api_key|apikey|passwd)\\s*=' /etc 2>/dev/null | grep -v '\\.bak' | head -10 || echo 'NONE'`,
    // Home directory .env files — sentinel-producing
    `HOMEENV=$(find /home -maxdepth 3 -name '.env' -perm -o+r 2>/dev/null | head -5); if [ -n "$HOMEENV" ]; then echo "$HOMEENV"; echo 'ENV_IN_HOME'; else echo 'NO_ENV_IN_HOME'; fi`,
    // Docker compose .env files — sentinel-producing
    `DOCKENV=$(find /home /opt /srv /var/www -maxdepth 4 \\( -name 'docker.env' -o -name '.env' \\) -perm -o+r 2>/dev/null | head -5); if [ -n "$DOCKENV" ]; then echo 'DOCKER_ENV_FOUND'; else echo 'NO_DOCKER_ENV'; fi`,
    // npm auth tokens in .npmrc — sentinel-producing
    `NPMRC=$(find /home /root -maxdepth 3 -name '.npmrc' -exec grep -l '_authToken' {} \\; 2>/dev/null | head -3); if [ -n "$NPMRC" ]; then echo 'NPMRC_TOKEN_FOUND'; else echo 'NO_NPMRC_TOKEN'; fi`,
    // World-readable private key files — sentinel-producing
    `WRKEYS=$(find /home /root /etc /opt -maxdepth 4 \\( -name '*.pem' -o -name '*.key' -o -name 'id_rsa' -o -name 'id_ed25519' -o -name 'id_ecdsa' \\) -perm -o+r 2>/dev/null | head -5); if [ -n "$WRKEYS" ]; then echo "$WRKEYS"; echo 'WORLD_READABLE_KEY'; else echo 'NO_WORLD_READABLE_KEYS'; fi`,
    // AWS credential file permissions — sentinel-producing
    `AWSDIR=$(find /root /home -maxdepth 3 -name '.aws' -type d 2>/dev/null | head -3); if [ -n "$AWSDIR" ]; then BADPERM=$(find /root /home -maxdepth 4 -name 'credentials' -path '*/.aws/*' -exec stat -c '%a' {} \\; 2>/dev/null | grep -vE '^(600|400)$' | head -1); if [ -n "$BADPERM" ]; then echo 'AWS_CREDS_FOUND'; else echo 'NO_AWS_CREDS'; fi; else echo 'NO_AWS_CREDS'; fi`,
    // Kubeconfig directories + permission check (M1 fix)
    `KUBEDIR=$(find /root /home -maxdepth 3 -name '.kube' -type d 2>/dev/null | head -1); if [ -n "$KUBEDIR" ]; then echo "$KUBEDIR"; KUBEPERM=$(stat -c '%a' "$KUBEDIR/config" 2>/dev/null); if [ -n "$KUBEPERM" ]; then echo "KUBECONFIG_PERM:$KUBEPERM"; else echo 'NO_KUBECONFIG'; fi; else echo 'NO_KUBE_DIR'; fi`,
    // World-readable bash history
    `find /home -maxdepth 3 -name ".bash_history" -perm -o+r 2>/dev/null | head -5 || echo 'NONE'`,
    // SSH agent forwarding
    `sshd -T 2>/dev/null | grep -i 'allowagentforwarding' || echo 'N/A'`,
    // Shell RC secrets
    `grep -rE 'export\\s+(API_KEY|SECRET_KEY|TOKEN|PASSWORD|AWS_ACCESS_KEY)=' /root/.bashrc /root/.profile /home/*/.bashrc /home/*/.profile 2>/dev/null | head -5 || echo 'NONE'`,
  ].join("\n");
}

function cloudMetaSection(): string {
  return [
    NAMED_SEP("CLOUDMETA"),
    `VPS=$(systemd-detect-virt 2>/dev/null || dmidecode -s system-product-name 2>/dev/null | head -1 || echo 'none'); if [ "$VPS" = "none" ]; then echo 'BARE_METAL'; else echo "VPS_TYPE:$VPS"; curl -sf --connect-timeout 2 http://169.254.169.254/latest/meta-data/ 2>/dev/null && echo 'METADATA_ACCESSIBLE' || { curl -sf --connect-timeout 2 http://metadata.google.internal/computeMetadata/v1/ -H "Metadata-Flavor: Google" 2>/dev/null && echo 'METADATA_ACCESSIBLE' || echo 'METADATA_BLOCKED'; }; iptables -S OUTPUT 2>/dev/null | grep -q '169.254.169.254' && echo 'METADATA_FIREWALL_OK' || echo 'METADATA_FIREWALL_MISSING'; fi`,
    `grep -iE 'password|secret|token|key' /var/log/cloud-init.log 2>/dev/null | head -5 || echo 'CLOUDINIT_CLEAN'`,
    `grep -iE '(DB_PASSWORD|API_KEY|SECRET_KEY|AWS_SECRET|PRIVATE_KEY)' /var/lib/cloud/instances/*/user-data.txt 2>/dev/null && echo 'SENSITIVE_ENV_IN_CLOUDINIT' || echo 'CLOUDINIT_NO_SENSITIVE_ENV'`,
    `curl -sf --connect-timeout 2 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null && echo 'IMDSV2_AVAILABLE' || echo 'IMDSV2_UNAVAILABLE'`,
  ].join("\n");
}

function supplyChainSection(): string {
  return [
    NAMED_SEP("SUPPLYCHAIN"),
    `apt-cache policy 2>/dev/null | grep -E '^\\s+[0-9]' | grep 'http://' | head -10 || echo 'NO_HTTP_REPOS'`,
    `ls /etc/apt/trusted.gpg.d/ 2>/dev/null || echo 'NONE'`,
    `dpkg --audit 2>/dev/null | head -10 || echo 'NONE'`,
    `apt-key list 2>&1 | head -20 || echo 'NONE'`,
    // NEW: insecure apt config
    `apt-config dump 2>/dev/null | grep -i 'AllowUnauthenticated\\|AllowInsecureRepositories' | head -5 || echo 'NONE'`,
    // NEW: modified package file count
    `dpkg --verify 2>/dev/null | wc -l || echo '0'`,
    // NEW: debsums presence
    `which debsums 2>/dev/null || echo 'NOT_INSTALLED'`,
  ].join("\n");
}

function backupSection(): string {
  return [
    NAMED_SEP("BACKUP"),
    // BACKUP-RECENT-BACKUP: sentinel KASTELL_BACKUP_FOUND / KASTELL_BACKUP_MISSING
    `find /root/.kastell/backups/ -maxdepth 1 -type f -mtime -30 2>/dev/null | grep -q . && echo 'KASTELL_BACKUP_FOUND' || echo 'KASTELL_BACKUP_MISSING'`,
    // BACKUP-ENCRYPTION-PRESENT: sentinel BACKUP_FILE_PERMS:<mode>:<owner>:<group>
    `BFILE=$(find /root/.kastell/backups /var/backups -maxdepth 2 -type f 2>/dev/null | head -1); [ -n "$BFILE" ] && stat -c 'BACKUP_FILE_PERMS:%a:%U:%G' "$BFILE" 2>/dev/null || echo 'BACKUP_FILE_PERMS:000:unknown:unknown'`,
    // BACKUP-SCRIPT-PERMS: sentinel BACKUP_SCRIPT_PERMS_OK / BACKUP_SCRIPT_PERMS_WRITABLE
    `find /etc/cron.daily /etc/cron.d /usr/local/bin -maxdepth 1 -name '*backup*' -perm /o+w 2>/dev/null | grep -q . && echo 'BACKUP_SCRIPT_PERMS_WRITABLE' || echo 'BACKUP_SCRIPT_PERMS_OK'`,
    // BACKUP-TOOL-INSTALLED: sentinel BACKUP_TOOL_INSTALLED:<tool> / BACKUP_TOOL_NOT_INSTALLED
    `BTOOL=""; for t in rsync borg restic; do which $t >/dev/null 2>&1 && { BTOOL=$t; break; }; done; [ -n "$BTOOL" ] && echo "BACKUP_TOOL_INSTALLED:$BTOOL" || echo 'BACKUP_TOOL_NOT_INSTALLED'`,
    // BACKUP-CRON-JOB: sentinel BACKUP_CRON_JOB_FOUND / BACKUP_CRON_JOB_NOT_FOUND
    `grep -rEq '(rsync|borg|restic|tar.*backup)' /etc/cron.d /etc/cron.daily /etc/crontab /var/spool/cron/crontabs/ 2>/dev/null && echo 'BACKUP_CRON_JOB_FOUND' || echo 'BACKUP_CRON_JOB_NOT_FOUND'`,
    // BACKUP-VAR-BACKUPS: sentinel VAR_BACKUPS_EXISTS / VAR_BACKUPS_MISSING
    `[ -d /var/backups ] && ls /var/backups/ 2>/dev/null | grep -q . && echo 'VAR_BACKUPS_EXISTS' || echo 'VAR_BACKUPS_MISSING'`,
    // BKUP-ENCRYPTED-BACKUPS: parser checks .enc/.gpg in output (works as-is)
    `find /var/backups /root/.kastell/backups -maxdepth 2 \\( -name "*.enc" -o -name "*.gpg" \\) 2>/dev/null | head -5 || echo 'NONE'`,
    // BKUP-BACKUP-TOOL-INSTALLED: parser checks NO_BACKUP_TOOLS / tool name regex (works as-is)
    `which rsync borg restic 2>/dev/null || echo 'NO_BACKUP_TOOLS'`,
  ].join("\n");
}

function resourceLimitsSection(): string {
  return [
    NAMED_SEP("RESOURCELIMITS"),
    // RLIMIT-CGROUPS-V2: sentinel CGROUPS_V2_ACTIVE / CGROUPS_V2_ABSENT
    `[ -f /sys/fs/cgroup/cgroup.controllers ] && echo 'CGROUPS_V2_ACTIVE' || echo 'CGROUPS_V2_ABSENT'`,
    // RLIMIT-NPROC-SOFT: sentinel NPROC_SOFT:<value>
    `NSOFT=$(ulimit -Su 2>/dev/null || echo 'unlimited'); echo "NPROC_SOFT:$NSOFT"`,
    // RLIMIT-NPROC-HARD: sentinel NPROC_HARD:<value>
    `NHARD=$(ulimit -Hu 2>/dev/null || echo 'NOT_SET'); echo "NPROC_HARD:$NHARD"`,
    // RLIMIT-THREADS-MAX: sentinel THREADS_MAX:kernel.threads-max = <value>
    `TMAX=$(sysctl -n kernel.threads-max 2>/dev/null); [ -n "$TMAX" ] && echo "THREADS_MAX:kernel.threads-max = $TMAX" || echo 'THREADS_MAX_NOT_FOUND'`,
    // RLIMIT-LIMITS-CONF-NPROC: sentinel LIMITS_CONF_NPROC_SET / LIMITS_CONF_NPROC_NOT_SET
    `grep -qE '\\bnproc\\b' /etc/security/limits.conf /etc/security/limits.d/*.conf 2>/dev/null && echo 'LIMITS_CONF_NPROC_SET' || echo 'LIMITS_CONF_NPROC_NOT_SET'`,
    // RLIMIT-MAXLOGINS: sentinel LIMITS_CONF_MAXLOGINS_SET / LIMITS_CONF_MAXLOGINS_NOT_SET
    `grep -qE '\\bmaxlogins\\b' /etc/security/limits.conf /etc/security/limits.d/*.conf 2>/dev/null && echo 'LIMITS_CONF_MAXLOGINS_SET' || echo 'LIMITS_CONF_MAXLOGINS_NOT_SET'`,
    // RLIMIT-LIMITS-CONF-CONFIGURED: parser counts non-comment lines (works as-is)
    `cat /etc/security/limits.conf 2>/dev/null | grep -vE '^#|^$' | head -20 || echo 'NONE'`,
    // RLIMIT-NPROC-LIMITED: parser regex matches nproc + number
    `grep -E 'nproc' /etc/security/limits.conf /etc/security/limits.d/*.conf 2>/dev/null | head -10 || echo 'NONE'`,
  ].join("\n");
}

function incidentReadySection(): string {
  return [
    NAMED_SEP("INCIDENTREADY"),
    // INCIDENT-AUDITD-INSTALLED: sentinel AUDITD_INSTALLED / AUDITD_NOT_INSTALLED
    `dpkg -l auditd 2>/dev/null | grep -q '^ii' && echo 'AUDITD_INSTALLED' || echo 'AUDITD_NOT_INSTALLED'`,
    // INCIDENT-AUDITD-RUNNING: sentinel AUDITD_RUNNING / AUDITD_NOT_RUNNING
    `systemctl is-active auditd 2>/dev/null | grep -q '^active$' && echo 'AUDITD_RUNNING' || echo 'AUDITD_NOT_RUNNING'`,
    // INCIDENT-AUDITD-PASSWD-RULE + SUDO-RULE: sentinel AUDITCTL_RULES:<rule> or AUDITCTL_UNAVAIL
    `if RULES=$(auditctl -l 2>/dev/null) && [ -n "$RULES" ]; then echo "$RULES" | while IFS= read -r line; do echo "AUDITCTL_RULES:$line"; done; else echo 'AUDITCTL_UNAVAIL'; fi`,
    // INCIDENT-LOG-FORWARDING: sentinel LOG_FORWARDING_ACTIVE:<service> / LOG_FORWARDING_INACTIVE
    `LFWD=""; for s in rsyslog vector fluent-bit promtail; do systemctl is-active "$s" 2>/dev/null | grep -q '^active$' && { LFWD=$s; break; }; done; [ -n "$LFWD" ] && echo "LOG_FORWARDING_ACTIVE:$LFWD" || echo 'LOG_FORWARDING_INACTIVE'`,
    // INCIDENT-LAST-ACCESSIBLE: sentinel LAST_AVAILABLE / LAST_NOT_AVAILABLE
    `last -1 2>/dev/null | grep -q . && echo 'LAST_AVAILABLE' || echo 'LAST_NOT_AVAILABLE'`,
    // INCIDENT-LASTB-ACCESSIBLE: sentinel LASTB_AVAILABLE / LASTB_NOT_AVAILABLE
    `lastb -1 2>/dev/null | grep -q . && echo 'LASTB_AVAILABLE' || echo 'LASTB_NOT_AVAILABLE'`,
    // INCIDENT-WTMP-ROTATION: sentinel WTMP_ROTATION_CONFIGURED / WTMP_ROTATION_NOT_CONFIGURED
    `grep -rqE 'wtmp' /etc/logrotate.conf /etc/logrotate.d/ 2>/dev/null && echo 'WTMP_ROTATION_CONFIGURED' || echo 'WTMP_ROTATION_NOT_CONFIGURED'`,
    // INCID-WTMP-EXISTS + INCID-BTMP-EXISTS: parser regex matches /var/log/wtmp and /var/log/btmp
    `ls -la /var/log/wtmp /var/log/btmp 2>/dev/null || echo 'N/A'`,
    // INCID-FORENSIC-TOOLS: parser regex matches volatility/dc3dd (works as-is)
    `which volatility3 volatility dc3dd 2>/dev/null | head -3 || echo 'NONE'`,
    // INCID-LOG-ARCHIVE-EXISTS: parser matches standalone number from wc -l (works as-is)
    `find /var/log -name '*.gz' -mtime -30 2>/dev/null | wc -l || echo '0'`,
  ].join("\n");
}

function dnsSection(): string {
  return [
    NAMED_SEP("DNS"),
    // DNS-DNSSEC-ENABLED: sentinel DNSSEC_ENABLED / DNSSEC_DISABLED
    `resolvectl status 2>/dev/null | grep -qiE 'DNSSEC.*(yes|allow-downgrade|supported)' && echo 'DNSSEC_ENABLED' || echo 'DNSSEC_DISABLED'`,
    // DNS-DOH-DOT-AVAILABLE: sentinel DOH_DOT_TOOL_INSTALLED:<tool> / DOH_DOT_TOOL_NOT_INSTALLED
    `DTOOL=""; for t in stubby dnscrypt-proxy; do which $t >/dev/null 2>&1 && { DTOOL=$t; break; }; done; [ -n "$DTOOL" ] && echo "DOH_DOT_TOOL_INSTALLED:$DTOOL" || echo 'DOH_DOT_TOOL_NOT_INSTALLED'`,
    // DNS-RESOLV-IMMUTABLE: sentinel RESOLV_CONF_IMMUTABLE / RESOLV_CONF_MUTABLE
    `RATTR=$(lsattr /etc/resolv.conf 2>/dev/null); RLINK=$(readlink /etc/resolv.conf 2>/dev/null); if echo "$RATTR" | grep -qP '^\\S*i' 2>/dev/null; then echo 'RESOLV_CONF_IMMUTABLE'; elif echo "$RLINK" | grep -q 'systemd' 2>/dev/null; then echo 'RESOLV_CONF_IMMUTABLE'; else echo 'RESOLV_CONF_MUTABLE'; fi`,
    // DNS-NAMESERVER-CONFIGURED: sentinel NAMESERVER_CONFIGURED:<ip> / NAMESERVER_NOT_CONFIGURED
    `NS=$(grep -m1 '^nameserver' /etc/resolv.conf 2>/dev/null | awk '{print $2}'); [ -n "$NS" ] && echo "NAMESERVER_CONFIGURED:$NS" || echo 'NAMESERVER_NOT_CONFIGURED'`,
    // DNS-MULTIPLE-NAMESERVERS: parser extracts standalone number
    `grep -c 'nameserver' /etc/resolv.conf 2>/dev/null || echo '0'`,
    // DNS-RESOLV-NOT-LOCALHOST-ONLY: parser parses nameserver lines from resolv.conf
    `cat /etc/resolv.conf 2>/dev/null || echo 'N/A'`,
    // DNS-LOCAL-RESOLVER-ACTIVE: parser regex matches ^active$
    `systemctl is-active systemd-resolved 2>/dev/null || echo 'inactive'`,
    // DNS-SEARCH-DOMAIN-SET: parser regex matches search + domain
    `grep -E 'search\\s+' /etc/resolv.conf 2>/dev/null || echo 'NONE'`,
  ].join("\n");
}

function tlsSection(): string {
  // Cache nginx -T output once, then grep from the cached variable
  return [
    NAMED_SEP("TLSHARDENING"),
    `command -v nginx >/dev/null 2>&1 || echo 'NGINX_NOT_INSTALLED'`,
    `_NGX=$(nginx -T 2>/dev/null || true)`,
    `echo "$_NGX" | grep -iE 'ssl_protocols' | head -5 || echo 'N/A'`,
    `echo "$_NGX" | grep -iE 'ssl_ciphers' | head -5 || echo 'N/A'`,
    `echo "$_NGX" | grep -iE 'Strict-Transport-Security' | head -5 || echo 'N/A'`,
    `echo "$_NGX" | grep -iE 'ssl_stapling[^_]' | head -5 || echo 'N/A'`,
    `CERT=$(echo "$_NGX" | grep -iE '^\\s*ssl_certificate\\s' | head -1 | awk '{print $2}' | tr -d ';'); if [ -z "$CERT" ] || [ ! -f "$CERT" ]; then echo 'CERT_NOT_FOUND'; elif openssl x509 -checkend 2592000 -noout -in "$CERT" 2>/dev/null; then echo 'CERT_VALID_30DAYS'; else echo 'CERT_EXPIRING_SOON'; fi`,
    `DHPEM=$(echo "$_NGX" | grep -iE 'ssl_dhparam' | head -1 | awk '{print $2}' | tr -d ';'); [ -n "$DHPEM" ] && [ -f "$DHPEM" ] && openssl dhparam -check -text -in "$DHPEM" 2>/dev/null | grep -E 'DH Parameters|bits' | head -3 || echo 'NO_DH_PARAM'`,
    `echo "$_NGX" | grep -iE 'ssl_compression' | head -3 || echo 'SSL_COMPRESSION_NOT_SET'`,
    `CERT=$(echo "$_NGX" | grep -iE '^\\s*ssl_certificate\\s' | head -1 | awk '{print $2}' | tr -d ';'); [ -n "$CERT" ] && [ -f "$CERT" ] && openssl verify -CApath /etc/ssl/certs "$CERT" 2>/dev/null || echo 'CERT_VERIFY_NOT_POSSIBLE'`,
  ].join("\n");
}

function httpHeadersSection(): string {
  return [
    NAMED_SEP("HTTPHEADERS"),
    `command -v nginx >/dev/null 2>&1 || echo 'NGINX_NOT_INSTALLED'`,
    `curl -skI --max-time 5 https://localhost 2>/dev/null || curl -sI --max-time 5 http://localhost 2>/dev/null || echo 'HTTP_NOT_RESPONDING'`,
  ].join("\n");
}

/**
 * Build 3 tiered SSH batch commands for server auditing.
 *
 * Batch 1 (fast):   SSH, Firewall, Updates, Auth, Accounts, Boot, Scheduling, Banners, TLS Hardening, HTTP Security Headers — config reads (30s timeout)
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
      tlsSection(),
      httpHeadersSection(),
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
