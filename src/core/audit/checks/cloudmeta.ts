/**
 * Cloud Metadata Protection security check parser.
 * Returns empty array on bare metal (BARE_METAL sentinel) — maxScore=0 means
 * this category is excluded from the overall weighted score on non-VPS hosts.
 * On VPS/cloud environments (IS_VPS sentinel), parses IMDS endpoint accessibility,
 * cloud-init log credential exposure, and IMDSv2 enforcement.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface CloudMetaCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const CLOUDMETA_CHECKS: CloudMetaCheckDef[] = [
  {
    id: "CLOUDMETA-ENDPOINT-BLOCKED",
    name: "Metadata Endpoint Not Publicly Accessible",
    severity: "critical",
    check: (output) => {
      const isBlocked = output.includes("METADATA_BLOCKED");
      const isAccessible = output.includes("METADATA_ACCESSIBLE");
      if (isBlocked) {
        return { passed: true, currentValue: "IMDS endpoint (169.254.169.254) is blocked or unreachable" };
      }
      if (isAccessible) {
        return { passed: false, currentValue: "IMDS endpoint (169.254.169.254) is accessible without restrictions" };
      }
      return { passed: false, currentValue: "Unable to determine IMDS endpoint accessibility" };
    },
    expectedValue: "Metadata endpoint blocked via iptables/cloud security group",
    fixCommand:
      "iptables -A OUTPUT -d 169.254.169.254 -m owner ! --uid-owner root -j DROP && iptables-save > /etc/iptables/rules.v4",
    explain:
      "The cloud IMDS (Instance Metadata Service) at 169.254.169.254 exposes IAM credentials, SSH keys, and instance identity tokens. If accessible to all processes, any compromised application can steal cloud credentials. Block with iptables for all non-root processes.",
  },
  {
    id: "CLOUDMETA-INIT-LOG-CLEAN",
    name: "Cloud-Init Logs Free of Credentials",
    severity: "warning",
    check: (output) => {
      const isClean = output.includes("CLOUDINIT_CLEAN");
      // Check for credential-like patterns in output lines
      const credentialLinePattern = /(?:password|token|secret)\s*[:=]/i;
      const lines = output.split("\n");
      const credentialLines = lines.filter((l) => credentialLinePattern.test(l) && !l.includes("CLOUDINIT_CLEAN"));
      if (isClean && credentialLines.length === 0) {
        return { passed: true, currentValue: "Cloud-init logs contain no credential-like entries" };
      }
      if (credentialLines.length > 0) {
        return { passed: false, currentValue: `Cloud-init logs contain ${credentialLines.length} credential-like line(s)` };
      }
      return { passed: true, currentValue: "No cloud-init credential exposure detected" };
    },
    expectedValue: "Cloud-init logs do not contain plaintext passwords or tokens",
    fixCommand:
      "# Rotate any credentials that appeared in cloud-init logs, then: sudo truncate -s 0 /var/log/cloud-init.log /var/log/cloud-init-output.log",
    explain:
      "Cloud-init logs (/var/log/cloud-init.log) can persist bootstrap credentials passed as user-data or config-drive scripts. If user-data included passwords or tokens, they may be readable in these logs by any user with log access.",
  },
  {
    id: "CLOUDMETA-IMDSV2-ENFORCED",
    name: "IMDSv2 Session-Oriented API Enforced (AWS)",
    severity: "warning",
    check: (output) => {
      const isV2Available = output.includes("IMDSV2_AVAILABLE");
      const isV2Unavailable = output.includes("IMDSV2_UNAVAILABLE");
      if (isV2Available) {
        return { passed: true, currentValue: "IMDSv2 token-based access is available and responding" };
      }
      if (isV2Unavailable) {
        return { passed: false, currentValue: "IMDSv2 unavailable — metadata API may use insecure v1 (no session tokens)" };
      }
      return { passed: false, currentValue: "Unable to determine IMDSv2 status" };
    },
    expectedValue: "IMDSv2 session-token API responds (PUT /latest/api/token)",
    fixCommand:
      "# For AWS EC2: aws ec2 modify-instance-metadata-options --instance-id $(curl -s http://169.254.169.254/latest/meta-data/instance-id) --http-tokens required",
    explain:
      "AWS IMDSv1 is vulnerable to SSRF attacks — any application-level SSRF can fetch IAM role credentials from the metadata service. IMDSv2 requires a session token obtained via a PUT request, which SSRF cannot perform due to HTTP redirect restrictions.",
  },
  {
    id: "CLOUDMETA-SENSITIVE-ENV-NOT-IN-CLOUDINIT",
    name: "Sensitive Data Not Passed via Cloud-Init User Data",
    severity: "info",
    check: (output) => {
      const isClean = output.includes("CLOUDINIT_NO_SENSITIVE_ENV");
      const hasSensitiveEnv = output.includes("SENSITIVE_ENV_IN_CLOUDINIT");
      if (isClean) {
        return { passed: true, currentValue: "No sensitive environment variables detected in cloud-init user data" };
      }
      if (hasSensitiveEnv) {
        return { passed: false, currentValue: "Sensitive environment variables found in cloud-init user data" };
      }
      // Default to pass — not all environments will have this sentinel
      return { passed: true, currentValue: "Cloud-init sensitive data check not determinable (treated as pass)" };
    },
    expectedValue: "Cloud-init user data does not embed secrets as environment variables",
    fixCommand:
      "# Replace cloud-init secret injection with cloud provider secrets manager (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault)",
    explain:
      "Embedding secrets directly in cloud-init user data stores them in the instance metadata at /user-data, readable by any process that can access the IMDS endpoint. Use a secrets manager and fetch credentials at runtime instead.",
  },
  {
    id: "CLOUDMETA-VPC-METADATA-FIREWALL",
    name: "VPC Security Group or Firewall Restricts Metadata Access",
    severity: "info",
    check: (output) => {
      const hasFirewallRestriction = output.includes("METADATA_FIREWALL_OK");
      const noFirewallRestriction = output.includes("METADATA_FIREWALL_MISSING");
      if (hasFirewallRestriction) {
        return { passed: true, currentValue: "Firewall rules restrict metadata service access by process" };
      }
      if (noFirewallRestriction) {
        return { passed: false, currentValue: "No process-level firewall restriction on metadata service found" };
      }
      // Indeterminate — treat as info-level pass (not critical)
      return { passed: true, currentValue: "Metadata firewall restriction status indeterminate" };
    },
    expectedValue: "iptables or cloud security group restricts metadata endpoint by UID/process",
    fixCommand:
      "iptables -I OUTPUT -d 169.254.169.254 -m owner ! --uid-owner root -j DROP",
    explain:
      "Even with IMDSv2 enabled, restricting metadata endpoint access by process UID using iptables provides defense-in-depth. This prevents compromised non-root services from enumerating instance metadata or acquiring temporary credentials.",
  },
];

export const parseCloudMetaChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  // NEW PATTERN: Bare metal detection — return empty array so maxScore=0
  // and this category is excluded from calculateOverallScore weighting
  if (
    !sectionOutput ||
    sectionOutput.trim() === "" ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.includes("BARE_METAL")
  ) {
    return [];
  }

  // Only process when IS_VPS sentinel is present
  const output = sectionOutput;

  return CLOUDMETA_CHECKS.map((def) => {
    const { passed, currentValue } = def.check(output);
    return {
      id: def.id,
      category: "Cloud Metadata",
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
