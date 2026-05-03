/**
 * DDoS Hardening check parser.
 * Parses sysctl output into 8 DDoS-specific audit checks.
 * Handles Docker/Coolify platform guard for DDOS-TW-REUSE.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { CHECK_IDS } from "../checkIds.js";
import { extractSysctlValue } from "./shared/sysctl.js";

const CATEGORY = "DDoS Hardening";

export const parseDdosChecks: CheckParser = (sectionOutput: string, platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;
  const isPlatform = platform === "coolify" || platform === "dokploy";

  // DDOS-SYN-BACKLOG: net.ipv4.tcp_max_syn_backlog >= 2048
  const synBacklog = extractSysctlValue(output, "net.ipv4.tcp_max_syn_backlog");
  const ddosSynBacklog: AuditCheck = {
    id: CHECK_IDS.DDOS.DDOS_SYN_BACKLOG,
    category: CATEGORY,
    name: "TCP SYN Backlog Queue Size",
    severity: "warning",
    passed: isNA ? false : synBacklog !== null && parseInt(synBacklog, 10) >= 2048,
    currentValue: isNA
      ? "Unable to determine"
      : synBacklog !== null
        ? `net.ipv4.tcp_max_syn_backlog = ${synBacklog}`
        : "Unable to determine",
    expectedValue: "net.ipv4.tcp_max_syn_backlog >= 2048",
    fixCommand:
      "sysctl -w net.ipv4.tcp_max_syn_backlog=2048 && echo 'net.ipv4.tcp_max_syn_backlog=2048' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "A larger SYN backlog queue allows the server to handle more simultaneous half-open TCP connections, reducing the risk of SYN flood attacks overwhelming the connection queue. The default value (128) is too small for production servers under load.",
  };

  // DDOS-SYNACK-RETRIES: net.ipv4.tcp_synack_retries <= 3
  const synackRetries = extractSysctlValue(output, "net.ipv4.tcp_synack_retries");
  const ddosSynackRetries: AuditCheck = {
    id: CHECK_IDS.DDOS.DDOS_SYNACK_RETRIES,
    category: CATEGORY,
    name: "TCP SYNACK Retry Count Limited",
    severity: "warning",
    passed: isNA ? false : synackRetries !== null && parseInt(synackRetries, 10) <= 3,
    currentValue: isNA
      ? "Unable to determine"
      : synackRetries !== null
        ? `net.ipv4.tcp_synack_retries = ${synackRetries}`
        : "Unable to determine",
    expectedValue: "net.ipv4.tcp_synack_retries <= 3",
    fixCommand:
      "sysctl -w net.ipv4.tcp_synack_retries=3 && echo 'net.ipv4.tcp_synack_retries=3' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "Limiting SYNACK retries reduces the time the server holds incomplete connection state during a SYN flood. The default (5) means up to 3 minutes of connection state per half-open session. Reducing to 3 cuts this to about 45 seconds.",
  };

  // DDOS-FIN-TIMEOUT: net.ipv4.tcp_fin_timeout <= 30
  const finTimeout = extractSysctlValue(output, "net.ipv4.tcp_fin_timeout");
  const ddosFinTimeout: AuditCheck = {
    id: CHECK_IDS.DDOS.DDOS_FIN_TIMEOUT,
    category: CATEGORY,
    name: "TCP FIN Timeout Reduced",
    severity: "warning",
    passed: isNA ? false : finTimeout !== null && parseInt(finTimeout, 10) <= 30,
    currentValue: isNA
      ? "Unable to determine"
      : finTimeout !== null
        ? `net.ipv4.tcp_fin_timeout = ${finTimeout}`
        : "Unable to determine",
    expectedValue: "net.ipv4.tcp_fin_timeout <= 30",
    fixCommand:
      "sysctl -w net.ipv4.tcp_fin_timeout=15 && echo 'net.ipv4.tcp_fin_timeout=15' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "The FIN timeout controls how long the kernel waits before freeing resources after a connection closes. The default (60s) allows an attacker to exhaust connection state with rapid connection teardown. Reducing to 15-30s reclaims resources faster.",
  };

  // DDOS-TW-REUSE: net.ipv4.tcp_tw_reuse = 1 (but Docker platforms are exempt)
  const twReuse = extractSysctlValue(output, "net.ipv4.tcp_tw_reuse");
  const ddosTwReuse: AuditCheck = {
    id: CHECK_IDS.DDOS.DDOS_TW_REUSE,
    category: CATEGORY,
    name: "TCP TIME_WAIT Reuse Enabled",
    severity: "info",
    passed: isNA ? false : isPlatform ? true : twReuse === "1",
    currentValue: isNA
      ? "Unable to determine"
      : twReuse !== null
        ? `net.ipv4.tcp_tw_reuse = ${twReuse}`
        : "Unable to determine",
    expectedValue: isPlatform
      ? "Any value (Docker NAT compatibility)"
      : "net.ipv4.tcp_tw_reuse = 1",
    fixCommand:
      "sysctl -w net.ipv4.tcp_tw_reuse=1 && echo 'net.ipv4.tcp_tw_reuse=1' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain: isPlatform
      ? "TCP TIME_WAIT reuse is not enforced on Docker/Coolify platforms because Docker NAT can cause issues when sockets are reused too aggressively."
      : "Enabling TIME_WAIT socket reuse allows the server to recycle connections in TIME_WAIT state, reducing the number of sockets held open and improving throughput under connection-heavy DDoS conditions.",
  };

  // DDOS-ICMP-RATELIMIT: net.ipv4.icmp_ratelimit <= 1000
  const icmpRatelimit = extractSysctlValue(output, "net.ipv4.icmp_ratelimit");
  const ddosIcmpRatelimit: AuditCheck = {
    id: CHECK_IDS.DDOS.DDOS_ICMP_RATELIMIT,
    category: CATEGORY,
    name: "ICMP Rate Limiting Configured",
    severity: "info",
    passed: isNA ? false : icmpRatelimit !== null && parseInt(icmpRatelimit, 10) <= 1000,
    currentValue: isNA
      ? "Unable to determine"
      : icmpRatelimit !== null
        ? `net.ipv4.icmp_ratelimit = ${icmpRatelimit}`
        : "Unable to determine",
    expectedValue: "net.ipv4.icmp_ratelimit <= 1000",
    fixCommand:
      "sysctl -w net.ipv4.icmp_ratelimit=1000 && echo 'net.ipv4.icmp_ratelimit=1000' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "ICMP rate limiting caps how many ICMP messages the kernel generates per second (in jiffies). Lower values prevent the server from being used as a DDoS reflector and reduce CPU overhead from processing ICMP flood responses.",
  };

  // DDOS-ICMP-BOGUS: net.ipv4.icmp_ignore_bogus_error_responses = 1
  const icmpBogus = extractSysctlValue(output, "net.ipv4.icmp_ignore_bogus_error_responses");
  const ddosIcmpBogus: AuditCheck = {
    id: CHECK_IDS.DDOS.DDOS_ICMP_BOGUS,
    category: CATEGORY,
    name: "Bogus ICMP Error Responses Ignored",
    severity: "info",
    passed: isNA ? false : icmpBogus === "1",
    currentValue: isNA
      ? "Unable to determine"
      : icmpBogus !== null
        ? `net.ipv4.icmp_ignore_bogus_error_responses = ${icmpBogus}`
        : "Unable to determine",
    expectedValue: "net.ipv4.icmp_ignore_bogus_error_responses = 1",
    fixCommand:
      "sysctl -w net.ipv4.icmp_ignore_bogus_error_responses=1 && echo 'net.ipv4.icmp_ignore_bogus_error_responses=1' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "Some routers send bogus ICMP error responses. Without this setting, the kernel logs each one, wasting I/O and disk space. Enabling this suppresses logging of these known-bogus packets.",
  };

  // DDOS-SOMAXCONN: net.core.somaxconn >= 1024
  const somaxconn = extractSysctlValue(output, "net.core.somaxconn");
  const ddosSomaxconn: AuditCheck = {
    id: CHECK_IDS.DDOS.DDOS_SOMAXCONN,
    category: CATEGORY,
    name: "Socket Listen Backlog (somaxconn) Size",
    severity: "warning",
    passed: isNA ? false : somaxconn !== null && parseInt(somaxconn, 10) >= 1024,
    currentValue: isNA
      ? "Unable to determine"
      : somaxconn !== null
        ? `net.core.somaxconn = ${somaxconn}`
        : "Unable to determine",
    expectedValue: "net.core.somaxconn >= 1024",
    fixCommand:
      "sysctl -w net.core.somaxconn=65535 && echo 'net.core.somaxconn=65535' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "somaxconn sets the maximum number of pending connections that can be queued before they are dropped. The default (128) is insufficient for high-traffic servers. Under a connection flood, a small backlog causes new connections to be silently dropped.",
  };

  // DDOS-SYN-RETRIES: net.ipv4.tcp_syn_retries <= 3
  const synRetries = extractSysctlValue(output, "net.ipv4.tcp_syn_retries");
  const ddosSynRetries: AuditCheck = {
    id: CHECK_IDS.DDOS.DDOS_SYN_RETRIES,
    category: CATEGORY,
    name: "TCP SYN Retry Count Limited",
    severity: "info",
    passed: isNA ? false : synRetries !== null && parseInt(synRetries, 10) <= 3,
    currentValue: isNA
      ? "Unable to determine"
      : synRetries !== null
        ? `net.ipv4.tcp_syn_retries = ${synRetries}`
        : "Unable to determine",
    expectedValue: "net.ipv4.tcp_syn_retries <= 3",
    fixCommand:
      "sysctl -w net.ipv4.tcp_syn_retries=3 && echo 'net.ipv4.tcp_syn_retries=3' >> /etc/sysctl.d/99-kastell.conf",
    safeToAutoFix: "SAFE",
    explain:
      "Limiting SYN retries reduces the time wasted on unanswered outbound connection attempts and mitigates resource exhaustion from connections to unresponsive hosts.",
  };

  return [
    ddosSynBacklog,
    ddosSynackRetries,
    ddosFinTimeout,
    ddosTwReuse,
    ddosIcmpRatelimit,
    ddosIcmpBogus,
    ddosSomaxconn,
    ddosSynRetries,
  ];
};
