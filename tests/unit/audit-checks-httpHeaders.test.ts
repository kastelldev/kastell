import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseHttpHeadersChecks } from "../../src/core/audit/checks/httpHeaders.js";

describe("parseHttpHeadersChecks", () => {
  const nginxNotInstalled = "NGINX_NOT_INSTALLED";
  const httpNotResponding = "HTTP_NOT_RESPONDING";

  const validOutput = [
    "HTTP/1.1 200 OK",
    "Server: nginx/1.18.0",
    "Date: Sun, 23 Mar 2026 08:00:00 GMT",
    "Content-Type: text/html",
    "X-Frame-Options: SAMEORIGIN",
    "X-Content-Type-Options: nosniff",
    "Content-Security-Policy: default-src 'self'",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "Permissions-Policy: camera=(), microphone=(), geolocation=()",
    // No Access-Control-Allow-Origin: * (absence = pass for HDR-005)
  ].join("\n");

  // ─── Nginx not installed — graceful skip ─────────────────────────────────────

  describe("Nginx not installed — graceful skip", () => {
    it("returns all checks passed=true when NGINX_NOT_INSTALLED sentinel", () => {
      const checks = parseHttpHeadersChecks(nginxNotInstalled, "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(true);
      });
    });

    it("all skipped checks have severity info", () => {
      const checks = parseHttpHeadersChecks(nginxNotInstalled, "bare");
      checks.forEach((c) => expect(c.severity).toBe("info"));
    });

    it("returns 6 checks for NGINX_NOT_INSTALLED", () => {
      const checks = parseHttpHeadersChecks(nginxNotInstalled, "bare");
      expect(checks.length).toBe(6);
    });

    it("skipped checks currentValue contains 'Nginx not installed or HTTP not responding'", () => {
      const checks = parseHttpHeadersChecks(nginxNotInstalled, "bare");
      checks.forEach((c) =>
        expect(c.currentValue).toBe("Nginx not installed or HTTP not responding"),
      );
    });

    it("returns 6 checks with skip for empty string input", () => {
      const checks = parseHttpHeadersChecks("", "bare");
      expect(checks.length).toBe(6);
      checks.forEach((c) => expect(c.currentValue).toBe("Nginx not installed or HTTP not responding"));
    });

    it("returns 6 checks with skip for N/A input", () => {
      const checks = parseHttpHeadersChecks("N/A", "bare");
      expect(checks.length).toBe(6);
      checks.forEach((c) => expect(c.currentValue).toBe("Nginx not installed or HTTP not responding"));
    });
  });

  // ─── HTTP not responding — graceful skip ─────────────────────────────────────

  describe("HTTP not responding — graceful skip", () => {
    it("returns 6 checks for HTTP_NOT_RESPONDING", () => {
      const checks = parseHttpHeadersChecks(httpNotResponding, "bare");
      expect(checks.length).toBe(6);
    });

    it("all skipped checks have passed=true for HTTP_NOT_RESPONDING", () => {
      const checks = parseHttpHeadersChecks(httpNotResponding, "bare");
      checks.forEach((c) => expect(c.passed).toBe(true));
    });

    it("all skipped checks have severity info for HTTP_NOT_RESPONDING", () => {
      const checks = parseHttpHeadersChecks(httpNotResponding, "bare");
      checks.forEach((c) => expect(c.severity).toBe("info"));
    });
  });

  // ─── Check count and shape ────────────────────────────────────────────────────

  describe("check count and shape", () => {
    it("returns exactly 6 checks for valid curl -sI output", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      expect(checks.length).toBe(6);
    });

    it("all check IDs start with HDR-", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^HDR-/));
    });

    it("all checks have category 'HTTP Security Headers'", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("HTTP Security Headers"));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have non-empty fixCommand", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeTruthy());
    });

    it("has exactly 4 warning checks (HDR-001, HDR-002, HDR-005, HDR-006)", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const warningCount = checks.filter((c) => c.severity === "warning").length;
      expect(warningCount).toBe(4);
    });

    it("has exactly 2 info checks (HDR-003, HDR-004)", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const infoCount = checks.filter((c) => c.severity === "info").length;
      expect(infoCount).toBe(2);
    });
  });

  // ─── HDR-001: X-Frame-Options or CSP frame-ancestors ─────────────────────────

  describe("HDR-001: X-Frame-Options or CSP frame-ancestors", () => {
    it("passes when X-Frame-Options: SAMEORIGIN header is present", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-001");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("X-Frame-Options present");
    });

    it("passes when x-frame-options header is lowercase (case-insensitive)", () => {
      const output = "x-frame-options: deny\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-001");
      expect(check!.passed).toBe(true);
    });

    it("passes when CSP contains frame-ancestors directive (alternative)", () => {
      const output = "content-security-policy: frame-ancestors 'self'\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-001");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("CSP frame-ancestors present");
    });

    it("fails when neither X-Frame-Options nor CSP frame-ancestors is present", () => {
      const output = "Content-Type: text/html\nServer: nginx";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-001");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-001");
      expect(check!.severity).toBe("warning");
    });
  });

  // ─── HDR-002: X-Content-Type-Options nosniff ─────────────────────────────────

  describe("HDR-002: X-Content-Type-Options nosniff", () => {
    it("passes when X-Content-Type-Options: nosniff header is present", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-002");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when x-content-type-options: nosniff is lowercase (case-insensitive)", () => {
      const output = "x-content-type-options: nosniff\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-002");
      expect(check!.passed).toBe(true);
    });

    it("passes when X-Content-Type-Options: NOSNIFF is uppercase (case-insensitive)", () => {
      const output = "X-Content-Type-Options: NOSNIFF\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-002");
      expect(check!.passed).toBe(true);
    });

    it("fails when X-Content-Type-Options header is absent", () => {
      const output = "Content-Type: text/html\nServer: nginx";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-002");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-002");
      expect(check!.severity).toBe("warning");
    });
  });

  // ─── HDR-003: Referrer-Policy present ────────────────────────────────────────

  describe("HDR-003: Referrer-Policy present", () => {
    it("passes when Referrer-Policy header is present", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-003");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when referrer-policy is lowercase (case-insensitive)", () => {
      const output = "referrer-policy: no-referrer\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-003");
      expect(check!.passed).toBe(true);
    });

    it("fails when Referrer-Policy header is absent", () => {
      const output = "Content-Type: text/html\nServer: nginx";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-003");
      expect(check!.passed).toBe(false);
    });

    it("has info severity", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-003");
      expect(check!.severity).toBe("info");
    });
  });

  // ─── HDR-004: Permissions-Policy present ─────────────────────────────────────

  describe("HDR-004: Permissions-Policy present", () => {
    it("passes when Permissions-Policy header is present", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-004");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when permissions-policy is lowercase (case-insensitive)", () => {
      const output = "permissions-policy: geolocation=()\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-004");
      expect(check!.passed).toBe(true);
    });

    it("fails when Permissions-Policy header is absent", () => {
      const output = "Content-Type: text/html\nServer: nginx";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-004");
      expect(check!.passed).toBe(false);
    });

    it("has info severity", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-004");
      expect(check!.severity).toBe("info");
    });
  });

  // ─── HDR-005: CORS wildcard detection (inverted) ─────────────────────────────

  describe("HDR-005: CORS wildcard detection", () => {
    it("passes when Access-Control-Allow-Origin header is absent (no wildcard = safe)", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-005");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when Access-Control-Allow-Origin: * is present (wildcard detected)", () => {
      const output = "Access-Control-Allow-Origin: *\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-005");
      expect(check!.passed).toBe(false);
    });

    it("fails when access-control-allow-origin: * is lowercase (case-insensitive)", () => {
      const output = "access-control-allow-origin: *\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-005");
      expect(check!.passed).toBe(false);
    });

    it("passes when Access-Control-Allow-Origin is set to specific origin (not wildcard)", () => {
      const output = "Access-Control-Allow-Origin: https://example.com\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-005");
      expect(check!.passed).toBe(true);
    });

    it("has warning severity", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-005");
      expect(check!.severity).toBe("warning");
    });
  });

  // ─── HDR-006: Content-Security-Policy present ────────────────────────────────

  describe("HDR-006: Content-Security-Policy present", () => {
    it("passes when Content-Security-Policy header is present", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-006");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when content-security-policy is lowercase (case-insensitive)", () => {
      const output = "content-security-policy: script-src 'none'\nContent-Type: text/html";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-006");
      expect(check!.passed).toBe(true);
    });

    it("fails when Content-Security-Policy header is absent", () => {
      const output = "Content-Type: text/html\nServer: nginx";
      const checks = parseHttpHeadersChecks(output, "bare");
      const check = checks.find((c) => c.id === "HDR-006");
      expect(check!.passed).toBe(false);
    });

    it("has warning severity", () => {
      const checks = parseHttpHeadersChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "HDR-006");
      expect(check!.severity).toBe("warning");
    });
  });
});
