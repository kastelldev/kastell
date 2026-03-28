import { parseTlsChecks } from "../../src/core/audit/checks/tls.js";

describe("parseTlsChecks", () => {
  const nginxNotInstalled = "NGINX_NOT_INSTALLED";

  const validOutput = [
    "ssl_protocols TLSv1.2 TLSv1.3;",
    "ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:HIGH:!aNULL:!MD5;",
    'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;',
    "ssl_stapling on;",
    "ssl_stapling_verify on;",
    "CERT_VALID_30DAYS",
    "DH Parameters: (2048 bit)",
    "SSL_COMPRESSION_NOT_SET",
    "/etc/ssl/certs/cert.pem: OK",
  ].join("\n");

  // ─── Nginx not installed — graceful skip ─────────────────────────────────────

  describe("Nginx not installed — graceful skip", () => {
    it("returns all checks passed=true with 'not installed' when NGINX_NOT_INSTALLED sentinel", () => {
      const checks = parseTlsChecks(nginxNotInstalled, "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(true);
        expect(c.currentValue).toContain("not installed");
      });
    });

    it("all skipped checks have severity info", () => {
      const checks = parseTlsChecks(nginxNotInstalled, "bare");
      checks.forEach((c) => expect(c.severity).toBe("info"));
    });

    it("returns 8 checks for NGINX_NOT_INSTALLED", () => {
      const checks = parseTlsChecks(nginxNotInstalled, "bare");
      expect(checks.length).toBe(8);
    });

    it("returns 8 checks with not installed for empty string input", () => {
      const checks = parseTlsChecks("", "bare");
      expect(checks.length).toBe(8);
      checks.forEach((c) => expect(c.currentValue).toContain("not installed"));
    });

    it("returns 8 checks with not installed for N/A input", () => {
      const checks = parseTlsChecks("N/A", "bare");
      expect(checks.length).toBe(8);
      checks.forEach((c) => expect(c.currentValue).toContain("not installed"));
    });
  });

  // ─── Check count and shape ────────────────────────────────────────────────────

  describe("check count and shape", () => {
    it("returns exactly 8 checks for valid Nginx TLS output", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      expect(checks.length).toBe(8);
    });

    it("all check IDs start with TLS-", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^TLS-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have non-empty fixCommand", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeTruthy());
    });

    it("category is 'TLS Hardening' on all checks", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("TLS Hardening"));
    });

    it("has exactly 2 critical checks", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount).toBe(2);
    });

    it("has exactly 6 warning checks", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const warningCount = checks.filter((c) => c.severity === "warning").length;
      expect(warningCount).toBe(6);
    });
  });

  // ─── TLS-MIN-VERSION ─────────────────────────────────────────────────────────

  describe("TLS-MIN-VERSION", () => {
    it("passes when ssl_protocols contains TLSv1.2 and TLSv1.3 only", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-MIN-VERSION");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when ssl_protocols is TLSv1.3 only", () => {
      const output = "ssl_protocols TLSv1.3;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-MIN-VERSION");
      expect(check!.passed).toBe(true);
    });

    it("fails when ssl_protocols contains TLSv1", () => {
      const output = "ssl_protocols TLSv1 TLSv1.1 TLSv1.2;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-MIN-VERSION");
      expect(check!.passed).toBe(false);
    });

    it("fails when ssl_protocols contains TLSv1.1", () => {
      const output = "ssl_protocols TLSv1.1 TLSv1.2;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-MIN-VERSION");
      expect(check!.passed).toBe(false);
    });

    it("fails when ssl_protocols is not configured", () => {
      const output = "ssl_ciphers HIGH:!aNULL;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-MIN-VERSION");
      expect(check!.passed).toBe(false);
    });

    it("has critical severity", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-MIN-VERSION");
      expect(check!.severity).toBe("critical");
    });
  });

  // ─── TLS-WEAK-CIPHERS ────────────────────────────────────────────────────────

  describe("TLS-WEAK-CIPHERS", () => {
    it("passes when ssl_ciphers uses strong ciphers only (! prefix excludes weak)", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-WEAK-CIPHERS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when !aNULL and !MD5 are excluded via ! prefix", () => {
      const output = "ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:HIGH:!aNULL:!MD5;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-WEAK-CIPHERS");
      expect(check!.passed).toBe(true);
    });

    it("fails when ssl_ciphers contains RC4 (no ! prefix)", () => {
      const output = "ssl_ciphers RC4-SHA:AES128-SHA;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-WEAK-CIPHERS");
      expect(check!.passed).toBe(false);
    });

    it("fails when ssl_ciphers contains DES", () => {
      const output = "ssl_ciphers DES-CBC3-SHA:AES256-SHA;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-WEAK-CIPHERS");
      expect(check!.passed).toBe(false);
    });

    it("fails when ssl_ciphers contains NULL (without ! prefix)", () => {
      const output = "ssl_ciphers NULL-SHA:AES128-SHA;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-WEAK-CIPHERS");
      expect(check!.passed).toBe(false);
    });

    it("fails when ssl_ciphers contains EXPORT", () => {
      const output = "ssl_ciphers EXPORT-RC4-MD5:AES128-SHA;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-WEAK-CIPHERS");
      expect(check!.passed).toBe(false);
    });

    it("fails when no ssl_ciphers directive is present", () => {
      const output = "ssl_protocols TLSv1.2 TLSv1.3;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-WEAK-CIPHERS");
      expect(check!.passed).toBe(false);
    });

    it("has critical severity", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-WEAK-CIPHERS");
      expect(check!.severity).toBe("critical");
    });
  });

  // ─── TLS-HSTS ────────────────────────────────────────────────────────────────

  describe("TLS-HSTS", () => {
    it("passes when Strict-Transport-Security header is present", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-HSTS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no HSTS header is configured", () => {
      const output = "ssl_protocols TLSv1.2 TLSv1.3;\nssl_stapling on;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-HSTS");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-HSTS");
      expect(check!.severity).toBe("warning");
    });
  });

  // ─── TLS-OCSP ────────────────────────────────────────────────────────────────

  describe("TLS-OCSP", () => {
    it("passes when ssl_stapling on is set", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-OCSP");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when ssl_stapling off is set", () => {
      const output = "ssl_protocols TLSv1.2 TLSv1.3;\nssl_stapling off;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-OCSP");
      expect(check!.passed).toBe(false);
    });

    it("fails when ssl_stapling is absent", () => {
      const output = "ssl_protocols TLSv1.2 TLSv1.3;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-OCSP");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-OCSP");
      expect(check!.severity).toBe("warning");
    });
  });

  // ─── TLS-CERT-EXPIRY ─────────────────────────────────────────────────────────

  describe("TLS-CERT-EXPIRY", () => {
    it("passes when CERT_VALID_30DAYS sentinel is found", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-CERT-EXPIRY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when CERT_EXPIRING_SOON sentinel is found", () => {
      const output = validOutput.replace("CERT_VALID_30DAYS", "CERT_EXPIRING_SOON");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-CERT-EXPIRY");
      expect(check!.passed).toBe(false);
    });

    it("fails when CERT_NOT_FOUND sentinel is found", () => {
      const output = validOutput.replace("CERT_VALID_30DAYS", "CERT_NOT_FOUND");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-CERT-EXPIRY");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-CERT-EXPIRY");
      expect(check!.severity).toBe("warning");
    });
  });

  // ─── TLS-DH-PARAM ────────────────────────────────────────────────────────────

  describe("TLS-DH-PARAM", () => {
    it("passes when DH Parameters is 2048 bit", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-DH-PARAM");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when DH Parameters is 4096 bit", () => {
      const output = validOutput.replace("DH Parameters: (2048 bit)", "DH Parameters: (4096 bit)");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-DH-PARAM");
      expect(check!.passed).toBe(true);
    });

    it("fails when DH Parameters is 1024 bit", () => {
      const output = validOutput.replace("DH Parameters: (2048 bit)", "DH Parameters: (1024 bit)");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-DH-PARAM");
      expect(check!.passed).toBe(false);
    });

    it("fails when NO_DH_PARAM sentinel is found", () => {
      const output = validOutput.replace("DH Parameters: (2048 bit)", "NO_DH_PARAM");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-DH-PARAM");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-DH-PARAM");
      expect(check!.severity).toBe("warning");
    });
  });

  // ─── TLS-COMPRESSION ─────────────────────────────────────────────────────────

  describe("TLS-COMPRESSION", () => {
    it("passes when ssl_compression off is set", () => {
      const output = validOutput.replace("SSL_COMPRESSION_NOT_SET", "ssl_compression off;");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-COMPRESSION");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when SSL_COMPRESSION_NOT_SET sentinel is present (absence = safe)", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-COMPRESSION");
      expect(check!.passed).toBe(true);
    });

    it("passes when ssl_compression directive is absent from output", () => {
      const output = "ssl_protocols TLSv1.2 TLSv1.3;\nssl_stapling on;";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-COMPRESSION");
      expect(check!.passed).toBe(true);
    });

    it("fails when ssl_compression on is explicitly set", () => {
      const output = validOutput.replace("SSL_COMPRESSION_NOT_SET", "ssl_compression on;");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-COMPRESSION");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-COMPRESSION");
      expect(check!.severity).toBe("warning");
    });
  });

  // ─── TLS-CERT-CHAIN ──────────────────────────────────────────────────────────

  describe("TLS-CERT-CHAIN", () => {
    it("passes when openssl verify output contains ': OK'", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-CERT-CHAIN");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when CERT_VERIFY_NOT_POSSIBLE sentinel is present", () => {
      const output = validOutput.replace("/etc/ssl/certs/cert.pem: OK", "CERT_VERIFY_NOT_POSSIBLE");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-CERT-CHAIN");
      expect(check!.passed).toBe(false);
    });

    it("fails when output contains 'unable to get local issuer certificate'", () => {
      const output = validOutput.replace(
        "/etc/ssl/certs/cert.pem: OK",
        "/etc/ssl/certs/cert.pem: unable to get local issuer certificate",
      );
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-CERT-CHAIN");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseTlsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "TLS-CERT-CHAIN");
      expect(check!.severity).toBe("warning");
    });
  });

  describe("TLS-MIN-VERSION edge cases", () => {
    it("fails when no recognized TLS version found", () => {
      const output = "ssl_protocols SSLv3;\nssl_ciphers HIGH;\nCERT_VALID_30DAYS";
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-MIN-VERSION");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("No recognized TLS protocol");
    });
  });

  describe("TLS-HSTS max-age validation", () => {
    it("fails when max-age is too low", () => {
      const output = [
        "ssl_protocols TLSv1.2;",
        'add_header Strict-Transport-Security "max-age=300" always;',
        "CERT_VALID_30DAYS",
      ].join("\n");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-HSTS");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("max-age too low");
    });

    it("passes when max-age is exactly 31536000", () => {
      const output = [
        "ssl_protocols TLSv1.2;",
        'add_header Strict-Transport-Security "max-age=31536000" always;',
        "CERT_VALID_30DAYS",
      ].join("\n");
      const checks = parseTlsChecks(output, "bare");
      const check = checks.find((c) => c.id === "TLS-HSTS");
      expect(check!.passed).toBe(true);
    });
  });

  describe("[MUTATION-KILLER] TLS check metadata", () => {
    const output = [
      "ssl_protocols TLSv1.2;",
      'add_header Strict-Transport-Security "max-age=31536000" always;',
      "CERT_VALID_30DAYS",
    ].join("\n");
    const checks = parseTlsChecks(output, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["TLS-MIN-VERSION", "critical", "GUARDED"],
      ["TLS-WEAK-CIPHERS", "critical", "GUARDED"],
      ["TLS-HSTS", "warning", "GUARDED"],
      ["TLS-OCSP", "warning", "GUARDED"],
      ["TLS-CERT-EXPIRY", "warning", "GUARDED"],
      ["TLS-DH-PARAM", "warning", "GUARDED"],
      ["TLS-COMPRESSION", "warning", "GUARDED"],
      ["TLS-CERT-CHAIN", "warning", "GUARDED"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("TLS Hardening");
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

    it("[MUTATION-KILLER] all IDs start with TLS-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^TLS-/));
    });
  });
});
