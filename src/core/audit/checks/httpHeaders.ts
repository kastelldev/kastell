/**
 * HTTP Security Headers check parser.
 * Parses HTTP response headers into 6 security checks.
 * If Nginx is not installed or HTTP is not responding, returns info-level skipped checks (score-neutral).
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";
import { makeSkippedChecks } from "./shared/skipChecks.js";

interface HttpHeaderCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const CATEGORY = "HTTP Security Headers";

const HTTP_HEADER_CHECKS: HttpHeaderCheckDef[] = [
  {
    id: "HDR-001",
    name: "X-Frame-Options or CSP frame-ancestors",
    severity: "warning",
    check: (output) => {
      const hasXFO = /x-frame-options\s*:/i.test(output);
      const hasCSPFrameAncestors = /content-security-policy[^:]*:.*frame-ancestors/i.test(output);
      if (hasXFO || hasCSPFrameAncestors) {
        const val = hasXFO ? "X-Frame-Options present" : "CSP frame-ancestors present";
        return { passed: true, currentValue: val };
      }
      return { passed: false, currentValue: "X-Frame-Options and CSP frame-ancestors both absent" };
    },
    expectedValue: "X-Frame-Options header or CSP frame-ancestors directive present",
    fixCommand: 'add_header X-Frame-Options "SAMEORIGIN" always;\nnginx -t && systemctl reload nginx',
    explain:
      "X-Frame-Options or CSP frame-ancestors prevents clickjacking attacks by restricting which sites can embed your pages in iframes. Without this header, attackers can overlay invisible iframes on legitimate sites to hijack user clicks and steal credentials or trigger unintended actions.",
  },
  {
    id: "HDR-002",
    name: "X-Content-Type-Options: nosniff",
    severity: "warning",
    check: (output) => {
      const has = /x-content-type-options\s*:\s*nosniff/i.test(output);
      if (has) return { passed: true, currentValue: "X-Content-Type-Options: nosniff present" };
      return { passed: false, currentValue: "X-Content-Type-Options header absent or not set to nosniff" };
    },
    expectedValue: "X-Content-Type-Options: nosniff header present",
    fixCommand: 'add_header X-Content-Type-Options "nosniff" always;\nnginx -t && systemctl reload nginx',
    explain:
      "X-Content-Type-Options: nosniff prevents browsers from MIME-type sniffing, which can turn non-executable MIME types into executable content. Without this header, attackers can exploit MIME confusion to execute malicious scripts disguised as harmless file types like images or stylesheets.",
  },
  {
    id: "HDR-003",
    name: "Referrer-Policy present",
    severity: "info",
    check: (output) => {
      const has = /referrer-policy\s*:/i.test(output);
      if (has) return { passed: true, currentValue: "Referrer-Policy header present" };
      return { passed: false, currentValue: "Referrer-Policy header absent" };
    },
    expectedValue: "Referrer-Policy header present (e.g. strict-origin-when-cross-origin)",
    fixCommand: 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;\nnginx -t && systemctl reload nginx',
    explain:
      "Referrer-Policy controls how much URL information the browser sends when navigating away from your site. Without this header, full URLs including query parameters, tokens, and internal paths may leak to third-party sites via the Referer header, potentially exposing sensitive data.",
  },
  {
    id: "HDR-004",
    name: "Permissions-Policy present",
    severity: "info",
    check: (output) => {
      const has = /permissions-policy\s*:/i.test(output);
      if (has) return { passed: true, currentValue: "Permissions-Policy header present" };
      return { passed: false, currentValue: "Permissions-Policy header absent" };
    },
    expectedValue: "Permissions-Policy header present (restricts browser features)",
    fixCommand:
      'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;\nnginx -t && systemctl reload nginx',
    explain:
      "Permissions-Policy restricts which browser features (camera, microphone, geolocation, payment) can be used by your site and embedded iframes. Without this header, malicious scripts or third-party iframes can silently access sensitive device APIs to record audio, track location, or initiate payments.",
  },
  {
    id: "HDR-005",
    name: "No CORS Wildcard (Access-Control-Allow-Origin)",
    severity: "warning",
    check: (output) => {
      const wildcardFound = /access-control-allow-origin\s*:\s*\*/i.test(output);
      if (wildcardFound) {
        return { passed: false, currentValue: "Access-Control-Allow-Origin: * (wildcard) detected" };
      }
      return { passed: true, currentValue: "No CORS wildcard — safe" };
    },
    expectedValue: "No Access-Control-Allow-Origin: * wildcard (use specific origins)",
    fixCommand:
      'add_header Access-Control-Allow-Origin "https://yourdomain.com" always;\nnginx -t && systemctl reload nginx',
    explain:
      "Access-Control-Allow-Origin: * allows any website to make cross-origin requests to your server and read the responses. This enables credential theft, data exfiltration, and CSRF attacks from any malicious site. Always specify exact allowed origins instead of using the wildcard.",
  },
  {
    id: "HDR-006",
    name: "Content-Security-Policy present",
    severity: "warning",
    check: (output) => {
      const has = /content-security-policy\s*:/i.test(output);
      if (has) return { passed: true, currentValue: "Content-Security-Policy header present" };
      return { passed: false, currentValue: "Content-Security-Policy header absent" };
    },
    expectedValue: "Content-Security-Policy header present (defense against XSS)",
    fixCommand:
      "add_header Content-Security-Policy \"default-src 'self'\" always;\nnginx -t && systemctl reload nginx",
    explain:
      "Content-Security-Policy (CSP) is the primary defense against cross-site scripting (XSS) attacks. It restricts which sources can load scripts, styles, images, and other resources. Without CSP, any injected script tag or inline JavaScript can execute with full access to session cookies, DOM, and user data.",
  },
];

export const parseHttpHeadersChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isSkipped =
    !sectionOutput ||
    sectionOutput.trim() === "" ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.includes("NGINX_NOT_INSTALLED") ||
    sectionOutput.includes("HTTP_NOT_RESPONDING");

  if (isSkipped) {
    return makeSkippedChecks(HTTP_HEADER_CHECKS, CATEGORY, "Nginx not installed or HTTP not responding");
  }

  return HTTP_HEADER_CHECKS.map((def) => {
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
