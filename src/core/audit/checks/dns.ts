/**
 * DNS Security check parser.
 * Parses DNSSEC status, DoH/DoT tool presence, resolv.conf protection,
 * and nameserver configuration into 4 security checks.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface DnsCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const DNS_CHECKS: DnsCheckDef[] = [
  {
    id: "DNS-DNSSEC-ENABLED",
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
    explain:
      "DNSSEC validation prevents DNS cache poisoning and man-in-the-middle attacks by verifying cryptographic signatures on DNS responses. Without it, DNS responses can be spoofed to redirect traffic to malicious servers.",
  },
  {
    id: "DNS-DOH-DOT-AVAILABLE",
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
    explain:
      "DNS over HTTPS (DoH) and DNS over TLS (DoT) encrypt DNS queries preventing network-level DNS interception and manipulation. Installing a DoH/DoT resolver protects DNS traffic from passive surveillance and active tampering.",
  },
  {
    id: "DNS-RESOLV-IMMUTABLE",
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
    explain:
      "An unprotected /etc/resolv.conf can be overwritten by DHCP clients, network managers, or malicious processes to redirect all DNS queries to an attacker-controlled resolver, enabling DNS hijacking without any kernel compromise.",
  },
  {
    id: "DNS-NAMESERVER-CONFIGURED",
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
    explain:
      "A nameserver must be configured in /etc/resolv.conf for the system to perform DNS lookups. Without it, domain name resolution fails entirely, breaking all network services that rely on hostnames rather than IP addresses.",
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
      explain: def.explain,
    };
  });
};
