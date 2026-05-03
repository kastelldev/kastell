/**
 * WAF & Reverse Proxy check parser.
 * Parses Nginx configuration output into 9 security checks (8 config + 1 WAF detection).
 * If Nginx is not installed, returns info-level skipped checks (score-neutral).
 * Detects Caddy/Traefik as alternative reverse proxies and reports in skip message.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";
import { makeSkippedChecks } from "./shared/skipChecks.js";

const CATEGORY = "WAF & Reverse Proxy";

interface NgxCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string, noWaf?: boolean) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const NGX_CHECKS: NgxCheckDef[] = [
  {
    id: CHECK_IDS.NGINX.NGX_SERVER_TOKENS,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Hiding Nginx version information prevents attackers from targeting known vulnerabilities for a specific version. The server_tokens directive controls whether Nginx sends its version number in the Server HTTP response header and on error pages.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_SSL_PROTOCOLS,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Explicitly configuring ssl_protocols ensures only modern TLS versions are accepted. Without explicit configuration, Nginx may accept outdated protocols depending on the compiled defaults.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_RATE_LIMIT,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Rate limiting protects against brute-force attacks and resource exhaustion by restricting the number of requests per client. Without rate limiting, a single client can overwhelm the server.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_GZIP_CONFIG,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Configuring gzip compression reduces bandwidth usage and improves page load times. Note: gzip on dynamic content with HTTPS can be vulnerable to BREACH attacks. Consider limiting gzip_types to static assets only.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_CLIENT_BODY_SIZE,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Setting client_max_body_size limits the maximum request body size, preventing large file uploads that could exhaust server resources or be used in denial-of-service attacks. Nginx default is 1MB, which may be too permissive or too restrictive depending on application needs.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_SERVER_HEADER,
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
    safeToAutoFix: "SAFE",
    explain:
      "Suppressing the Server response header reduces information disclosure. While server_tokens off hides the version, the Server header still reveals Nginx is in use. Full suppression requires the headers-more module or proxy_hide_header directive.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_ACCESS_LOG,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Access logs are essential for incident investigation, traffic analysis, and compliance. Disabling access logging creates blind spots in security monitoring and makes forensic analysis impossible after an incident.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_ERROR_LOG,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Error logs capture server-side issues, misconfigurations, and upstream failures. They are critical for troubleshooting and detecting attacks that cause 4xx/5xx errors.",
  },
];

const WAF_CHECK: NgxCheckDef = {
  id: CHECK_IDS.NGINX.NGX_WAF_DETECTED,
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
  safeToAutoFix: "GUARDED",
  explain:
    "A Web Application Firewall (WAF) like ModSecurity or Coraza provides runtime protection against common web attacks (SQL injection, XSS, etc.). PCI-DSS v4.0 Requirement 6.4.2 requires a WAF for public-facing web applications. This check detects WAF presence — it does not penalize absence.",
};

/** Returns true if no WAF (modsecurity/coraza) is detected in the output. */
function isNoWaf(output: string): boolean {
  return !/modsecurity|coraza/i.test(output) || /NO_WAF/i.test(output);
}

const WAF_SKIP_MSG = "WAF not installed \u2014 advanced checks skipped";

const RE_IP_ACL = /^\s*(deny|allow)\s+(?!all\b)/im;
const RE_RATE_LIMIT_ID = /SecRule\s+(IP:|REQUEST_HEADERS|REMOTE_ADDR)[^;]*id['":\s]*9\d{2}/i;
const RE_RATE_LIMIT_GT = /SecRule\s+\S+\s+["'][^'"]*@gt\s+\d+/i;
const RE_BOT_CRS = /REQUEST-913|scanner-detection|bot-detection/i;
const RE_BOT_UA_MAP = /map\s+\$http_user_agent/i;
const RE_CHALLENGE_MODSEC = /redirect:\/captcha|redirect:\/challenge|SecAction.*challenge/i;
const RE_CHALLENGE_NGINX = /error_page.*challenge/i;

const WAF_DEEP_CHECKS: NgxCheckDef[] = [
  {
    id: CHECK_IDS.NGINX.NGX_WAF_IP_ACL,
    name: "IP ACL rules configured (deny/allow directives)",
    severity: "warning",
    check: (output) => {
      if (/NO_IP_ACL/i.test(output)) {
        return { passed: false, currentValue: "No IP ACL rules found (deny/allow directives absent)" };
      }
      // Match deny or allow directives (excluding 'allow all' which is too permissive)
      if (RE_IP_ACL.test(output)) {
        return { passed: true, currentValue: "IP ACL rules configured (deny/allow directives present)" };
      }
      return { passed: false, currentValue: "No IP ACL rules found (deny/allow directives absent)" };
    },
    expectedValue: "IP ACL rules configured (deny/allow directives)",
    fixCommand: "Add IP ACL rules to nginx: deny <blocked-ip>; or allow <trusted-ip>;",
    safeToAutoFix: "GUARDED",
    explain:
      "IP ACL rules (deny/allow directives) restrict access to specific IP addresses or ranges, providing a first line of defense against known malicious sources. Without IP ACLs, any IP address can attempt to access the server. Configure deny directives to block known bad actors and allow directives to whitelist trusted sources.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_WAF_RATE_LIMIT,
    name: "WAF rate limit rules active",
    severity: "info",
    check: (output, noWaf) => {
      if (noWaf) {
        return { passed: true, currentValue: WAF_SKIP_MSG };
      }
      if (RE_RATE_LIMIT_ID.test(output) || RE_RATE_LIMIT_GT.test(output)) {
        return { passed: true, currentValue: "ModSecurity rate limit rules active" };
      }
      return { passed: false, currentValue: "No ModSecurity rate limit rules found" };
    },
    expectedValue: "ModSecurity rate limit rules active",
    fixCommand:
      "Add ModSecurity rate limit rules: SecRule IP:REMOTE_ADDR \"@gt 100\" id:900100,phase:1,deny,status:429",
    safeToAutoFix: "GUARDED",
    explain:
      "ModSecurity rate limit rules complement nginx's built-in rate limiting by providing WAF-level request throttling with deeper inspection capabilities. They can detect and block volumetric attacks and brute-force attempts at the application layer, providing more granular control than IP-level rate limits.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_WAF_INPUT_SANITIZE,
    name: "SecRuleEngine active (On or DetectionOnly)",
    severity: "info",
    check: (output, noWaf) => {
      if (noWaf) {
        return { passed: true, currentValue: WAF_SKIP_MSG };
      }
      if (/SecRuleEngine\s+(On|DetectionOnly)/i.test(output)) {
        return { passed: true, currentValue: "SecRuleEngine active — input sanitization enabled" };
      }
      return { passed: false, currentValue: "SecRuleEngine not active or set to Off" };
    },
    expectedValue: "SecRuleEngine active (On or DetectionOnly)",
    fixCommand:
      "Enable ModSecurity: add 'SecRuleEngine On;' (or 'DetectionOnly' for audit mode) to modsecurity.conf",
    safeToAutoFix: "GUARDED",
    explain:
      "SecRuleEngine On activates ModSecurity's rule engine to inspect and sanitize incoming requests, blocking SQL injection, XSS, path traversal, and other OWASP Top 10 attacks. DetectionOnly mode logs violations without blocking — useful for initial rollout. Without this setting active, the WAF provides no protection even if installed.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_WAF_DETECTION_ENGINE,
    name: "CRS rules installed (>0 rule files)",
    severity: "info",
    check: (output, noWaf) => {
      if (noWaf) {
        return { passed: true, currentValue: WAF_SKIP_MSG };
      }
      // The CRS rule count comes from `ls /usr/share/modsecurity-crs/rules/ | wc -l`
      // It appears as a standalone number line after the WAF detection line
      const countMatch = output.match(/^(\d+)$/m);
      if (countMatch && parseInt(countMatch[1], 10) > 0) {
        return { passed: true, currentValue: `CRS rules installed (${countMatch[1]} rule files)` };
      }
      return { passed: false, currentValue: "No CRS rule files found (0 or missing)" };
    },
    expectedValue: "CRS rules installed (>0 rule files)",
    fixCommand:
      "Install OWASP CRS: apt-get install -y modsecurity-crs && ln -s /usr/share/modsecurity-crs/rules /etc/nginx/modsecurity/",
    safeToAutoFix: "GUARDED",
    explain:
      "The OWASP Core Rule Set (CRS) provides ModSecurity with pre-built detection rules covering OWASP Top 10 threats. Without CRS rules, a WAF engine is present but has no detection capability. CRS includes rules for SQL injection, XSS, local/remote file inclusion, command injection, and many other attack vectors.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_WAF_DATA_MASKING,
    name: "Sensitive response headers filtered",
    severity: "info",
    check: (output) => {
      // Look for proxy_hide_header or more_clear_headers targeting app-layer sensitive headers
      // (NOT 'Server' which is already covered by NGX-SERVER-HEADER)
      if (/proxy_hide_header\s+(X-Powered-By|X-AspNet|X-Generator)/i.test(output) ||
          /more_clear_headers\s+['"]?(X-Powered-By|X-AspNet|X-Generator)/i.test(output)) {
        return { passed: true, currentValue: "Sensitive response headers filtered (proxy_hide_header/more_clear_headers)" };
      }
      return { passed: false, currentValue: "No sensitive header filtering found" };
    },
    expectedValue: "Sensitive response headers filtered (proxy_hide_header/more_clear_headers)",
    fixCommand:
      "Add to nginx location/server block: proxy_hide_header X-Powered-By; proxy_hide_header X-AspNet-Version;",
    safeToAutoFix: "GUARDED",
    explain:
      "Filtering sensitive response headers like X-Powered-By and X-AspNet-Version prevents information disclosure about the backend technology stack. Attackers use this information to target known vulnerabilities in specific framework versions. proxy_hide_header removes upstream headers, while more_clear_headers (from headers-more module) can remove any header.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_WAF_BOT_DETECT,
    name: "Bot detection rules configured (ModSec CRS 913 or UA map)",
    severity: "info",
    check: (output, noWaf) => {
      if (noWaf) {
        return { passed: true, currentValue: WAF_SKIP_MSG };
      }
      const hasCrsBot = RE_BOT_CRS.test(output);
      const hasUaMap = RE_BOT_UA_MAP.test(output);
      if (hasCrsBot || hasUaMap) {
        const detected = [hasCrsBot && "CRS 913 rules", hasUaMap && "UA map"].filter(Boolean).join(" + ");
        return { passed: true, currentValue: `Bot detection configured (${detected})` };
      }
      return { passed: false, currentValue: "No bot detection rules found (CRS 913 or UA map absent)" };
    },
    expectedValue: "Bot detection rules configured",
    fixCommand:
      "# Install OWASP CRS scanner-detection rules:\n# CRS includes REQUEST-913-SCANNER-DETECTION.conf\n# Or add nginx UA map: map $http_user_agent $bad_bot { ... }",
    safeToAutoFix: "GUARDED",
    explain:
      "Bot detection rules identify and block automated scanning tools and known bad bots. OWASP CRS rules 913xxx detect scanners (Nmap, Nikto, etc.). Nginx UA map blocks by user agent string. Without bot detection, automated reconnaissance runs unchallenged.",
  },
  {
    id: CHECK_IDS.NGINX.NGX_WAF_CHALLENGE_MODE,
    name: "Challenge mode configured (JS PoW/CAPTCHA redirect)",
    severity: "info",
    check: (output, noWaf) => {
      if (noWaf) {
        return { passed: true, currentValue: WAF_SKIP_MSG };
      }
      const hasModSecChallenge = RE_CHALLENGE_MODSEC.test(output);
      const hasNginxChallenge = RE_CHALLENGE_NGINX.test(output);
      if (hasModSecChallenge || hasNginxChallenge) {
        return { passed: true, currentValue: "Challenge mode configured (redirect/CAPTCHA pattern detected)" };
      }
      return { passed: false, currentValue: "No challenge mode configured (no CAPTCHA/JS PoW redirect found)" };
    },
    expectedValue: "Challenge mode configured",
    fixCommand:
      "# Configure challenge mode:\n# ModSec: SecAction \"id:900700,phase:1,redirect:/captcha\"\n# Nginx: error_page 403 /challenge.html;",
    safeToAutoFix: "GUARDED",
    explain:
      "Challenge mode (JS Proof-of-Work or CAPTCHA) gates suspicious requests before reaching the application, blocking automated attacks without permanent bans. It reduces false positives compared to outright denial. Configured via ModSec SecAction redirect rules or Nginx error_page directives.",
  },
];

const ALL_CHECKS: NgxCheckDef[] = [...NGX_CHECKS, WAF_CHECK, ...WAF_DEEP_CHECKS];

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
    const altMatch = sectionOutput?.match(/ALT_RP:(\w+)/);
    const reason = altMatch
      ? `Alternative reverse proxy detected: ${altMatch[1].charAt(0).toUpperCase() + altMatch[1].slice(1)} — Nginx checks skipped`
      : "Nginx not installed";
    return makeSkippedChecks(ALL_CHECKS, CATEGORY, reason);
  }

  const noWaf = isNoWaf(sectionOutput);

  return ALL_CHECKS.map((def) => {
    const { passed, currentValue } = def.check(sectionOutput, noWaf);
    return {
      id: def.id,
      category: CATEGORY,
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
