/**
 * Services security check parser.
 * Detects dangerous legacy services and unnecessary network services.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface ServicesCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}



/**
 * Check if a specific service status line shows "active".
 * systemctl is-active returns one word per service: active, inactive, unknown, or not-found (on stderr).
 */
function isServiceLineActive(output: string, index: number): boolean {
  const lines = output.split("\n").filter((l) => l.trim() !== "");
  if (index >= lines.length) return false;
  return lines[index].trim() === "active";
}

const SERVICES_CHECKS: ServicesCheckDef[] = [
  // === Legacy dangerous services (from first systemctl batch) ===
  {
    id: CHECK_IDS.SERVICES.SVC_NO_TELNET,
    name: "Telnet Service Disabled",
    severity: "critical",
    check: (output) => {
      const active = /\btelnet\b.*\bactive\b/i.test(output) || isServiceLineActive(output, 0);
      return {
        passed: !active,
        currentValue: active ? "telnet is active" : "telnet is not running",
      };
    },
    expectedValue: "telnet service inactive or not installed",
    fixCommand: "systemctl stop telnet && systemctl disable telnet && apt purge telnetd -y",
    safeToAutoFix: "SAFE",
    explain:
      "Telnet transmits all data including passwords in cleartext, making it trivially interceptable.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_RSH,
    name: "rsh Service Disabled",
    severity: "critical",
    check: (output) => {
      const active = /\brsh\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "rsh is active" : "rsh is not running",
      };
    },
    expectedValue: "rsh service inactive or not installed",
    fixCommand: "systemctl stop rsh && systemctl disable rsh && apt purge rsh-server -y",
    safeToAutoFix: "SAFE",
    explain:
      "Remote Shell (rsh) provides no encryption and uses weak host-based authentication, allowing easy impersonation.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_RLOGIN,
    name: "rlogin Service Disabled",
    severity: "warning",
    check: (output) => {
      const active = /\brlogin\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "rlogin is active" : "rlogin is not running",
      };
    },
    expectedValue: "rlogin service inactive or not installed",
    fixCommand: "systemctl stop rlogin && systemctl disable rlogin",
    safeToAutoFix: "SAFE",
    explain:
      "Remote login (rlogin) transmits credentials in cleartext and relies on insecure host trust relationships.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_FTP,
    name: "FTP Server Disabled",
    severity: "warning",
    check: (output) => {
      const active = /\bvsftpd\b.*\bactive\b/i.test(output) || /\bftp\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "FTP server is active" : "FTP server is not running",
      };
    },
    expectedValue: "FTP service inactive or not installed",
    fixCommand: "systemctl stop vsftpd && systemctl disable vsftpd",
    safeToAutoFix: "SAFE",
    explain:
      "FTP transmits credentials and data in cleartext. Use SFTP or SCP over SSH for secure file transfers.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_TFTP,
    name: "TFTP Service Disabled",
    severity: "warning",
    check: (output) => {
      const active = /\btftpd\b.*\bactive\b/i.test(output) || /\btftp\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "TFTP is active" : "TFTP is not running",
      };
    },
    expectedValue: "TFTP service inactive or not installed",
    fixCommand: "systemctl stop tftpd-hpa && systemctl disable tftpd-hpa",
    safeToAutoFix: "SAFE",
    explain:
      "TFTP provides no authentication or encryption, allowing anyone to read and write files on the server.",
  },

  // === Network services (from second systemctl batch) ===
  {
    id: CHECK_IDS.SERVICES.SVC_NFS_RESTRICTED,
    name: "NFS Server Not Exposed",
    severity: "warning",
    check: (output) => {
      const active = /\bnfs-server\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "NFS server is running" : "NFS server is not running",
      };
    },
    expectedValue: "NFS server inactive unless explicitly required",
    fixCommand: "systemctl stop nfs-server && systemctl disable nfs-server",
    safeToAutoFix: "SAFE",
    explain:
      "NFS shares can expose sensitive files to unauthorized hosts if not properly restricted with exports configuration.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_RPCBIND,
    name: "rpcbind Not Running",
    severity: "warning",
    check: (output) => {
      const active = /\brpcbind\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "rpcbind is running" : "rpcbind is not running",
      };
    },
    expectedValue: "rpcbind inactive unless NFS is required",
    fixCommand: "systemctl stop rpcbind && systemctl disable rpcbind",
    safeToAutoFix: "SAFE",
    explain:
      "rpcbind maps RPC services to ports and is a common target for reconnaissance and amplification attacks.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_SAMBA_RESTRICTED,
    name: "Samba Not Exposed",
    severity: "warning",
    check: (output) => {
      const active = /\bsmbd\b.*\bactive\b/i.test(output) || /\bnmbd\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "Samba is running" : "Samba is not running",
      };
    },
    expectedValue: "Samba inactive unless file sharing is required",
    fixCommand: "systemctl stop smbd nmbd && systemctl disable smbd nmbd",
    safeToAutoFix: "SAFE",
    explain:
      "Samba file sharing on public servers exposes the SMB protocol, which is frequently targeted by ransomware and worms.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_AVAHI,
    name: "Avahi Daemon Disabled",
    severity: "info",
    check: (output) => {
      const active = /\bavahi-daemon\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "avahi-daemon is running" : "avahi-daemon is not running",
      };
    },
    expectedValue: "avahi-daemon inactive on servers",
    fixCommand: "systemctl stop avahi-daemon && systemctl disable avahi-daemon",
    safeToAutoFix: "SAFE",
    explain:
      "Avahi provides mDNS/DNS-SD service discovery intended for desktops, not servers. It increases attack surface unnecessarily.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_CUPS,
    name: "CUPS Print Service Disabled",
    severity: "info",
    check: (output) => {
      const active = /\bcups\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "CUPS is running" : "CUPS is not running",
      };
    },
    expectedValue: "CUPS inactive unless print server needed",
    fixCommand: "systemctl stop cups && systemctl disable cups",
    safeToAutoFix: "SAFE",
    explain:
      "CUPS print service is unnecessary on most servers and has had multiple critical vulnerabilities in recent years.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_DHCP_SERVER,
    name: "DHCP Server Disabled",
    severity: "info",
    check: (output) => {
      const active = /\bisc-dhcp-server\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "DHCP server is running" : "DHCP server is not running",
      };
    },
    expectedValue: "DHCP server inactive unless required",
    fixCommand: "systemctl stop isc-dhcp-server && systemctl disable isc-dhcp-server",
    safeToAutoFix: "SAFE",
    explain:
      "Running a rogue DHCP server on a cloud VPS can disrupt network addressing for other tenants.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_DNS_SERVER,
    name: "DNS Server Not Running",
    severity: "info",
    check: (output) => {
      const active = /\bnamed\b.*\bactive\b/i.test(output) || /\bbind9\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "DNS server is running" : "DNS server is not running",
      };
    },
    expectedValue: "DNS server inactive unless explicitly required",
    fixCommand: "systemctl stop named && systemctl disable named",
    safeToAutoFix: "SAFE",
    explain:
      "An unintended DNS server can be used for DNS amplification attacks and zone information leakage.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_SNMP,
    name: "SNMP Service Disabled",
    severity: "warning",
    check: (output) => {
      const active = /\bsnmpd\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "SNMP is running" : "SNMP is not running",
      };
    },
    expectedValue: "SNMP inactive unless monitoring requires it",
    fixCommand: "systemctl stop snmpd && systemctl disable snmpd",
    safeToAutoFix: "SAFE",
    explain:
      "SNMP with default community strings exposes system information and can allow unauthorized configuration changes.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_SQUID,
    name: "Squid Proxy Disabled",
    severity: "info",
    check: (output) => {
      const active = /\bsquid\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "Squid proxy is running" : "Squid proxy is not running",
      };
    },
    expectedValue: "Squid inactive unless proxy is required",
    fixCommand: "systemctl stop squid && systemctl disable squid",
    safeToAutoFix: "SAFE",
    explain:
      "An open proxy server can be abused to anonymize malicious traffic and may violate hosting provider terms.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_XINETD,
    name: "xinetd Service Disabled",
    severity: "warning",
    check: (output) => {
      const active = /\bxinetd\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "xinetd is running" : "xinetd is not running",
      };
    },
    expectedValue: "xinetd inactive — use systemd socket activation instead",
    fixCommand: "systemctl stop xinetd && systemctl disable xinetd",
    safeToAutoFix: "SAFE",
    explain:
      "xinetd is a legacy super-server that can spawn insecure services. Modern systemd socket activation is preferred.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_YPSERV,
    name: "NIS (ypserv) Disabled",
    severity: "warning",
    check: (output) => {
      const active = /\bypserv\b.*\bactive\b/i.test(output);
      return {
        passed: !active,
        currentValue: active ? "NIS is running" : "NIS is not running",
      };
    },
    expectedValue: "NIS (ypserv) inactive — insecure authentication protocol",
    fixCommand: "systemctl stop ypserv && systemctl disable ypserv",
    safeToAutoFix: "SAFE",
    explain:
      "NIS transmits authentication data in cleartext and is vulnerable to domain-level compromise.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_INETD,
    name: "No Dangerous inetd Entries",
    severity: "warning",
    check: (output) => {
      if (output.includes("NONE") || !output.includes("inetd")) {
        return { passed: true, currentValue: "No inetd.conf or no dangerous entries" };
      }
      const dangerous = /(?:telnet|ftp|rsh|rlogin|tftp|chargen|daytime|discard|echo)/i.test(output);
      return {
        passed: !dangerous,
        currentValue: dangerous
          ? "Dangerous services found in inetd.conf"
          : "No dangerous inetd entries",
      };
    },
    expectedValue: "No dangerous services in inetd.conf",
    fixCommand: "rm -f /etc/inetd.conf # Or remove dangerous entries",
    safeToAutoFix: "SAFE",
    explain:
      "The inetd super-server can silently spawn legacy insecure services that bypass systemd management.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_CHARGEN,
    name: "chargen Service Disabled",
    severity: "warning",
    check: (output) => {
      const hasChargen = /\bchargen\b/i.test(output) && !output.includes("NONE");
      return {
        passed: !hasChargen,
        currentValue: hasChargen ? "chargen service found" : "chargen not found",
      };
    },
    expectedValue: "chargen service not running or configured",
    fixCommand: "sed -i '/chargen/d' /etc/inetd.conf && systemctl restart inetd",
    safeToAutoFix: "GUARDED",
    explain:
      "The chargen service generates character streams and is commonly exploited in amplification DDoS attacks.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_DAYTIME,
    name: "daytime Service Disabled",
    severity: "info",
    check: (output) => {
      const hasDaytime = /\bdaytime\b/i.test(output) && !output.includes("NONE");
      return {
        passed: !hasDaytime,
        currentValue: hasDaytime ? "daytime service found" : "daytime not found",
      };
    },
    expectedValue: "daytime service not running or configured",
    fixCommand: "sed -i '/daytime/d' /etc/inetd.conf && systemctl restart inetd",
    safeToAutoFix: "GUARDED",
    explain:
      "The daytime protocol is obsolete and can be used in amplification attacks against third parties.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_DISCARD,
    name: "discard Service Disabled",
    severity: "info",
    check: (output) => {
      const hasDiscard = /\bdiscard\b/i.test(output) && !output.includes("NONE");
      return {
        passed: !hasDiscard,
        currentValue: hasDiscard ? "discard service found" : "discard not found",
      };
    },
    expectedValue: "discard service not running or configured",
    fixCommand: "sed -i '/discard/d' /etc/inetd.conf && systemctl restart inetd",
    safeToAutoFix: "GUARDED",
    explain:
      "The discard service silently drops all received data and provides no useful function on modern servers.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_ECHO_SVC,
    name: "echo Service Disabled",
    severity: "info",
    check: (output) => {
      // Look for echo as a service in inetd, not the echo command
      const hasEchoSvc = /^\s*echo\s/im.test(output) && !output.includes("NONE");
      return {
        passed: !hasEchoSvc,
        currentValue: hasEchoSvc ? "echo service found in inetd" : "echo service not found",
      };
    },
    expectedValue: "echo service not running or configured",
    fixCommand: "sed -i '/^echo/d' /etc/inetd.conf && systemctl restart inetd",
    safeToAutoFix: "GUARDED",
    explain:
      "The echo network service can be paired with chargen to create infinite traffic loops between hosts.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_RUNNING_COUNT_REASONABLE,
    name: "Running Service Count Reasonable",
    severity: "info",
    check: (output) => {
      // systemctl list-units --type=service --state=running | wc -l output
      const lines = output.split("\n");
      let serviceCount: number | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          // Service count should be > 0 and plausible (1-200)
          if (val > 0 && val < 200) {
            serviceCount = val;
            break;
          }
        }
      }
      if (serviceCount === null) {
        return { passed: true, currentValue: "Running service count not determinable" };
      }
      const passed = serviceCount < 50;
      return {
        passed,
        currentValue: passed
          ? `${serviceCount} running services (acceptable)`
          : `${serviceCount} running services (review recommended)`,
      };
    },
    expectedValue: "Fewer than 50 running services",
    fixCommand: "# Review: systemctl list-units --type=service --state=running — disable unnecessary: systemctl disable --now SERVICE",
    safeToAutoFix: "GUARDED",
    explain:
      "Excessive running services increase attack surface; each service is a potential entry point for attackers.",
  },
  // NEW checks (Wave 1 gap closure)
  {
    id: CHECK_IDS.SERVICES.SVC_NO_WILDCARD_LISTENERS,
    name: "No Excessive Wildcard Listeners",
    severity: "warning",
    check: (output) => {
      // ss -tlnp | grep -c '0.0.0.0:' output — count of wildcard listeners
      // The running-count check consumes the first standalone digit; wildcard count is the second.
      const lines = output.split("\n");
      let wildcardCount: number | null = null;
      let standaloneDigitsSeen = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          if (val >= 0 && val < 1000) {
            standaloneDigitsSeen++;
            if (standaloneDigitsSeen === 2) {
              wildcardCount = val;
              break;
            }
          }
        }
      }
      if (wildcardCount === null) {
        return { passed: true, currentValue: "Wildcard listener count not determinable" };
      }
      const passed = wildcardCount <= 5;
      return {
        passed,
        currentValue: passed
          ? `${wildcardCount} service(s) listening on 0.0.0.0 (acceptable)`
          : `${wildcardCount} service(s) listening on 0.0.0.0 (review recommended)`,
      };
    },
    expectedValue: "5 or fewer services listening on 0.0.0.0",
    fixCommand: "ss -tlnp | grep '0.0.0.0:' — bind services to specific IPs in their configuration",
    safeToAutoFix: "SAFE",
    explain:
      "Services listening on 0.0.0.0 accept connections on all network interfaces, increasing attack surface from untrusted networks.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_XINETD_SERVICES,
    name: "xinetd Legacy Service Disabled",
    severity: "info",
    check: (output) => {
      // systemctl is-active xinetd output — should not be "active"
      const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
      // Look for a standalone "active" line that matches xinetd status
      const xinetdActive = lines.some((l) => l === "active") && /xinetd/i.test(output);
      const isActive = xinetdActive || (/\bxinetd\b.*\bactive\b/i.test(output));
      return {
        passed: !isActive,
        currentValue: isActive ? "xinetd is active" : "xinetd is not running",
      };
    },
    expectedValue: "xinetd inactive or not installed",
    fixCommand: "systemctl stop xinetd && systemctl disable xinetd && apt purge xinetd",
    safeToAutoFix: "SAFE",
    explain:
      "xinetd is a legacy super-daemon with known security weaknesses; modern systems should use systemd socket activation instead.",
  },
  {
    id: CHECK_IDS.SERVICES.SVC_NO_WORLD_READABLE_CONFIGS,
    name: "No World-Readable Service Configs",
    severity: "info",
    check: (output) => {
      // find /etc -name '*.conf' -perm -o+r -path '*/systemd/*' output
      // NONE = no world-readable configs found; this is the last section in output.
      // We look at lines from the end to find the world-readable section result.
      const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
      // Collect all path lines (lines starting with /) — these are world-readable config files
      const configFiles = lines.filter((l) => l.startsWith("/") && l.includes(".conf"));
      if (configFiles.length > 0) {
        return {
          passed: false,
          currentValue: `${configFiles.length} world-readable service config(s) found`,
        };
      }
      // Check if the last non-empty line (or any line) is explicitly "NONE"
      const lastLine = lines[lines.length - 1];
      if (lastLine === "NONE") {
        return { passed: true, currentValue: "None found" };
      }
      return { passed: true, currentValue: "None found" };
    },
    expectedValue: "No world-readable systemd service configuration files",
    fixCommand: "find /etc/systemd/ -name '*.conf' -perm -o+r -exec chmod o-r {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "World-readable service configuration files may expose internal paths, credentials, and operational details to unprivileged users.",
  },
];

export const parseServicesChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return SERVICES_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Services",
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
      category: "Services",
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
