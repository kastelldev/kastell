import type { ComplianceRef } from "../../types.js";
import { cis, pci, hipaa } from "../helpers.js";
import { CHECK_IDS } from "../../checkIds.js";

export const COMPLIANCE_MAP: Record<string, ComplianceRef[]> = {
  // ─── SSH (CIS 5.2.x) ────────────────────────────────────────────────────
  [CHECK_IDS.SSH.SSH_PASSWORD_AUTH]: [
    cis("5.2.8", "Ensure SSH PasswordAuthentication is disabled", "full"),
    pci("2.2.7", "All non-console administrative access is encrypted", "partial"),
    hipaa("§164.312(d)", "Person or entity authentication", "partial"),
  ],
  [CHECK_IDS.SSH.SSH_ROOT_LOGIN]: [
    cis("5.2.10", "Ensure SSH root login is disabled", "full"),
    pci("2.2.7", "Restrict administrative access", "partial"),
  ],
  [CHECK_IDS.SSH.SSH_EMPTY_PASSWORDS]: [cis("5.2.11", "Ensure SSH PermitEmptyPasswords is disabled", "full")],
  [CHECK_IDS.SSH.SSH_PUBKEY_AUTH]: [
    cis("5.2.6", "Ensure SSH public key authentication is in use", "full"),
    hipaa("§164.312(d)", "Person or entity authentication", "partial"),
  ],
  [CHECK_IDS.SSH.SSH_MAX_AUTH_TRIES]: [cis("5.2.7", "Ensure SSH MaxAuthTries is set to 4 or less", "full")],
  [CHECK_IDS.SSH.SSH_X11_FORWARDING]: [cis("5.2.5", "Ensure SSH X11 forwarding is disabled", "full")],
  [CHECK_IDS.SSH.SSH_CLIENT_ALIVE_INTERVAL]: [
    cis("5.2.16", "Ensure SSH Idle Timeout Interval is configured", "full"),
    hipaa("§164.312(a)(2)(iii)", "Automatic logoff", "partial"),
  ],
  [CHECK_IDS.SSH.SSH_CLIENT_ALIVE_COUNT]: [
    cis("5.2.16", "Ensure SSH ClientAliveCountMax is configured", "full"),
    hipaa("§164.312(a)(2)(iii)", "Automatic logoff", "partial"),
  ],
  [CHECK_IDS.SSH.SSH_LOGIN_GRACE_TIME]: [cis("5.2.17", "Ensure SSH LoginGraceTime is set to one minute or less", "full")],
  [CHECK_IDS.SSH.SSH_IGNORE_RHOSTS]: [cis("5.2.9", "Ensure SSH IgnoreRhosts is enabled", "full")],
  [CHECK_IDS.SSH.SSH_HOSTBASED_AUTH]: [cis("5.2.12", "Ensure SSH HostbasedAuthentication is disabled", "full")],
  [CHECK_IDS.SSH.SSH_MAX_SESSIONS]: [cis("5.2.19", "Ensure SSH MaxSessions is limited", "full")],
  [CHECK_IDS.SSH.SSH_USE_DNS]: [cis("5.2.20", "Ensure SSH AllowTcpForwarding is disabled", "partial")],
  [CHECK_IDS.SSH.SSH_PERMIT_USER_ENV]: [cis("5.2.13", "Ensure SSH PermitUserEnvironment is disabled", "full")],
  [CHECK_IDS.SSH.SSH_LOG_LEVEL]: [cis("5.2.4", "Ensure SSH LogLevel is appropriate", "full")],
  [CHECK_IDS.SSH.SSH_STRONG_CIPHERS]: [
    cis("5.2.15", "Ensure only strong ciphers are used", "full"),
    pci("4.2.1", "Strong cryptography for data in transit", "full"),
    hipaa("§164.312(e)(2)(ii)", "Encryption in transmission", "partial"),
  ],
  [CHECK_IDS.SSH.SSH_STRONG_MACS]: [
    cis("5.2.15", "Ensure only approved MAC algorithms are used", "full"),
    pci("4.2.1", "Strong cryptography for data in transit", "full"),
    hipaa("§164.312(e)(2)(ii)", "Encryption in transmission", "partial"),
  ],
  [CHECK_IDS.SSH.SSH_STRONG_KEX]: [
    cis("5.2.15", "Ensure only strong Key Exchange algorithms are used", "full"),
    pci("4.2.1", "Strong cryptography for data in transit", "full"),
  ],
  [CHECK_IDS.SSH.SSH_MAX_STARTUPS]: [cis("5.2.18", "Ensure SSH MaxStartups is configured", "full")],
  [CHECK_IDS.SSH.SSH_STRICT_MODES]: [cis("5.2.3", "Ensure SSH StrictModes is enabled", "full")],
  [CHECK_IDS.SSH.SSH_NO_AGENT_FORWARDING]: [cis("5.2.14", "Ensure SSH AllowAgentForwarding is disabled", "full")],
  [CHECK_IDS.SSH.SSH_PRINT_MOTD]: [cis("5.2.21", "Ensure SSH warning banner is configured", "partial")],

  // ─── Auth (CIS 5.3-5.5, 6.1-6.2) ────────────────────────────────────────
  [CHECK_IDS.AUTH.AUTH_NO_NOPASSWD_ALL]: [
    cis("5.3.7", "Ensure sudo commands use pty and require authentication", "full"),
    pci("7.2.1", "Least privilege access", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_PASSWORD_AGING]: [
    cis("5.5.1.1", "Ensure password expiration is 365 days or less", "full"),
    pci("8.3.9", "Password change interval", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS]: [
    cis("6.2.1", "Ensure accounts in /etc/passwd use shadowed passwords", "partial"),
    pci("8.3.1", "All user passwords set", "full"),
  ],
  [CHECK_IDS.AUTH.AUTH_ROOT_LOGIN_RESTRICTED]: [cis("5.4.3", "Ensure default group for the root account is GID 0", "partial")],
  [CHECK_IDS.AUTH.AUTH_PWD_QUALITY]: [cis("5.3.2", "Ensure password creation requirements are configured", "full")],
  [CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED]: [
    cis("5.3.1", "Ensure lockout for failed password attempts is configured", "full"),
    pci("8.3.4", "Account lockout after failures", "partial"),
    hipaa("§164.312(a)(2)(i)", "Access control protection", "partial"),
    hipaa("§164.312(a)(1)", "Access control", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS]: [
    cis("6.1.3", "Ensure permissions on /etc/shadow are configured", "full"),
    pci("8.3.7", "Render passwords unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_SUDO_LOG]: [cis("5.3.5", "Ensure sudo logging is enabled", "full")],
  [CHECK_IDS.AUTH.AUTH_SUDO_REQUIRETTY]: [cis("5.3.6", "Ensure sudo authentication timeout is configured correctly", "partial")],
  [CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS]: [
    cis("6.2.4", "Ensure no duplicate UIDs exist", "full"),
    hipaa("§164.312(a)(2)(i)", "Unique user identification", "partial"),
    hipaa("§164.312(a)(2)(ii)", "Emergency access procedure", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_PASS_MIN_DAYS]: [cis("5.5.1.2", "Ensure minimum days between password changes is 1 or more", "full")],
  [CHECK_IDS.AUTH.AUTH_PASS_WARN_AGE]: [cis("5.5.1.3", "Ensure password expiration warning days is 7 or more", "full")],
  [CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK]: [cis("5.5.1.4", "Ensure inactive password lock is 30 days or less", "full")],
  [CHECK_IDS.AUTH.AUTH_SUDO_WHEEL_ONLY]: [
    cis("5.3.8", "Ensure access to the su command is restricted", "partial"),
    pci("7.2.1", "Restrict access by need-to-know", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_MFA_PRESENT]: [
    cis("5.3.4", "Ensure multi-factor authentication is enabled for all administrative access", "partial"),
    pci("8.4.2", "MFA for all access into CDE", "partial"),
    hipaa("§164.312(d)", "Person or entity authentication", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_SU_RESTRICTED]: [
    cis("5.3.8", "Ensure access to the su command is restricted", "full"),
    pci("7.2.1", "Restrict su access", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_PASS_MAX_DAYS_SET]: [cis("5.5.1.1", "Ensure password expiration is 365 days or less", "full")],
  [CHECK_IDS.AUTH.AUTH_GSHADOW_PERMISSIONS]: [cis("6.1.5", "Ensure permissions on /etc/gshadow are configured", "full")],
  [CHECK_IDS.AUTH.AUTH_PWQUALITY_CONFIGURED]: [
    cis("5.3.2", "Ensure password creation requirements are configured", "full"),
    pci("8.3.6", "Minimum password complexity", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_UMASK_LOGIN_DEFS]: [cis("5.5.5", "Ensure default user shell timeout is 900 seconds or less", "partial")],
  [CHECK_IDS.AUTH.AUTH_SHA512_HASH]: [
    cis("5.3.3", "Ensure password hashing algorithm is SHA-512 or yescrypt", "full"),
    pci("8.3.7", "Passwords stored with strong cryptography", "partial"),
    hipaa("§164.312(d)", "Authentication with strong cryptography", "partial"),
  ],
  [CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN]: [cis("5.3.2", "Ensure password creation requirements are configured", "full")],

  // ─── Kernel (CIS 1.5.x, 3.3.x) ──────────────────────────────────────────
  [CHECK_IDS.KERNEL.KRN_ASLR_ENABLED]: [cis("1.5.1", "Ensure address space layout randomization is enabled", "full")],
  [CHECK_IDS.KERNEL.KRN_CORE_DUMPS_RESTRICTED]: [cis("1.5.2", "Ensure core dumps are restricted", "full")],
  [CHECK_IDS.KERNEL.KRN_NETWORK_HARDENING]: [cis("3.3.1", "Ensure source routed packets are not accepted", "partial")],
  [CHECK_IDS.KERNEL.KRN_KERNEL_VERSION]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  [CHECK_IDS.KERNEL.KRN_DMESG_RESTRICTED]: [cis("1.5.3", "Ensure unprivileged access to the kernel syslog is disabled", "full")],
  [CHECK_IDS.KERNEL.KRN_PTRACE_SCOPE]: [cis("1.5.4", "Ensure ptrace_scope is restricted", "full")],
  [CHECK_IDS.KERNEL.KRN_KPTR_RESTRICT]: [cis("1.5.3", "Ensure kernel pointer access is restricted", "partial")],
  [CHECK_IDS.KERNEL.KRN_PERF_PARANOID]: [cis("1.5.4", "Ensure kernel performance events access is restricted", "partial")],
  [CHECK_IDS.KERNEL.KRN_SYN_COOKIES]: [cis("3.3.8", "Ensure TCP SYN Cookies is enabled", "full")],
  [CHECK_IDS.KERNEL.KRN_IP_FORWARD_DISABLED]: [cis("3.3.1", "Ensure IP forwarding is disabled", "full")],
  [CHECK_IDS.KERNEL.KRN_RP_FILTER]: [cis("3.3.2", "Ensure packet redirect sending is disabled", "partial")],
  [CHECK_IDS.KERNEL.KRN_TCP_TIMESTAMPS]: [cis("3.3.7", "Ensure Reverse Path Filtering is enabled", "partial")],
  [CHECK_IDS.KERNEL.KRN_ICMP_BROADCAST]: [cis("3.3.5", "Ensure broadcast ICMP requests are ignored", "full")],
  [CHECK_IDS.KERNEL.KRN_ACCEPT_REDIRECTS_V6]: [cis("3.3.3", "Ensure secure ICMP redirects are not accepted", "full")],
  [CHECK_IDS.KERNEL.KRN_BPF_UNPRIVILEGED]: [cis("1.5.4", "Ensure unprivileged BPF is disabled", "full")],
  [CHECK_IDS.KERNEL.KRN_MODULES_DISABLED]: [cis("1.5.1", "Ensure module loading is disabled after boot", "partial")],
  [CHECK_IDS.KERNEL.KRN_IP_FORWARD_V6]: [cis("3.3.1", "Ensure IPv6 forwarding is disabled", "full")],
  [CHECK_IDS.KERNEL.KRN_SEND_REDIRECTS]: [cis("3.3.2", "Ensure packet redirect sending is disabled", "full")],
  [CHECK_IDS.KERNEL.KRN_SECURE_REDIRECTS]: [cis("3.3.3", "Ensure secure ICMP redirects are not accepted", "full")],
  [CHECK_IDS.KERNEL.KRN_SYSRQ_DISABLED]: [cis("1.5.4", "Ensure SysRq key is disabled", "full")],
  [CHECK_IDS.KERNEL.KRN_CORE_PATTERN_SAFE]: [cis("1.5.2", "Ensure core dump storage is configured", "partial")],
  [CHECK_IDS.KERNEL.KRN_PANIC_ON_OOPS]: [cis("1.5.4", "Ensure kernel panic on oops is enabled", "partial")],
  [CHECK_IDS.KERNEL.KRN_NMI_WATCHDOG_DISABLED]: [cis("1.5.4", "Ensure NMI watchdog is configured", "partial")],
  [CHECK_IDS.KERNEL.KRN_UNPRIVILEGED_USERNS]: [cis("1.5.4", "Ensure unprivileged user namespaces are disabled", "full")],
  [CHECK_IDS.KERNEL.KRN_EXEC_SHIELD]: [cis("1.5.1", "Ensure exec-shield is enabled", "partial")],
  [CHECK_IDS.KERNEL.KRN_MODULE_BLACKLIST]: [cis("1.1.1.1", "Ensure mounting of filesystem modules is disabled", "partial")],
  [CHECK_IDS.KERNEL.KRN_PANIC_REBOOT]: [cis("1.5.4", "Ensure kernel panic reboot timeout is configured", "partial")],
  [CHECK_IDS.KERNEL.KRN_SYSCTL_HARDENED]: [cis("3.3.1", "Ensure sysctl kernel parameters are hardened", "partial")],
  [CHECK_IDS.KERNEL.KRN_COREDUMP_SYSTEMD]: [cis("1.5.2", "Ensure core dumps are restricted via systemd", "full")],
  [CHECK_IDS.KERNEL.KRN_LOCKDOWN_MODE]: [cis("1.6.4", "Ensure kernel lockdown is enabled", "partial")],

  // ─── Network (CIS 3.1-3.3) ────────────────────────────────────────────────
  [CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS]: [cis("3.5.1.1", "Ensure ufw is installed", "partial")],
  [CHECK_IDS.NETWORK.NET_DNS_RESOLVER]: [cis("2.1.6", "Ensure DNS server is not in use", "partial")],
  [CHECK_IDS.NETWORK.NET_TIME_SYNC]: [cis("2.1.1.1", "Ensure a single time synchronization daemon is in use", "partial")],
  [CHECK_IDS.NETWORK.NET_IP_FORWARDING]: [cis("3.3.1", "Ensure IP forwarding is disabled", "full")],
  [CHECK_IDS.NETWORK.NET_SYN_COOKIES]: [cis("3.3.8", "Ensure TCP SYN Cookies is enabled", "full")],
  [CHECK_IDS.NETWORK.NET_HOSTS_ACCESS]: [cis("3.4.4", "Ensure TCP wrappers are configured", "partial")],
  [CHECK_IDS.NETWORK.NET_HOSTS_DENY]: [cis("3.4.4", "Ensure TCP wrappers are configured", "partial")],
  [CHECK_IDS.NETWORK.NET_IPV6_DISABLED]: [cis("3.1.1", "Disable IPv6", "full")],
  [CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND]: [cis("3.3.2", "Ensure packet redirect sending is disabled", "full")],
  [CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT]: [cis("3.3.3", "Ensure secure ICMP redirects are not accepted", "full")],
  [CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6]: [cis("3.3.1", "Ensure source routed packets are not accepted", "full")],
  [CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING]: [cis("3.3.6", "Ensure suspicious packets are logged", "full")],
  [CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS]: [cis("3.5.1.4", "Ensure ufw default deny firewall policy", "partial")],
  [CHECK_IDS.NETWORK.NET_RP_FILTER]: [cis("3.3.7", "Ensure Reverse Path Filtering is enabled", "full")],
  [CHECK_IDS.DDOS.DDOS_SYN_RETRIES]: [cis("3.3.8", "Ensure TCP backlog queue is configured", "partial")],
  [CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS]: [cis("2.1.12", "Ensure mail transfer agent is configured for local-only mode", "partial")],
  [CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT]: [cis("2.4", "Ensure nonessential services are removed or masked", "partial")],
  [CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES]: [cis("3.5.2.1", "Ensure nftables is installed", "partial")],
  [CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE]: [cis("3.3.7", "Ensure Reverse Path Filtering is enabled", "partial")],
  [CHECK_IDS.NETWORK.NET_ARP_IGNORE]: [cis("3.3.7", "Ensure Reverse Path Filtering is enabled", "partial")],
  [CHECK_IDS.DDOS.DDOS_ICMP_BOGUS]: [cis("3.3.5", "Ensure broadcast ICMP requests are ignored", "partial")],
  [CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED]: [cis("3.4.1", "Ensure DCCP is disabled", "partial")],
  [CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT]: [cis("2.4", "Ensure nonessential services are removed or masked", "partial")],

  // ─── Firewall (CIS 3.5.x) ────────────────────────────────────────────────
  [CHECK_IDS.FIREWALL.FW_UFW_ACTIVE]: [
    cis("3.5.1.1", "Ensure ufw is installed", "full"),
    pci("1.3.1", "Network access controls", "partial"),
  ],
  [CHECK_IDS.FIREWALL.FW_DEFAULT_DENY]: [
    cis("3.5.1.4", "Ensure ufw default deny firewall policy", "full"),
    pci("1.3.2", "Network access controls default deny", "partial"),
  ],
  [CHECK_IDS.FIREWALL.FW_SSH_ALLOWED]: [cis("3.5.1.3", "Ensure ufw service is enabled", "partial")],
  [CHECK_IDS.FIREWALL.FW_NO_WIDE_OPEN]: [
    cis("3.5.1.4", "Ensure ufw default deny firewall policy", "partial"),
    pci("1.3.3", "Restrict inbound and outbound traffic", "partial"),
  ],
  [CHECK_IDS.FIREWALL.FW_IPV6_RULES]: [cis("3.5.1.2", "Ensure ufw loopback traffic is configured", "partial")],
  [CHECK_IDS.FIREWALL.FW_NFTABLES_PRESENT]: [cis("3.5.2.1", "Ensure nftables is installed", "full")],
  [CHECK_IDS.FIREWALL.FW_FAIL2BAN_ACTIVE]: [cis("3.5.1.1", "Ensure ufw is installed", "partial")],
  [CHECK_IDS.FIREWALL.FW_IPTABLES_BASELINE]: [cis("3.5.3.1", "Ensure iptables packages are installed", "full")],
  [CHECK_IDS.FIREWALL.FW_INPUT_CHAIN_DENY]: [
    cis("3.5.3.3", "Ensure iptables default deny firewall policy", "full"),
    pci("1.3.2", "Network access controls", "partial"),
  ],
  [CHECK_IDS.FIREWALL.FW_REJECT_NOT_DROP]: [cis("3.5.1.4", "Ensure ufw default deny firewall policy", "partial")],
  [CHECK_IDS.FIREWALL.FW_OUTBOUND_RESTRICTED]: [cis("3.5.3.3", "Ensure iptables outbound connections are configured", "partial")],
  [CHECK_IDS.FIREWALL.FW_RATE_LIMIT]: [cis("3.5.1.5", "Ensure ufw outbound connections are configured", "partial")],
  [CHECK_IDS.FIREWALL.FW_FORWARD_CHAIN_DENY]: [
    cis("3.5.3.3", "Ensure iptables default deny firewall policy", "full"),
    pci("1.3.4", "Prohibit direct public access to cardholder data environment", "partial"),
  ],
  [CHECK_IDS.FIREWALL.FW_IPV6_DISABLED_OR_FILTERED]: [cis("3.1.1", "Disable IPv6", "partial")],
  [CHECK_IDS.FIREWALL.FW_NO_WILDCARD_ACCEPT]: [
    cis("3.5.1.4", "Ensure ufw default deny firewall policy", "full"),
    pci("1.3.3", "Restrict inbound traffic to IP addresses within the CDE", "partial"),
  ],
  [CHECK_IDS.FIREWALL.FW_CONNTRACK_MAX]: [cis("3.3.8", "Ensure TCP SYN Cookies is enabled", "partial")],
  [CHECK_IDS.FIREWALL.FW_LOG_DROPPED]: [cis("3.5.1.6", "Ensure ufw firewall rules exist for all open ports", "partial")],

  // ─── Filesystem (CIS 1.1.x, 6.1.x) ──────────────────────────────────────
  [CHECK_IDS.FILESYSTEM.FS_TMP_STICKY_BIT]: [cis("1.1.2.1", "Ensure /tmp is a separate partition", "partial")],
  [CHECK_IDS.FILESYSTEM.FS_NO_WORLD_WRITABLE]: [cis("6.1.11", "Ensure no world writable files exist", "full")],
  [CHECK_IDS.FILESYSTEM.FS_SUID_THRESHOLD]: [cis("6.1.13", "Ensure SUID and SGID files are reviewed", "partial")],
  [CHECK_IDS.FILESYSTEM.FS_HOME_PERMISSIONS]: [cis("6.2.7", "Ensure users' home directories permissions are 750 or more restrictive", "full")],
  [CHECK_IDS.FILESYSTEM.FS_DISK_USAGE]: [cis("1.1.1.1", "Ensure mounting of cramfs filesystems is disabled", "partial")],
  [CHECK_IDS.FILESYSTEM.FS_HOME_NOEXEC]: [cis("1.1.7.1", "Ensure noexec option set on /home partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_HOME_NOSUID]: [cis("1.1.7.2", "Ensure nosuid option set on /home partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOEXEC]: [cis("1.1.3.2", "Ensure noexec option set on /var/tmp partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_VAR_TMP_NOSUID]: [cis("1.1.3.3", "Ensure nosuid option set on /var/tmp partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_DEV_SHM_NOEXEC]: [cis("1.1.8.2", "Ensure noexec option set on /dev/shm partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_DEV_SHM_NOSUID]: [cis("1.1.8.3", "Ensure nosuid option set on /dev/shm partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_UMASK_RESTRICTIVE]: [cis("5.5.5", "Ensure default user umask is 027 or more restrictive", "full")],
  [CHECK_IDS.FILESYSTEM.FS_TMP_NOEXEC]: [cis("1.1.2.3", "Ensure noexec option set on /tmp partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_NO_UNOWNED_FILES]: [cis("6.1.12", "Ensure no ungrouped files or directories exist", "partial")],
  [CHECK_IDS.FILESYSTEM.FS_TMP_NOSUID]: [cis("1.1.2.4", "Ensure nosuid option set on /tmp partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_NODEV_REMOVABLE]: [cis("1.1.8.1", "Ensure nodev option set on /dev/shm partition", "partial")],
  [CHECK_IDS.FILESYSTEM.FS_VAR_LOG_SEPARATE]: [cis("1.1.6.1", "Ensure /var/log is a separate partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_BOOT_NOSUID]: [cis("1.4.1", "Ensure permissions on bootloader config are configured", "partial")],
  [CHECK_IDS.FILESYSTEM.FS_VAR_NOEXEC]: [cis("1.1.4.2", "Ensure noexec option set on /var partition", "full")],
  [CHECK_IDS.FILESYSTEM.FS_SUID_SYSTEM_COUNT]: [cis("6.1.13", "Ensure SUID and SGID files are reviewed", "partial")],

  // ─── Logging (CIS 4.1-4.2) ────────────────────────────────────────────────
  [CHECK_IDS.LOGGING.LOG_SYSLOG_ACTIVE]: [
    cis("4.2.1.1", "Ensure rsyslog is installed", "full"),
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "LOG-AUTH-LOG-PRESENT": [
    cis("4.2.1.5", "Ensure rsyslog is configured to send logs to a remote log host", "partial"),
    pci("10.2.1", "Implement audit logs", "partial"),
  ],
  "LOG-ROTATION-CONFIGURED": [cis("4.2.3", "Ensure logrotate is configured", "full")],
  "LOG-REMOTE-LOGGING": [
    cis("4.2.1.5", "Ensure rsyslog is configured to send logs to a remote log host", "full"),
    pci("10.3.3", "Protect audit logs from modification", "partial"),
    hipaa("§164.312(b)", "Audit controls - offsite preservation", "partial"),
  ],
  "LOG-AUDIT-DAEMON": [
    cis("4.1.1.1", "Ensure auditd is installed", "full"),
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "LOG-AUDITD-ACTIVE": [
    cis("4.1.1.2", "Ensure auditd service is enabled", "full"),
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "LOG-AUDIT-LOGIN-RULES": [
    cis("4.1.3.1", "Ensure changes to system administration scope (sudoers) is collected", "full", "L2"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "LOG-AUDIT-SUDO-RULES": [
    cis("4.1.3.2", "Ensure actions as another user are always logged", "full", "L2"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "LOG-AUDIT-FILE-RULES": [
    cis("4.1.3.5", "Ensure events that modify the system's network environment are collected", "full", "L2"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "LOG-VARLOG-PERMISSIONS": [cis("4.2.2.1", "Ensure journald is configured to send logs to rsyslog", "partial")],
  "LOG-CENTRAL-LOGGING": [
    cis("4.2.1.5", "Ensure rsyslog is configured to send logs to a remote log host", "partial"),
    pci("10.3.3", "Protect audit logs from modification", "partial"),
  ],
  "LOG-SECURE-JOURNAL": [cis("4.2.2.2", "Ensure journald is configured to compress large log files", "partial")],
  "LOG-NO-WORLD-READABLE-LOGS": [cis("4.2.2.3", "Ensure journald is configured to write logfiles to persistent disk", "partial")],
  "LOG-SYSLOG-REMOTE": [
    cis("4.2.1.5", "Ensure rsyslog is configured to send logs to a remote log host", "full"),
    pci("10.3.3", "Protect audit logs from modification", "partial"),
    hipaa("§164.312(b)", "Audit controls - offsite preservation", "partial"),
  ],
  "LOG-LOGROTATE-ACTIVE": [cis("4.2.3", "Ensure logrotate is configured", "full")],
  "LOG-AUDIT-WATCH-COUNT": [cis("4.1.3.7", "Ensure file deletion events by users are collected", "full", "L2")],
  "LOG-AUDITD-SPACE-ACTION": [cis("4.1.1.3", "Ensure auditing for processes that start prior to auditd is enabled", "partial")],

  // ─── Accounts (CIS 5.5.x, 6.2.x) ────────────────────────────────────────
  "ACCT-NO-EXTRA-UID0": [cis("6.2.3", "Ensure root is the only UID 0 account", "full")],
  "ACCT-NO-EMPTY-PASSWORD": [cis("6.2.1", "Ensure accounts in /etc/passwd use shadowed passwords", "full")],
  "ACCT-NO-RHOSTS": [cis("6.2.8", "Ensure users' dot files are not group or world writable", "partial")],
  "ACCT-HOSTS-EQUIV": [cis("6.2.8", "Ensure users' dot files are not group or world writable", "partial")],
  "ACCT-NO-NETRC": [cis("6.2.9", "Ensure no users have .netrc files", "full")],
  "ACCT-NO-FORWARD": [cis("6.2.10", "Ensure no users have .forward files", "full")],
  "ACCT-SYSTEM-SHELL": [cis("6.2.6", "Ensure no legacy '+' entries exist in /etc/passwd", "partial")],
  "ACCT-ROOT-HOME-PERMS": [cis("6.2.8", "Ensure root PATH integrity", "partial")],
  "ACCT-NO-DUPLICATE-UID": [cis("6.2.4", "Ensure no duplicate UIDs exist", "full")],
  "ACCT-HOME-OWNERSHIP": [cis("6.2.7", "Ensure users' home directories permissions are 750 or more restrictive", "partial")],
  "ACCT-SHADOW-PERMS": [cis("6.1.3", "Ensure permissions on /etc/shadow are configured", "full")],
  "ACCT-MAX-PASSWORD-DAYS": [cis("5.5.1.1", "Ensure password expiration is 365 days or less", "full")],
  "ACCT-MIN-PASSWORD-DAYS": [cis("5.5.1.2", "Ensure minimum days between password changes is 1 or more", "full")],
  "ACCT-INACTIVE-LOCK": [cis("5.5.1.4", "Ensure inactive password lock is 30 days or less", "full")],
  "ACCT-DEFAULT-UMASK": [cis("5.5.5", "Ensure default user umask is 027 or more restrictive", "full")],
  "ACCT-NO-EMPTY-HOME": [cis("6.2.7", "Ensure users' home directories permissions are 750 or more restrictive", "partial")],
  "ACCT-INACTIVE-ACCOUNTS": [cis("5.5.1.4", "Ensure inactive password lock is 30 days or less", "partial")],
  "ACCT-TOTAL-USERS-REASONABLE": [cis("6.2.2", "Ensure /etc/shadow password fields are not empty", "partial")],
  "ACCT-NO-WORLD-WRITABLE-HOME": [cis("6.2.7", "Ensure users' home directories permissions are 750 or more restrictive", "full")],
  "ACCT-LOGIN-DEFS-UID-MAX": [cis("5.5.3", "Ensure system accounts are secured", "partial")],
  "ACCT-LOGIN-SHELL-AUDIT": [cis("5.5.3", "Ensure system accounts are secured", "full")],
  "ACCT-GID-CONSISTENCY": [cis("6.2.5", "Ensure no duplicate GIDs exist", "full")],

  // ─── Services (CIS 2.1-2.6) ────────────────────────────────────────────────
  [CHECK_IDS.SERVICES.SVC_NO_TELNET]: [
    cis("2.3.2", "Ensure telnet client is not installed", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_RSH]: [
    cis("2.3.1", "Ensure NIS client is not installed", "partial"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_RLOGIN]: [
    cis("2.3.1", "Ensure rsh client is not installed", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_FTP]: [
    cis("2.2.11", "Ensure VSFTPD server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_TFTP]: [
    cis("2.2.12", "Ensure TFTP server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NFS_RESTRICTED]: [
    cis("2.2.6", "Ensure NFS is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_RPCBIND]: [
    cis("2.2.8", "Ensure rpcbind is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_SAMBA_RESTRICTED]: [
    cis("2.2.7", "Ensure Samba is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_AVAHI]: [
    cis("2.2.3", "Ensure avahi daemon services are not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_CUPS]: [
    cis("2.2.4", "Ensure a print server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_DHCP_SERVER]: [
    cis("2.2.5", "Ensure DHCP server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_DNS_SERVER]: [cis("2.2.1", "Ensure xinetd is not installed", "partial")],
  [CHECK_IDS.SERVICES.SVC_NO_SNMP]: [
    cis("2.2.15", "Ensure net-snmp is not installed", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_SQUID]: [
    cis("2.2.14", "Ensure HTTP Proxy server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_XINETD]: [
    cis("2.1.1", "Ensure xinetd is not installed", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_YPSERV]: [
    cis("2.2.16", "Ensure NIS server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_INETD]: [
    cis("2.1.1", "Ensure xinetd is not installed", "partial"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  [CHECK_IDS.SERVICES.SVC_NO_CHARGEN]: [cis("2.1.3", "Ensure chargen services are not in use", "full")],
  [CHECK_IDS.SERVICES.SVC_NO_DAYTIME]: [cis("2.1.4", "Ensure daytime services are not in use", "full")],
  [CHECK_IDS.SERVICES.SVC_NO_DISCARD]: [cis("2.1.5", "Ensure discard services are not in use", "full")],
  [CHECK_IDS.SERVICES.SVC_NO_ECHO_SVC]: [cis("2.1.2", "Ensure echo services are not in use", "full")],
  [CHECK_IDS.SERVICES.SVC_RUNNING_COUNT_REASONABLE]: [cis("2.4", "Ensure nonessential services are removed or masked", "partial")],
  [CHECK_IDS.SERVICES.SVC_NO_WILDCARD_LISTENERS]: [cis("2.4", "Ensure nonessential services are removed or masked", "partial")],
  [CHECK_IDS.SERVICES.SVC_NO_XINETD_SERVICES]: [cis("2.1.1", "Ensure xinetd is not installed", "full")],
  [CHECK_IDS.SERVICES.SVC_NO_WORLD_READABLE_CONFIGS]: [cis("6.1.11", "Ensure no world writable files exist", "partial")],

  // ─── Boot (CIS 1.4.x) ─────────────────────────────────────────────────────
  [CHECK_IDS.BOOT.BOOT_GRUB_PERMS]: [
    cis("1.4.1", "Ensure permissions on bootloader config are configured", "full"),
    pci("2.2.1", "System configuration standards", "partial"),
  ],
  [CHECK_IDS.BOOT.BOOT_GRUB_PASSWORD]: [
    cis("1.4.2", "Ensure bootloader password is set", "full"),
    pci("2.2.1", "System configuration standards", "partial"),
  ],
  [CHECK_IDS.BOOT.BOOT_SECURE_BOOT]: [cis("1.4.2", "Ensure bootloader password is set", "partial")],
  [CHECK_IDS.BOOT.BOOT_CMDLINE_SECURITY]: [cis("1.5.1", "Ensure address space layout randomization is enabled", "partial")],
  [CHECK_IDS.BOOT.BOOT_GRUB_DIR_PERMS]: [cis("1.4.1", "Ensure permissions on bootloader config are configured", "full")],
  [CHECK_IDS.BOOT.BOOT_BOOT_PARTITION]: [cis("1.1.5.1", "Ensure /boot is a separate partition", "full")],
  [CHECK_IDS.BOOT.BOOT_SINGLE_USER_AUTH]: [cis("1.4.2", "Ensure bootloader password is set", "partial")],
  [CHECK_IDS.BOOT.BOOT_KERNEL_MODULES]: [cis("1.2.1", "Ensure package manager repositories are configured", "partial")],
  [CHECK_IDS.BOOT.BOOT_UEFI_SECURE]: [cis("1.4.2", "Ensure bootloader password is set", "partial")],
  [CHECK_IDS.BOOT.BOOT_RESCUE_AUTH]: [cis("1.4.2", "Ensure bootloader password is set", "partial")],
  [CHECK_IDS.BOOT.BOOT_GRUB_UNRESTRICTED]: [cis("1.4.2", "Ensure bootloader password is set", "full")],

  // ─── Scheduling (CIS 5.1.x) ───────────────────────────────────────────────
  [CHECK_IDS.SCHEDULING.SCHED_CRON_ACCESS_CONTROL]: [cis("5.1.9", "Ensure at is restricted to authorized users", "partial")],
  [CHECK_IDS.SCHEDULING.SCHED_CRON_DENY]: [cis("5.1.9", "Ensure crontab is restricted to authorized users", "full")],
  [CHECK_IDS.SCHEDULING.SCHED_AT_ACCESS_CONTROL]: [cis("5.1.8", "Ensure at/cron is restricted to authorized users", "full")],
  [CHECK_IDS.SCHEDULING.SCHED_AT_DENY]: [cis("5.1.8", "Ensure at is restricted to authorized users", "full")],
  [CHECK_IDS.SCHEDULING.SCHED_CRON_DIR_PERMS]: [cis("5.1.2", "Ensure permissions on /etc/cron.d are configured", "full")],
  [CHECK_IDS.SCHEDULING.SCHED_CRONTAB_PERMS]: [cis("5.1.1", "Ensure cron daemon is enabled and running", "partial")],
  [CHECK_IDS.SCHEDULING.SCHED_CRON_D_PERMS]: [cis("5.1.2", "Ensure permissions on /etc/cron.d are configured", "full")],
  [CHECK_IDS.SCHEDULING.SCHED_CRON_DAILY_PERMS]: [cis("5.1.3", "Ensure permissions on /etc/cron.daily are configured", "full")],
  [CHECK_IDS.SCHEDULING.SCHED_CRONTAB_OWNER]: [cis("5.1.1", "Ensure cron daemon is enabled and running", "partial")],
  [CHECK_IDS.SCHEDULING.SCHED_NO_USER_CRONTABS]: [cis("5.1.9", "Ensure crontab is restricted to authorized users", "partial")],
  [CHECK_IDS.SCHEDULING.SCHED_CRON_D_FILE_COUNT]: [cis("5.1.2", "Ensure permissions on /etc/cron.d are configured", "partial")],
  [CHECK_IDS.SCHEDULING.SCHED_NO_WORLD_READABLE_CRONTABS]: [cis("5.1.7", "Ensure permissions on /etc/cron.d are configured", "full")],

  // ─── Time (CIS 2.1.1.x) ───────────────────────────────────────────────────
  [CHECK_IDS.TIME.TIME_NTP_ACTIVE]: [cis("2.1.1.1", "Ensure a single time synchronization daemon is in use", "full")],
  [CHECK_IDS.TIME.TIME_SYNCHRONIZED]: [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "partial")],
  [CHECK_IDS.TIME.TIME_TIMEZONE_SET]: [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "partial")],
  [CHECK_IDS.TIME.TIME_HWCLOCK_SYNC]: [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "partial")],
  [CHECK_IDS.TIME.TIME_CHRONY_SOURCES]: [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "full")],
  [CHECK_IDS.TIME.TIME_DRIFT_CHECK]: [cis("2.1.1.3", "Ensure chrony is running as user chrony", "partial")],
  [CHECK_IDS.TIME.TIME_NTP_PEERS_CONFIGURED]: [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "full")],
  [CHECK_IDS.TIME.TIME_NO_DRIFT]: [cis("2.1.1.3", "Ensure chrony is running as user chrony", "partial")],
  [CHECK_IDS.TIME.TIME_NTP_SYNCHRONIZED]: [cis("2.1.1.1", "Ensure a single time synchronization daemon is in use", "full")],

  // ─── Banners (CIS 1.7.x) ──────────────────────────────────────────────────
  [CHECK_IDS.BANNERS.BANNER_ISSUE_EXISTS]: [cis("1.7.1", "Ensure message of the day is configured properly", "full")],
  [CHECK_IDS.BANNERS.BANNER_ISSUE_NET_EXISTS]: [cis("1.7.4", "Ensure permissions on /etc/issue.net are configured", "full")],
  [CHECK_IDS.BANNERS.BANNER_MOTD_EXISTS]: [cis("1.7.2", "Ensure local login warning banner is configured properly", "full")],
  [CHECK_IDS.BANNERS.BANNER_SSH_BANNER]: [cis("1.7.3", "Ensure remote login warning banner is configured properly", "full")],
  [CHECK_IDS.BANNERS.BANNER_NO_OS_INFO]: [cis("1.7.1", "Ensure message of the day is configured properly", "partial")],
  [CHECK_IDS.BANNERS.BNR_ISSUE_NET_SET]: [cis("1.7.3", "Ensure remote login warning banner is configured properly", "full")],

  // ─── Crypto (CIS 5.2.x SSH crypto) ───────────────────────────────────────
  [CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_INSTALLED]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS]: [cis("5.2.15", "Ensure only strong ciphers are used", "full")],
  [CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_MACS]: [cis("5.2.15", "Ensure only approved MAC algorithms are used", "full")],
  [CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_KEX]: [cis("5.2.15", "Ensure only strong Key Exchange algorithms are used", "full")],
  [CHECK_IDS.CRYPTO.CRYPTO_SSH_ED25519_KEY]: [cis("5.2.6", "Ensure SSH public key authentication is in use", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_LUKS_DISK]: [cis("1.4.1", "Ensure disk encryption is configured", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_TLS_MIN_PROTOCOL]: [
    cis("5.2.15", "Ensure only strong ciphers are used", "partial"),
    pci("4.2.1", "Strong cryptography for data in transit", "full"),
    hipaa("§164.312(e)(2)(ii)", "Encryption in transmission", "partial"),
  ],
  [CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED]: [cis("5.2.15", "Ensure only strong ciphers are used", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_NO_SSLV3]: [
    cis("5.2.15", "Ensure only strong ciphers are used", "full"),
    pci("4.2.1", "No SSLv3", "full"),
    hipaa("§164.312(e)(2)(ii)", "No weak encryption protocols", "full"),
  ],
  [CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_WEAK_SSH_KEYS]: [cis("5.2.6", "Ensure SSH public key authentication is in use", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_HOST_KEY_PERMS]: [cis("5.2.3", "Ensure SSH StrictModes is enabled", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_NO_WEAK_OPENSSL_CIPHERS]: [
    cis("5.2.15", "Ensure only strong ciphers are used", "full"),
    pci("4.2.1", "Strong cryptography", "full"),
  ],
  [CHECK_IDS.CRYPTO.CRYPTO_MIN_PROTOCOL]: [cis("5.2.15", "Ensure only strong ciphers are used", "full")],
  [CHECK_IDS.CRYPTO.CRYPTO_LUKS_KEY_SIZE]: [cis("1.1.2.1", "Ensure /tmp is a separate partition", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE]: [cis("5.2.15", "Ensure only strong Key Exchange algorithms are used", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS]: [cis("6.1.11", "Ensure no world writable files exist", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_CERT_COUNT]: [cis("5.2.15", "Ensure only strong ciphers are used", "partial")],
  [CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN]: [cis("5.2.15", "Ensure only strong ciphers are used", "partial")],

  // ─── File Integrity (CIS 4.1.4 — L2) ────────────────────────────────────
  [CHECK_IDS.FILEINTEGRITY.FINT_AIDE_INSTALLED]: [
    cis("4.1.4.1", "Ensure AIDE is installed", "full", "L2"),
    pci("11.5.2", "File integrity monitoring deployed", "partial"),
    hipaa("§164.312(c)(1)", "Protect ePHI integrity", "partial"),
  ],
  [CHECK_IDS.FILEINTEGRITY.FINT_TRIPWIRE_INSTALLED]: [cis("4.1.4.1", "Ensure AIDE is installed", "partial", "L2")],
  [CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_EXISTS]: [cis("4.1.4.1", "Ensure AIDE is installed", "partial", "L2")],
  [CHECK_IDS.FILEINTEGRITY.FINT_AIDE_CRON]: [
    cis("4.1.4.2", "Ensure filesystem integrity is regularly checked", "full", "L2"),
    pci("11.5.2", "File integrity monitoring", "partial"),
    hipaa("§164.312(c)(1)", "Integrity controls", "partial"),
    hipaa("§164.312(c)(2)", "Mechanism to authenticate ePHI", "partial"),
  ],
  [CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_INSTALLED]: [
    cis("4.1.1.1", "Ensure auditd is installed", "full"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  [CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_RUNNING]: [
    cis("4.1.1.2", "Ensure auditd service is enabled", "full"),
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  [CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_PASSWD_RULE]: [
    cis("4.1.3.1", "Ensure changes to system administration scope (sudoers) is collected", "partial", "L2"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  [CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_SHADOW_RULE]: [
    cis("4.1.3.1", "Ensure changes to system administration scope (sudoers) is collected", "partial", "L2"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  [CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_RECENT]: [
    cis("4.1.4.2", "Ensure filesystem integrity is regularly checked", "partial", "L2"),
    hipaa("§164.312(c)(1)", "Protect ePHI integrity", "partial"),
    hipaa("§164.312(c)(2)", "Mechanism to authenticate ePHI", "partial"),
  ],
  [CHECK_IDS.FILEINTEGRITY.FINT_CRITICAL_FILE_MONITORING]: [
    cis("4.1.3.5", "Ensure events that modify the system's network environment are collected", "partial", "L2"),
    pci("11.5.2", "File integrity monitoring", "partial"),
    hipaa("§164.312(c)(1)", "Integrity controls", "partial"),
  ],

  // ─── MAC (CIS 1.6.x) ──────────────────────────────────────────────────────
  [CHECK_IDS.MAC.MAC_LSM_ACTIVE]: [cis("1.6.1", "Ensure AppArmor is installed", "partial")],
  [CHECK_IDS.MAC.MAC_APPARMOR_ACTIVE]: [cis("1.6.1", "Ensure AppArmor is installed", "full")],
  [CHECK_IDS.MAC.MAC_APPARMOR_PROFILES]: [cis("1.6.2", "Ensure AppArmor is enabled in the bootloader configuration", "partial")],
  [CHECK_IDS.MAC.MAC_APPARMOR_NO_UNCONFINED]: [cis("1.6.3", "Ensure all AppArmor Profiles are in enforce or complain mode", "full")],
  [CHECK_IDS.MAC.MAC_SELINUX_ENFORCING]: [cis("1.6.1", "Ensure AppArmor is installed", "partial")],
  [CHECK_IDS.MAC.MAC_SELINUX_CONFIG]: [cis("1.6.2", "Ensure AppArmor is enabled in the bootloader configuration", "partial")],
  [CHECK_IDS.MAC.MAC_SECCOMP_ENABLED]: [cis("1.6.1", "Ensure AppArmor is installed", "partial")],
  [CHECK_IDS.MAC.MAC_APPARMOR_ENFORCE_COUNT]: [cis("1.6.3", "Ensure all AppArmor Profiles are in enforce or complain mode", "full")],
  [CHECK_IDS.MAC.MAC_NO_UNCONFINED_PROCS]: [cis("1.6.3", "Ensure all AppArmor Profiles are in enforce or complain mode", "full")],
  [CHECK_IDS.MAC.MAC_SECCOMP_STRICT]: [cis("1.6.1", "Ensure AppArmor is installed", "partial")],

  // ─── Updates (CIS 1.9) ────────────────────────────────────────────────────
  [CHECK_IDS.UPDATES.UPD_SECURITY_PATCHES]: [
    cis("1.9", "Ensure updates, patches, and additional security software are installed", "full"),
    pci("6.3.3", "Security patches installed", "partial"),
  ],
  [CHECK_IDS.UPDATES.UPD_AUTO_UPDATES]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  [CHECK_IDS.UPDATES.UPD_CACHE_FRESH]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  [CHECK_IDS.UPDATES.UPD_REBOOT_REQUIRED]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  [CHECK_IDS.UPDATES.UPD_LAST_UPGRADE_RECENT]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  [CHECK_IDS.UPDATES.UPD_CVE_SCANNER_PRESENT]: [
    cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial"),
    pci("6.3.2", "Software vulnerability identification", "partial"),
  ],
  [CHECK_IDS.UPDATES.UPD_DPKG_NO_PARTIAL]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  [CHECK_IDS.UPDATES.UPD_KERNEL_CURRENT]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  [CHECK_IDS.UPDATES.UPD_UNATTENDED_ENABLED]: [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  [CHECK_IDS.UPDATES.UPD_APT_HTTPS]: [cis("1.2.1", "Ensure package manager repositories are configured", "partial")],
  [CHECK_IDS.UPDATES.UPD_SECURITY_REPO_PRIORITY]: [cis("1.2.1", "Ensure package manager repositories are configured", "full")],

  // ─── Malware (PCI-DSS 5.x) ────────────────────────────────────────────────
  [CHECK_IDS.MALWARE.MALWARE_CHKROOTKIT_INSTALLED]: [pci("5.2.1", "Anti-malware deployed", "partial")],
  [CHECK_IDS.MALWARE.MALWARE_RKHUNTER_INSTALLED]: [pci("5.2.1", "Anti-malware deployed", "partial")],
  [CHECK_IDS.MALWARE.MALWARE_NO_SUID_IN_TMP]: [pci("5.2.1", "Anti-malware deployed", "partial")],
  [CHECK_IDS.MALWARE.MALWARE_NO_SUID_IN_DEV]: [pci("5.2.1", "Anti-malware deployed", "partial")],
  [CHECK_IDS.MALWARE.MALWARE_RKHUNTER_RECENT_SCAN]: [pci("5.2.1", "Anti-malware deployed", "partial")],
  [CHECK_IDS.MALWARE.MALWARE_NO_ROOT_WRITABLE]: [pci("5.2.1", "Anti-malware deployed", "partial")],

  // ─── Secrets (PCI-DSS 8.x + HIPAA 164.312(a)) ────────────────────────────
  [CHECK_IDS.SECRETS.SECRETS_SSH_KEY_PERMS]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_ENV_WORLD_READABLE]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_ETC_PLAINTEXT_CRED]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_WORLD_READABLE_KEYS]: [pci("8.3.7", "Authentication factors unreadable", "partial")],
  [CHECK_IDS.SECRETS.SECRETS_SSH_AUTHORIZED_KEYS_PERMS]: [pci("8.3.7", "Authentication factors unreadable", "partial")],
  [CHECK_IDS.SECRETS.SECRETS_NO_READABLE_HISTORY]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_NO_SSH_AGENT_FORWARDING]: [
    cis("5.2.20", "Ensure SSH AllowAgentForwarding is disabled", "full"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_NO_AWS_CREDS_PLAINTEXT]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_NO_KUBECONFIG_EXPOSED]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_NO_SHELL_RC_SECRETS]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_GIT_CONFIG_TOKEN]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_ENV_IN_HOME]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_AWS_CREDS_PERMS]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_DOCKER_ENV_PERMS]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  [CHECK_IDS.SECRETS.SECRETS_NPMRC_TOKEN]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],

  // ─── Cloud Metadata (CIS + PCI-DSS) ──────────────────────────────────────
  [CHECK_IDS.CLOUDMETA.CLOUDMETA_ENDPOINT_BLOCKED]: [
    cis("5.4.5", "Ensure default deny firewall policy", "partial"),
    pci("1.3.1", "Restrict inbound traffic", "partial"),
  ],
  [CHECK_IDS.CLOUDMETA.CLOUDMETA_INIT_LOG_CLEAN]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  [CHECK_IDS.CLOUDMETA.CLOUDMETA_IMDSV2_ENFORCED]: [
    cis("5.4.5", "Ensure default deny firewall policy", "partial"),
    pci("1.3.1", "Restrict inbound traffic", "partial"),
  ],
  [CHECK_IDS.CLOUDMETA.CLOUDMETA_SENSITIVE_ENV_NOT_IN_CLOUDINIT]: [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  [CHECK_IDS.CLOUDMETA.CLOUDMETA_VPC_METADATA_FIREWALL]: [
    cis("5.4.5", "Ensure default deny firewall policy", "partial"),
    pci("1.3.1", "Restrict inbound traffic", "partial"),
  ],
  [CHECK_IDS.CLOUDMETA.CLOUDMETA_IMDSV1_DISABLED]: [
    cis("5.4.5", "Ensure default deny firewall policy", "partial"),
  ],

  // ─── Supply Chain (PCI-DSS 6.x) ──────────────────────────────────────────
  [CHECK_IDS.SUPPLYCHAIN.SUPPLY_APT_HTTPS_REPOS]: [pci("6.3.3", "Software protected from vulnerabilities", "partial")],
  [CHECK_IDS.SUPPLYCHAIN.SUPPLY_GPG_KEYS_PRESENT]: [pci("6.3.3", "Software authenticated", "partial")],
  [CHECK_IDS.SUPPLYCHAIN.SUPPLY_NO_UNSIGNED_PACKAGES]: [pci("6.3.3", "Supply chain integrity", "partial")],
  [CHECK_IDS.SUPPLYCHAIN.SUPPLY_REPOS_SIGNED]: [pci("6.3.3", "Supply chain integrity", "partial")],
  [CHECK_IDS.SUPPLYCHAIN.SUPPLY_NO_UNAUTH_SOURCES]: [pci("6.3.3", "Supply chain integrity", "partial")],
  [CHECK_IDS.SUPPLYCHAIN.SUPPLY_DPKG_AUDIT_CLEAN]: [pci("6.3.3", "Supply chain integrity", "partial")],
  [CHECK_IDS.SUPPLYCHAIN.SUPPLY_NO_INSECURE_REPOS]: [pci("6.3.3", "Supply chain integrity", "partial")],
  [CHECK_IDS.SUPPLYCHAIN.SUPPLY_GPG_KEYS_TRUSTED]: [pci("6.3.3", "Supply chain integrity", "partial")],

  // ─── Docker (PCI-DSS 2.x) ────────────────────────────────────────────────
  "DCK-ROOTLESS-MODE": [pci("2.2.5", "Container security configuration", "partial")],
  [CHECK_IDS.DOCKER.DCK_NO_PRIVILEGED]: [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-APPARMOR-PROFILE": [pci("2.2.5", "Container security configuration", "partial")],
  [CHECK_IDS.DOCKER.DCK_NO_HOST_NETWORK]: [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-PID-MODE": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-SECCOMP-ENABLED": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-READ-ONLY-ROOTFS": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-NO-HOST-NETWORK-INSPECT": [pci("2.2.5", "Container security configuration", "partial")],

  // ─── Incident Readiness (PCI-DSS 10.x + HIPAA 164.312(b)) ───────────────
  [CHECK_IDS.INCIDENTREADY.INCIDENT_AUDITD_RUNNING]: [
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  [CHECK_IDS.INCIDENTREADY.INCIDENT_LOG_FORWARDING]: [
    pci("10.3.3", "Protect audit logs from modification", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  [CHECK_IDS.INCIDENTREADY.INCIDENT_AUDITD_PASSWD_RULE]: [
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  [CHECK_IDS.INCIDENTREADY.INCIDENT_AUDITD_SUDO_RULE]: [
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  [CHECK_IDS.INCIDENTREADY.INCID_FORENSIC_TOOLS]: [pci("10.2.1", "Implement audit logs", "partial")],
  [CHECK_IDS.INCIDENTREADY.INCID_LOG_ARCHIVE_EXISTS]: [pci("10.3.3", "Protect audit logs from modification", "partial")],

  // --- TLS Hardening (Phase 85) ---
  [CHECK_IDS.TLS.TLS_MIN_VERSION]: [
    pci("4.2.1", "Strong cryptography for data in transit — TLS 1.2 minimum", "full"),
    cis("5.1", "Ensure only approved TLS protocols are used", "partial"),
    hipaa("§164.312(e)(1)", "Transmission security — TLS 1.2 minimum", "partial"),
  ],
  [CHECK_IDS.TLS.TLS_WEAK_CIPHERS]: [
    pci("4.2.1", "Strong cryptography — no weak ciphers (RC4, DES, 3DES, NULL, SEED, IDEA)", "full"),
    hipaa("§164.312(e)(1)", "Transmission security — strong cipher suites", "partial"),
  ],
  [CHECK_IDS.TLS.TLS_HSTS]: [
    cis("4.1", "Ensure web server HSTS is enabled", "partial"),
  ],
  [CHECK_IDS.TLS.TLS_OCSP]: [],
  [CHECK_IDS.TLS.TLS_CERT_EXPIRY]: [
    pci("4.2.1", "Maintain valid TLS certificates — expiry monitoring", "partial"),
  ],
  [CHECK_IDS.TLS.TLS_DH_PARAM]: [
    pci("4.2.1", "Strong cryptography — DH parameters >= 2048 bits", "partial"),
    cis("5.1", "Ensure only strong DH parameters are used", "partial"),
  ],
  [CHECK_IDS.TLS.TLS_COMPRESSION]: [
    pci("4.2.1", "Disable TLS compression to prevent CRIME attack", "partial"),
  ],
  [CHECK_IDS.TLS.TLS_CERT_CHAIN]: [
    pci("4.2.1", "Ensure certificate chain is complete and valid", "partial"),
  ],

  // --- HTTP Security Headers (Phase 86) ---
  [CHECK_IDS.HTTPHEADERS.HDR_001]: [
    pci("6.4.1", "Protect against clickjacking (X-Frame-Options or CSP frame-ancestors)", "partial"),
  ],
  [CHECK_IDS.HTTPHEADERS.HDR_002]: [
    pci("6.4.1", "Prevent MIME type sniffing (X-Content-Type-Options: nosniff)", "partial"),
  ],
  [CHECK_IDS.HTTPHEADERS.HDR_003]: [],
  [CHECK_IDS.HTTPHEADERS.HDR_004]: [],
  [CHECK_IDS.HTTPHEADERS.HDR_005]: [
    pci("6.2.4", "Protect against cross-site request forgery (CORS wildcard)", "partial"),
  ],
  [CHECK_IDS.HTTPHEADERS.HDR_006]: [
    pci("6.4.1", "Content Security Policy — defense against XSS injection", "partial"),
  ],

  // --- WAF & Reverse Proxy (NGX) — Phase 88 ---
  [CHECK_IDS.NGINX.NGX_SERVER_TOKENS]: [
    cis("2.2.1", "Ensure unnecessary system components are not installed", "partial"),
    pci("2.2.1", "System components are configured and managed securely", "partial"),
  ],
  [CHECK_IDS.NGINX.NGX_SSL_PROTOCOLS]: [
    pci("4.2.1", "Strong cryptography for transmission of account data", "partial"),
  ],
  [CHECK_IDS.NGINX.NGX_RATE_LIMIT]: [
    pci("6.4.1", "Web-facing applications are protected against attacks", "partial"),
  ],
  [CHECK_IDS.NGINX.NGX_CLIENT_BODY_SIZE]: [
    pci("6.4.1", "Web-facing application security controls in place", "partial"),
  ],
  [CHECK_IDS.NGINX.NGX_ACCESS_LOG]: [
    cis("4.1.1.1", "Ensure auditd is installed", "partial"),
    pci("10.2.1", "Audit logs capture events required for reconstruction", "partial"),
  ],
  [CHECK_IDS.NGINX.NGX_ERROR_LOG]: [
    cis("4.1.1.1", "Ensure logging is configured", "partial"),
    pci("10.2.1", "Audit logs capture events", "partial"),
  ],
  [CHECK_IDS.NGINX.NGX_WAF_DETECTED]: [
    pci("6.4.2", "An automated technical solution is deployed to detect and prevent web-based attacks", "full"),
  ],
  [CHECK_IDS.NGINX.NGX_WAF_BOT_DETECT]: [
    pci("6.4.2", "Automated bot detection via CRS 913 rules or UA map", "partial"),
  ],
  [CHECK_IDS.NGINX.NGX_WAF_CHALLENGE_MODE]: [
    pci("6.4.2", "Challenge mode for suspicious request verification", "partial"),
  ],

  // --- DDoS Hardening (DDOS) --- Phase 89 ---
  [CHECK_IDS.DDOS.DDOS_SYN_BACKLOG]: [
    cis("3.3.8", "Ensure TCP backlog queue is configured", "partial"),
    pci("6.3.3", "All system components protected from known vulnerabilities", "partial"),
  ],
  [CHECK_IDS.DDOS.DDOS_SYNACK_RETRIES]: [
    cis("3.3.8", "Ensure TCP SYN cookies and retry limits configured", "partial"),
    pci("6.3.3", "System components protected from known vulnerabilities", "partial"),
  ],
  [CHECK_IDS.DDOS.DDOS_FIN_TIMEOUT]: [
    cis("3.3.8", "Ensure TCP hardening parameters configured", "partial"),
  ],
  [CHECK_IDS.DDOS.DDOS_TW_REUSE]: [
    pci("6.3.3", "System components protected from known vulnerabilities", "partial"),
  ],
  [CHECK_IDS.DDOS.DDOS_ICMP_RATELIMIT]: [
    cis("3.3.5", "Ensure broadcast ICMP requests are ignored", "partial"),
  ],
  [CHECK_IDS.DDOS.DDOS_SOMAXCONN]: [
    cis("3.3.8", "Ensure TCP backlog queue is configured", "partial"),
    pci("6.3.3", "System components protected from known vulnerabilities", "partial"),
  ],
};