/**
 * Firewall check parser.
 * Parses ufw status verbose output into 5 security checks with semantic IDs.
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
    id: "FW-UFW-ACTIVE",
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
    id: "FW-DEFAULT-DENY",
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
    id: "FW-SSH-ALLOWED",
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
    const wideOpenMatch = line.match(/(\d+)\/tcp\s+ALLOW\s+IN\s+(?:0\.0\.0\.0\/0|Anywhere)/i);
    if (wideOpenMatch) {
      const port = wideOpenMatch[1];
      if (!SAFE_PUBLIC_PORTS.has(port)) {
        hasWideOpen = true;
        break;
      }
    }
  }
  const fw04: AuditCheck = {
    id: "FW-NO-WIDE-OPEN",
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
    id: "FW-IPV6-RULES",
    category: "Firewall",
    name: "IPv6 Firewall Rules",
    severity: "info",
    passed: isNA ? false : isActive,
    currentValue: isNA ? "Unable to determine" : ipv6Enabled ? "IPv6 rules present" : "IPv6 status unknown",
    expectedValue: "IPv6 firewall rules configured",
    fixCommand: "sed -i 's/IPV6=no/IPV6=yes/' /etc/default/ufw && ufw reload",
    explain: "IPv6 firewall rules prevent bypassing security through IPv6 connections.",
  };

  
  // FW-06: nftables available
  const nftOutput = sectionOutput.includes("nft") && !sectionOutput.includes("nft list ruleset") ? false :
    /tables+w+/.test(sectionOutput) || /chains+w+/.test(sectionOutput);
  const hasNftAvailable = /command -v nft/.test(sectionOutput) === false &&
    sectionOutput.includes("nft") && !sectionOutput.trim().endsWith("N/A");
  // Detect nft by checking output that is not just N/A
  const nftSection = (() => {
    const lines = sectionOutput.split("\n");
    const nftIdx = lines.findIndex((l) => /tables+|chains+|counter/.test(l));
    return nftIdx !== -1;
  })();
  const fw06: AuditCheck = {
    id: "FW-NFTABLES-PRESENT",
    category: "Firewall",
    name: "nftables Available",
    severity: "info",
    passed: nftSection,
    currentValue: nftSection ? "nftables ruleset present" : "nftables not detected",
    expectedValue: "nftables available as modern firewall",
    fixCommand: "apt install -y nftables && systemctl enable --now nftables",
    explain: "nftables is the modern replacement for iptables with improved performance and maintainability.",
  };

  // FW-07: fail2ban active (uses existing output from fail2ban-client status)
  const hasFail2banJails = /Number of jail/.test(output);
  const fw07: AuditCheck = {
    id: "FW-FAIL2BAN-ACTIVE",
    category: "Firewall",
    name: "Fail2ban Active",
    severity: "warning",
    passed: hasFail2banJails,
    currentValue: hasFail2banJails ? "fail2ban running with jails" : "fail2ban not active",
    expectedValue: "fail2ban running with at least one jail",
    fixCommand: "apt install -y fail2ban && systemctl enable --now fail2ban",
    explain: "fail2ban blocks brute-force attacks by banning IPs with repeated failed logins.",
  };

  // FW-08: iptables has rules beyond defaults (wc line > 8)
  const iptablesCountStr = output.split("\n").find((l) => /^d+$/.test(l.trim())) ?? "0";
  const iptablesCount = parseInt(iptablesCountStr, 10);
  const hasIptablesRules = !isNaN(iptablesCount) && iptablesCount > 8;
  const fw08: AuditCheck = {
    id: "FW-IPTABLES-BASELINE",
    category: "Firewall",
    name: "iptables Has Rules",
    severity: "warning",
    passed: hasIptablesRules,
    currentValue: isNA ? "Unable to determine" : `iptables line count: ${iptablesCount}`,
    expectedValue: "More than 8 iptables lines (non-empty chains)",
    fixCommand: "iptables -A INPUT -j DROP",
    explain: "An iptables ruleset with only default chains (< 8 lines) provides no real protection.",
  };

  // FW-09: iptables INPUT default policy DROP or REJECT
  const inputPolicyLine = output.split("\n").find((l) => /Chain INPUT.*policy/.test(l)) ?? "";
  const hasInputDeny = /policy DROP|policy REJECT/i.test(inputPolicyLine);
  const fw09: AuditCheck = {
    id: "FW-INPUT-CHAIN-DENY",
    category: "Firewall",
    name: "iptables INPUT Default Deny",
    severity: "critical",
    passed: hasInputDeny,
    currentValue: isNA ? "Unable to determine" : inputPolicyLine.trim() || "No INPUT policy found",
    expectedValue: "Chain INPUT (policy DROP) or (policy REJECT)",
    fixCommand: "iptables -P INPUT DROP",
    explain: "Setting iptables INPUT default policy to DROP ensures all inbound traffic is denied unless explicitly allowed.",
  };

  // FW-10: REJECT preferred over DROP (informational)
  const hasRejectRules = /REJECT/.test(output);
  const fw10: AuditCheck = {
    id: "FW-REJECT-NOT-DROP",
    category: "Firewall",
    name: "REJECT Rules Present",
    severity: "info",
    passed: isNA ? false : isActive,
    currentValue: hasRejectRules ? "REJECT rules present" : "No REJECT rules found (DROP-only)",
    expectedValue: "REJECT preferred for user-facing services",
    fixCommand: "iptables -A INPUT -j REJECT --reject-with icmp-port-unreachable",
    explain: "REJECT informs the client the port is closed, which is preferable for user-facing services.",
  };

  // FW-11: OUTPUT chain not fully open (informational)
  const outputPolicyLine = output.split("\n").find((l) => /Chain OUTPUT.*policy/.test(l)) ?? "";
  const hasRestrictedOutput = /policy DROP|policy REJECT/.test(outputPolicyLine);
  const fw11: AuditCheck = {
    id: "FW-OUTBOUND-RESTRICTED",
    category: "Firewall",
    name: "Outbound Traffic Restricted",
    severity: "info",
    passed: isNA ? false : isActive,
    currentValue: isNA ? "Unable to determine" : hasRestrictedOutput ? "OUTPUT chain restricted" : "OUTPUT chain not restricted",
    expectedValue: "Consider restricting outbound traffic",
    fixCommand: "iptables -P OUTPUT DROP && iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT",
    explain: "Restricting outbound traffic limits damage from compromised services attempting to exfiltrate data.",
  };

  // FW-12: Rate limiting rules present
  const hasRateLimit = /limit/.test(output) && !output.split("\n").filter((l) => /limit/.test(l)).every((l) => l.trim() === "NONE");
  const fw12: AuditCheck = {
    id: "FW-RATE-LIMIT",
    category: "Firewall",
    name: "Rate Limiting Rules Present",
    severity: "info",
    passed: hasRateLimit,
    currentValue: hasRateLimit ? "Rate limiting rules found" : "No rate limiting rules",
    expectedValue: "iptables rate limiting rules configured",
    fixCommand: "iptables -A INPUT -p tcp --dport 22 -m limit --limit 3/minute --limit-burst 3 -j ACCEPT",
    explain: "Rate limiting rules protect against brute-force and DoS attacks by throttling connection attempts.",
  };

  return [fw01, fw02, fw03, fw04, fw05, fw06, fw07, fw08, fw09, fw10, fw11, fw12];
};
