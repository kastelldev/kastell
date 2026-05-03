import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseFirewallChecks } from "../../src/core/audit/checks/firewall.js";

describe("parseFirewallChecks", () => {
  const activeSecureOutput = [
    "Status: active",
    "Logging: on (low)",
    "Default: deny (incoming), allow (outgoing), disabled (routed)",
    "",
    "To                         Action      From",
    "--                         ------      ----",
    "22/tcp                     ALLOW IN    Anywhere",
    "80/tcp                     ALLOW IN    Anywhere",
    "443/tcp                    ALLOW IN    Anywhere",
    // nft output
    "table inet filter {",
    "  chain input {",
    "    type filter hook input priority 0; policy drop;",
    "  }",
    "}",
    // iptables INPUT chain with DROP policy
    "Chain INPUT (policy DROP 0 packets, 0 bytes)",
    "num  target     prot opt source               destination",
    "1    ACCEPT     all  --  0.0.0.0/0            0.0.0.0/0            state RELATED,ESTABLISHED",
    "2    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22",
    "Chain OUTPUT (policy ACCEPT 0 packets, 0 bytes)",
    // iptables rule count (sentinel-keyed)
    "---IPTABLES_COUNT---",
    "15",
    // fail2ban status
    "Status",
    "|- Number of jail: 2",
    "|  `- Jail list: sshd, apache",
    "|- Number of peers: 0",
    // rate limiting
    "ACCEPT     tcp  --  0.0.0.0/0  0.0.0.0/0  limit: avg 3/min burst 3",
    // FORWARD chain policy (FW-FORWARD-CHAIN-DENY)
    "Chain FORWARD (policy DROP 0 packets, 0 bytes)",
    // ip6tables INPUT line count (sentinel-keyed)
    "---IPV6_RULE_COUNT---",
    "5",
    // conntrack max (sentinel-keyed)
    "---CONNTRACK_MAX---",
    "131072",
    // LOG rule count (sentinel-keyed)
    "---LOG_RULE_COUNT---",
    "3",
  ].join("\n");

  const inactiveOutput = "Status: inactive";

  it("should return 17 checks for active firewall with deny default", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    expect(checks).toHaveLength(17);
    checks.forEach((check) => {
      expect(check.category).toBe("Firewall");
      expect(check.id).toMatch(/^FW-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return FW-UFW-ACTIVE and FW-DEFAULT-DENY passed for active deny-incoming firewall", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw01 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_UFW_ACTIVE);
    const fw02 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_DEFAULT_DENY);
    expect(fw01!.passed).toBe(true);
    expect(fw02!.passed).toBe(true);
  });

  it("should return FW-UFW-ACTIVE failed when firewall is inactive", () => {
    const checks = parseFirewallChecks(inactiveOutput, "bare");
    const fw01 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_UFW_ACTIVE);
    expect(fw01!.passed).toBe(false);
    expect(fw01!.severity).toBe("critical");
  });

  it("should return FW-SSH-ALLOWED passed when SSH port is in rules", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw03 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_SSH_ALLOWED);
    expect(fw03!.passed).toBe(true);
  });

  it("should return FW-NO-WIDE-OPEN passed when no wide-open 0.0.0.0/0 on non-SSH ports", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw04 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_NO_WIDE_OPEN);
    expect(fw04!.passed).toBe(true);
  });

  it("should return FW-NO-WIDE-OPEN failed when 0.0.0.0/0 rule on non-SSH port exists", () => {
    const wideOpen = [
      "Status: active",
      "Default: deny (incoming), allow (outgoing), disabled (routed)",
      "To                         Action      From",
      "--                         ------      ----",
      "3306/tcp                   ALLOW IN    0.0.0.0/0",
    ].join("\n");
    const checks = parseFirewallChecks(wideOpen, "bare");
    const fw04 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_NO_WIDE_OPEN);
    expect(fw04!.passed).toBe(false);
  });

  it("should return FW-INPUT-CHAIN-DENY passed when iptables INPUT policy is DROP", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw09 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_INPUT_CHAIN_DENY);
    expect(fw09!.passed).toBe(true);
    expect(fw09!.severity).toBe("critical");
  });

  it("should return FW-INPUT-CHAIN-DENY failed when iptables INPUT policy is ACCEPT", () => {
    const acceptPolicy = [
      "Status: active",
      "Chain INPUT (policy ACCEPT 0 packets, 0 bytes)",
    ].join("\n");
    const checks = parseFirewallChecks(acceptPolicy, "bare");
    const fw09 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_INPUT_CHAIN_DENY);
    expect(fw09!.passed).toBe(false);
  });

  it("should return FW-FAIL2BAN-ACTIVE passed when fail2ban reports jails", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw07 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_FAIL2BAN_ACTIVE);
    expect(fw07!.passed).toBe(true);
    expect(fw07!.severity).toBe("warning");
  });

  it("should return FW-RATE-LIMIT passed when rate limiting rules present", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw12 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_RATE_LIMIT);
    expect(fw12!.passed).toBe(true);
  });

  it("FW-FORWARD-CHAIN-DENY passes when FORWARD chain policy is DROP", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_FORWARD_CHAIN_DENY);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("FW-NO-WILDCARD-ACCEPT passes when no ACCEPT all wildcard rule", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_NO_WILDCARD_ACCEPT);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseFirewallChecks("N/A", "bare");
    expect(checks).toHaveLength(17);
    const fw01 = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_UFW_ACTIVE);
    expect(fw01!.passed).toBe(false);
  });

  it("FW-CONNTRACK-MAX passes when conntrack max is >= 65536", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_CONNTRACK_MAX);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/131072/);
  });

  it("FW-CONNTRACK-MAX fails when conntrack max is below 65536", () => {
    const output = activeSecureOutput.replace("---CONNTRACK_MAX---\n131072", "---CONNTRACK_MAX---\n1024");
    const checks = parseFirewallChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_CONNTRACK_MAX);
    expect(check!.passed).toBe(false);
  });

  it("FW-LOG-DROPPED passes when LOG rule count > 0", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_LOG_DROPPED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/LOG rule/);
  });

  it("FW-LOG-DROPPED fails when only 0 LOG rules", () => {
    // Use output with sentinel-keyed values
    const output = "Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\nChain INPUT (policy DROP 0 packets, 0 bytes)\n---CONNTRACK_MAX---\n131072\n---LOG_RULE_COUNT---\n0";
    const checks = parseFirewallChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_LOG_DROPPED);
    expect(check!.passed).toBe(false);
  });
});

describe("[MUTATION-KILLER] Firewall check string assertions", () => {
  const activeSecureOutput = [
    "Status: active",
    "Logging: on (low)",
    "Default: deny (incoming), allow (outgoing), disabled (routed)",
    "",
    "To                         Action      From",
    "--                         ------      ----",
    "22/tcp                     ALLOW IN    Anywhere",
    "80/tcp                     ALLOW IN    Anywhere",
    "443/tcp                    ALLOW IN    Anywhere",
    "table inet filter {",
    "  chain input {",
    "    type filter hook input priority 0; policy drop;",
    "  }",
    "}",
    "Chain INPUT (policy DROP 0 packets, 0 bytes)",
    "num  target     prot opt source               destination",
    "1    ACCEPT     all  --  0.0.0.0/0            0.0.0.0/0            state RELATED,ESTABLISHED",
    "2    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22",
    "Chain OUTPUT (policy ACCEPT 0 packets, 0 bytes)",
    "---IPTABLES_COUNT---",
    "15",
    "Status",
    "|- Number of jail: 2",
    "|  `- Jail list: sshd, apache",
    "|- Number of peers: 0",
    "ACCEPT     tcp  --  0.0.0.0/0  0.0.0.0/0  limit: avg 3/min burst 3",
    "Chain FORWARD (policy DROP 0 packets, 0 bytes)",
    "---IPV6_RULE_COUNT---",
    "5",
    "---CONNTRACK_MAX---",
    "131072",
    "---LOG_RULE_COUNT---",
    "3",
  ].join("\n");

  const checks = parseFirewallChecks(activeSecureOutput, "bare");

  const expectedChecks = [
    {
      id: CHECK_IDS.FIREWALL.FW_UFW_ACTIVE,
      name: "Firewall Active",
      severity: "critical",
      expectedValue: "active",
      fixCommand: "ufw enable",
      explain: "A firewall is the first line of defense against unauthorized network access.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_DEFAULT_DENY,
      name: "Default Deny Incoming",
      severity: "critical",
      expectedValue: "deny (incoming)",
      fixCommand: "ufw default deny incoming",
      explain: "Default deny ensures only explicitly allowed traffic reaches the server.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_SSH_ALLOWED,
      name: "SSH Port in Rules",
      severity: "warning",
      expectedValue: "SSH port (22) explicitly allowed",
      fixCommand: "ufw allow 22/tcp",
      explain: "SSH port should be explicitly allowed to prevent lockout when firewall is active.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_NO_WIDE_OPEN,
      name: "No Wide-Open Rules",
      severity: "warning",
      expectedValue: "No 0.0.0.0/0 rules on non-standard ports",
      fixCommand: "ufw status numbered && ufw delete <rule_number>",
      explain: "Wide-open rules on database or service ports expose them to the entire internet.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_IPV6_RULES,
      name: "IPv6 Firewall Rules",
      severity: "info",
      expectedValue: "IPv6 firewall rules configured",
      fixCommand: "sed -i 's/IPV6=no/IPV6=yes/' /etc/default/ufw && ufw reload",
      explain: "IPv6 firewall rules prevent bypassing security through IPv6 connections.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_NFTABLES_PRESENT,
      name: "nftables Available",
      severity: "info",
      expectedValue: "nftables available as modern firewall",
      fixCommand: "apt install -y nftables && systemctl enable --now nftables",
      explain: "nftables is the modern replacement for iptables with improved performance and maintainability.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_FAIL2BAN_ACTIVE,
      name: "Fail2ban Active",
      severity: "warning",
      expectedValue: "fail2ban running with at least one jail",
      fixCommand: "apt install -y fail2ban && systemctl enable --now fail2ban",
      explain: "fail2ban blocks brute-force attacks by banning IPs with repeated failed logins.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_IPTABLES_BASELINE,
      name: "iptables Has Rules",
      severity: "warning",
      expectedValue: "More than 8 iptables lines (non-empty chains)",
      fixCommand: "iptables -A INPUT -j DROP",
      explain: "An iptables ruleset with only default chains (< 8 lines) provides no real protection.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_INPUT_CHAIN_DENY,
      name: "iptables INPUT Default Deny",
      severity: "critical",
      expectedValue: "Chain INPUT (policy DROP) or (policy REJECT)",
      fixCommand: "iptables -P INPUT DROP",
      explain: "Setting iptables INPUT default policy to DROP ensures all inbound traffic is denied unless explicitly allowed.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_REJECT_NOT_DROP,
      name: "REJECT Rules Present",
      severity: "info",
      expectedValue: "REJECT preferred for user-facing services",
      fixCommand: "iptables -A INPUT -j REJECT --reject-with icmp-port-unreachable",
      explain: "REJECT informs the client the port is closed, which is preferable for user-facing services.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_OUTBOUND_RESTRICTED,
      name: "Outbound Traffic Restricted",
      severity: "info",
      expectedValue: "Consider restricting outbound traffic",
      fixCommand: "iptables -P OUTPUT DROP && iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT",
      explain: "Restricting outbound traffic limits damage from compromised services attempting to exfiltrate data.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_RATE_LIMIT,
      name: "Rate Limiting Rules Present",
      severity: "info",
      expectedValue: "iptables rate limiting rules configured",
      fixCommand: "iptables -A INPUT -p tcp --dport 22 -m limit --limit 3/minute --limit-burst 3 -j ACCEPT",
      explain: "Rate limiting rules protect against brute-force and DoS attacks by throttling connection attempts.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_FORWARD_CHAIN_DENY,
      name: "FORWARD Chain Default Deny",
      severity: "warning",
      expectedValue: "Chain FORWARD (policy DROP) or (policy REJECT)",
      fixCommand: "iptables -P FORWARD DROP",
      explain: "FORWARD chain default ACCEPT allows unintended traffic routing through the host, potentially bypassing network segmentation.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_IPV6_DISABLED_OR_FILTERED,
      name: "IPv6 Disabled or Filtered",
      severity: "info",
      expectedValue: "IPv6 disabled or ip6tables has rules (> 3 lines)",
      fixCommand: "ip6tables -P INPUT DROP && ip6tables -P FORWARD DROP && ip6tables -P OUTPUT ACCEPT",
      explain: "Unfiltered IPv6 traffic can bypass IPv4 firewall rules on dual-stack systems.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_NO_WILDCARD_ACCEPT,
      name: "No Unrestricted ACCEPT All Rule",
      severity: "warning",
      expectedValue: "No 'ACCEPT all -- 0.0.0.0/0 0.0.0.0/0' rule without restrictions",
      fixCommand: "iptables -D INPUT -j ACCEPT  # Remove and replace with specific allow rules",
      explain: "A wildcard ACCEPT rule in the INPUT chain bypasses all other security rules, effectively disabling the firewall.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_CONNTRACK_MAX,
      name: "Connection Tracking Limit Adequate",
      severity: "info",
      expectedValue: "nf_conntrack_max >= 65536",
      fixCommand: "echo 262144 > /proc/sys/net/netfilter/nf_conntrack_max && echo 'net.netfilter.nf_conntrack_max = 262144' >> /etc/sysctl.d/99-kastell.conf",
      explain: "Low connection tracking limits cause packet drops under load, which can be exploited for denial-of-service.",
    },
    {
      id: CHECK_IDS.FIREWALL.FW_LOG_DROPPED,
      name: "Dropped Packets Logged",
      severity: "info",
      expectedValue: "At least 1 LOG rule in iptables for forensic evidence",
      fixCommand: "iptables -A INPUT -j LOG --log-prefix \"iptables-dropped: \" --log-level 4",
      explain: "Logging dropped firewall packets provides forensic evidence of attack attempts and helps identify malicious traffic patterns.",
    },
  ];

  it("[MUTATION-KILLER] returns exactly 17 checks", () => {
    expect(checks).toHaveLength(17);
    expect(expectedChecks).toHaveLength(17);
  });

  expectedChecks.forEach((expected) => {
    describe(`${expected.id}`, () => {
      it("[MUTATION-KILLER] has correct id", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check).toBeDefined();
        expect(check!.id).toBe(expected.id);
      });

      it("[MUTATION-KILLER] has correct name", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.name).toBe(expected.name);
      });

      it("[MUTATION-KILLER] has correct severity", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.severity).toBe(expected.severity);
      });

      it("[MUTATION-KILLER] has correct category", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.category).toBe("Firewall");
      });

      it("[MUTATION-KILLER] has correct expectedValue", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.expectedValue).toBe(expected.expectedValue);
      });

      it("[MUTATION-KILLER] has correct fixCommand", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.fixCommand).toBe(expected.fixCommand);
      });

      it("[MUTATION-KILLER] has correct explain", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.explain).toBe(expected.explain);
      });

      it("[MUTATION-KILLER] has safeToAutoFix set to FORBIDDEN", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.safeToAutoFix).toBe("FORBIDDEN");
      });
    });
  });

  it("[MUTATION-KILLER] every check has non-empty fixCommand", () => {
    checks.forEach((c) => {
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty explain (> 10 chars)", () => {
    checks.forEach((c) => {
      expect(c.explain).toBeDefined();
      expect(c.explain!.length).toBeGreaterThan(10);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty name", () => {
    checks.forEach((c) => {
      expect(c.name.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty id", () => {
    checks.forEach((c) => {
      expect(c.id.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty expectedValue", () => {
    checks.forEach((c) => {
      expect(c.expectedValue.length).toBeGreaterThan(0);
    });
  });
});

describe("[MUTATION-KILLER] Firewall N/A output string assertions", () => {
  const naChecks = parseFirewallChecks("N/A", "bare");

  it("[MUTATION-KILLER] every N/A check has category Firewall", () => {
    naChecks.forEach((c) => {
      expect(c.category).toBe("Firewall");
    });
  });

  it("[MUTATION-KILLER] every N/A check has safeToAutoFix FORBIDDEN", () => {
    naChecks.forEach((c) => {
      expect(c.safeToAutoFix).toBe("FORBIDDEN");
    });
  });

  it("[MUTATION-KILLER] FW-UFW-ACTIVE N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_UFW_ACTIVE);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-DEFAULT-DENY N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_DEFAULT_DENY);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-SSH-ALLOWED N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_SSH_ALLOWED);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-NO-WIDE-OPEN N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_NO_WIDE_OPEN);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-IPTABLES-BASELINE N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_IPTABLES_BASELINE);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-INPUT-CHAIN-DENY N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_INPUT_CHAIN_DENY);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-OUTBOUND-RESTRICTED N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_OUTBOUND_RESTRICTED);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-IPV6-DISABLED-OR-FILTERED N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_IPV6_DISABLED_OR_FILTERED);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-NO-WILDCARD-ACCEPT N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_NO_WILDCARD_ACCEPT);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-CONNTRACK-MAX N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_CONNTRACK_MAX);
    expect(check!.currentValue).toBe("Unable to determine");
  });

  it("[MUTATION-KILLER] FW-LOG-DROPPED N/A currentValue is 'Unable to determine'", () => {
    const check = naChecks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_LOG_DROPPED);
    expect(check!.currentValue).toBe("Unable to determine");
  });
});

describe("[MUTATION-KILLER] Firewall currentValue strings for active output", () => {
  const activeSecureOutput = [
    "Status: active",
    "Logging: on (low)",
    "Default: deny (incoming), allow (outgoing), disabled (routed)",
    "",
    "To                         Action      From",
    "--                         ------      ----",
    "22/tcp                     ALLOW IN    Anywhere",
    "80/tcp                     ALLOW IN    Anywhere",
    "443/tcp                    ALLOW IN    Anywhere",
    "table inet filter {",
    "  chain input {",
    "    type filter hook input priority 0; policy drop;",
    "  }",
    "}",
    "Chain INPUT (policy DROP 0 packets, 0 bytes)",
    "num  target     prot opt source               destination",
    "1    ACCEPT     all  --  0.0.0.0/0            0.0.0.0/0            state RELATED,ESTABLISHED",
    "2    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22",
    "Chain OUTPUT (policy ACCEPT 0 packets, 0 bytes)",
    "---IPTABLES_COUNT---",
    "15",
    "Status",
    "|- Number of jail: 2",
    "|  `- Jail list: sshd, apache",
    "|- Number of peers: 0",
    "ACCEPT     tcp  --  0.0.0.0/0  0.0.0.0/0  limit: avg 3/min burst 3",
    "Chain FORWARD (policy DROP 0 packets, 0 bytes)",
    "---IPV6_RULE_COUNT---",
    "5",
    "---CONNTRACK_MAX---",
    "131072",
    "---LOG_RULE_COUNT---",
    "3",
  ].join("\n");

  const checks = parseFirewallChecks(activeSecureOutput, "bare");

  it("[MUTATION-KILLER] FW-UFW-ACTIVE currentValue is 'active'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_UFW_ACTIVE);
    expect(check!.currentValue).toBe("active");
  });

  it("[MUTATION-KILLER] FW-DEFAULT-DENY currentValue is 'deny (incoming)'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_DEFAULT_DENY);
    expect(check!.currentValue).toBe("deny (incoming)");
  });

  it("[MUTATION-KILLER] FW-SSH-ALLOWED currentValue is 'SSH port allowed'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_SSH_ALLOWED);
    expect(check!.currentValue).toBe("SSH port allowed");
  });

  it("[MUTATION-KILLER] FW-NO-WIDE-OPEN currentValue is 'No wide-open rules'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_NO_WIDE_OPEN);
    expect(check!.currentValue).toBe("No wide-open rules");
  });

  it("[MUTATION-KILLER] FW-NFTABLES-PRESENT currentValue is 'nftables ruleset present'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_NFTABLES_PRESENT);
    expect(check!.currentValue).toBe("nftables ruleset present");
  });

  it("[MUTATION-KILLER] FW-FAIL2BAN-ACTIVE currentValue is 'fail2ban running with jails'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_FAIL2BAN_ACTIVE);
    expect(check!.currentValue).toBe("fail2ban running with jails");
  });

  it("[MUTATION-KILLER] FW-RATE-LIMIT currentValue is 'Rate limiting rules found'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_RATE_LIMIT);
    expect(check!.currentValue).toBe("Rate limiting rules found");
  });

  it("[MUTATION-KILLER] FW-NO-WILDCARD-ACCEPT currentValue is 'No unrestricted ACCEPT all rule found'", () => {
    const check = checks.find((c) => c.id === CHECK_IDS.FIREWALL.FW_NO_WILDCARD_ACCEPT);
    expect(check!.currentValue).toBe("No unrestricted ACCEPT all rule found");
  });
});
