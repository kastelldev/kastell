/**
 * WAF & Reverse Proxy check parser.
 * Parses Nginx configuration output into 9 security checks (8 config + 1 WAF detection).
 * If Nginx is not installed, returns info-level skipped checks (score-neutral).
 * Detects Caddy/Traefik as alternative reverse proxies and reports in skip message.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";
import { makeSkippedChecks } from "./shared/skipChecks.js";

const CATEGORY = "WAF & Reverse Proxy";

interface NgxCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const NGX_CHECKS: NgxCheckDef[] = [
  {
    id: "NGX-SERVER-TOKENS",
    name: "server_tokens off",
    severity: "warning",
    check: (output) => {
      if (/server_tokens\s+off/i.test(output)) {
        return { passed: true, currentValue: "server_tokens off" };
      }
      if (/server_tokens/i.test(output)) {
        return { passed: false, currentValue: "server_tokens not set to off" };
      }
      return { passed: false, currentValue: "server_tokens directive not found" };
    },
    expectedValue: "server_tokens off",
    fixCommand: "Add 'server_tokens off;' to nginx.conf http block",
    explain:
      "Hiding Nginx version information prevents attackers from targeting known vulnerabilities for a specific version. The server_tokens directive controls whether Nginx sends its version number in the Server HTTP response header and on error pages.",
  },
  {
    id: "NGX-SSL-PROTOCOLS",
    name: "ssl_protocols explicitly configured",
    severity: "warning",
    check: (output) => {
      if (/ssl_protocols/i.test(output)) {
        return { passed: true, currentValue: "ssl_protocols directive present" };
      }
      return { passed: false, currentValue: "ssl_protocols directive not found" };
    },
    expectedValue: "ssl_protocols directive present",
    fixCommand: "Add 'ssl_protocols TLSv1.2 TLSv1.3;' to nginx.conf http or server block",
    explain:
      "Explicitly configuring ssl_protocols ensures only modern TLS versions are accepted. Without explicit configuration, Nginx may accept outdated protocols depending on the compiled defaults.",
  },
  {
    id: "NGX-RATE-LIMIT",
    name: "Rate limiting configured",
    severity: "warning",
    check: (output) => {
      if (/limit_req_zone|limit_req\s/i.test(output)) {
        return { passed: true, currentValue: "Rate limiting configured (limit_req_zone or limit_req)" };
      }
      return { passed: false, currentValue: "No rate limiting directives found" };
    },
    expectedValue: "Rate limiting configured (limit_req_zone or limit_req)",
    fixCommand:
      "Add rate limiting: limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s; and limit_req zone=one burst=20 nodelay; in appropriate blocks",
    explain:
      "Rate limiting protects against brute-force attacks and resource exhaustion by restricting the number of requests per client. Without rate limiting, a single client can overwhelm the server.",
  },
  {
    id: "NGX-GZIP-CONFIG",
    name: "gzip compression configured",
    severity: "info",
    check: (output) => {
      if (/gzip/i.test(output)) {
        return { passed: true, currentValue: "gzip directive configured" };
      }
      return { passed: false, currentValue: "gzip directive not found" };
    },
    expectedValue: "gzip directive configured",
    fixCommand:
      "Add 'gzip on; gzip_types text/plain text/css application/json application/javascript;' to nginx.conf http block",
    explain:
      "Configuring gzip compression reduces bandwidth usage and improves page load times. Note: gzip on dynamic content with HTTPS can be vulnerable to BREACH attacks. Consider limiting gzip_types to static assets only.",
  },
  {
    id: "NGX-CLIENT-BODY-SIZE",
    name: "client_max_body_size configured",
    severity: "warning",
    check: (output) => {
      if (/client_max_body_size/i.test(output)) {
        return { passed: true, currentValue: "client_max_body_size directive present" };
      }
      return { passed: false, currentValue: "client_max_body_size directive not found" };
    },
    expectedValue: "client_max_body_size directive present",
    fixCommand: "Add 'client_max_body_size 10m;' (adjust value) to nginx.conf http or server block",
    explain:
      "Setting client_max_body_size limits the maximum request body size, preventing large file uploads that could exhaust server resources or be used in denial-of-service attacks. Nginx default is 1MB, which may be too permissive or too restrictive depending on application needs.",
  },
  {
    id: "NGX-SERVER-HEADER",
    name: "Server header suppression configured",
    severity: "info",
    check: (output) => {
      if (/more_clear_headers|proxy_hide_header\s+Server|server_header_hide/i.test(output)) {
        return { passed: true, currentValue: "Server header suppression configured" };
      }
      return { passed: false, currentValue: "Server header suppression not configured" };
    },
    expectedValue: "Server header suppression configured",
    fixCommand:
      "Install headers-more module and add 'more_clear_headers Server;' or use 'proxy_hide_header Server;' to suppress the Server response header",
    explain:
      "Suppressing the Server response header reduces information disclosure. While server_tokens off hides the version, the Server header still reveals Nginx is in use. Full suppression requires the headers-more module or proxy_hide_header directive.",
  },
  {
    id: "NGX-ACCESS-LOG",
    name: "access_log enabled",
    severity: "warning",
    check: (output) => {
      if (/access_log/i.test(output) && !/access_log\s+off/i.test(output)) {
        return { passed: true, currentValue: "access_log enabled (not off)" };
      }
      if (/access_log\s+off/i.test(output)) {
        return { passed: false, currentValue: "access_log is set to off" };
      }
      return { passed: false, currentValue: "access_log directive not found" };
    },
    expectedValue: "access_log enabled (not off)",
    fixCommand: "Ensure 'access_log' is configured in nginx.conf and not set to 'off'",
    explain:
      "Access logs are essential for incident investigation, traffic analysis, and compliance. Disabling access logging creates blind spots in security monitoring and makes forensic analysis impossible after an incident.",
  },
  {
    id: "NGX-ERROR-LOG",
    name: "error_log directive present",
    severity: "warning",
    check: (output) => {
      if (/error_log/i.test(output)) {
        return { passed: true, currentValue: "error_log directive present" };
      }
      return { passed: false, currentValue: "error_log directive not found" };
    },
    expectedValue: "error_log directive present",
    fixCommand:
      "Ensure 'error_log' is configured in nginx.conf (e.g., 'error_log /var/log/nginx/error.log warn;')",
    explain:
      "Error logs capture server-side issues, misconfigurations, and upstream failures. They are critical for troubleshooting and detecting attacks that cause 4xx/5xx errors.",
  },
];

const WAF_CHECK: NgxCheckDef = {
  id: "NGX-WAF-DETECTED",
  name: "WAF detection (ModSecurity/Coraza)",
  severity: "info",
  check: (output) => {
    if (/modsecurity/i.test(output) && !/NO_WAF/i.test(output)) {
      return { passed: true, currentValue: "ModSecurity active" };
    }
    if (/coraza/i.test(output) && !/NO_WAF/i.test(output)) {
      return { passed: true, currentValue: "Coraza WAF active" };
    }
    return { passed: true, currentValue: "No WAF detected (informational — no score penalty)" };
  },
  expectedValue: "WAF detection (informational)",
  fixCommand:
    "# Install ModSecurity for Nginx:\napt-get install -y libnginx-mod-http-modsecurity\n# Enable in nginx.conf: modsecurity on; modsecurity_rules_file /etc/nginx/modsecurity/main.conf;",
  explain:
    "A Web Application Firewall (WAF) like ModSecurity or Coraza provides runtime protection against common web attacks (SQL injection, XSS, etc.). PCI-DSS v4.0 Requirement 6.4.2 requires a WAF for public-facing web applications. This check detects WAF presence — it does not penalize absence.",
};

export const parseNginxChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNginxAbsent =
    !sectionOutput ||
    sectionOutput.trim() === "" ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.includes("NGINX_NOT_INSTALLED");

  if (isNginxAbsent) {
    // Per D-05: Detect alternative reverse proxy
    const altMatch = sectionOutput?.match(/ALT_RP:(\w+)/);
    const reason = altMatch
      ? `Alternative reverse proxy detected: ${altMatch[1].charAt(0).toUpperCase() + altMatch[1].slice(1)} — Nginx checks skipped`
      : "Nginx not installed";
    return makeSkippedChecks([...NGX_CHECKS, WAF_CHECK], CATEGORY, reason);
  }

  const allChecks = [...NGX_CHECKS, WAF_CHECK];

  return allChecks.map((def) => {
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
