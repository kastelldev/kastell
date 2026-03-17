/**
 * Firewall check parser.
 * Parses ufw status verbose output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";

/** Dangerous ports that should not be exposed to 0.0.0.0/0 (except SSH 22, HTTP 80, HTTPS 443) */
const SAFE_PUBLIC_PORTS = new Set(["22", "80", "443"]);

/**
 * Extract the numeric value immediately following a sentinel marker in SSH output.
 * Intentionally local to this file — only used by firewall checks (4 calls).
 * Not extracted to a shared utility because no other parser uses this sentinel→number pattern.
 */
function extractSentinelValue(output: string, sentinel: string): number | null {
  const idx = output.indexOf(sentinel);
  if (idx === -1) return null;
  const afterSentinel = output.slice(idx + sentinel.length);
  const match = afterSentinel.match(/^\s*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

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
  const nftSection = lines.some((l) => /\btables?\b|\bchains?\b|counter/.test(l));
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
  const iptablesCount = extractSentinelValue(output, "---IPTABLES_COUNT---") ?? 0;
  const hasIptablesRules = iptablesCount > 8;
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
  const hasRejectRules = /REJECT/.test(output);
  const fw10: AuditCheck = {
    id: "FW-REJECT-NOT-DROP",
    category: "Firewall",
    name: "REJECT Rules Present",
    severity: "info",
    passed: isNA ? false : hasRejectRules,
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
    passed: isNA ? false : hasRestrictedOutput,
    currentValue: isNA ? "Unable to determine" : hasRestrictedOutput ? "OUTPUT chain restricted" : "OUTPUT chain not restricted",
    expectedValue: "Consider restricting outbound traffic",
    fixCommand: "iptables -P OUTPUT DROP && iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT",
    explain: "Restricting outbound traffic limits damage from compromised services attempting to exfiltrate data.",
  };

  // FW-12: Rate limiting rules present
  const hasRateLimit = output.split("\n").some((l) => /limit/.test(l) && l.trim() !== "NONE");
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

  // FW-13: FORWARD chain default policy DROP
  const forwardPolicyLine = output.split("\n").find((l) => /Chain FORWARD.*policy/.test(l)) ?? "";
  const hasForwardDeny = /policy DROP|policy REJECT/i.test(forwardPolicyLine);
  const fw13: AuditCheck = {
    id: "FW-FORWARD-CHAIN-DENY",
    category: "Firewall",
    name: "FORWARD Chain Default Deny",
    severity: "warning",
    passed: isNA ? false : hasForwardDeny,
    currentValue: isNA
      ? "Unable to determine"
      : forwardPolicyLine.trim() || "No FORWARD policy found",
    expectedValue: "Chain FORWARD (policy DROP) or (policy REJECT)",
    fixCommand: "iptables -P FORWARD DROP",
    explain:
      "FORWARD chain default ACCEPT allows unintended traffic routing through the host, potentially bypassing network segmentation.",
  };

  // FW-14: IPv6 traffic filtered or disabled
  const ipv6RuleCount = extractSentinelValue(output, "---IPV6_RULE_COUNT---") ?? 0;
  // IPv6 disabled sysctl
  const ipv6SysctlDisabled = /disable_ipv6\s*=\s*1/.test(output);
  const fw14: AuditCheck = {
    id: "FW-IPV6-DISABLED-OR-FILTERED",
    category: "Firewall",
    name: "IPv6 Disabled or Filtered",
    severity: "info",
    passed: isNA ? false : ipv6SysctlDisabled || ipv6RuleCount > 3,
    currentValue: isNA
      ? "Unable to determine"
      : ipv6SysctlDisabled
        ? "IPv6 disabled via sysctl"
        : `ip6tables INPUT rules: ${ipv6RuleCount}`,
    expectedValue: "IPv6 disabled or ip6tables has rules (> 3 lines)",
    fixCommand: "ip6tables -P INPUT DROP && ip6tables -P FORWARD DROP && ip6tables -P OUTPUT ACCEPT",
    explain:
      "Unfiltered IPv6 traffic can bypass IPv4 firewall rules on dual-stack systems.",
  };

  // FW-15: No wildcard ACCEPT rule in INPUT chain
  const hasWildcardAccept = /ACCEPT\s+all\s+--\s+0\.0\.0\.0\/0\s+0\.0\.0\.0\/0\s*$/.test(output);
  const fw15: AuditCheck = {
    id: "FW-NO-WILDCARD-ACCEPT",
    category: "Firewall",
    name: "No Unrestricted ACCEPT All Rule",
    severity: "warning",
    passed: isNA ? false : !hasWildcardAccept,
    currentValue: isNA
      ? "Unable to determine"
      : hasWildcardAccept
        ? "Wildcard ACCEPT all rule found in INPUT chain"
        : "No unrestricted ACCEPT all rule found",
    expectedValue: "No 'ACCEPT all -- 0.0.0.0/0 0.0.0.0/0' rule without restrictions",
    fixCommand: "iptables -D INPUT -j ACCEPT  # Remove and replace with specific allow rules",
    explain:
      "A wildcard ACCEPT rule in the INPUT chain bypasses all other security rules, effectively disabling the firewall.",
  };

  // FW-16: conntrack max value
  const conntrackMax = extractSentinelValue(output, "---CONNTRACK_MAX---");
  const fw16: AuditCheck = {
    id: "FW-CONNTRACK-MAX",
    category: "Firewall",
    name: "Connection Tracking Limit Adequate",
    severity: "info",
    passed: isNA ? false : conntrackMax !== null ? conntrackMax >= 65536 : false,
    currentValue: isNA
      ? "Unable to determine"
      : conntrackMax !== null
        ? `nf_conntrack_max = ${conntrackMax}`
        : "Connection tracking not available",
    expectedValue: "nf_conntrack_max >= 65536",
    fixCommand: "echo 262144 > /proc/sys/net/netfilter/nf_conntrack_max && echo 'net.netfilter.nf_conntrack_max = 262144' >> /etc/sysctl.d/99-kastell.conf",
    explain: "Low connection tracking limits cause packet drops under load, which can be exploited for denial-of-service.",
  };

  // FW-17: LOG rule count for dropped packets
  const logRuleCount = extractSentinelValue(output, "---LOG_RULE_COUNT---");
  const fw17: AuditCheck = {
    id: "FW-LOG-DROPPED",
    category: "Firewall",
    name: "Dropped Packets Logged",
    severity: "info",
    passed: isNA ? false : logRuleCount !== null ? logRuleCount > 0 : false,
    currentValue: isNA
      ? "Unable to determine"
      : logRuleCount !== null
        ? logRuleCount > 0 ? `${logRuleCount} LOG rule(s) in iptables` : "No LOG rules found in iptables"
        : "LOG rule count not determinable",
    expectedValue: "At least 1 LOG rule in iptables for forensic evidence",
    fixCommand: "iptables -A INPUT -j LOG --log-prefix \"iptables-dropped: \" --log-level 4",
    explain: "Logging dropped firewall packets provides forensic evidence of attack attempts and helps identify malicious traffic patterns.",
  };

  return [fw01, fw02, fw03, fw04, fw05, fw06, fw07, fw08, fw09, fw10, fw11, fw12, fw13, fw14, fw15, fw16, fw17];
};
