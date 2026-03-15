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

  return [net01, net02, net03, net04, net05];
};
