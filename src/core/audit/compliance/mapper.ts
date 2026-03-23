/**
 * Compliance mapping data — maps check IDs to framework controls.
 * Central Record<string, ComplianceRef[]> flat map.
 * Populated in Phase 50 for CIS Ubuntu 22.04 v2.0.0, PCI-DSS v4.0, HIPAA.
 */

import type { ComplianceRef, ComplianceCoverage } from "../types.js";

export const FRAMEWORK_VERSIONS = {
  CIS: "CIS Ubuntu 22.04 v2.0.0",
  "PCI-DSS": "PCI-DSS v4.0",
  HIPAA: "HIPAA §164.312",
} as const;

export type FrameworkKey = keyof typeof FRAMEWORK_VERSIONS;

/** Helper: build CIS ref with optional level (default L1) */
function cis(
  controlId: string,
  description: string,
  coverage: ComplianceCoverage,
  level: "L1" | "L2" = "L1",
): ComplianceRef {
  return {
    framework: "CIS",
    controlId,
    version: FRAMEWORK_VERSIONS.CIS,
    description,
    coverage,
    level,
  };
}

/** Helper: build PCI-DSS ref */
function pci(
  controlId: string,
  description: string,
  coverage: ComplianceCoverage,
): ComplianceRef {
  return {
    framework: "PCI-DSS",
    controlId,
    version: FRAMEWORK_VERSIONS["PCI-DSS"],
    description,
    coverage,
  };
}

/** Helper: build HIPAA ref */
function hipaa(
  controlId: string,
  description: string,
  coverage: ComplianceCoverage,
): ComplianceRef {
  return {
    framework: "HIPAA",
    controlId,
    version: FRAMEWORK_VERSIONS.HIPAA,
    description,
    coverage,
  };
}

export { cis, pci, hipaa };

// ─── COMPLIANCE_MAP ──────────────────────────────────────────────────────────
// CIS Ubuntu 22.04 v2.0.0 mappings (Plan 01).
// PCI-DSS and HIPAA mappings added in Plan 02.
export const COMPLIANCE_MAP: Record<string, ComplianceRef[]> = {
  // ─── SSH (CIS 5.2.x) ────────────────────────────────────────────────────
  "SSH-PASSWORD-AUTH": [
    cis("5.2.8", "Ensure SSH PasswordAuthentication is disabled", "full"),
    pci("2.2.7", "All non-console administrative access is encrypted", "partial"),
    hipaa("§164.312(d)", "Person or entity authentication", "partial"),
  ],
  "SSH-ROOT-LOGIN": [
    cis("5.2.10", "Ensure SSH root login is disabled", "full"),
    pci("2.2.7", "Restrict administrative access", "partial"),
  ],
  "SSH-EMPTY-PASSWORDS": [cis("5.2.11", "Ensure SSH PermitEmptyPasswords is disabled", "full")],
  "SSH-PUBKEY-AUTH": [
    cis("5.2.6", "Ensure SSH public key authentication is in use", "full"),
    hipaa("§164.312(d)", "Person or entity authentication", "partial"),
  ],
  "SSH-MAX-AUTH-TRIES": [cis("5.2.7", "Ensure SSH MaxAuthTries is set to 4 or less", "full")],
  "SSH-X11-FORWARDING": [cis("5.2.5", "Ensure SSH X11 forwarding is disabled", "full")],
  "SSH-CLIENT-ALIVE-INTERVAL": [
    cis("5.2.16", "Ensure SSH Idle Timeout Interval is configured", "full"),
    hipaa("§164.312(a)(2)(iii)", "Automatic logoff", "partial"),
  ],
  "SSH-CLIENT-ALIVE-COUNT": [
    cis("5.2.16", "Ensure SSH ClientAliveCountMax is configured", "full"),
    hipaa("§164.312(a)(2)(iii)", "Automatic logoff", "partial"),
  ],
  "SSH-LOGIN-GRACE-TIME": [cis("5.2.17", "Ensure SSH LoginGraceTime is set to one minute or less", "full")],
  "SSH-IGNORE-RHOSTS": [cis("5.2.9", "Ensure SSH IgnoreRhosts is enabled", "full")],
  "SSH-HOSTBASED-AUTH": [cis("5.2.12", "Ensure SSH HostbasedAuthentication is disabled", "full")],
  "SSH-MAX-SESSIONS": [cis("5.2.19", "Ensure SSH MaxSessions is limited", "full")],
  "SSH-USE-DNS": [cis("5.2.20", "Ensure SSH AllowTcpForwarding is disabled", "partial")],
  "SSH-PERMIT-USER-ENV": [cis("5.2.13", "Ensure SSH PermitUserEnvironment is disabled", "full")],
  "SSH-LOG-LEVEL": [cis("5.2.4", "Ensure SSH LogLevel is appropriate", "full")],
  "SSH-STRONG-CIPHERS": [
    cis("5.2.15", "Ensure only strong ciphers are used", "full"),
    pci("4.2.1", "Strong cryptography for data in transit", "full"),
    hipaa("§164.312(e)(2)(ii)", "Encryption in transmission", "partial"),
  ],
  "SSH-STRONG-MACS": [
    cis("5.2.15", "Ensure only approved MAC algorithms are used", "full"),
    pci("4.2.1", "Strong cryptography for data in transit", "full"),
    hipaa("§164.312(e)(2)(ii)", "Encryption in transmission", "partial"),
  ],
  "SSH-STRONG-KEX": [
    cis("5.2.15", "Ensure only strong Key Exchange algorithms are used", "full"),
    pci("4.2.1", "Strong cryptography for data in transit", "full"),
  ],
  "SSH-MAX-STARTUPS": [cis("5.2.18", "Ensure SSH MaxStartups is configured", "full")],
  "SSH-STRICT-MODES": [cis("5.2.3", "Ensure SSH StrictModes is enabled", "full")],
  "SSH-NO-AGENT-FORWARDING": [cis("5.2.14", "Ensure SSH AllowAgentForwarding is disabled", "full")],
  "SSH-PRINT-MOTD": [cis("5.2.21", "Ensure SSH warning banner is configured", "partial")],

  // ─── Auth (CIS 5.3-5.5, 6.1-6.2) ────────────────────────────────────────
  "AUTH-NO-NOPASSWD-ALL": [
    cis("5.3.7", "Ensure sudo commands use pty and require authentication", "full"),
    pci("7.2.1", "Least privilege access", "partial"),
  ],
  "AUTH-PASSWORD-AGING": [
    cis("5.5.1.1", "Ensure password expiration is 365 days or less", "full"),
    pci("8.3.9", "Password change interval", "partial"),
  ],
  "AUTH-NO-EMPTY-PASSWORDS": [
    cis("6.2.1", "Ensure accounts in /etc/passwd use shadowed passwords", "partial"),
    pci("8.3.1", "All user passwords set", "full"),
  ],
  "AUTH-ROOT-LOGIN-RESTRICTED": [cis("5.4.3", "Ensure default group for the root account is GID 0", "partial")],
  "AUTH-PWD-QUALITY": [cis("5.3.2", "Ensure password creation requirements are configured", "full")],
  "AUTH-FAILLOCK-CONFIGURED": [
    cis("5.3.1", "Ensure lockout for failed password attempts is configured", "full"),
    pci("8.3.4", "Account lockout after failures", "partial"),
    hipaa("§164.312(a)(2)(i)", "Access control protection", "partial"),
    hipaa("§164.312(a)(1)", "Access control", "partial"),
  ],
  "AUTH-SHADOW-PERMISSIONS": [
    cis("6.1.3", "Ensure permissions on /etc/shadow are configured", "full"),
    pci("8.3.7", "Render passwords unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  "AUTH-SUDO-LOG": [cis("5.3.5", "Ensure sudo logging is enabled", "full")],
  "AUTH-SUDO-REQUIRETTY": [cis("5.3.6", "Ensure sudo authentication timeout is configured correctly", "partial")],
  "AUTH-NO-UID0-DUPS": [
    cis("6.2.4", "Ensure no duplicate UIDs exist", "full"),
    hipaa("§164.312(a)(2)(i)", "Unique user identification", "partial"),
    hipaa("§164.312(a)(2)(ii)", "Emergency access procedure", "partial"),
  ],
  "AUTH-PASS-MIN-DAYS": [cis("5.5.1.2", "Ensure minimum days between password changes is 1 or more", "full")],
  "AUTH-PASS-WARN-AGE": [cis("5.5.1.3", "Ensure password expiration warning days is 7 or more", "full")],
  "AUTH-INACTIVE-LOCK": [cis("5.5.1.4", "Ensure inactive password lock is 30 days or less", "full")],
  "AUTH-SUDO-WHEEL-ONLY": [
    cis("5.3.8", "Ensure access to the su command is restricted", "partial"),
    pci("7.2.1", "Restrict access by need-to-know", "partial"),
  ],
  "AUTH-MFA-PRESENT": [
    cis("5.3.4", "Ensure multi-factor authentication is enabled for all administrative access", "partial"),
    pci("8.4.2", "MFA for all access into CDE", "partial"),
    hipaa("§164.312(d)", "Person or entity authentication", "partial"),
  ],
  "AUTH-SU-RESTRICTED": [
    cis("5.3.8", "Ensure access to the su command is restricted", "full"),
    pci("7.2.1", "Restrict su access", "partial"),
  ],
  "AUTH-PASS-MAX-DAYS-SET": [cis("5.5.1.1", "Ensure password expiration is 365 days or less", "full")],
  "AUTH-GSHADOW-PERMISSIONS": [cis("6.1.5", "Ensure permissions on /etc/gshadow are configured", "full")],
  "AUTH-PWQUALITY-CONFIGURED": [
    cis("5.3.2", "Ensure password creation requirements are configured", "full"),
    pci("8.3.6", "Minimum password complexity", "partial"),
  ],
  "AUTH-UMASK-LOGIN-DEFS": [cis("5.5.5", "Ensure default user shell timeout is 900 seconds or less", "partial")],
  "AUTH-SHA512-HASH": [
    cis("5.3.3", "Ensure password hashing algorithm is SHA-512 or yescrypt", "full"),
    pci("8.3.7", "Passwords stored with strong cryptography", "partial"),
    hipaa("§164.312(d)", "Authentication with strong cryptography", "partial"),
  ],
  "AUTH-PWQUALITY-MINLEN": [cis("5.3.2", "Ensure password creation requirements are configured", "full")],

  // ─── Kernel (CIS 1.5.x, 3.3.x) ──────────────────────────────────────────
  "KRN-ASLR-ENABLED": [cis("1.5.1", "Ensure address space layout randomization is enabled", "full")],
  "KRN-CORE-DUMPS-RESTRICTED": [cis("1.5.2", "Ensure core dumps are restricted", "full")],
  "KRN-NETWORK-HARDENING": [cis("3.3.1", "Ensure source routed packets are not accepted", "partial")],
  "KRN-KERNEL-VERSION": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  "KRN-DMESG-RESTRICTED": [cis("1.5.3", "Ensure unprivileged access to the kernel syslog is disabled", "full")],
  "KRN-PTRACE-SCOPE": [cis("1.5.4", "Ensure ptrace_scope is restricted", "full")],
  "KRN-KPTR-RESTRICT": [cis("1.5.3", "Ensure kernel pointer access is restricted", "partial")],
  "KRN-PERF-PARANOID": [cis("1.5.4", "Ensure kernel performance events access is restricted", "partial")],
  "KRN-SYN-COOKIES": [cis("3.3.8", "Ensure TCP SYN Cookies is enabled", "full")],
  "KRN-IP-FORWARD-DISABLED": [cis("3.3.1", "Ensure IP forwarding is disabled", "full")],
  "KRN-RP-FILTER": [cis("3.3.2", "Ensure packet redirect sending is disabled", "partial")],
  "KRN-TCP-TIMESTAMPS": [cis("3.3.7", "Ensure Reverse Path Filtering is enabled", "partial")],
  "KRN-ICMP-BROADCAST": [cis("3.3.5", "Ensure broadcast ICMP requests are ignored", "full")],
  "KRN-ACCEPT-REDIRECTS-V6": [cis("3.3.3", "Ensure secure ICMP redirects are not accepted", "full")],
  "KRN-BPF-UNPRIVILEGED": [cis("1.5.4", "Ensure unprivileged BPF is disabled", "full")],
  "KRN-MODULES-DISABLED": [cis("1.5.1", "Ensure module loading is disabled after boot", "partial")],
  "KRN-IP-FORWARD-V6": [cis("3.3.1", "Ensure IPv6 forwarding is disabled", "full")],
  "KRN-SEND-REDIRECTS": [cis("3.3.2", "Ensure packet redirect sending is disabled", "full")],
  "KRN-SECURE-REDIRECTS": [cis("3.3.3", "Ensure secure ICMP redirects are not accepted", "full")],
  "KRN-SYSRQ-DISABLED": [cis("1.5.4", "Ensure SysRq key is disabled", "full")],
  "KRN-CORE-PATTERN-SAFE": [cis("1.5.2", "Ensure core dump storage is configured", "partial")],
  "KRN-PANIC-ON-OOPS": [cis("1.5.4", "Ensure kernel panic on oops is enabled", "partial")],
  "KRN-NMI-WATCHDOG-DISABLED": [cis("1.5.4", "Ensure NMI watchdog is configured", "partial")],
  "KRN-UNPRIVILEGED-USERNS": [cis("1.5.4", "Ensure unprivileged user namespaces are disabled", "full")],
  "KRN-EXEC-SHIELD": [cis("1.5.1", "Ensure exec-shield is enabled", "partial")],
  "KRN-MODULE-BLACKLIST": [cis("1.1.1.1", "Ensure mounting of filesystem modules is disabled", "partial")],
  "KRN-PANIC-REBOOT": [cis("1.5.4", "Ensure kernel panic reboot timeout is configured", "partial")],
  "KRN-SYSCTL-HARDENED": [cis("3.3.1", "Ensure sysctl kernel parameters are hardened", "partial")],
  "KRN-COREDUMP-SYSTEMD": [cis("1.5.2", "Ensure core dumps are restricted via systemd", "full")],
  "KRN-LOCKDOWN-MODE": [cis("1.6.4", "Ensure kernel lockdown is enabled", "partial")],

  // ─── Network (CIS 3.1-3.3) ────────────────────────────────────────────────
  "NET-NO-DANGEROUS-PORTS": [cis("3.5.1.1", "Ensure ufw is installed", "partial")],
  "NET-DNS-RESOLVER": [cis("2.1.6", "Ensure DNS server is not in use", "partial")],
  "NET-TIME-SYNC": [cis("2.1.1.1", "Ensure a single time synchronization daemon is in use", "partial")],
  "NET-IP-FORWARDING": [cis("3.3.1", "Ensure IP forwarding is disabled", "full")],
  "NET-SYN-COOKIES": [cis("3.3.8", "Ensure TCP SYN Cookies is enabled", "full")],
  "NET-HOSTS-ACCESS": [cis("3.4.4", "Ensure TCP wrappers are configured", "partial")],
  "NET-HOSTS-DENY": [cis("3.4.4", "Ensure TCP wrappers are configured", "partial")],
  "NET-IPV6-DISABLED": [cis("3.1.1", "Disable IPv6", "full")],
  "NET-ICMP-REDIRECT-SEND": [cis("3.3.2", "Ensure packet redirect sending is disabled", "full")],
  "NET-ICMP-SECURE-REDIRECT": [cis("3.3.3", "Ensure secure ICMP redirects are not accepted", "full")],
  "NET-SOURCE-ROUTING-V6": [cis("3.3.1", "Ensure source routed packets are not accepted", "full")],
  "NET-MARTIAN-LOGGING": [cis("3.3.6", "Ensure suspicious packets are logged", "full")],
  "NET-NO-EXPOSED-MGMT-PORTS": [cis("3.5.1.4", "Ensure ufw default deny firewall policy", "partial")],
  "NET-RP-FILTER": [cis("3.3.7", "Ensure Reverse Path Filtering is enabled", "full")],
  "NET-TCP-SYN-RETRIES": [cis("3.3.8", "Ensure TCP backlog queue is configured", "partial")],
  "NET-NO-MAIL-PORTS": [cis("2.1.12", "Ensure mail transfer agent is configured for local-only mode", "partial")],
  "NET-LISTENING-SERVICES-AUDIT": [cis("2.4", "Ensure nonessential services are removed or masked", "partial")],
  "NET-NO-PROMISCUOUS-INTERFACES": [cis("3.5.2.1", "Ensure nftables is installed", "partial")],
  "NET-ARP-ANNOUNCE": [cis("3.3.7", "Ensure Reverse Path Filtering is enabled", "partial")],
  "NET-ARP-IGNORE": [cis("3.3.7", "Ensure Reverse Path Filtering is enabled", "partial")],
  "NET-BOGUS-ICMP-IGNORE": [cis("3.3.5", "Ensure broadcast ICMP requests are ignored", "partial")],
  "NET-TCP-WRAPPERS-CONFIGURED": [cis("3.4.1", "Ensure DCCP is disabled", "partial")],
  "NET-LISTENING-PORT-COUNT": [cis("2.4", "Ensure nonessential services are removed or masked", "partial")],

  // ─── Firewall (CIS 3.5.x) ────────────────────────────────────────────────
  "FW-UFW-ACTIVE": [
    cis("3.5.1.1", "Ensure ufw is installed", "full"),
    pci("1.3.1", "Network access controls", "partial"),
  ],
  "FW-DEFAULT-DENY": [
    cis("3.5.1.4", "Ensure ufw default deny firewall policy", "full"),
    pci("1.3.2", "Network access controls default deny", "partial"),
  ],
  "FW-SSH-ALLOWED": [cis("3.5.1.3", "Ensure ufw service is enabled", "partial")],
  "FW-NO-WIDE-OPEN": [
    cis("3.5.1.4", "Ensure ufw default deny firewall policy", "partial"),
    pci("1.3.3", "Restrict inbound and outbound traffic", "partial"),
  ],
  "FW-IPV6-RULES": [cis("3.5.1.2", "Ensure ufw loopback traffic is configured", "partial")],
  "FW-NFTABLES-PRESENT": [cis("3.5.2.1", "Ensure nftables is installed", "full")],
  "FW-FAIL2BAN-ACTIVE": [cis("3.5.1.1", "Ensure ufw is installed", "partial")],
  "FW-IPTABLES-BASELINE": [cis("3.5.3.1", "Ensure iptables packages are installed", "full")],
  "FW-INPUT-CHAIN-DENY": [
    cis("3.5.3.3", "Ensure iptables default deny firewall policy", "full"),
    pci("1.3.2", "Network access controls", "partial"),
  ],
  "FW-REJECT-NOT-DROP": [cis("3.5.1.4", "Ensure ufw default deny firewall policy", "partial")],
  "FW-OUTBOUND-RESTRICTED": [cis("3.5.3.3", "Ensure iptables outbound connections are configured", "partial")],
  "FW-RATE-LIMIT": [cis("3.5.1.5", "Ensure ufw outbound connections are configured", "partial")],
  "FW-FORWARD-CHAIN-DENY": [
    cis("3.5.3.3", "Ensure iptables default deny firewall policy", "full"),
    pci("1.3.4", "Prohibit direct public access to cardholder data environment", "partial"),
  ],
  "FW-IPV6-DISABLED-OR-FILTERED": [cis("3.1.1", "Disable IPv6", "partial")],
  "FW-NO-WILDCARD-ACCEPT": [
    cis("3.5.1.4", "Ensure ufw default deny firewall policy", "full"),
    pci("1.3.3", "Restrict inbound traffic to IP addresses within the CDE", "partial"),
  ],
  "FW-CONNTRACK-MAX": [cis("3.3.8", "Ensure TCP SYN Cookies is enabled", "partial")],
  "FW-LOG-DROPPED": [cis("3.5.1.6", "Ensure ufw firewall rules exist for all open ports", "partial")],

  // ─── Filesystem (CIS 1.1.x, 6.1.x) ──────────────────────────────────────
  "FS-TMP-STICKY-BIT": [cis("1.1.2.1", "Ensure /tmp is a separate partition", "partial")],
  "FS-NO-WORLD-WRITABLE": [cis("6.1.11", "Ensure no world writable files exist", "full")],
  "FS-SUID-THRESHOLD": [cis("6.1.13", "Ensure SUID and SGID files are reviewed", "partial")],
  "FS-HOME-PERMISSIONS": [cis("6.2.7", "Ensure users' home directories permissions are 750 or more restrictive", "full")],
  "FS-DISK-USAGE": [cis("1.1.1.1", "Ensure mounting of cramfs filesystems is disabled", "partial")],
  "FS-HOME-NOEXEC": [cis("1.1.7.1", "Ensure noexec option set on /home partition", "full")],
  "FS-HOME-NOSUID": [cis("1.1.7.2", "Ensure nosuid option set on /home partition", "full")],
  "FS-VAR-TMP-NOEXEC": [cis("1.1.3.2", "Ensure noexec option set on /var/tmp partition", "full")],
  "FS-VAR-TMP-NOSUID": [cis("1.1.3.3", "Ensure nosuid option set on /var/tmp partition", "full")],
  "FS-DEV-SHM-NOEXEC": [cis("1.1.8.2", "Ensure noexec option set on /dev/shm partition", "full")],
  "FS-DEV-SHM-NOSUID": [cis("1.1.8.3", "Ensure nosuid option set on /dev/shm partition", "full")],
  "FS-UMASK-RESTRICTIVE": [cis("5.5.5", "Ensure default user umask is 027 or more restrictive", "full")],
  "FS-TMP-NOEXEC": [cis("1.1.2.3", "Ensure noexec option set on /tmp partition", "full")],
  "FS-NO-UNOWNED-FILES": [cis("6.1.12", "Ensure no ungrouped files or directories exist", "partial")],
  "FS-TMP-NOSUID": [cis("1.1.2.4", "Ensure nosuid option set on /tmp partition", "full")],
  "FS-NODEV-REMOVABLE": [cis("1.1.8.1", "Ensure nodev option set on /dev/shm partition", "partial")],
  "FS-VAR-LOG-SEPARATE": [cis("1.1.6.1", "Ensure /var/log is a separate partition", "full")],
  "FS-BOOT-NOSUID": [cis("1.4.1", "Ensure permissions on bootloader config are configured", "partial")],
  "FS-VAR-NOEXEC": [cis("1.1.4.2", "Ensure noexec option set on /var partition", "full")],
  "FS-SUID-SYSTEM-COUNT": [cis("6.1.13", "Ensure SUID and SGID files are reviewed", "partial")],

  // ─── Logging (CIS 4.1-4.2) ────────────────────────────────────────────────
  "LOG-SYSLOG-ACTIVE": [
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

  // ─── Services (CIS 2.1-2.6) ───────────────────────────────────────────────
  "SVC-NO-TELNET": [
    cis("2.3.2", "Ensure telnet client is not installed", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-RSH": [
    cis("2.3.1", "Ensure NIS client is not installed", "partial"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-RLOGIN": [
    cis("2.3.1", "Ensure rsh client is not installed", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-FTP": [
    cis("2.2.11", "Ensure VSFTPD server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-TFTP": [
    cis("2.2.12", "Ensure TFTP server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NFS-RESTRICTED": [
    cis("2.2.6", "Ensure NFS is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-RPCBIND": [
    cis("2.2.8", "Ensure rpcbind is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-SAMBA-RESTRICTED": [
    cis("2.2.7", "Ensure Samba is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-AVAHI": [
    cis("2.2.3", "Ensure avahi daemon services are not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-CUPS": [
    cis("2.2.4", "Ensure a print server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-DHCP-SERVER": [
    cis("2.2.5", "Ensure DHCP server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-DNS-SERVER": [cis("2.2.1", "Ensure xinetd is not installed", "partial")],
  "SVC-NO-SNMP": [
    cis("2.2.15", "Ensure net-snmp is not installed", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-SQUID": [
    cis("2.2.14", "Ensure HTTP Proxy server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-XINETD": [
    cis("2.1.1", "Ensure xinetd is not installed", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-YPSERV": [
    cis("2.2.16", "Ensure NIS server is not in use", "full"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-INETD": [
    cis("2.1.1", "Ensure xinetd is not installed", "partial"),
    pci("2.2.5", "Remove unnecessary services", "partial"),
  ],
  "SVC-NO-CHARGEN": [cis("2.1.3", "Ensure chargen services are not in use", "full")],
  "SVC-NO-DAYTIME": [cis("2.1.4", "Ensure daytime services are not in use", "full")],
  "SVC-NO-DISCARD": [cis("2.1.5", "Ensure discard services are not in use", "full")],
  "SVC-NO-ECHO-SVC": [cis("2.1.2", "Ensure echo services are not in use", "full")],
  "SVC-RUNNING-COUNT-REASONABLE": [cis("2.4", "Ensure nonessential services are removed or masked", "partial")],
  "SVC-NO-WILDCARD-LISTENERS": [cis("2.4", "Ensure nonessential services are removed or masked", "partial")],
  "SVC-NO-XINETD-SERVICES": [cis("2.1.1", "Ensure xinetd is not installed", "full")],
  "SVC-NO-WORLD-READABLE-CONFIGS": [cis("6.1.11", "Ensure no world writable files exist", "partial")],

  // ─── Boot (CIS 1.4.x) ─────────────────────────────────────────────────────
  "BOOT-GRUB-PERMS": [
    cis("1.4.1", "Ensure permissions on bootloader config are configured", "full"),
    pci("2.2.1", "System configuration standards", "partial"),
  ],
  "BOOT-GRUB-PASSWORD": [
    cis("1.4.2", "Ensure bootloader password is set", "full"),
    pci("2.2.1", "System configuration standards", "partial"),
  ],
  "BOOT-SECURE-BOOT": [cis("1.4.2", "Ensure bootloader password is set", "partial")],
  "BOOT-CMDLINE-SECURITY": [cis("1.5.1", "Ensure address space layout randomization is enabled", "partial")],
  "BOOT-GRUB-DIR-PERMS": [cis("1.4.1", "Ensure permissions on bootloader config are configured", "full")],
  "BOOT-BOOT-PARTITION": [cis("1.1.5.1", "Ensure /boot is a separate partition", "full")],
  "BOOT-SINGLE-USER-AUTH": [cis("1.4.2", "Ensure bootloader password is set", "partial")],
  "BOOT-KERNEL-MODULES": [cis("1.2.1", "Ensure package manager repositories are configured", "partial")],
  "BOOT-UEFI-SECURE": [cis("1.4.2", "Ensure bootloader password is set", "partial")],
  "BOOT-RESCUE-AUTH": [cis("1.4.2", "Ensure bootloader password is set", "partial")],
  "BOOT-GRUB-UNRESTRICTED": [cis("1.4.2", "Ensure bootloader password is set", "full")],

  // ─── Scheduling (CIS 5.1.x) ───────────────────────────────────────────────
  "SCHED-CRON-ACCESS-CONTROL": [cis("5.1.9", "Ensure at is restricted to authorized users", "partial")],
  "SCHED-CRON-DENY": [cis("5.1.9", "Ensure crontab is restricted to authorized users", "full")],
  "SCHED-AT-ACCESS-CONTROL": [cis("5.1.8", "Ensure at/cron is restricted to authorized users", "full")],
  "SCHED-AT-DENY": [cis("5.1.8", "Ensure at is restricted to authorized users", "full")],
  "SCHED-CRON-DIR-PERMS": [cis("5.1.2", "Ensure permissions on /etc/cron.d are configured", "full")],
  "SCHED-CRONTAB-PERMS": [cis("5.1.1", "Ensure cron daemon is enabled and running", "partial")],
  "SCHED-CRON-D-PERMS": [cis("5.1.2", "Ensure permissions on /etc/cron.d are configured", "full")],
  "SCHED-CRON-DAILY-PERMS": [cis("5.1.3", "Ensure permissions on /etc/cron.daily are configured", "full")],
  "SCHED-CRONTAB-OWNER": [cis("5.1.1", "Ensure cron daemon is enabled and running", "partial")],
  "SCHED-NO-USER-CRONTABS": [cis("5.1.9", "Ensure crontab is restricted to authorized users", "partial")],
  "SCHED-CRON-D-FILE-COUNT": [cis("5.1.2", "Ensure permissions on /etc/cron.d are configured", "partial")],
  "SCHED-NO-WORLD-READABLE-CRONTABS": [cis("5.1.7", "Ensure permissions on /etc/cron.d are configured", "full")],

  // ─── Time (CIS 2.1.1.x) ───────────────────────────────────────────────────
  "TIME-NTP-ACTIVE": [cis("2.1.1.1", "Ensure a single time synchronization daemon is in use", "full")],
  "TIME-SYNCHRONIZED": [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "partial")],
  "TIME-TIMEZONE-SET": [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "partial")],
  "TIME-HWCLOCK-SYNC": [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "partial")],
  "TIME-CHRONY-SOURCES": [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "full")],
  "TIME-DRIFT-CHECK": [cis("2.1.1.3", "Ensure chrony is running as user chrony", "partial")],
  "TIME-NTP-PEERS-CONFIGURED": [cis("2.1.1.2", "Ensure chrony is configured with authorized timeserver", "full")],
  "TIME-NO-DRIFT": [cis("2.1.1.3", "Ensure chrony is running as user chrony", "partial")],
  "TIME-NTP-SYNCHRONIZED": [cis("2.1.1.1", "Ensure a single time synchronization daemon is in use", "full")],

  // ─── Banners (CIS 1.7.x) ──────────────────────────────────────────────────
  "BANNER-ISSUE-EXISTS": [cis("1.7.1", "Ensure message of the day is configured properly", "full")],
  "BANNER-ISSUE-NET-EXISTS": [cis("1.7.4", "Ensure permissions on /etc/issue.net are configured", "full")],
  "BANNER-MOTD-EXISTS": [cis("1.7.2", "Ensure local login warning banner is configured properly", "full")],
  "BANNER-SSH-BANNER": [cis("1.7.3", "Ensure remote login warning banner is configured properly", "full")],
  "BANNER-NO-OS-INFO": [cis("1.7.1", "Ensure message of the day is configured properly", "partial")],
  "BNR-ISSUE-NET-SET": [cis("1.7.3", "Ensure remote login warning banner is configured properly", "full")],

  // ─── Crypto (CIS 5.2.x SSH crypto) ───────────────────────────────────────
  "CRYPTO-OPENSSL-INSTALLED": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  "CRYPTO-SSH-WEAK-CIPHERS": [cis("5.2.15", "Ensure only strong ciphers are used", "full")],
  "CRYPTO-SSH-WEAK-MACS": [cis("5.2.15", "Ensure only approved MAC algorithms are used", "full")],
  "CRYPTO-SSH-WEAK-KEX": [cis("5.2.15", "Ensure only strong Key Exchange algorithms are used", "full")],
  "CRYPTO-SSH-ED25519-KEY": [cis("5.2.6", "Ensure SSH public key authentication is in use", "partial")],
  "CRYPTO-LUKS-DISK": [cis("1.4.1", "Ensure disk encryption is configured", "partial")],
  "CRYPTO-TLS-MIN-PROTOCOL": [
    cis("5.2.15", "Ensure only strong ciphers are used", "partial"),
    pci("4.2.1", "Strong cryptography for data in transit", "full"),
    hipaa("§164.312(e)(2)(ii)", "Encryption in transmission", "partial"),
  ],
  "CRYPTO-CERT-NOT-EXPIRED": [cis("5.2.15", "Ensure only strong ciphers are used", "partial")],
  "CRYPTO-NO-SSLV3": [
    cis("5.2.15", "Ensure only strong ciphers are used", "full"),
    pci("4.2.1", "No SSLv3", "full"),
    hipaa("§164.312(e)(2)(ii)", "No weak encryption protocols", "full"),
  ],
  "CRYPTO-OPENSSL-MODERN": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  "CRYPTO-WEAK-SSH-KEYS": [cis("5.2.6", "Ensure SSH public key authentication is in use", "partial")],
  "CRYPTO-HOST-KEY-PERMS": [cis("5.2.3", "Ensure SSH StrictModes is enabled", "partial")],
  "CRYPTO-NO-WEAK-OPENSSL-CIPHERS": [
    cis("5.2.15", "Ensure only strong ciphers are used", "full"),
    pci("4.2.1", "Strong cryptography", "full"),
  ],
  "CRYPTO-MIN-PROTOCOL": [cis("5.2.15", "Ensure only strong ciphers are used", "full")],
  "CRYPTO-LUKS-KEY-SIZE": [cis("1.1.2.1", "Ensure /tmp is a separate partition", "partial")],
  "CRYPTO-DH-PARAMS-SIZE": [cis("5.2.15", "Ensure only strong Key Exchange algorithms are used", "partial")],
  "CRYPTO-NO-WORLD-READABLE-KEYS": [cis("6.1.11", "Ensure no world writable files exist", "partial")],
  "CRYPTO-CERT-COUNT": [cis("5.2.15", "Ensure only strong ciphers are used", "partial")],
  "CRYPTO-NGINX-TLS-MODERN": [cis("5.2.15", "Ensure only strong ciphers are used", "partial")],

  // ─── File Integrity (CIS 4.1.4 — L2) ────────────────────────────────────
  "FINT-AIDE-INSTALLED": [
    cis("4.1.4.1", "Ensure AIDE is installed", "full", "L2"),
    pci("11.5.2", "File integrity monitoring deployed", "partial"),
    hipaa("§164.312(c)(1)", "Protect ePHI integrity", "partial"),
  ],
  "FINT-TRIPWIRE-INSTALLED": [cis("4.1.4.1", "Ensure AIDE is installed", "partial", "L2")],
  "FINT-AIDE-DB-EXISTS": [cis("4.1.4.1", "Ensure AIDE is installed", "partial", "L2")],
  "FINT-AIDE-CRON": [
    cis("4.1.4.2", "Ensure filesystem integrity is regularly checked", "full", "L2"),
    pci("11.5.2", "File integrity monitoring", "partial"),
    hipaa("§164.312(c)(1)", "Integrity controls", "partial"),
    hipaa("§164.312(c)(2)", "Mechanism to authenticate ePHI", "partial"),
  ],
  "FINT-AUDITD-INSTALLED": [
    cis("4.1.1.1", "Ensure auditd is installed", "full"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "FINT-AUDITD-RUNNING": [
    cis("4.1.1.2", "Ensure auditd service is enabled", "full"),
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "FINT-AUDIT-PASSWD-RULE": [
    cis("4.1.3.1", "Ensure changes to system administration scope (sudoers) is collected", "partial", "L2"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "FINT-AUDIT-SHADOW-RULE": [
    cis("4.1.3.1", "Ensure changes to system administration scope (sudoers) is collected", "partial", "L2"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "FINT-AIDE-DB-RECENT": [
    cis("4.1.4.2", "Ensure filesystem integrity is regularly checked", "partial", "L2"),
    hipaa("§164.312(c)(1)", "Protect ePHI integrity", "partial"),
    hipaa("§164.312(c)(2)", "Mechanism to authenticate ePHI", "partial"),
  ],
  "FINT-CRITICAL-FILE-MONITORING": [
    cis("4.1.3.5", "Ensure events that modify the system's network environment are collected", "partial", "L2"),
    pci("11.5.2", "File integrity monitoring", "partial"),
    hipaa("§164.312(c)(1)", "Integrity controls", "partial"),
  ],

  // ─── MAC (CIS 1.6.x) ──────────────────────────────────────────────────────
  "MAC-LSM-ACTIVE": [cis("1.6.1", "Ensure AppArmor is installed", "partial")],
  "MAC-APPARMOR-ACTIVE": [cis("1.6.1", "Ensure AppArmor is installed", "full")],
  "MAC-APPARMOR-PROFILES": [cis("1.6.2", "Ensure AppArmor is enabled in the bootloader configuration", "partial")],
  "MAC-APPARMOR-NO-UNCONFINED": [cis("1.6.3", "Ensure all AppArmor Profiles are in enforce or complain mode", "full")],
  "MAC-SELINUX-ENFORCING": [cis("1.6.1", "Ensure AppArmor is installed", "partial")],
  "MAC-SELINUX-CONFIG": [cis("1.6.2", "Ensure AppArmor is enabled in the bootloader configuration", "partial")],
  "MAC-SECCOMP-ENABLED": [cis("1.6.1", "Ensure AppArmor is installed", "partial")],
  "MAC-APPARMOR-ENFORCE-COUNT": [cis("1.6.3", "Ensure all AppArmor Profiles are in enforce or complain mode", "full")],
  "MAC-NO-UNCONFINED-PROCS": [cis("1.6.3", "Ensure all AppArmor Profiles are in enforce or complain mode", "full")],
  "MAC-SECCOMP-STRICT": [cis("1.6.1", "Ensure AppArmor is installed", "partial")],

  // ─── Updates (CIS 1.9) ────────────────────────────────────────────────────
  "UPD-SECURITY-PATCHES": [
    cis("1.9", "Ensure updates, patches, and additional security software are installed", "full"),
    pci("6.3.3", "Security patches installed", "partial"),
  ],
  "UPD-AUTO-UPDATES": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  "UPD-CACHE-FRESH": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  "UPD-REBOOT-REQUIRED": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial")],
  "UPD-LAST-UPGRADE-RECENT": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  "UPD-CVE-SCANNER-PRESENT": [
    cis("1.9", "Ensure updates, patches, and additional security software are installed", "partial"),
    pci("6.3.2", "Software vulnerability identification", "partial"),
  ],
  "UPD-DPKG-NO-PARTIAL": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  "UPD-KERNEL-CURRENT": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  "UPD-UNATTENDED-ENABLED": [cis("1.9", "Ensure updates, patches, and additional security software are installed", "full")],
  "UPD-APT-HTTPS": [cis("1.2.1", "Ensure package manager repositories are configured", "partial")],
  "UPD-SECURITY-REPO-PRIORITY": [cis("1.2.1", "Ensure package manager repositories are configured", "full")],

  // ─── Malware (PCI-DSS 5.x) ────────────────────────────────────────────────
  "MALWARE-CHKROOTKIT-INSTALLED": [pci("5.2.1", "Anti-malware deployed", "partial")],
  "MALWARE-RKHUNTER-INSTALLED": [pci("5.2.1", "Anti-malware deployed", "partial")],
  "MALWARE-NO-SUID-IN-TMP": [pci("5.2.1", "Anti-malware deployed", "partial")],
  "MALWARE-NO-SUID-IN-DEV": [pci("5.2.1", "Anti-malware deployed", "partial")],
  "MALWARE-RKHUNTER-RECENT-SCAN": [pci("5.2.1", "Anti-malware deployed", "partial")],
  "MALWARE-NO-ROOT-WRITABLE": [pci("5.2.1", "Anti-malware deployed", "partial")],

  // ─── Secrets (PCI-DSS 8.x + HIPAA 164.312(a)) ────────────────────────────
  "SECRETS-SSH-KEY-PERMS": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  "SECRETS-ENV-WORLD-READABLE": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  "SECRETS-ETC-PLAINTEXT-CRED": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  "SECRETS-WORLD-READABLE-KEYS": [pci("8.3.7", "Authentication factors unreadable", "partial")],
  "SECRETS-SSH-AUTHORIZED-KEYS-PERMS": [pci("8.3.7", "Authentication factors unreadable", "partial")],
  "SECRETS-NO-READABLE-HISTORY": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  "SECRETS-NO-SSH-AGENT-FORWARDING": [
    cis("5.2.20", "Ensure SSH AllowAgentForwarding is disabled", "full"),
  ],
  "SECRETS-NO-AWS-CREDS-PLAINTEXT": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  "SECRETS-NO-KUBECONFIG-EXPOSED": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  "SECRETS-NO-SHELL-RC-SECRETS": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  "SECRETS-GIT-CONFIG-TOKEN": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  "SECRETS-ENV-IN-HOME": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  "SECRETS-AWS-CREDS-PERMS": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  "SECRETS-DOCKER-ENV-PERMS": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  "SECRETS-NPMRC-TOKEN": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],

  // ─── Cloud Metadata (CIS + PCI-DSS) ──────────────────────────────────────
  "CLOUDMETA-ENDPOINT-BLOCKED": [
    cis("5.4.5", "Ensure default deny firewall policy", "partial"),
    pci("1.3.1", "Restrict inbound traffic", "partial"),
  ],
  "CLOUDMETA-INIT-LOG-CLEAN": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
  ],
  "CLOUDMETA-IMDSV2-ENFORCED": [
    cis("5.4.5", "Ensure default deny firewall policy", "partial"),
    pci("1.3.1", "Restrict inbound traffic", "partial"),
  ],
  "CLOUDMETA-SENSITIVE-ENV-NOT-IN-CLOUDINIT": [
    pci("8.3.7", "Authentication factors unreadable", "partial"),
    hipaa("§164.312(a)(2)(iv)", "Encryption and decryption", "partial"),
  ],
  "CLOUDMETA-VPC-METADATA-FIREWALL": [
    cis("5.4.5", "Ensure default deny firewall policy", "partial"),
    pci("1.3.1", "Restrict inbound traffic", "partial"),
  ],
  "CLOUDMETA-IMDSV1-DISABLED": [
    cis("5.4.5", "Ensure default deny firewall policy", "partial"),
  ],

  // ─── Supply Chain (PCI-DSS 6.x) ──────────────────────────────────────────
  "SUPPLY-APT-HTTPS-REPOS": [pci("6.3.3", "Software protected from vulnerabilities", "partial")],
  "SUPPLY-GPG-KEYS-PRESENT": [pci("6.3.3", "Software authenticated", "partial")],
  "SUPPLY-NO-UNSIGNED-PACKAGES": [pci("6.3.3", "Supply chain integrity", "partial")],
  "SUPPLY-REPOS-SIGNED": [pci("6.3.3", "Supply chain integrity", "partial")],
  "SUPPLY-NO-UNAUTH-SOURCES": [pci("6.3.3", "Supply chain integrity", "partial")],
  "SUPPLY-DPKG-AUDIT-CLEAN": [pci("6.3.3", "Supply chain integrity", "partial")],
  "SUPPLY-NO-INSECURE-REPOS": [pci("6.3.3", "Supply chain integrity", "partial")],
  "SUPPLY-GPG-KEYS-TRUSTED": [pci("6.3.3", "Supply chain integrity", "partial")],

  // ─── Docker (PCI-DSS 2.x) ────────────────────────────────────────────────
  "DCK-ROOTLESS-MODE": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-NO-PRIVILEGED": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-APPARMOR-PROFILE": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-NO-HOST-NETWORK": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-PID-MODE": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-SECCOMP-ENABLED": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-READ-ONLY-ROOTFS": [pci("2.2.5", "Container security configuration", "partial")],
  "DCK-NO-HOST-NETWORK-INSPECT": [pci("2.2.5", "Container security configuration", "partial")],

  // ─── Incident Readiness (PCI-DSS 10.x + HIPAA 164.312(b)) ───────────────
  "INCIDENT-AUDITD-RUNNING": [
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "INCIDENT-LOG-FORWARDING": [
    pci("10.3.3", "Protect audit logs from modification", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "INCIDENT-AUDITD-PASSWD-RULE": [
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "INCIDENT-AUDITD-SUDO-RULE": [
    pci("10.2.1", "Implement audit logs", "partial"),
    hipaa("§164.312(b)", "Audit controls", "partial"),
  ],
  "INCID-FORENSIC-TOOLS": [pci("10.2.1", "Implement audit logs", "partial")],
  "INCID-LOG-ARCHIVE-EXISTS": [pci("10.3.3", "Protect audit logs from modification", "partial")],

  // --- TLS Hardening (Phase 85) ---
  "TLS-MIN-VERSION": [
    pci("4.2.1", "Strong cryptography for data in transit — TLS 1.2 minimum", "full"),
    cis("5.1", "Ensure only approved TLS protocols are used", "partial"),
  ],
  "TLS-WEAK-CIPHERS": [
    pci("4.2.1", "Strong cryptography — no weak ciphers (RC4, DES, 3DES, NULL)", "full"),
  ],
  "TLS-HSTS": [
    cis("4.1", "Ensure web server HSTS is enabled", "partial"),
  ],
  "TLS-OCSP": [],
  "TLS-CERT-EXPIRY": [
    pci("4.2.1", "Maintain valid TLS certificates — expiry monitoring", "partial"),
  ],
  "TLS-DH-PARAM": [
    pci("4.2.1", "Strong cryptography — DH parameters >= 2048 bits", "partial"),
    cis("5.1", "Ensure only strong DH parameters are used", "partial"),
  ],
  "TLS-COMPRESSION": [
    pci("4.2.1", "Disable TLS compression to prevent CRIME attack", "partial"),
  ],
  "TLS-CERT-CHAIN": [
    pci("4.2.1", "Ensure certificate chain is complete and valid", "partial"),
  ],

  // --- HTTP Security Headers (Phase 86) ---
  "HDR-001": [
    pci("6.4.1", "Protect against clickjacking (X-Frame-Options or CSP frame-ancestors)", "partial"),
  ],
  "HDR-002": [
    pci("6.4.1", "Prevent MIME type sniffing (X-Content-Type-Options: nosniff)", "partial"),
  ],
  "HDR-003": [],   // Referrer-Policy — no direct CIS/PCI mapping; best practice
  "HDR-004": [],   // Permissions-Policy — no direct CIS/PCI mapping; best practice
  "HDR-005": [
    pci("6.5.9", "Protect against cross-site request forgery (CORS wildcard)", "partial"),
  ],
  "HDR-006": [
    pci("6.4.1", "Content Security Policy — defense against XSS injection", "partial"),
  ],
};
