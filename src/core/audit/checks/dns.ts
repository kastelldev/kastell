/**
 * DNS Security check parser.
 * Parses DNSSEC status, DoH/DoT tool presence, resolv.conf protection,
 * and nameserver configuration into 4 security checks.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface DnsCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const DNS_CHECKS: DnsCheckDef[] = [
  {
    id: CHECK_IDS.DNS.DNS_DNSSEC_ENABLED,
    name: "DNSSEC Validation Enabled",
    severity: "warning",
    check: (output) => {
      if (output.includes("DNSSEC_ENABLED")) {
        return { passed: true, currentValue: "DNSSEC validation is enabled" };
      }
      if (output.includes("DNSSEC_DISABLED")) {
        return { passed: false, currentValue: "DNSSEC validation is disabled" };
      }
      return { passed: false, currentValue: "DNSSEC status could not be determined" };
    },
    expectedValue: "DNSSEC=yes in systemd-resolved config or resolv.conf has edns0/trust-ad",
    fixCommand: "# For systemd-resolved: set DNSSEC=yes in /etc/systemd/resolved.conf then systemctl restart systemd-resolved",
    safeToAutoFix: "GUARDED",
    explain:
      "DNSSEC validation prevents DNS cache poisoning and man-in-the-middle attacks by verifying cryptographic signatures on DNS responses. Without it, DNS responses can be spoofed to redirect traffic to malicious servers.",
  },
  {
    id: CHECK_IDS.DNS.DNS_DOH_DOT_AVAILABLE,
    name: "DNS over HTTPS/TLS Tool Installed",
    severity: "info",
    check: (output) => {
      // DOH_DOT_TOOL_INSTALLED:<tool>
      const match = output.match(/DOH_DOT_TOOL_INSTALLED:(\S+)/);
      if (match) {
        return { passed: true, currentValue: `DoH/DoT tool installed: ${match[1]}` };
      }
      if (output.includes("DOH_DOT_TOOL_NOT_INSTALLED")) {
        return { passed: false, currentValue: "No DoH/DoT tool installed (stubby, dnscrypt-proxy)" };
      }
      return { passed: false, currentValue: "DoH/DoT tool presence could not be determined" };
    },
    expectedValue: "stubby or dnscrypt-proxy is installed on the system",
    fixCommand: "apt-get install -y stubby || apt-get install -y dnscrypt-proxy",
    safeToAutoFix: "SAFE",
    explain:
      "DNS over HTTPS (DoH) and DNS over TLS (DoT) encrypt DNS queries preventing network-level DNS interception and manipulation. Installing a DoH/DoT resolver protects DNS traffic from passive surveillance and active tampering.",
  },
  {
    id: CHECK_IDS.DNS.DNS_RESOLV_IMMUTABLE,
    name: "/etc/resolv.conf Protected from Modification",
    severity: "warning",
    check: (output) => {
      if (output.includes("RESOLV_CONF_IMMUTABLE")) {
        return { passed: true, currentValue: "/etc/resolv.conf is immutable or managed by systemd" };
      }
      if (output.includes("RESOLV_CONF_MUTABLE")) {
        return { passed: false, currentValue: "/etc/resolv.conf is not protected — can be overwritten" };
      }
      return { passed: false, currentValue: "/etc/resolv.conf protection status could not be determined" };
    },
    expectedValue: "/etc/resolv.conf has chattr +i flag or is a symlink to /run/systemd/resolve/stub-resolv.conf",
    fixCommand: "# Preferred: ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf\n# Alternative: chattr +i /etc/resolv.conf",
    safeToAutoFix: "GUARDED",
    explain:
      "An unprotected /etc/resolv.conf can be overwritten by DHCP clients, network managers, or malicious processes to redirect all DNS queries to an attacker-controlled resolver, enabling DNS hijacking without any kernel compromise.",
  },
  {
    id: CHECK_IDS.DNS.DNS_NAMESERVER_CONFIGURED,
    name: "Nameserver Configured in resolv.conf",
    severity: "warning",
    check: (output) => {
      // NAMESERVER_CONFIGURED:<ip>
      const match = output.match(/NAMESERVER_CONFIGURED:(\S+)/);
      if (match) {
        return { passed: true, currentValue: `Nameserver configured: ${match[1]}` };
      }
      if (output.includes("NAMESERVER_NOT_CONFIGURED")) {
        return { passed: false, currentValue: "No nameserver entry found in /etc/resolv.conf" };
      }
      return { passed: false, currentValue: "Nameserver configuration could not be determined" };
    },
    expectedValue: "At least one nameserver line present in /etc/resolv.conf",
    fixCommand: "echo 'nameserver 1.1.1.1' >> /etc/resolv.conf",
    safeToAutoFix: "SAFE",
    explain:
      "A nameserver must be configured in /etc/resolv.conf for the system to perform DNS lookups. Without it, domain name resolution fails entirely, breaking all network services that rely on hostnames rather than IP addresses.",
  },
  {
    id: CHECK_IDS.DNS.DNS_MULTIPLE_NAMESERVERS,
    name: "Multiple DNS Nameservers Configured",
    severity: "info",
    check: (output) => {
      // grep -c 'nameserver' /etc/resolv.conf returns a count
      const countMatch = output.match(/\b(\d+)\b/);
      if (!countMatch) {
        return { passed: false, currentValue: "Unable to determine nameserver count" };
      }
      const count = parseInt(countMatch[1], 10);
      const passed = count >= 2;
      return {
        passed,
        currentValue: passed
          ? `${count} nameserver(s) configured in /etc/resolv.conf`
          : `Only ${count} nameserver configured — single point of failure`,
      };
    },
    expectedValue: "At least 2 nameservers in /etc/resolv.conf for redundancy",
    fixCommand: "echo 'nameserver 8.8.8.8' >> /etc/resolv.conf  # Add secondary DNS",
    safeToAutoFix: "SAFE",
    explain:
      "A single DNS nameserver creates a single point of failure; multiple servers ensure DNS resolution survives outages.",
  },
  {
    id: CHECK_IDS.DNS.DNS_RESOLV_NOT_LOCALHOST_ONLY,
    name: "DNS Resolution Not Limited to Localhost Only",
    severity: "info",
    check: (output) => {
      // Parse resolv.conf content for nameserver lines
      const nameserverLines = output.split("\n").filter((l) => /^\s*nameserver\s+/i.test(l));
      if (nameserverLines.length === 0) {
        return { passed: false, currentValue: "No nameserver entries found in /etc/resolv.conf" };
      }
      // Check if any nameserver is not localhost
      const hasNonLocalhost = nameserverLines.some((l) => {
        const ip = l.replace(/^\s*nameserver\s+/i, "").trim();
        return ip !== "127.0.0.1" && ip !== "::1" && ip !== "127.0.0.53";
      });
      // Also check if a local resolver is in use (127.0.0.53 = systemd-resolved is fine)
      const hasLocalResolver = nameserverLines.some((l) => l.includes("127.0.0.53"));
      const passed = hasNonLocalhost || hasLocalResolver;
      return {
        passed,
        currentValue: passed
          ? "DNS configured with external or managed local resolver"
          : "DNS resolution limited to raw localhost — no external nameserver or managed resolver",
      };
    },
    expectedValue: "At least one nameserver is external or uses systemd-resolved (127.0.0.53)",
    fixCommand: "echo 'nameserver 1.1.1.1' >> /etc/resolv.conf",
    safeToAutoFix: "SAFE",
    explain:
      "DNS resolution relying solely on localhost without a running resolver causes total DNS failure.",
  },
  {
    id: CHECK_IDS.DNS.DNS_LOCAL_RESOLVER_ACTIVE,
    name: "systemd-resolved Local Resolver Active",
    severity: "info",
    check: (output) => {
      // systemctl is-active systemd-resolved output — "active" or "inactive"
      const isActive = /^active$/im.test(output);
      return {
        passed: isActive,
        currentValue: isActive ? "systemd-resolved is active" : "systemd-resolved is inactive",
      };
    },
    expectedValue: "systemd-resolved service is active",
    fixCommand: "systemctl enable --now systemd-resolved",
    safeToAutoFix: "GUARDED",
    explain:
      "A local DNS resolver provides caching, DNSSEC validation, and protection against DNS cache poisoning from upstream resolvers.",
  },
  {
    id: CHECK_IDS.DNS.DNS_SEARCH_DOMAIN_SET,
    name: "DNS Search Domain Configured",
    severity: "info",
    check: (output) => {
      // grep -E 'search\s+' /etc/resolv.conf output — matching line or NONE
      const hasSearch = /^\s*search\s+\S+/im.test(output) && !output.includes("NONE");
      return {
        passed: hasSearch,
        currentValue: hasSearch
          ? "DNS search domain is configured in /etc/resolv.conf"
          : "No search domain configured in /etc/resolv.conf",
      };
    },
    expectedValue: "A search domain is configured in /etc/resolv.conf",
    fixCommand: "echo 'search example.com' >> /etc/resolv.conf",
    safeToAutoFix: "SAFE",
    explain:
      "A configured search domain prevents DNS queries from leaking internal hostnames to external resolvers.",
  },
];

export const parseDnsChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return DNS_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "DNS Security",
        name: def.name,
        severity: def.severity,
        passed: false,
        currentValue: "Unable to determine",
        expectedValue: def.expectedValue,
        fixCommand: def.fixCommand,
        safeToAutoFix: def.safeToAutoFix,
        explain: def.explain,
      };
    }
    const { passed, currentValue } = def.check(output);
    return {
      id: def.id,
      category: "DNS Security",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      safeToAutoFix: def.safeToAutoFix,
      explain: def.explain,
    };
  });
};
