/**
 * TLS Hardening check parser.
 * Parses Nginx TLS configuration output into 8 security checks.
 * If Nginx is not installed, returns info-level skipped checks (score-neutral).
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface TlsCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const TLS_CHECKS: TlsCheckDef[] = [
  {
    id: "TLS-MIN-VERSION",
    name: "TLS Minimum Version 1.2",
    severity: "critical",
    check: (output) => {
      const protocolLine = output.match(/ssl_protocols\s+([^;]+);/i)?.[1] ?? "";
      if (!protocolLine) {
        return { passed: false, currentValue: "ssl_protocols not explicitly configured" };
      }
      const hasWeak = /TLSv1(\s|$)|TLSv1\.1(\s|$)/i.test(protocolLine);
      const hasModern = /TLSv1\.[23]/i.test(protocolLine);
      if (hasWeak) {
        return { passed: false, currentValue: `Weak protocols found: ${protocolLine.trim()}` };
      }
      if (hasModern) {
        return { passed: true, currentValue: `Protocols: ${protocolLine.trim()}` };
      }
      return { passed: false, currentValue: "No recognized TLS protocol version found" };
    },
    expectedValue: "TLSv1.2 and/or TLSv1.3 only — no TLSv1.0 or TLSv1.1",
    fixCommand:
      "# In /etc/nginx/nginx.conf or site config:\nssl_protocols TLSv1.2 TLSv1.3;\nnginx -t && systemctl reload nginx",
    explain:
      "TLS 1.0 and 1.1 are deprecated (RFC 8996). PCI-DSS 4.2.1 requires TLS 1.2 minimum. TLS 1.0 is vulnerable to POODLE and BEAST attacks. Enforcing TLSv1.2+ eliminates these protocol-level vulnerabilities.",
  },
  {
    id: "TLS-WEAK-CIPHERS",
    name: "No Weak TLS Ciphers Configured",
    severity: "critical",
    check: (output) => {
      const cipherLine = output.match(/ssl_ciphers\s+([^;]+);/i)?.[1] ?? "";
      if (!cipherLine) {
        return { passed: false, currentValue: "ssl_ciphers not explicitly configured" };
      }
      // Split on ':' and check each token — skip tokens starting with '!' (exclusion)
      // Use word-boundary-like check: cipher name appears at start, end, or surrounded by '-'
      const weakPattern = /(^|-)(RC4|DES|3DES|MD5|EXPORT|NULL|aNULL|SEED|IDEA)(-|$)/i;
      const tokens = cipherLine.split(":").map((t) => t.trim());
      const weakFound = tokens.filter((t) => !t.startsWith("!") && weakPattern.test(t));
      if (weakFound.length > 0) {
        return { passed: false, currentValue: `Weak ciphers found: ${weakFound.join(", ")}` };
      }
      return { passed: true, currentValue: `Ciphers: ${cipherLine.trim()}` };
    },
    expectedValue: "No RC4, DES, 3DES, MD5, EXPORT, NULL, aNULL, SEED, or IDEA ciphers in ssl_ciphers",
    fixCommand:
      "# In /etc/nginx/nginx.conf or site config:\nssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:!aNULL:!MD5;\nnginx -t && systemctl reload nginx",
    explain:
      "Weak ciphers like RC4 (RFC 7465), DES, 3DES (Sweet32), and EXPORT-grade ciphers are cryptographically broken. They can be exploited via BEAST, POODLE, SWEET32, and CRIME attacks to decrypt TLS traffic. Only ECDHE/DHE with AES-GCM or ChaCha20 ciphers should be allowed.",
  },
  {
    id: "TLS-HSTS",
    name: "HTTP Strict Transport Security Enabled",
    severity: "warning",
    check: (output) => {
      if (output.includes("Strict-Transport-Security")) {
        const maxAgeMatch = output.match(/max-age\s*=\s*(\d+)/i);
        if (maxAgeMatch && parseInt(maxAgeMatch[1], 10) < 31536000) {
          return { passed: false, currentValue: `HSTS max-age too low: ${maxAgeMatch[1]} (need >= 31536000)` };
        }
        return { passed: true, currentValue: "HSTS header configured in Nginx" };
      }
      return { passed: false, currentValue: "Strict-Transport-Security header not configured" };
    },
    expectedValue: "add_header Strict-Transport-Security header with max-age >= 31536000",
    fixCommand:
      'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;\nnginx -t && systemctl reload nginx',
    explain:
      "HTTP Strict Transport Security (HSTS) prevents protocol downgrade attacks by instructing browsers to only connect via HTTPS. Without HSTS, attackers can perform SSL stripping attacks that silently downgrade HTTPS connections to HTTP, exposing credentials and session tokens.",
  },
  {
    id: "TLS-OCSP",
    name: "OCSP Stapling Enabled",
    severity: "warning",
    check: (output) => {
      if (/ssl_stapling\s+on/i.test(output)) {
        return { passed: true, currentValue: "OCSP stapling is enabled" };
      }
      if (/ssl_stapling\s+off/i.test(output)) {
        return { passed: false, currentValue: "OCSP stapling is explicitly disabled" };
      }
      return { passed: false, currentValue: "ssl_stapling directive not configured" };
    },
    expectedValue: "ssl_stapling on; ssl_stapling_verify on; configured",
    fixCommand:
      "ssl_stapling on;\nssl_stapling_verify on;\nresolver 1.1.1.1 8.8.8.8 valid=300s;\nresolver_timeout 5s;\nnginx -t && systemctl reload nginx",
    explain:
      "OCSP stapling allows Nginx to provide certificate revocation status during the TLS handshake, eliminating the need for clients to contact the CA directly. This improves connection speed and privacy, and ensures clients know immediately if a certificate has been revoked.",
  },
  {
    id: "TLS-CERT-EXPIRY",
    name: "TLS Certificate Valid for >= 30 Days",
    severity: "warning",
    check: (output) => {
      if (output.includes("CERT_VALID_30DAYS")) {
        return { passed: true, currentValue: "Certificate valid for at least 30 more days" };
      }
      if (output.includes("CERT_EXPIRING_SOON")) {
        return { passed: false, currentValue: "Certificate expires within 30 days" };
      }
      if (output.includes("CERT_NOT_FOUND")) {
        return { passed: false, currentValue: "TLS certificate file not found or not readable" };
      }
      return { passed: false, currentValue: "Certificate expiry could not be determined" };
    },
    expectedValue: "Certificate valid for >= 30 days",
    fixCommand:
      "# Renew with certbot:\ncertbot renew --nginx\n# Or with acme.sh:\nacme.sh --renew -d yourdomain.com",
    explain:
      "Expired TLS certificates cause browser warnings and connection failures, breaking all HTTPS traffic immediately. Certificates expiring within 30 days should be renewed proactively to avoid service disruption. Let's Encrypt auto-renewal with certbot or acme.sh handles this automatically.",
  },
  {
    id: "TLS-DH-PARAM",
    name: "DH Parameters >= 2048 Bits",
    severity: "warning",
    check: (output) => {
      if (output.includes("NO_DH_PARAM")) {
        return { passed: false, currentValue: "ssl_dhparam not configured — using Nginx default (may be 1024-bit)" };
      }
      const match = output.match(/DH Parameters:\s*\((\d+)\s+bit\)/i);
      if (!match) {
        return { passed: false, currentValue: "DH parameter bit length could not be determined" };
      }
      const bits = parseInt(match[1], 10);
      if (bits >= 2048) {
        return { passed: true, currentValue: `DH Parameters: ${bits} bits` };
      }
      return { passed: false, currentValue: `DH Parameters too weak: ${bits} bits (minimum 2048)` };
    },
    expectedValue: "ssl_dhparam configured with >= 2048-bit DH parameters",
    fixCommand:
      "# Generate 2048-bit DH params (takes a few minutes):\nopenssl dhparam -out /etc/ssl/dhparams.pem 2048\n# Then in nginx.conf:\nssl_dhparam /etc/ssl/dhparams.pem;\nnginx -t && systemctl reload nginx",
    explain:
      "Weak Diffie-Hellman parameters (1024-bit) are vulnerable to the Logjam attack (CVE-2015-4000), enabling a man-in-the-middle attacker to downgrade TLS connections and decrypt them. PCI-DSS 4.2.1 requires DH parameters of at least 2048 bits for all TLS connections.",
  },
  {
    id: "TLS-COMPRESSION",
    name: "TLS Compression Disabled",
    severity: "warning",
    check: (output) => {
      if (/ssl_compression\s+on/i.test(output)) {
        return { passed: false, currentValue: "TLS compression is explicitly enabled — vulnerable to CRIME" };
      }
      // Absence or explicit off is safe (Nginx default since 1.3.2)
      if (/ssl_compression\s+off/i.test(output)) {
        return { passed: true, currentValue: "TLS compression is explicitly disabled" };
      }
      return { passed: true, currentValue: "TLS compression not set — default off (safe since Nginx 1.3.2)" };
    },
    expectedValue: "ssl_compression off or absent (Nginx default is off since 1.3.2)",
    fixCommand:
      "# In /etc/nginx/nginx.conf or site config:\nssl_compression off;\nnginx -t && systemctl reload nginx",
    explain:
      "TLS compression is vulnerable to the CRIME attack (CVE-2012-4929) which allows an attacker to recover secret HTTP headers (including session cookies and CSRF tokens) from encrypted TLS traffic using a chosen-plaintext attack. Nginx has disabled it by default since version 1.3.2.",
  },
  {
    id: "TLS-CERT-CHAIN",
    name: "TLS Certificate Chain Complete",
    severity: "warning",
    check: (output) => {
      if (output.includes("CERT_VERIFY_NOT_POSSIBLE")) {
        return { passed: false, currentValue: "Certificate chain verification not possible" };
      }
      if (output.includes(": OK")) {
        return { passed: true, currentValue: "Certificate chain verified successfully" };
      }
      if (output.includes("unable to get local issuer certificate")) {
        return { passed: false, currentValue: "Certificate chain incomplete — missing intermediate certificate" };
      }
      return { passed: false, currentValue: "Certificate chain verification failed or result unknown" };
    },
    expectedValue: "openssl verify output contains ': OK' — full chain trusted",
    fixCommand:
      "# Ensure your ssl_certificate file includes the full chain (cert + intermediates):\n# Download the intermediate cert from your CA and append it:\ncat domain.crt intermediate.crt > /etc/ssl/fullchain.pem\n# Update nginx.conf: ssl_certificate /etc/ssl/fullchain.pem;\nnginx -t && systemctl reload nginx",
    explain:
      "An incomplete certificate chain causes TLS handshake failures in strict clients (iOS, Chrome) that do not fetch intermediate certificates automatically. Missing intermediate certificates result in 'SSL_ERROR_BAD_CERT_DOMAIN' or 'NET::ERR_CERT_AUTHORITY_INVALID' errors that break HTTPS for end users.",
  },
];

const CATEGORY = "TLS Hardening";

function makeNginxSkippedChecks(): AuditCheck[] {
  return TLS_CHECKS.map((def) => ({
    id: def.id,
    category: CATEGORY,
    name: def.name,
    severity: "info" as const,
    passed: true,
    currentValue: "Nginx not installed",
    expectedValue: def.expectedValue,
    fixCommand: def.fixCommand,
    explain: def.explain,
  }));
}

export const parseTlsChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isSkipped =
    !sectionOutput ||
    sectionOutput.trim() === "" ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.includes("NGINX_NOT_INSTALLED");

  if (isSkipped) {
    return makeNginxSkippedChecks();
  }

  return TLS_CHECKS.map((def) => {
    const { passed, currentValue } = def.check(sectionOutput);
    return {
      id: def.id,
      category: CATEGORY,
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
