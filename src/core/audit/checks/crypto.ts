/**
 * Crypto security check parser.
 * Parses OpenSSL version, SSH cipher/MAC/KEX config, LUKS disk, TLS protocol,
 * and certificate expiry data into 10 security checks.
 */
import { CHECK_IDS } from "../checkIds.js";

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { WEAK_CIPHERS, WEAK_MACS, WEAK_KEX } from "../../../constants.js";

interface CryptoCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const CRYPTO_CHECKS: CryptoCheckDef[] = [
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_INSTALLED,
    name: "OpenSSL Installed",
    severity: "info",
    check: (output) => {
      const installed = /OpenSSL\s+\d+\.\d+/i.test(output) && !/NOT_INSTALLED/.test(output);
      return {
        passed: installed,
        currentValue: installed ? output.match(/OpenSSL\s+[\d.a-z]+/i)?.[0] ?? "OpenSSL installed" : "OpenSSL not installed",
      };
    },
    expectedValue: "OpenSSL is installed",
    fixCommand: "apt install openssl -y",
    safeToAutoFix: "SAFE",
    explain: "OpenSSL provides the cryptographic library used by most services for TLS and certificate operations.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS,
    name: "SSH No Weak Ciphers",
    severity: "warning",
    check: (output) => {
      const ciphersLine = output.match(/^ciphers (.+)$/mi)?.[1] ?? "";
      if (!ciphersLine) {
        return { passed: false, currentValue: "SSH cipher configuration not found" };
      }
      const activeCiphers = ciphersLine.split(",").map((s) => s.trim().toLowerCase());
      const weakFound = activeCiphers.filter((c) => WEAK_CIPHERS.some((w) => c.includes(w)));
      return {
        passed: weakFound.length === 0,
        currentValue: weakFound.length > 0 ? `Weak ciphers: ${weakFound.join(", ")}` : "No weak ciphers configured",
      };
    },
    expectedValue: "No arcfour, 3des-cbc, blowfish-cbc, or cast128-cbc ciphers",
    fixCommand: "sed -i '/^Ciphers/d' /etc/ssh/sshd_config && echo 'Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr' >> /etc/ssh/sshd_config && systemctl restart sshd",
    safeToAutoFix: "GUARDED",
    explain: "Weak SSH ciphers (arcfour, 3DES, Blowfish) are vulnerable to known cryptographic attacks including SWEET32 and related attacks.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_MACS,
    name: "SSH No Weak MACs",
    severity: "warning",
    check: (output) => {
      const macsLine = output.match(/^macs (.+)$/mi)?.[1] ?? "";
      if (!macsLine) {
        return { passed: false, currentValue: "SSH MAC configuration not found" };
      }
      const activeMacs = macsLine.split(",").map((s) => s.trim().toLowerCase());
      const weakFound = activeMacs.filter((m) => WEAK_MACS.some((w) => m.includes(w)));
      return {
        passed: weakFound.length === 0,
        currentValue: weakFound.length > 0 ? `Weak MACs: ${weakFound.join(", ")}` : "No weak MACs configured",
      };
    },
    expectedValue: "No hmac-md5, hmac-sha1-96, or umac-64 MACs",
    fixCommand: "sed -i '/^MACs/d' /etc/ssh/sshd_config && echo 'MACs hmac-sha2-512,hmac-sha2-256,umac-128@openssh.com' >> /etc/ssh/sshd_config && systemctl restart sshd",
    safeToAutoFix: "GUARDED",
    explain: "Weak SSH MACs like HMAC-MD5 and HMAC-SHA1-96 provide insufficient integrity protection and are vulnerable to collision attacks.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_KEX,
    name: "SSH No Weak Key Exchange",
    severity: "warning",
    check: (output) => {
      const kexLine = output.match(/^kexalgorithms (.+)$/mi)?.[1] ?? "";
      if (!kexLine) {
        return { passed: false, currentValue: "SSH KEX configuration not found" };
      }
      const activeKex = kexLine.split(",").map((s) => s.trim().toLowerCase());
      const weakFound = activeKex.filter((k) => WEAK_KEX.some((w) => k.includes(w)));
      return {
        passed: weakFound.length === 0,
        currentValue: weakFound.length > 0 ? `Weak KEX: ${weakFound.join(", ")}` : "No weak KEX algorithms",
      };
    },
    expectedValue: "No diffie-hellman-group1-sha1 or diffie-hellman-group14-sha1",
    fixCommand: "sed -i '/^KexAlgorithms/d' /etc/ssh/sshd_config && echo 'KexAlgorithms curve25519-sha256,ecdh-sha2-nistp521,ecdh-sha2-nistp384,ecdh-sha2-nistp256' >> /etc/ssh/sshd_config && systemctl restart sshd",
    safeToAutoFix: "GUARDED",
    explain: "Weak Diffie-Hellman group1 and group14 key exchanges are susceptible to Logjam attack, allowing MitM decryption of SSH sessions.",
  },
  {
    id: "CRYPTO-SSH-ED25519-KEY",
    name: "SSH ED25519 Host Key Present",
    severity: "info",
    check: (output) => {
      const hasEd25519 = /ssh_host_ed25519_key/.test(output);
      return {
        passed: hasEd25519,
        currentValue: hasEd25519 ? "ED25519 host key present" : "ED25519 host key not found",
      };
    },
    expectedValue: "ssh_host_ed25519_key exists in /etc/ssh/",
    fixCommand: "ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N '' && systemctl restart sshd",
    safeToAutoFix: "GUARDED",
    explain: "ED25519 host keys use modern elliptic curve cryptography offering stronger security and better performance than RSA keys.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_LUKS_DISK,
    name: "Disk Encryption (LUKS) Present",
    severity: "info",
    check: (output) => {
      const hasLuks = /crypto_luks/i.test(output) && !/NO_LUKS/.test(output);
      return {
        passed: hasLuks,
        currentValue: hasLuks ? "LUKS disk encryption detected" : "No LUKS encrypted volumes found",
      };
    },
    expectedValue: "At least one LUKS-encrypted disk volume present",
    fixCommand: "cryptsetup luksFormat /dev/sdX # Encrypt disk partition with LUKS (DESTRUCTIVE — backup data first)",
    safeToAutoFix: "SAFE",
    explain: "LUKS disk encryption protects data at rest against physical theft or unauthorized access to storage media.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_TLS_MIN_PROTOCOL,
    name: "TLS Minimum Protocol Version",
    severity: "warning",
    check: (output) => {
      const minProtoMatch = output.match(/MinProtocol\s*=\s*(TLSv[\d.]+)/i);
      if (!minProtoMatch) {
        // If no TLS ports active, not applicable
        if (/NO_TLS_PORTS/.test(output)) {
          return { passed: false, currentValue: "TLS ports active but MinProtocol not configured" };
        }
        return { passed: false, currentValue: "MinProtocol not configured in openssl.cnf" };
      }
      const proto = minProtoMatch[1];
      const passed = proto === "TLSv1.2" || proto === "TLSv1.3";
      return {
        passed,
        currentValue: passed ? `MinProtocol = ${proto}` : `MinProtocol = ${proto} (too low)`,
      };
    },
    expectedValue: "MinProtocol = TLSv1.2 or TLSv1.3 in /etc/ssl/openssl.cnf",
    fixCommand: "grep -q 'MinProtocol' /etc/ssl/openssl.cnf && sed -i 's/MinProtocol.*/MinProtocol = TLSv1.2/' /etc/ssl/openssl.cnf || echo 'MinProtocol = TLSv1.2' >> /etc/ssl/openssl.cnf",
    safeToAutoFix: "SAFE",
    explain: "Setting a minimum TLS protocol version prevents clients from negotiating insecure TLS 1.0 or 1.1 connections.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED,
    name: "TLS Certificate Not Expired",
    severity: "warning",
    check: (output) => {
      // If no TLS ports detected, not applicable (pass)
      if (/NO_TLS_PORTS/.test(output)) {
        return { passed: true, currentValue: "No HTTPS ports active (not applicable)" };
      }
      const endDateMatch = output.match(/notAfter=(.+)/i);
      if (!endDateMatch) {
        // cert section returned N/A (no HTTPS despite port detection)
        if (/^N\/A$/m.test(output)) {
          return { passed: true, currentValue: "Certificate check not applicable" };
        }
        return { passed: false, currentValue: "Could not determine certificate expiry" };
      }
      const endDateStr = endDateMatch[1].trim();
      const endDate = new Date(endDateStr);
      if (isNaN(endDate.getTime())) {
        return { passed: false, currentValue: `Unparseable cert date: ${endDateStr}` };
      }
      const now = new Date();
      const passed = endDate > now;
      return {
        passed,
        currentValue: passed
          ? `Certificate valid until ${endDateStr}`
          : `Certificate EXPIRED on ${endDateStr}`,
      };
    },
    expectedValue: "TLS certificate enddate is in the future",
    fixCommand: "certbot renew # Renew Let's Encrypt certificate, or replace with valid certificate",
    safeToAutoFix: "SAFE",
    explain: "Expired TLS certificates cause browser warnings and trust errors, disrupting service and indicating poor certificate lifecycle management.",
  },
  {
    id: "CRYPTO-NO-SSLV3",
    name: "SSLv3 Disabled",
    severity: "warning",
    check: (output) => {
      // Look for SSLv3 being explicitly enabled in openssl.cnf
      const sslv3Enabled = /Protocol\s*=\s*.*SSLv3/i.test(output);
      return {
        passed: !sslv3Enabled,
        currentValue: sslv3Enabled ? "SSLv3 appears enabled in openssl.cnf" : "SSLv3 not enabled",
      };
    },
    expectedValue: "SSLv3 not enabled in openssl.cnf",
    fixCommand: "grep -q 'Protocol' /etc/ssl/openssl.cnf && sed -i '/SSLv3/d' /etc/ssl/openssl.cnf",
    safeToAutoFix: "SAFE",
    explain: "SSLv3 is vulnerable to the POODLE attack which allows an attacker to decrypt encrypted communications in an active MitM scenario.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN,
    name: "OpenSSL Modern Version",
    severity: "info",
    check: (output) => {
      if (/NOT_INSTALLED/.test(output)) {
        return { passed: false, currentValue: "OpenSSL not installed" };
      }
      const versionMatch = output.match(/OpenSSL\s+([\d.]+)/i);
      if (!versionMatch) {
        return { passed: false, currentValue: "OpenSSL version not detected" };
      }
      const version = versionMatch[1];
      const isModern = version.startsWith("3.") || version.startsWith("1.1.");
      const isLegacy = version.startsWith("1.0.") || version.startsWith("0.9.");
      return {
        passed: isModern && !isLegacy,
        currentValue: `OpenSSL ${version}`,
      };
    },
    expectedValue: "OpenSSL 3.x or 1.1.x (not 1.0.x or older)",
    fixCommand: "apt update && apt install --only-upgrade openssl -y",
    safeToAutoFix: "SAFE",
    explain: "OpenSSL 1.0.x and earlier have known vulnerabilities including Heartbleed (1.0.1) and lack modern cipher support.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_WEAK_SSH_KEYS,
    name: "No Weak DSA SSH Host Keys",
    severity: "warning",
    check: (output) => {
      const hasDsaKey = /ssh_host_dsa_key/.test(output);
      return {
        passed: !hasDsaKey,
        currentValue: hasDsaKey ? "DSA host key present (weak 1024-bit)" : "No DSA host keys found",
      };
    },
    expectedValue: "No ssh_host_dsa_key present in /etc/ssh/",
    fixCommand: "rm -f /etc/ssh/ssh_host_dsa_key* && ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N ''",
    safeToAutoFix: "SAFE",
    explain: "DSA host keys use fixed 1024-bit key length which is cryptographically weak by modern standards.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_HOST_KEY_PERMS,
    name: "SSH Host Key Permissions Restrictive",
    severity: "critical",
    check: (output) => {
      // stat -c '%a %n' /etc/ssh/ssh_host_*_key output
      // Lines like: "600 /etc/ssh/ssh_host_rsa_key"
      const hostKeyLines = output.match(/^(\d{3,4})\s+\/etc\/ssh\/ssh_host_.*_key$/gm) ?? [];
      if (hostKeyLines.length === 0) {
        // No stat output found — check if N/A
        if (/^N\/A$/m.test(output)) {
          return { passed: false, currentValue: "Unable to determine SSH host key permissions" };
        }
        return { passed: false, currentValue: "No SSH host key stat output found" };
      }
      const insecure = hostKeyLines.filter((line) => {
        const perms = line.trim().split(/\s+/)[0];
        return perms !== "600" && perms !== "640";
      });
      return {
        passed: insecure.length === 0,
        currentValue: insecure.length === 0
          ? "All SSH host keys have restrictive permissions"
          : `${insecure.length} key(s) with non-restrictive permissions`,
      };
    },
    expectedValue: "All SSH host private keys have mode 600 or 640",
    fixCommand: "chmod 600 /etc/ssh/ssh_host_*_key",
    safeToAutoFix: "SAFE",
    explain: "World-readable SSH host private keys allow any local user to impersonate the server.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_NO_WEAK_OPENSSL_CIPHERS,
    name: "No Excessive Weak OpenSSL Ciphers",
    severity: "warning",
    check: (output) => {
      // openssl ciphers | grep -ci 'NULL|RC4|DES|MD5' — count on standalone line
      const lines = output.split("\n");
      let weakCount: number | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          // Look for a number that could be a cipher count (0-100)
          if (val >= 0 && val < 200) {
            weakCount = val;
            break;
          }
        }
      }
      if (weakCount === null) {
        return { passed: false, currentValue: "Weak cipher count not determinable" };
      }
      const passed = weakCount < 5;
      return {
        passed,
        currentValue: passed
          ? `${weakCount} weak cipher references (acceptable)`
          : `${weakCount} weak cipher references (review recommended)`,
      };
    },
    expectedValue: "Fewer than 5 NULL/RC4/DES/MD5 cipher references",
    fixCommand: "Update /etc/ssl/openssl.cnf MinProtocol and CipherString to disable weak algorithms",
    safeToAutoFix: "GUARDED",
    explain: "Weak ciphers in the OpenSSL configuration can be exploited through protocol downgrade attacks.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_MIN_PROTOCOL,
    name: "OpenSSL Minimum TLS Protocol",
    severity: "warning",
    check: (output) => {
      const minProtoMatch = output.match(/MinProtocol\s*=\s*(TLSv[\d.]+)/i);
      if (!minProtoMatch) {
        return { passed: false, currentValue: "MinProtocol not configured in openssl.cnf" };
      }
      const proto = minProtoMatch[1];
      const passed = proto === "TLSv1.2" || proto === "TLSv1.3";
      return {
        passed,
        currentValue: passed ? `MinProtocol = ${proto}` : `MinProtocol = ${proto} (below TLSv1.2)`,
      };
    },
    expectedValue: "MinProtocol = TLSv1.2 or TLSv1.3",
    fixCommand: "Add 'MinProtocol = TLSv1.2' to /etc/ssl/openssl.cnf [system_default_sect]",
    safeToAutoFix: "GUARDED",
    explain: "TLS versions below 1.2 have known cryptographic weaknesses and are deprecated by NIST and PCI-DSS.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_LUKS_KEY_SIZE,
    name: "LUKS Encryption Present or Info",
    severity: "info",
    check: (output) => {
      const hasLuks = /crypto_luks/i.test(output) && !/NO_LUKS/.test(output);
      return {
        passed: true,
        currentValue: hasLuks ? "LUKS disk encryption detected" : "No LUKS encrypted volumes (info only)",
      };
    },
    expectedValue: "LUKS disk encryption presence checked",
    fixCommand: "# Verify: cryptsetup luksDump /dev/sdX | grep 'Key Slot'",
    safeToAutoFix: "GUARDED",
    explain: "LUKS disk encryption protects data at rest; key size should be >= 256 bits for strong protection.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE,
    name: "DH Parameters Are Adequate Size",
    severity: "warning",
    check: (output) => {
      if (/NO_DH_PARAMS/.test(output)) {
        return { passed: true, currentValue: "Using system defaults (no custom DH params file)" };
      }
      const sizeMatch = output.match(/DH Parameters:\s*\((\d+)\s*bit\)/i);
      if (!sizeMatch) {
        return { passed: true, currentValue: "DH params check inconclusive — treated as acceptable" };
      }
      const bits = parseInt(sizeMatch[1], 10);
      const passed = bits >= 2048;
      return {
        passed,
        currentValue: passed ? `DH parameters: ${bits} bits (acceptable)` : `DH parameters: ${bits} bits (too small)`,
      };
    },
    expectedValue: "DH parameters >= 2048 bits or using system defaults",
    fixCommand: "openssl dhparam -out /etc/ssl/dhparams.pem 4096",
    safeToAutoFix: "SAFE",
    explain: "DH parameters smaller than 2048 bits are vulnerable to Logjam attacks that allow passive TLS decryption.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS,
    name: "No World-Readable TLS Private Keys",
    severity: "critical",
    check: (output) => {
      // find /etc/ssl/ /etc/pki/ -name '*.key' -perm -o+r returns paths or NONE
      const lines = output.split("\n");
      // Find lines that look like file paths from find (after NO_DH_PARAMS section)
      const keyLines = lines.filter((l) => {
        const trimmed = l.trim();
        return (trimmed.startsWith("/etc/ssl/") || trimmed.startsWith("/etc/pki/")) && trimmed.endsWith(".key");
      });
      const isNone = lines.some((l) => l.trim() === "NONE");
      const passed = isNone || keyLines.length === 0;
      return {
        passed,
        currentValue: passed
          ? "No world-readable keys found"
          : `${keyLines.length} world-readable private key file(s) found`,
      };
    },
    expectedValue: "No world-readable .key files in /etc/ssl/ or /etc/pki/",
    fixCommand: "find /etc/ssl/ /etc/pki/ -name '*.key' -perm -o+r -exec chmod 600 {} \\;",
    safeToAutoFix: "SAFE",
    explain: "World-readable TLS private keys allow any local user to impersonate the server or decrypt intercepted traffic.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_CERT_COUNT,
    name: "CA Certificate Store Populated",
    severity: "info",
    check: (output) => {
      // find /etc/ssl/certs/ -name '*.pem' | wc -l — a standalone number
      // This command appears AFTER the weak cipher count command in cryptoSection(),
      // so use the LAST standalone number (0-2000) found in output.
      const lines = output.split("\n");
      let certCount: number | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          // Cert count is typically 100-200+ on a healthy system
          if (val >= 0 && val < 2000) {
            certCount = val;
            // Do not break — cert count appears after weak cipher count in output
          }
        }
      }
      if (certCount === null) {
        return { passed: false, currentValue: "Certificate count not determinable" };
      }
      const passed = certCount > 0;
      return {
        passed,
        currentValue: passed ? `${certCount} CA certificate(s) installed` : "No CA certificates found in /etc/ssl/certs/",
      };
    },
    expectedValue: "CA certificate store has at least 1 certificate",
    fixCommand: "apt install ca-certificates && update-ca-certificates",
    safeToAutoFix: "SAFE",
    explain: "A populated CA certificate store is required for TLS verification; empty stores cause all HTTPS connections to fail or bypass validation.",
  },
  {
    id: CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN,
    name: "Nginx TLS Protocols Are Modern",
    severity: "warning",
    check: (output) => {
      if (/NO_NGINX/.test(output)) {
        return { passed: true, currentValue: "Nginx not installed (not applicable)" };
      }
      // Look for ssl_protocols line in nginx config
      const sslProtoMatch = output.match(/ssl_protocols\s+([^;]+)/i);
      if (!sslProtoMatch) {
        return { passed: true, currentValue: "No ssl_protocols directive found in nginx config" };
      }
      const protocols = sslProtoMatch[1].toLowerCase();
      const hasLegacy = /tls(v)?1\.0|tls(v)?1\.1/.test(protocols);
      return {
        passed: !hasLegacy,
        currentValue: hasLegacy
          ? `Nginx TLS protocols include legacy versions: ${sslProtoMatch[1].trim()}`
          : `Nginx TLS protocols are modern: ${sslProtoMatch[1].trim()}`,
      };
    },
    expectedValue: "ssl_protocols uses only TLSv1.2 and TLSv1.3",
    fixCommand: "ssl_protocols TLSv1.2 TLSv1.3; in nginx.conf",
    safeToAutoFix: "SAFE",
    explain: "TLSv1.0 and TLSv1.1 have known vulnerabilities (POODLE, BEAST) and are deprecated by all major browsers.",
  },
];

export const parseCryptoChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return CRYPTO_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Crypto",
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
      category: "Crypto",
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
