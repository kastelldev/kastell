/**
 * Network check parser.
 * Parses ss/sysctl output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";

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
    id: "NET-NO-DANGEROUS-PORTS",
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
    id: "NET-DNS-RESOLVER",
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
    explain: "DNS resolution is required for package updates and security operations.",
  };

  // NET-03: NTP sync (check timedatectl output)
  const hasNTP = /NTP\s*synchronized:\s*yes/i.test(output) ||
    /System clock synchronized:\s*yes/i.test(output);
  const net03: AuditCheck = {
    id: "NET-TIME-SYNC",
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
    explain: "Time sync is critical for TLS certificates, logging accuracy, and security audit trails.",
  };

  // NET-04: IP forwarding (should be off for bare, ok for docker platforms)
  const ipForward = extractSysctlValue(output, "net.ipv4.ip_forward");
  const isPlatform = platform === "coolify" || platform === "dokploy";
  const forwardingOff = ipForward === "0";
  const net04: AuditCheck = {
    id: "NET-IP-FORWARDING",
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
    explain: isPlatform
      ? "IP forwarding is required for Docker networking on this platform."
      : "IP forwarding should be disabled unless the server is a router or runs Docker.",
  };

  // NET-05: TCP SYN cookies enabled
  const syncookies = extractSysctlValue(output, "net.ipv4.tcp_syncookies");
  const net05: AuditCheck = {
    id: "NET-SYN-COOKIES",
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
    explain: "SYN cookies protect against SYN flood denial-of-service attacks.",
  };

  // NET-06: hosts.allow exists
  const hostsAllowPresent = !output.includes("NO_HOSTS_ALLOW") && output.includes("hosts.allow") === false
    ? /^(?!NO_HOSTS_ALLOW).*\S/m.test(
        (() => {
          const idx = output.indexOf("NO_HOSTS_ALLOW");
          return idx === -1 ? "PRESENT" : "NO_HOSTS_ALLOW";
        })(),
      )
    : !output.includes("NO_HOSTS_ALLOW");
  const net06: AuditCheck = {
    id: "NET-HOSTS-ACCESS",
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
    explain: "TCP Wrappers hosts.allow defines allowed hosts for network services, providing an additional access control layer.",
  };

  // NET-07: hosts.deny has default deny (ALL : ALL)
  const hostsDenyAll = /ALL\s*:\s*ALL/i.test(output);
  const net07: AuditCheck = {
    id: "NET-HOSTS-DENY",
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
    explain: "A default deny rule in hosts.deny blocks all TCP wrapper-controlled services unless explicitly allowed.",
  };

  // NET-08: IPv6 disabled if not needed
  const ipv6Disabled = extractSysctlValue(output, "net.ipv6.conf.all.disable_ipv6");
  const net08: AuditCheck = {
    id: "NET-IPV6-DISABLED",
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
    explain: "Disabling IPv6 if not in use reduces attack surface and avoids misconfigured IPv6 stack vulnerabilities.",
  };

  // NET-09: Send redirects disabled
  const sendRedirectsNet = extractSysctlValue(output, "net.ipv4.conf.all.send_redirects");
  const net09: AuditCheck = {
    id: "NET-ICMP-REDIRECT-SEND",
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
    explain: "Sending ICMP redirects is only needed for routers and can be exploited to redirect traffic on endpoints.",
  };

  // NET-10: Secure redirects disabled
  const secureRedirectsNet = extractSysctlValue(output, "net.ipv4.conf.all.secure_redirects");
  const net10: AuditCheck = {
    id: "NET-ICMP-SECURE-REDIRECT",
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
    explain: "Secure ICMP redirects from gateways can still be exploited to manipulate routing on non-router systems.",
  };

  // NET-11: IPv6 source routing disabled
  const ipv6SourceRoute = extractSysctlValue(output, "net.ipv6.conf.all.accept_source_route");
  const net11: AuditCheck = {
    id: "NET-SOURCE-ROUTING-V6",
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
    explain: "IPv6 source routing allows an attacker to specify the path a packet should take, enabling traffic interception.",
  };

  // NET-12: Martian packet logging
  const logMartiansNet = extractSysctlValue(output, "net.ipv4.conf.all.log_martians");
  const net12: AuditCheck = {
    id: "NET-MARTIAN-LOGGING",
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
    explain: "Logging martian packets helps detect spoofed or malformed packets that indicate network anomalies.",
  };

  // NET-13: No management ports exposed on 0.0.0.0
  const noExposedMgmt = output.includes("NONE") || !/:8080 |:8443 |:9000 |:3000 /.test(output);
  const net13: AuditCheck = {
    id: "NET-NO-EXPOSED-MGMT-PORTS",
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
    explain: "Management and development ports exposed publicly are frequent targets for exploitation and unauthorized access.",
  };

  // NET-14: Reverse path filter enabled
  const rpFilterNet = extractSysctlValue(output, "net.ipv4.conf.all.rp_filter");
  const net14: AuditCheck = {
    id: "NET-RP-FILTER",
    category: "Network",
    name: "Reverse Path Filtering Enabled",
    severity: "warning",
    passed: isNA ? false : rpFilterNet === "1",
    currentValue: isNA
      ? "Unable to determine"
      : rpFilterNet !== null
        ? `net.ipv4.conf.all.rp_filter = ${rpFilterNet}`
        : "Unable to determine",
    expectedValue: "net.ipv4.conf.all.rp_filter = 1",
    fixCommand: "sysctl -w net.ipv4.conf.all.rp_filter=1 && echo 'net.ipv4.conf.all.rp_filter=1' >> /etc/sysctl.conf",
    explain: "Reverse path filtering drops packets with spoofed source addresses, preventing IP spoofing attacks.",
  };

  // NET-15: TCP SYN retries limited
  const synRetries = extractSysctlValue(output, "net.ipv4.tcp_syn_retries");
  const net15: AuditCheck = {
    id: "NET-TCP-SYN-RETRIES",
    category: "Network",
    name: "TCP SYN Retry Count Limited",
    severity: "info",
    passed: isNA ? false : synRetries !== null && parseInt(synRetries, 10) <= 3,
    currentValue: isNA
      ? "Unable to determine"
      : synRetries !== null
        ? `net.ipv4.tcp_syn_retries = ${synRetries}`
        : "Unable to determine",
    expectedValue: "net.ipv4.tcp_syn_retries <= 3",
    fixCommand: "sysctl -w net.ipv4.tcp_syn_retries=3 && echo 'net.ipv4.tcp_syn_retries=3' >> /etc/sysctl.conf",
    explain: "Limiting SYN retries reduces the time wasted on unanswered connection attempts and mitigates resource exhaustion.",
  };

  return [net01, net02, net03, net04, net05, net06, net07, net08, net09, net10, net11, net12, net13, net14, net15];
};
