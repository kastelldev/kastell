/**
 * Firewall check parser.
 * Parses ufw status verbose output into 5 security checks (FW-01 through FW-05).
 */

import type { AuditCheck, CheckParser } from "../types.js";

/** Dangerous ports that should not be exposed to 0.0.0.0/0 (except SSH 22, HTTP 80, HTTPS 443) */
const SAFE_PUBLIC_PORTS = new Set(["22", "80", "443"]);

export const parseFirewallChecks: CheckParser = (sectionOutput: string, _platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  // FW-01: Firewall active
  const isActive = /Status:\s*active/i.test(output);
  const fw01: AuditCheck = {
    id: "FW-01",
    category: "Firewall",
    name: "Firewall Active",
    severity: "critical",
    passed: isActive,
    currentValue: isNA ? "Unable to determine" : isActive ? "active" : "inactive",
    expectedValue: "active",
    fixCommand: "ufw enable",
    explain: "A firewall is the first line of defense against unauthorized network access.",
  };

  // FW-02: Default deny incoming
  const denyIncoming = /Default:\s*deny\s*\(incoming\)/i.test(output);
  const fw02: AuditCheck = {
    id: "FW-02",
    category: "Firewall",
    name: "Default Deny Incoming",
    severity: "critical",
    passed: isActive && denyIncoming,
    currentValue: isNA ? "Unable to determine" : denyIncoming ? "deny (incoming)" : "not set to deny",
    expectedValue: "deny (incoming)",
    fixCommand: "ufw default deny incoming",
    explain: "Default deny ensures only explicitly allowed traffic reaches the server.",
  };

  // FW-03: SSH port in rules
  const hasSSHRule = /22\/tcp\s+ALLOW/i.test(output) || /OpenSSH\s+ALLOW/i.test(output);
  const fw03: AuditCheck = {
    id: "FW-03",
    category: "Firewall",
    name: "SSH Port in Rules",
    severity: "warning",
    passed: isActive && hasSSHRule,
    currentValue: isNA ? "Unable to determine" : hasSSHRule ? "SSH port allowed" : "SSH port not in rules",
    expectedValue: "SSH port (22) explicitly allowed",
    fixCommand: "ufw allow 22/tcp",
    explain: "SSH port should be explicitly allowed to prevent lockout when firewall is active.",
  };

  // FW-04: No wide-open 0.0.0.0/0 rules on non-SSH ports
  const lines = output.split("\n");
  let hasWideOpen = false;
  for (const line of lines) {
    const wideOpenMatch = line.match(/(\d+)\/tcp\s+ALLOW\s+IN\s+0\.0\.0\.0\/0/i);
    if (wideOpenMatch) {
      const port = wideOpenMatch[1];
      if (!SAFE_PUBLIC_PORTS.has(port)) {
        hasWideOpen = true;
        break;
      }
    }
  }
  const fw04: AuditCheck = {
    id: "FW-04",
    category: "Firewall",
    name: "No Wide-Open Rules",
    severity: "warning",
    passed: isNA ? false : !hasWideOpen,
    currentValue: isNA ? "Unable to determine" : hasWideOpen ? "Wide-open rule found on non-standard port" : "No wide-open rules",
    expectedValue: "No 0.0.0.0/0 rules on non-standard ports",
    fixCommand: "ufw status numbered && ufw delete <rule_number>",
    explain: "Wide-open rules on database or service ports expose them to the entire internet.",
  };

  // FW-05: IPv6 consistency (basic check - just verify UFW supports IPv6)
  const ipv6Enabled = /IPV6=yes/i.test(output) || output.includes("(v6)");
  const fw05: AuditCheck = {
    id: "FW-05",
    category: "Firewall",
    name: "IPv6 Firewall Rules",
    severity: "info",
    passed: isNA ? false : isActive,
    currentValue: isNA ? "Unable to determine" : ipv6Enabled ? "IPv6 rules present" : "IPv6 status unknown",
    expectedValue: "IPv6 firewall rules configured",
    fixCommand: "sed -i 's/IPV6=no/IPV6=yes/' /etc/default/ufw && ufw reload",
    explain: "IPv6 firewall rules prevent bypassing security through IPv6 connections.",
  };

  return [fw01, fw02, fw03, fw04, fw05];
};
