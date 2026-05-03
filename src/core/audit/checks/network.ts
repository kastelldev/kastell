/**
 * Network check parser.
 * Parses ss/sysctl output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

// CodeQL suppression: fixCommand strings are display-only recommendations;
// no user input reaches shell execution


/** Ports commonly associated with databases/services that should NOT be publicly exposed */
const DANGEROUS_PORTS = new Set(["3306", "5432", "6379", "27017", "9200", "11211", "5984"]);

function extractSysctlValue(output: string, key: string): string | null {
  const regex = new RegExp(`${key.replace(/\./g, "\\.")}\\s*=\\s*(\\S+)`, "m");
  const match = output.match(regex);
  return match ? match[1].trim() : null;
}

export const parseNetworkChecks: CheckParser = (sectionOutput: string, platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  // NET-01: Listening ports analysis (check for dangerous exposed ports)
  const portMatches = output.matchAll(/0\.0\.0\.0:(\d+)/g);
  const exposedPorts: string[] = [];
  const dangerousPorts: string[] = [];
  for (const match of portMatches) {
    const port = match[1];
    exposedPorts.push(port);
    if (DANGEROUS_PORTS.has(port)) {
      dangerousPorts.push(port);
    }
  }
  const net01: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS,
    category: "Network",
    name: "No Dangerous Ports Exposed",
    severity: "warning",
    passed: isNA ? false : dangerousPorts.length === 0,
    currentValue: isNA
      ? "Unable to determine"
      : dangerousPorts.length > 0
        ? `Dangerous port(s) exposed: ${dangerousPorts.join(", ")}`
        : `${exposedPorts.length} port(s) listening, no dangerous ports exposed`,
    expectedValue: "No database/service ports exposed publicly",
    fixCommand: dangerousPorts.length > 0
      ? `ufw deny ${dangerousPorts[0]}/tcp`
      : "Review listening ports with: ss -tlnp",
    explain: "Database and cache ports exposed to the internet are common attack vectors.",
  };

  // NET-02: DNS resolver configured
  const hasDNS = /nameserver\s+\S+/i.test(output);
  const net02: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_DNS_RESOLVER,
    category: "Network",
    name: "DNS Resolver Configured",
    severity: "info",
    passed: isNA ? false : hasDNS,
    currentValue: isNA
      ? "Unable to determine"
      : hasDNS
        ? "DNS resolver configured"
        : "No DNS resolver found",
    expectedValue: "DNS resolver configured",
    fixCommand: "echo 'nameserver 1.1.1.1' >> /etc/resolv.conf",
    safeToAutoFix: "SAFE",
    explain: "DNS resolution is required for package updates and security operations.",
  };

  // NET-03: NTP sync (check timedatectl output)
  const hasNTP = /NTP\s*synchronized:\s*yes/i.test(output) ||
    /System clock synchronized:\s*yes/i.test(output);
  const net03: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_TIME_SYNC,
    category: "Network",
    name: "Time Synchronization",
    severity: "info",
    passed: isNA ? false : hasNTP,
    currentValue: isNA
      ? "Unable to determine"
      : hasNTP
        ? "NTP synchronized"
        : "NTP status unknown",
    expectedValue: "NTP synchronized",
    fixCommand: "timedatectl set-ntp true",
    safeToAutoFix: "SAFE",
    explain: "Time sync is critical for TLS certificates, logging accuracy, and security audit trails.",
  };

  // NET-04: IP forwarding (should be off for bare, ok for docker platforms)
  const ipForward = extractSysctlValue(output, "net.ipv4.ip_forward");
  const isPlatform = platform === "coolify" || platform === "dokploy";
  const forwardingOff = ipForward === "0";
  const net04: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_IP_FORWARDING,
    category: "Network",
    name: "IP Forwarding Status",
    severity: "warning",
    passed: isNA ? false : isPlatform ? true : forwardingOff,
    currentValue: isNA
      ? "Unable to determine"
      : ipForward !== null
        ? `net.ipv4.ip_forward = ${ipForward}`
        : "Unable to determine",
    expectedValue: isPlatform ? "Enabled (required for Docker)" : "Disabled (net.ipv4.ip_forward = 0)",
    fixCommand: "sysctl -w net.ipv4.ip_forward=0 && echo 'net.ipv4.ip_forward=0' >> /etc/sysctl.conf",
    safeToAutoFix: "SAFE",
    explain: isPlatform
      ? "IP forwarding is required for Docker networking on this platform."
      : "IP forwarding should be disabled unless the server is a router or runs Docker.",
  };

  // NET-05: TCP SYN cookies enabled
  const syncookies = extractSysctlValue(output, "net.ipv4.tcp_syncookies");
  const net05: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_SYN_COOKIES,
    category: "Network",
    name: "TCP SYN Cookies Enabled",
    severity: "warning",
    passed: isNA ? false : syncookies === "1",
    currentValue: isNA
      ? "Unable to determine"
      : syncookies !== null
        ? `net.ipv4.tcp_syncookies = ${syncookies}`
        : "Unable to determine",
    expectedValue: "net.ipv4.tcp_syncookies = 1",
    fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1 && echo 'net.ipv4.tcp_syncookies=1' >> /etc/sysctl.conf",
    safeToAutoFix: "SAFE",
    explain: "SYN cookies protect against SYN flood denial-of-service attacks.",
  };

  // NET-06: hosts.allow exists
  const hostsAllowPresent = !output.includes("NO_HOSTS_ALLOW");
  const net06: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_HOSTS_ACCESS,
    category: "Network",
    name: "TCP Wrappers hosts.allow Configured",
    severity: "info",
    passed: isNA ? false : hostsAllowPresent,
    currentValue: isNA
      ? "Unable to determine"
      : hostsAllowPresent
        ? "/etc/hosts.allow exists"
        : "/etc/hosts.allow not found",
    expectedValue: "/etc/hosts.allow configured",
    fixCommand: "echo 'sshd: ALL' > /etc/hosts.allow",
    safeToAutoFix: "SAFE",
    explain: "TCP Wrappers hosts.allow defines allowed hosts for network services, providing an additional access control layer.",
  };

  // NET-07: hosts.deny has default deny (ALL : ALL)
  const hostsDenyAll = /ALL\s*:\s*ALL/i.test(output);
  const net07: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_HOSTS_DENY,
    category: "Network",
    name: "TCP Wrappers Default Deny Configured",
    severity: "warning",
    passed: isNA ? false : hostsDenyAll,
    currentValue: isNA
      ? "Unable to determine"
      : hostsDenyAll
        ? "/etc/hosts.deny has ALL:ALL deny rule"
        : "/etc/hosts.deny missing or no default deny",
    expectedValue: "/etc/hosts.deny contains ALL : ALL",
    fixCommand: "echo 'ALL: ALL' >> /etc/hosts.deny",
    safeToAutoFix: "GUARDED",
    explain: "A default deny rule in hosts.deny blocks all TCP wrapper-controlled services unless explicitly allowed. GUARDED: must ensure sshd is in hosts.allow first — applying without it locks out SSH.",
  };

  // NET-08: IPv6 disabled if not needed
  const ipv6Disabled = extractSysctlValue(output, "net.ipv6.conf.all.disable_ipv6");
  const net08: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_IPV6_DISABLED,
    category: "Network",
    name: "IPv6 Disabled If Not Needed",
    severity: "info",
    passed: isNA ? false : ipv6Disabled === "1",
    currentValue: isNA
      ? "Unable to determine"
      : ipv6Disabled !== null
        ? `net.ipv6.conf.all.disable_ipv6 = ${ipv6Disabled}`
        : "Unable to determine",
    expectedValue: "net.ipv6.conf.all.disable_ipv6 = 1",
    fixCommand: "sysctl -w net.ipv6.conf.all.disable_ipv6=1 && echo 'net.ipv6.conf.all.disable_ipv6=1' >> /etc/sysctl.conf",
    safeToAutoFix: "GUARDED",
    explain: "Disabling IPv6 if not in use reduces attack surface and avoids misconfigured IPv6 stack vulnerabilities. GUARDED: may break SSH if server uses IPv6 for connectivity.",
  };

  // NET-09: Send redirects disabled
  const sendRedirectsNet = extractSysctlValue(output, "net.ipv4.conf.all.send_redirects");
  const net09: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND,
    category: "Network",
    name: "ICMP Redirect Sending Disabled",
    severity: "warning",
    passed: isNA ? false : sendRedirectsNet === "0",
    currentValue: isNA
      ? "Unable to determine"
      : sendRedirectsNet !== null
        ? `net.ipv4.conf.all.send_redirects = ${sendRedirectsNet}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.send_redirects = 0",
    fixCommand: "sysctl -w net.ipv4.conf.all.send_redirects=0 && echo 'net.ipv4.conf.all.send_redirects=0' >> /etc/sysctl.conf",
    safeToAutoFix: "SAFE",
    explain: "Sending ICMP redirects is only needed for routers and can be exploited to redirect traffic on endpoints.",
  };

  // NET-10: Secure redirects disabled
  const secureRedirectsNet = extractSysctlValue(output, "net.ipv4.conf.all.secure_redirects");
  const net10: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT,
    category: "Network",
    name: "Secure ICMP Redirects Disabled",
    severity: "warning",
    passed: isNA ? false : secureRedirectsNet === "0",
    currentValue: isNA
      ? "Unable to determine"
      : secureRedirectsNet !== null
        ? `net.ipv4.conf.all.secure_redirects = ${secureRedirectsNet}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.secure_redirects = 0",
    fixCommand: "sysctl -w net.ipv4.conf.all.secure_redirects=0 && echo 'net.ipv4.conf.all.secure_redirects=0' >> /etc/sysctl.conf",
    safeToAutoFix: "SAFE",
    explain: "Secure ICMP redirects from gateways can still be exploited to manipulate routing on non-router systems.",
  };

  // NET-11: IPv6 source routing disabled
  const ipv6SourceRoute = extractSysctlValue(output, "net.ipv6.conf.all.accept_source_route");
  const net11: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6,
    category: "Network",
    name: "IPv6 Source Routing Disabled",
    severity: "warning",
    passed: isNA ? false : ipv6SourceRoute === "0",
    currentValue: isNA
      ? "Unable to determine"
      : ipv6SourceRoute !== null
        ? `net.ipv6.conf.all.accept_source_route = ${ipv6SourceRoute}`
        : "Unable to determine",
    expectedValue: "net.ipv6.conf.all.accept_source_route = 0",
    fixCommand: "sysctl -w net.ipv6.conf.all.accept_source_route=0 && echo 'net.ipv6.conf.all.accept_source_route=0' >> /etc/sysctl.conf",
    safeToAutoFix: "SAFE",
    explain: "IPv6 source routing allows an attacker to specify the path a packet should take, enabling traffic interception.",
  };

  // NET-12: Martian packet logging
  const logMartiansNet = extractSysctlValue(output, "net.ipv4.conf.all.log_martians");
  const net12: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING,
    category: "Network",
    name: "Martian Packet Logging Enabled",
    severity: "info",
    passed: isNA ? false : logMartiansNet === "1",
    currentValue: isNA
      ? "Unable to determine"
      : logMartiansNet !== null
        ? `net.ipv4.conf.all.log_martians = ${logMartiansNet}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.log_martians = 1",
    fixCommand: "sysctl -w net.ipv4.conf.all.log_martians=1 && echo 'net.ipv4.conf.all.log_martians=1' >> /etc/sysctl.conf",
    safeToAutoFix: "SAFE",
    explain: "Logging martian packets helps detect spoofed or malformed packets that indicate network anomalies.",
  };

  // NET-13: No management ports exposed on 0.0.0.0
  const noExposedMgmt = output.includes("NONE") || !/:8080 |:8443 |:9000 |:3000 /.test(output);
  const net13: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS,
    category: "Network",
    name: "No Management Ports Exposed Publicly",
    severity: "warning",
    passed: isNA ? false : noExposedMgmt,
    currentValue: isNA
      ? "Unable to determine"
      : noExposedMgmt
        ? "No management ports (8080, 8443, 9000, 3000) on 0.0.0.0"
        : "Management port(s) exposed on 0.0.0.0",
    expectedValue: "Ports 8080, 8443, 9000, 3000 not exposed on 0.0.0.0",
    fixCommand: "ufw deny 8080/tcp && ufw deny 8443/tcp && ufw deny 9000/tcp && ufw deny 3000/tcp",
    safeToAutoFix: "SAFE",
    explain: "Management and development ports exposed publicly are frequent targets for exploitation and unauthorized access.",
  };

  // NET-14: Reverse path filter enabled
  const rpFilterNet = extractSysctlValue(output, "net.ipv4.conf.all.rp_filter");
  const net14: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_RP_FILTER,
    category: "Network",
    name: "Reverse Path Filtering Enabled",
    severity: "warning",
    passed: isNA ? false : isPlatform ? rpFilterNet === "1" || rpFilterNet === "2" : rpFilterNet === "1",
    currentValue: isNA
      ? "Unable to determine"
      : rpFilterNet !== null
        ? `net.ipv4.conf.all.rp_filter = ${rpFilterNet}`
        : "Unable to determine",
    expectedValue: isPlatform ? "net.ipv4.conf.all.rp_filter = 1 or 2 (loose mode ok for Docker)" : "net.ipv4.conf.all.rp_filter = 1",
    fixCommand: isPlatform
      ? "sysctl -w net.ipv4.conf.all.rp_filter=2 && echo 'net.ipv4.conf.all.rp_filter=2' >> /etc/sysctl.conf"
      : "sysctl -w net.ipv4.conf.all.rp_filter=1 && echo 'net.ipv4.conf.all.rp_filter=1' >> /etc/sysctl.conf",
    explain: isPlatform
      ? "Reverse path filtering validates source addresses. Loose mode (2) is required for Docker Swarm IPVS ingress mesh."
      : "Reverse path filtering drops packets with spoofed source addresses, preventing IP spoofing attacks.",
  };

  // NET-16: No unnecessary mail ports open
  // ss -tlnp | grep -E ':25 |:110 |:143 ' output
  const mailPortsNone = output.split("\n").some((l) => l.trim() === "NONE");
  const mailPortsFound = !mailPortsNone && /:(25|110|143)\s/.test(output);
  const net16: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS,
    category: "Network",
    name: "No Unnecessary Mail Ports Open",
    severity: "info",
    passed: isNA ? false : !mailPortsFound,
    currentValue: isNA
      ? "Unable to determine"
      : mailPortsFound
        ? "Mail service port(s) (25/110/143) detected"
        : "No unexpected mail ports open",
    expectedValue: "Ports 25, 110, 143 not listening (unless mail server)",
    fixCommand: "systemctl stop postfix sendmail dovecot 2>/dev/null; ufw deny 25/tcp && ufw deny 110/tcp && ufw deny 143/tcp",
    safeToAutoFix: "SAFE",
    explain: "Open mail service ports on a non-mail server indicate unnecessary services that increase attack surface.",
  };

  // NET-17: Total listening services count reasonable
  // Count 0.0.0.0 and :: listening TCP services from ss output
  const listeningCount = (output.match(/(?:0\.0\.0\.0|::|\*):(\d+)/g) ?? []).length;
  const net17: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT,
    category: "Network",
    name: "Listening Services Count Reasonable",
    severity: "info",
    passed: isNA ? false : listeningCount < 20,
    currentValue: isNA
      ? "Unable to determine"
      : `${listeningCount} listening TCP services detected`,
    expectedValue: "Fewer than 20 listening TCP services",
    fixCommand: "# Review: ss -tlnp — close unnecessary ports or restrict with firewall: ufw deny PORT",
    safeToAutoFix: "GUARDED",
    explain: "Excessive listening services indicate poor service hygiene and increase the network attack surface.",
  };

  // NET-18: No promiscuous network interfaces
  // ip link show | grep -i 'PROMISC' output
  const promiscNone = output.split("\n").some((l) => l.trim() === "NONE");
  const hasPromiscuousIface = !promiscNone && /PROMISC/i.test(output);
  const net18: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES,
    category: "Network",
    name: "No Promiscuous Mode Interfaces",
    severity: "warning",
    passed: isNA ? false : !hasPromiscuousIface,
    currentValue: isNA
      ? "Unable to determine"
      : hasPromiscuousIface
        ? "Promiscuous mode interface(s) detected"
        : "No promiscuous mode interfaces",
    expectedValue: "No network interfaces in PROMISC mode",
    fixCommand: "ip link set <interface> promisc off  # Replace <interface> with interface name",
    safeToAutoFix: "SAFE",
    explain: "Promiscuous mode interfaces capture all network traffic, potentially indicating network sniffing malware.",
  };

  // NET-19: ARP announce protection (net.ipv4.conf.all.arp_announce = 2)
  const arpAnnounce = extractSysctlValue(output, "net.ipv4.conf.all.arp_announce");
  const net19: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE,
    category: "Network",
    name: "ARP Announce Protection Enabled",
    severity: "warning",
    passed: isNA ? false : arpAnnounce === "2",
    currentValue: isNA
      ? "Unable to determine"
      : arpAnnounce !== null
        ? `net.ipv4.conf.all.arp_announce = ${arpAnnounce}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.arp_announce = 2",
    fixCommand: "sysctl -w net.ipv4.conf.all.arp_announce=2 && echo 'net.ipv4.conf.all.arp_announce = 2' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain: "Setting arp_announce=2 prevents ARP spoofing by ensuring source addresses in ARP replies match the interface address.",
  };

  // NET-20: ARP ignore protection (net.ipv4.conf.all.arp_ignore >= 1)
  const arpIgnore = extractSysctlValue(output, "net.ipv4.conf.all.arp_ignore");
  const arpIgnoreVal = arpIgnore !== null ? parseInt(arpIgnore, 10) : null;
  const net20: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_ARP_IGNORE,
    category: "Network",
    name: "ARP Ignore Protection Enabled",
    severity: "warning",
    passed: isNA ? false : arpIgnoreVal !== null && arpIgnoreVal >= 1,
    currentValue: isNA
      ? "Unable to determine"
      : arpIgnore !== null
        ? `net.ipv4.conf.all.arp_ignore = ${arpIgnore}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.arp_ignore >= 1",
    fixCommand: "sysctl -w net.ipv4.conf.all.arp_ignore=1 && echo 'net.ipv4.conf.all.arp_ignore = 1' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain: "Setting arp_ignore=1 prevents ARP cache poisoning by only responding to requests targeting the receiving interface's address.",
  };

  // NET-22: TCP wrappers have active rules in hosts.allow
  // cat /etc/hosts.allow | grep non-comment/non-empty lines output — "EMPTY" if no rules
  const tcpWrappersOutput = output.split("\n").find((l) => l.trim() === "EMPTY" || (l.includes(":") && !l.startsWith("#")));
  const hasTcpWrapperRules = tcpWrappersOutput !== undefined
    && tcpWrappersOutput.trim() !== "EMPTY"
    && tcpWrappersOutput.trim() !== "";
  const net22: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED,
    category: "Network",
    name: "TCP Wrappers Active Rules Present",
    severity: "info",
    passed: isNA ? false : hasTcpWrapperRules,
    currentValue: isNA
      ? "Unable to determine"
      : hasTcpWrapperRules
        ? "Active rules found in /etc/hosts.allow"
        : "No active rules in /etc/hosts.allow",
    expectedValue: "At least one active access control rule in /etc/hosts.allow",
    fixCommand: "echo 'sshd: 10.0.0.0/8' >> /etc/hosts.allow && echo 'ALL: ALL' >> /etc/hosts.deny",
    safeToAutoFix: "SAFE",
    explain: "TCP wrappers provide an additional layer of access control for network services beyond firewall rules.",
  };

  // NET-23: Total listening port count reasonable
  // ss -tlnp | grep -c ':' output — total listening port count
  const portCountLines = output.split("\n");
  let totalListeningCount: number | null = null;
  for (const line of portCountLines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      const val = parseInt(trimmed, 10);
      // Plausible total ss port count (1-200)
      if (val >= 0 && val < 200) {
        totalListeningCount = val;
        break;
      }
    }
  }
  const net23: AuditCheck = {
    id: CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT,
    category: "Network",
    name: "Listening Port Count Reasonable",
    severity: "info",
    passed: isNA ? false : totalListeningCount === null || totalListeningCount <= 20,
    currentValue: isNA
      ? "Unable to determine"
      : totalListeningCount !== null
        ? `${totalListeningCount} listening TCP ports`
        : "Port count not determinable",
    expectedValue: "20 or fewer listening TCP ports",
    fixCommand: "ss -tlnp — review and close unnecessary listening ports",
    safeToAutoFix: "SAFE",
    explain: "Excessive listening ports indicate unnecessary services, each representing a potential attack vector.",
  };

  return [net01, net02, net03, net04, net05, net06, net07, net08, net09, net10, net11, net12, net13, net14, net16, net17, net18, net19, net20, net22, net23];
};
