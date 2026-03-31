import { parseNginxChecks } from "../../src/core/audit/checks/nginx.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_NGINX_OUTPUT = [
  "server_tokens off;",
  "ssl_protocols TLSv1.2 TLSv1.3;",
  "limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;",
  "gzip on;",
  "gzip_types text/plain text/css application/json;",
  "client_max_body_size 50m;",
  "more_clear_headers Server;",
  "access_log /var/log/nginx/access.log combined;",
  "error_log /var/log/nginx/error.log warn;",
  "modsecurity on;",
  // WAF deep checks
  "SecRuleEngine On",
  "SecRule IP:REMOTE_ADDR id:900",
  "10",
  "  deny 10.0.0.0/8;",
  "proxy_hide_header X-Powered-By;",
  // WAF bot detection + challenge mode
  "REQUEST-913-SCANNER-DETECTION.conf",
  "redirect:/captcha",
].join("\n");

const FULL_MODSEC_OUTPUT = [
  "server_tokens off;",
  "ssl_protocols TLSv1.2 TLSv1.3;",
  "limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;",
  "gzip on;",
  "client_max_body_size 50m;",
  "more_clear_headers Server;",
  "access_log /var/log/nginx/access.log combined;",
  "error_log /var/log/nginx/error.log warn;",
  "modsecurity on;",
  // WAF deep: SecRuleEngine, rate limit rule, CRS count, IP ACL, data masking
  "SecRuleEngine On",
  "SecRule IP:REMOTE_ADDR \"@gt 100\" id:900100",
  "15",
  "  deny 192.168.0.0/16;",
  "  allow 10.0.0.1;",
  "proxy_hide_header X-Powered-By;",
].join("\n");

const MINIMAL_NGINX_OUTPUT = [
  "server_tokens on;",
  "access_log off;",
].join("\n");

const NGINX_NOT_INSTALLED_OUTPUT = "ALT_RP:caddy\nNGINX_NOT_INSTALLED";

const TRAEFIK_NOT_INSTALLED_OUTPUT = "ALT_RP:traefik\nNGINX_NOT_INSTALLED";

const NO_WAF_OUTPUT = [
  "server_tokens off;",
  "ssl_protocols TLSv1.2 TLSv1.3;",
  "limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;",
  "gzip on;",
  "client_max_body_size 50m;",
  "more_clear_headers Server;",
  "access_log /var/log/nginx/access.log combined;",
  "error_log /var/log/nginx/error.log warn;",
  "NO_WAF",
].join("\n");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseNginxChecks — full nginx output", () => {
  it("returns exactly 16 AuditCheck objects for full valid output", () => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");
    expect(checks.length).toBe(16);
  });

  it("all check IDs start with 'NGX-'", () => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^NGX-/));
  });

  it("all checks have category 'WAF & Reverse Proxy'", () => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");
    checks.forEach((c) => expect(c.category).toBe("WAF & Reverse Proxy"));
  });

  it("all 16 checks pass with complete valid config", () => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");
    checks.forEach((c) => expect(c.passed).toBe(true));
  });
});

describe("parseNginxChecks — individual check logic", () => {
  // NGX-SERVER-TOKENS
  it("NGX-SERVER-TOKENS passes when 'server_tokens off;' present", () => {
    const checks = parseNginxChecks("server_tokens off;", "bare");
    const check = checks.find((c) => c.id === "NGX-SERVER-TOKENS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("NGX-SERVER-TOKENS fails when 'server_tokens on;' present", () => {
    const checks = parseNginxChecks("server_tokens on;", "bare");
    const check = checks.find((c) => c.id === "NGX-SERVER-TOKENS");
    expect(check!.passed).toBe(false);
  });

  it("NGX-SERVER-TOKENS fails when server_tokens directive not found", () => {
    const checks = parseNginxChecks("gzip on;", "bare");
    const check = checks.find((c) => c.id === "NGX-SERVER-TOKENS");
    expect(check!.passed).toBe(false);
  });

  // NGX-SSL-PROTOCOLS
  it("NGX-SSL-PROTOCOLS passes when 'ssl_protocols TLSv1.2 TLSv1.3;' present", () => {
    const checks = parseNginxChecks("ssl_protocols TLSv1.2 TLSv1.3;", "bare");
    const check = checks.find((c) => c.id === "NGX-SSL-PROTOCOLS");
    expect(check!.passed).toBe(true);
  });

  it("NGX-SSL-PROTOCOLS fails when ssl_protocols directive not present", () => {
    const checks = parseNginxChecks("server_tokens off;", "bare");
    const check = checks.find((c) => c.id === "NGX-SSL-PROTOCOLS");
    expect(check!.passed).toBe(false);
  });

  // NGX-RATE-LIMIT
  it("NGX-RATE-LIMIT passes when limit_req_zone present", () => {
    const checks = parseNginxChecks(
      "limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;",
      "bare",
    );
    const check = checks.find((c) => c.id === "NGX-RATE-LIMIT");
    expect(check!.passed).toBe(true);
  });

  it("NGX-RATE-LIMIT fails when no rate limiting directives found", () => {
    const checks = parseNginxChecks("server_tokens off;", "bare");
    const check = checks.find((c) => c.id === "NGX-RATE-LIMIT");
    expect(check!.passed).toBe(false);
  });

  // NGX-GZIP-CONFIG
  it("NGX-GZIP-CONFIG passes when 'gzip on;' present", () => {
    const checks = parseNginxChecks("gzip on;", "bare");
    const check = checks.find((c) => c.id === "NGX-GZIP-CONFIG");
    expect(check!.passed).toBe(true);
  });

  it("NGX-GZIP-CONFIG fails when no gzip directive", () => {
    const checks = parseNginxChecks("server_tokens off;", "bare");
    const check = checks.find((c) => c.id === "NGX-GZIP-CONFIG");
    expect(check!.passed).toBe(false);
  });

  // NGX-CLIENT-BODY-SIZE
  it("NGX-CLIENT-BODY-SIZE passes when client_max_body_size present", () => {
    const checks = parseNginxChecks("client_max_body_size 10m;", "bare");
    const check = checks.find((c) => c.id === "NGX-CLIENT-BODY-SIZE");
    expect(check!.passed).toBe(true);
  });

  it("NGX-CLIENT-BODY-SIZE fails without directive", () => {
    const checks = parseNginxChecks("server_tokens off;", "bare");
    const check = checks.find((c) => c.id === "NGX-CLIENT-BODY-SIZE");
    expect(check!.passed).toBe(false);
  });

  // NGX-SERVER-HEADER
  it("NGX-SERVER-HEADER passes when more_clear_headers Server; present", () => {
    const checks = parseNginxChecks("more_clear_headers Server;", "bare");
    const check = checks.find((c) => c.id === "NGX-SERVER-HEADER");
    expect(check!.passed).toBe(true);
  });

  it("NGX-SERVER-HEADER fails without suppression directive", () => {
    const checks = parseNginxChecks("server_tokens off;", "bare");
    const check = checks.find((c) => c.id === "NGX-SERVER-HEADER");
    expect(check!.passed).toBe(false);
  });

  // NGX-ACCESS-LOG
  it("NGX-ACCESS-LOG passes when access_log path present (not off)", () => {
    const checks = parseNginxChecks("access_log /var/log/nginx/access.log combined;", "bare");
    const check = checks.find((c) => c.id === "NGX-ACCESS-LOG");
    expect(check!.passed).toBe(true);
  });

  it("NGX-ACCESS-LOG fails when access_log is set to off", () => {
    const checks = parseNginxChecks("access_log off;", "bare");
    const check = checks.find((c) => c.id === "NGX-ACCESS-LOG");
    expect(check!.passed).toBe(false);
  });

  it("NGX-ACCESS-LOG fails when no access_log directive", () => {
    const checks = parseNginxChecks("server_tokens off;", "bare");
    const check = checks.find((c) => c.id === "NGX-ACCESS-LOG");
    expect(check!.passed).toBe(false);
  });

  // NGX-ERROR-LOG
  it("NGX-ERROR-LOG passes when error_log present", () => {
    const checks = parseNginxChecks("error_log /var/log/nginx/error.log warn;", "bare");
    const check = checks.find((c) => c.id === "NGX-ERROR-LOG");
    expect(check!.passed).toBe(true);
  });

  it("NGX-ERROR-LOG fails when no error_log directive", () => {
    const checks = parseNginxChecks("server_tokens off;", "bare");
    const check = checks.find((c) => c.id === "NGX-ERROR-LOG");
    expect(check!.passed).toBe(false);
  });
});

describe("parseNginxChecks — nginx absent", () => {
  it("returns exactly 16 checks when NGINX_NOT_INSTALLED sentinel", () => {
    const checks = parseNginxChecks("NGINX_NOT_INSTALLED", "bare");
    expect(checks.length).toBe(16);
  });

  it("all checks have passed=true (score-neutral) when NGINX_NOT_INSTALLED", () => {
    const checks = parseNginxChecks("NGINX_NOT_INSTALLED", "bare");
    checks.forEach((c) => expect(c.passed).toBe(true));
  });

  it("all checks have severity='info' when NGINX_NOT_INSTALLED", () => {
    const checks = parseNginxChecks("NGINX_NOT_INSTALLED", "bare");
    checks.forEach((c) => expect(c.severity).toBe("info"));
  });

  it("returns 16 checks with skipped currentValue for empty string", () => {
    const checks = parseNginxChecks("", "bare");
    expect(checks.length).toBe(16);
    checks.forEach((c) => expect(c.passed).toBe(true));
  });

  it("returns 16 checks for N/A input", () => {
    const checks = parseNginxChecks("N/A", "bare");
    expect(checks.length).toBe(16);
  });
});

describe("parseNginxChecks — alternative proxy detection", () => {
  it("returns 16 checks when ALT_RP:caddy sentinel present", () => {
    const checks = parseNginxChecks(NGINX_NOT_INSTALLED_OUTPUT, "bare");
    expect(checks.length).toBe(16);
  });

  it("all checks have passed=true for Caddy sentinel", () => {
    const checks = parseNginxChecks(NGINX_NOT_INSTALLED_OUTPUT, "bare");
    checks.forEach((c) => expect(c.passed).toBe(true));
  });

  it("currentValue contains 'Caddy' for all checks when ALT_RP:caddy", () => {
    const checks = parseNginxChecks(NGINX_NOT_INSTALLED_OUTPUT, "bare");
    checks.forEach((c) => expect(c.currentValue).toContain("Caddy"));
  });

  it("currentValue contains 'Traefik' for all checks when ALT_RP:traefik", () => {
    const checks = parseNginxChecks(TRAEFIK_NOT_INSTALLED_OUTPUT, "bare");
    checks.forEach((c) => expect(c.currentValue).toContain("Traefik"));
  });

  it("all Traefik sentinel checks have severity='info'", () => {
    const checks = parseNginxChecks(TRAEFIK_NOT_INSTALLED_OUTPUT, "bare");
    checks.forEach((c) => expect(c.severity).toBe("info"));
  });
});

describe("parseNginxChecks — WAF detection", () => {
  it("NGX-WAF-DETECTED passes when modsecurity on; present", () => {
    const checks = parseNginxChecks("modsecurity on;", "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTED");
    expect(check!.passed).toBe(true);
  });

  it("NGX-WAF-DETECTED currentValue contains 'ModSecurity' when modsecurity on;", () => {
    const checks = parseNginxChecks("modsecurity on;", "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTED");
    expect(check!.currentValue).toContain("ModSecurity");
  });

  it("NGX-WAF-DETECTED currentValue contains 'Coraza' when coraza present", () => {
    const checks = parseNginxChecks("coraza_waf on;", "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTED");
    expect(check!.currentValue).toContain("Coraza");
  });

  it("NGX-WAF-DETECTED passed=true when NO_WAF sentinel (informational — no penalty)", () => {
    const checks = parseNginxChecks(NO_WAF_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTED");
    expect(check!.passed).toBe(true);
  });

  it("NGX-WAF-DETECTED currentValue contains 'No WAF detected' when NO_WAF", () => {
    const checks = parseNginxChecks(NO_WAF_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTED");
    expect(check!.currentValue).toContain("No WAF detected");
  });

  it("NGX-WAF-DETECTED always passed=true regardless of WAF presence", () => {
    const outputs = [
      VALID_NGINX_OUTPUT,
      NO_WAF_OUTPUT,
      "modsecurity on;",
      "coraza_waf on;",
      "server_tokens off;",
    ];
    for (const output of outputs) {
      const checks = parseNginxChecks(output, "bare");
      const check = checks.find((c) => c.id === "NGX-WAF-DETECTED");
      expect(check!.passed).toBe(true);
    }
  });

  it("NGX-WAF-DETECTED has severity 'info'", () => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTED");
    expect(check!.severity).toBe("info");
  });
});

describe("parseNginxChecks — check metadata", () => {
  it.each([
    "NGX-SERVER-TOKENS",
    "NGX-SSL-PROTOCOLS",
    "NGX-RATE-LIMIT",
    "NGX-GZIP-CONFIG",
    "NGX-CLIENT-BODY-SIZE",
    "NGX-SERVER-HEADER",
    "NGX-ACCESS-LOG",
    "NGX-ERROR-LOG",
    "NGX-WAF-DETECTED",
  ])("%s has explain.length > 20", (checkId) => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === checkId);
    expect(check).toBeDefined();
    expect((check!.explain ?? "").length).toBeGreaterThan(20);
  });

  it.each([
    "NGX-SERVER-TOKENS",
    "NGX-SSL-PROTOCOLS",
    "NGX-RATE-LIMIT",
    "NGX-GZIP-CONFIG",
    "NGX-CLIENT-BODY-SIZE",
    "NGX-SERVER-HEADER",
    "NGX-ACCESS-LOG",
    "NGX-ERROR-LOG",
    "NGX-WAF-DETECTED",
  ])("%s has non-empty fixCommand", (checkId) => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === checkId);
    expect(check!.fixCommand).toBeTruthy();
  });

  it("NGX-GZIP-CONFIG has severity 'info'", () => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-GZIP-CONFIG");
    expect(check!.severity).toBe("info");
  });

  it("MINIMAL_NGINX_OUTPUT returns 16 checks (partial pass/fail)", () => {
    const checks = parseNginxChecks(MINIMAL_NGINX_OUTPUT, "bare");
    expect(checks.length).toBe(16);
  });

  it("MINIMAL_NGINX_OUTPUT has some passing and some failing checks", () => {
    const checks = parseNginxChecks(MINIMAL_NGINX_OUTPUT, "bare");
    const passed = checks.filter((c) => c.passed).length;
    const failed = checks.filter((c) => !c.passed).length;
    expect(passed).toBeGreaterThan(0);
    expect(failed).toBeGreaterThan(0);
  });

  describe("[MUTATION-KILLER] Nginx check metadata", () => {
    const checks = parseNginxChecks(VALID_NGINX_OUTPUT, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["NGX-SERVER-TOKENS", "warning", "GUARDED"],
      ["NGX-SSL-PROTOCOLS", "warning", "GUARDED"],
      ["NGX-RATE-LIMIT", "warning", "GUARDED"],
      ["NGX-GZIP-CONFIG", "info", "GUARDED"],
      ["NGX-CLIENT-BODY-SIZE", "warning", "GUARDED"],
      ["NGX-SERVER-HEADER", "info", "SAFE"],
      ["NGX-ACCESS-LOG", "warning", "GUARDED"],
      ["NGX-ERROR-LOG", "warning", "GUARDED"],
      ["NGX-WAF-DETECTED", "info", "GUARDED"],
      ["NGX-WAF-IP-ACL", "warning", "GUARDED"],
      ["NGX-WAF-RATE-LIMIT", "info", "GUARDED"],
      ["NGX-WAF-INPUT-SANITIZE", "info", "GUARDED"],
      ["NGX-WAF-DETECTION-ENGINE", "info", "GUARDED"],
      ["NGX-WAF-DATA-MASKING", "info", "GUARDED"],
      ["NGX-WAF-BOT-DETECT", "info", "GUARDED"],
      ["NGX-WAF-CHALLENGE-MODE", "info", "GUARDED"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("WAF & Reverse Proxy");
      expect(c!.severity).toBe(severity);
      expect(c!.safeToAutoFix).toBe(safe);
    });

    it("[MUTATION-KILLER] every check has non-empty fixCommand and explain", () => {
      checks.forEach((c) => {
        expect(c.fixCommand).toBeDefined();
        expect(c.fixCommand!.length).toBeGreaterThan(0);
        expect(c.explain).toBeDefined();
        expect(c.explain!.length).toBeGreaterThan(10);
      });
    });

    it("[MUTATION-KILLER] all IDs start with NGX-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^NGX-/));
    });
  });
});

// ─── New WAF Deep Checks ──────────────────────────────────────────────────────

const NO_WAF_NGINX_OUTPUT = [
  "server_tokens off;",
  "ssl_protocols TLSv1.2 TLSv1.3;",
  "limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;",
  "gzip on;",
  "client_max_body_size 50m;",
  "more_clear_headers Server;",
  "access_log /var/log/nginx/access.log combined;",
  "error_log /var/log/nginx/error.log warn;",
  "NO_WAF",
  // WAF deep: gateway outputs (no modsecurity/coraza)
  "NO_MODSEC_CONFIG",
  "0",
  "NO_IP_ACL",
  "NO_HEADER_FILTER",
].join("\n");

const MODSEC_NGINX_OUTPUT = [
  "server_tokens off;",
  "ssl_protocols TLSv1.2 TLSv1.3;",
  "limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;",
  "gzip on;",
  "client_max_body_size 50m;",
  "more_clear_headers Server;",
  "access_log /var/log/nginx/access.log combined;",
  "error_log /var/log/nginx/error.log warn;",
  "modsecurity on;",
  // WAF deep checks: full ModSec data
  "SecRuleEngine On",
  "SecRule IP:REMOTE_ADDR \"@gt 100\" id:900100",
  "15",
  "  deny 10.0.0.0/8;",
  "proxy_hide_header X-Powered-By;",
].join("\n");

describe("parseNginxChecks — NGX-WAF-IP-ACL", () => {
  it("passes when deny directive present", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-IP-ACL");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("fails (warning) when NO_IP_ACL sentinel present and no deny/allow", () => {
    const checks = parseNginxChecks(NO_WAF_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-IP-ACL");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("has severity='warning'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-IP-ACL");
    expect(check!.severity).toBe("warning");
  });

  it("has safeToAutoFix='GUARDED'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-IP-ACL");
    expect(check!.safeToAutoFix).toBe("GUARDED");
  });
});

describe("parseNginxChecks — NGX-WAF-RATE-LIMIT", () => {
  it("passes=true with 'WAF not installed' message when NO_WAF present (gateway)", () => {
    const checks = parseNginxChecks(NO_WAF_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-RATE-LIMIT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("WAF not installed");
  });

  it("passes when SecRule with rate-related pattern found and WAF present", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-RATE-LIMIT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("has severity='info'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-RATE-LIMIT");
    expect(check!.severity).toBe("info");
  });

  it("has safeToAutoFix='GUARDED'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-RATE-LIMIT");
    expect(check!.safeToAutoFix).toBe("GUARDED");
  });
});

describe("parseNginxChecks — NGX-WAF-INPUT-SANITIZE", () => {
  it("passes=true with 'WAF not installed' when no modsecurity/coraza in output", () => {
    const checks = parseNginxChecks(NO_WAF_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-INPUT-SANITIZE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("WAF not installed");
  });

  it("passes when SecRuleEngine On present and WAF active", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-INPUT-SANITIZE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("has severity='info'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-INPUT-SANITIZE");
    expect(check!.severity).toBe("info");
  });
});

describe("parseNginxChecks — NGX-WAF-DETECTION-ENGINE", () => {
  it("passes=true with 'WAF not installed' when no WAF detected", () => {
    const checks = parseNginxChecks(NO_WAF_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTION-ENGINE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("WAF not installed");
  });

  it("passes when CRS rule count > 0 and WAF active", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTION-ENGINE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("has severity='info'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DETECTION-ENGINE");
    expect(check!.severity).toBe("info");
  });
});

describe("parseNginxChecks — NGX-WAF-DATA-MASKING", () => {
  it("passes when proxy_hide_header targeting sensitive headers present", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DATA-MASKING");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("fails when NO_HEADER_FILTER sentinel and no header filtering", () => {
    const checks = parseNginxChecks(NO_WAF_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DATA-MASKING");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("has severity='info'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DATA-MASKING");
    expect(check!.severity).toBe("info");
  });

  it("has safeToAutoFix='GUARDED'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-DATA-MASKING");
    expect(check!.safeToAutoFix).toBe("GUARDED");
  });
});

describe("parseNginxChecks — WAF gateway: all WAF-dependent checks pass when no WAF", () => {
  it("NGX-WAF-RATE-LIMIT, NGX-WAF-INPUT-SANITIZE, NGX-WAF-DETECTION-ENGINE, NGX-WAF-BOT-DETECT, NGX-WAF-CHALLENGE-MODE all pass=true when no WAF", () => {
    const checks = parseNginxChecks(NO_WAF_NGINX_OUTPUT, "bare");
    const gatewayChecks = [
      "NGX-WAF-RATE-LIMIT",
      "NGX-WAF-INPUT-SANITIZE",
      "NGX-WAF-DETECTION-ENGINE",
      "NGX-WAF-BOT-DETECT",
      "NGX-WAF-CHALLENGE-MODE",
    ];
    for (const id of gatewayChecks) {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.passed).toBe(true);
    }
  });
});

describe("parseNginxChecks — NGX-WAF-BOT-DETECT", () => {
  it("passes when CRS 913 rules present (REQUEST-913-SCANNER-DETECTION)", () => {
    const output = ["modsecurity on;", "REQUEST-913-SCANNER-DETECTION.conf"].join("\n");
    const checks = parseNginxChecks(output, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-BOT-DETECT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("CRS 913");
  });

  it("passes when UA map present (map $http_user_agent)", () => {
    const output = ["modsecurity on;", "map $http_user_agent $bad_bot { default 0; }"].join("\n");
    const checks = parseNginxChecks(output, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-BOT-DETECT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("UA map");
  });

  it("passes=true (gateway skip) when NO_WAF in output", () => {
    const checks = parseNginxChecks(NO_WAF_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-BOT-DETECT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("WAF not installed");
  });

  it("fails when WAF present but no bot detection rules", () => {
    const output = ["modsecurity on;", "SecRuleEngine On"].join("\n");
    const checks = parseNginxChecks(output, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-BOT-DETECT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("No bot detection");
  });

  it("has severity='info'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-BOT-DETECT");
    expect(check!.severity).toBe("info");
  });

  it("has safeToAutoFix='GUARDED'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-BOT-DETECT");
    expect(check!.safeToAutoFix).toBe("GUARDED");
  });
});

describe("parseNginxChecks — NGX-WAF-CHALLENGE-MODE", () => {
  it("passes when SecAction redirect:/captcha present", () => {
    const output = ["modsecurity on;", "redirect:/captcha"].join("\n");
    const checks = parseNginxChecks(output, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-CHALLENGE-MODE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("Challenge mode configured");
  });

  it("passes when error_page challenge pattern present", () => {
    const output = ["modsecurity on;", "error_page 403 /challenge.html;"].join("\n");
    const checks = parseNginxChecks(output, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-CHALLENGE-MODE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("Challenge mode configured");
  });

  it("passes=true (gateway skip) when NO_WAF in output", () => {
    const checks = parseNginxChecks(NO_WAF_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-CHALLENGE-MODE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toContain("WAF not installed");
  });

  it("fails when WAF present but no challenge patterns", () => {
    const output = ["modsecurity on;", "SecRuleEngine On"].join("\n");
    const checks = parseNginxChecks(output, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-CHALLENGE-MODE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("No challenge mode");
  });

  it("has severity='info'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-CHALLENGE-MODE");
    expect(check!.severity).toBe("info");
  });

  it("has safeToAutoFix='GUARDED'", () => {
    const checks = parseNginxChecks(MODSEC_NGINX_OUTPUT, "bare");
    const check = checks.find((c) => c.id === "NGX-WAF-CHALLENGE-MODE");
    expect(check!.safeToAutoFix).toBe("GUARDED");
  });
});
