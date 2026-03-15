/**
 * Services security check parser.
 * Detects dangerous legacy services and unnecessary network services.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface ServicesCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

/**
 * Helper: check if a systemctl service is active.
 * Only "active" is a failure — "inactive", "not-found", "failed", absence = pass.
 */
function isServiceActive(output: string, serviceName: string): boolean {
  // systemctl is-active outputs one line per service in order
  // We look for the service name in context or just check for "active" lines
  const regex = new RegExp(`(?:^|\\n)${serviceName}[^\\n]*active`, "i");
  if (regex.test(output)) return true;

  // For batch systemctl output: services listed in order, each returning active/inactive
  // We need a more precise approach for batch output
  return false;
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
    id: "SVC-NO-TELNET",
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
    explain:
      "Telnet transmits all data including passwords in cleartext, making it trivially interceptable.",
  },
  {
    id: "SVC-NO-RSH",
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
    explain:
      "Remote Shell (rsh) provides no encryption and uses weak host-based authentication, allowing easy impersonation.",
  },
  {
    id: "SVC-NO-RLOGIN",
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
    explain:
      "Remote login (rlogin) transmits credentials in cleartext and relies on insecure host trust relationships.",
  },
  {
    id: "SVC-NO-FTP",
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
    explain:
      "FTP transmits credentials and data in cleartext. Use SFTP or SCP over SSH for secure file transfers.",
  },
  {
    id: "SVC-NO-TFTP",
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
    explain:
      "TFTP provides no authentication or encryption, allowing anyone to read and write files on the server.",
  },

  // === Network services (from second systemctl batch) ===
  {
    id: "SVC-NFS-RESTRICTED",
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
    explain:
      "NFS shares can expose sensitive files to unauthorized hosts if not properly restricted with exports configuration.",
  },
  {
    id: "SVC-NO-RPCBIND",
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
    explain:
      "rpcbind maps RPC services to ports and is a common target for reconnaissance and amplification attacks.",
  },
  {
    id: "SVC-SAMBA-RESTRICTED",
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
    explain:
      "Samba file sharing on public servers exposes the SMB protocol, which is frequently targeted by ransomware and worms.",
  },
  {
    id: "SVC-NO-AVAHI",
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
    explain:
      "Avahi provides mDNS/DNS-SD service discovery intended for desktops, not servers. It increases attack surface unnecessarily.",
  },
  {
    id: "SVC-NO-CUPS",
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
    explain:
      "CUPS print service is unnecessary on most servers and has had multiple critical vulnerabilities in recent years.",
  },
  {
    id: "SVC-NO-DHCP-SERVER",
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
    explain:
      "Running a rogue DHCP server on a cloud VPS can disrupt network addressing for other tenants.",
  },
  {
    id: "SVC-NO-DNS-SERVER",
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
    explain:
      "An unintended DNS server can be used for DNS amplification attacks and zone information leakage.",
  },
  {
    id: "SVC-NO-SNMP",
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
    explain:
      "SNMP with default community strings exposes system information and can allow unauthorized configuration changes.",
  },
  {
    id: "SVC-NO-SQUID",
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
    explain:
      "An open proxy server can be abused to anonymize malicious traffic and may violate hosting provider terms.",
  },
  {
    id: "SVC-NO-XINETD",
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
    explain:
      "xinetd is a legacy super-server that can spawn insecure services. Modern systemd socket activation is preferred.",
  },
  {
    id: "SVC-NO-YPSERV",
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
    explain:
      "NIS transmits authentication data in cleartext and is vulnerable to domain-level compromise.",
  },
  {
    id: "SVC-NO-INETD",
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
    explain:
      "The inetd super-server can silently spawn legacy insecure services that bypass systemd management.",
  },
  {
    id: "SVC-NO-CHARGEN",
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
    explain:
      "The chargen service generates character streams and is commonly exploited in amplification DDoS attacks.",
  },
  {
    id: "SVC-NO-DAYTIME",
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
    explain:
      "The daytime protocol is obsolete and can be used in amplification attacks against third parties.",
  },
  {
    id: "SVC-NO-DISCARD",
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
    explain:
      "The discard service silently drops all received data and provides no useful function on modern servers.",
  },
  {
    id: "SVC-NO-ECHO-SVC",
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
    explain:
      "The echo network service can be paired with chargen to create infinite traffic loops between hosts.",
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
      explain: def.explain,
    };
  });
};
