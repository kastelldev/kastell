/**
 * Unit tests for fix profiles module.
 * Covers: COMMON_CATEGORIES count, PROFILES composition, filterChecksByProfile, isValidProfile.
 */

import {
  COMMON_CATEGORIES,
  PROFILES,
  filterChecksByProfile,
  isValidProfile,
} from "../../src/core/audit/profiles.js";
import type { ProfileName } from "../../src/core/audit/profiles.js";

// ─── COMMON_CATEGORIES ────────────────────────────────────────────────────────

describe("COMMON_CATEGORIES", () => {
  it("contains exactly 27 categories", () => {
    expect(COMMON_CATEGORIES.length).toBe(27);
  });

  it("does not contain WAF & Reverse Proxy", () => {
    expect(COMMON_CATEGORIES).not.toContain("WAF & Reverse Proxy");
  });

  it("does not contain HTTP Security Headers", () => {
    expect(COMMON_CATEGORIES).not.toContain("HTTP Security Headers");
  });

  it("does not contain TLS Hardening", () => {
    expect(COMMON_CATEGORIES).not.toContain("TLS Hardening");
  });

  it("does not contain Backup Hygiene", () => {
    expect(COMMON_CATEGORIES).not.toContain("Backup Hygiene");
  });

  it("contains core categories", () => {
    expect(COMMON_CATEGORIES).toContain("SSH");
    expect(COMMON_CATEGORIES).toContain("Firewall");
    expect(COMMON_CATEGORIES).toContain("Kernel");
    expect(COMMON_CATEGORIES).toContain("Auth");
    expect(COMMON_CATEGORIES).toContain("DDoS Hardening");
  });
});

// ─── PROFILES ─────────────────────────────────────────────────────────────────

describe("PROFILES", () => {
  describe("web-server", () => {
    it("has 30 categories (27 common + WAF + HTTP + TLS)", () => {
      expect(PROFILES["web-server"].length).toBe(30);
    });

    it("contains WAF & Reverse Proxy", () => {
      expect(PROFILES["web-server"]).toContain("WAF & Reverse Proxy");
    });

    it("contains HTTP Security Headers", () => {
      expect(PROFILES["web-server"]).toContain("HTTP Security Headers");
    });

    it("contains TLS Hardening (not TLS/SSL)", () => {
      expect(PROFILES["web-server"]).toContain("TLS Hardening");
      expect(PROFILES["web-server"]).not.toContain("TLS/SSL");
    });

    it("does not contain Backup Hygiene", () => {
      expect(PROFILES["web-server"]).not.toContain("Backup Hygiene");
    });
  });

  describe("database", () => {
    it("has 28 categories (27 common + Backup Hygiene)", () => {
      expect(PROFILES["database"].length).toBe(28);
    });

    it("contains Backup Hygiene (not Backup & Recovery)", () => {
      expect(PROFILES["database"]).toContain("Backup Hygiene");
      expect(PROFILES["database"]).not.toContain("Backup & Recovery");
    });

    it("does not contain WAF & Reverse Proxy", () => {
      expect(PROFILES["database"]).not.toContain("WAF & Reverse Proxy");
    });

    it("does not contain TLS Hardening", () => {
      expect(PROFILES["database"]).not.toContain("TLS Hardening");
    });
  });

  describe("mail-server", () => {
    it("has 28 categories (27 common + TLS Hardening)", () => {
      expect(PROFILES["mail-server"].length).toBe(28);
    });

    it("contains TLS Hardening (not TLS/SSL)", () => {
      expect(PROFILES["mail-server"]).toContain("TLS Hardening");
      expect(PROFILES["mail-server"]).not.toContain("TLS/SSL");
    });

    it("does not contain WAF & Reverse Proxy", () => {
      expect(PROFILES["mail-server"]).not.toContain("WAF & Reverse Proxy");
    });

    it("does not contain Backup Hygiene", () => {
      expect(PROFILES["mail-server"]).not.toContain("Backup Hygiene");
    });
  });
});

// ─── isValidProfile ───────────────────────────────────────────────────────────

describe("isValidProfile", () => {
  it("returns true for web-server", () => {
    expect(isValidProfile("web-server")).toBe(true);
  });

  it("returns true for database", () => {
    expect(isValidProfile("database")).toBe(true);
  });

  it("returns true for mail-server", () => {
    expect(isValidProfile("mail-server")).toBe(true);
  });

  it("returns false for invalid profile names", () => {
    expect(isValidProfile("invalid")).toBe(false);
    expect(isValidProfile("")).toBe(false);
    expect(isValidProfile("web server")).toBe(false);
    expect(isValidProfile("WEB-SERVER")).toBe(false);
  });

  it("type guard narrows to ProfileName when true", () => {
    const name = "database";
    if (isValidProfile(name)) {
      // TypeScript should accept name as ProfileName here
      const profile: ProfileName = name;
      expect(profile).toBe("database");
    }
  });
});

// ─── filterChecksByProfile ────────────────────────────────────────────────────

describe("filterChecksByProfile", () => {
  const testChecks = [
    { id: "SSH-01", category: "SSH" },
    { id: "WAF-01", category: "WAF & Reverse Proxy" },
    { id: "HTTP-01", category: "HTTP Security Headers" },
    { id: "TLS-01", category: "TLS Hardening" },
    { id: "BAK-01", category: "Backup Hygiene" },
    { id: "FW-01", category: "Firewall" },
    { id: "UNKNOWN-01", category: "Unknown Category" },
  ];

  it("filters checks to only those in web-server profile", () => {
    const result = filterChecksByProfile(testChecks, "web-server");
    const ids = result.map((c) => c.id);
    expect(ids).toContain("SSH-01");
    expect(ids).toContain("WAF-01");
    expect(ids).toContain("HTTP-01");
    expect(ids).toContain("TLS-01");
    expect(ids).toContain("FW-01");
    expect(ids).not.toContain("BAK-01");
    expect(ids).not.toContain("UNKNOWN-01");
  });

  it("filters checks to only those in database profile", () => {
    const result = filterChecksByProfile(testChecks, "database");
    const ids = result.map((c) => c.id);
    expect(ids).toContain("SSH-01");
    expect(ids).toContain("BAK-01");
    expect(ids).toContain("FW-01");
    expect(ids).not.toContain("WAF-01");
    expect(ids).not.toContain("HTTP-01");
    expect(ids).not.toContain("TLS-01");
    expect(ids).not.toContain("UNKNOWN-01");
  });

  it("filters checks to only those in mail-server profile", () => {
    const result = filterChecksByProfile(testChecks, "mail-server");
    const ids = result.map((c) => c.id);
    expect(ids).toContain("SSH-01");
    expect(ids).toContain("TLS-01");
    expect(ids).toContain("FW-01");
    expect(ids).not.toContain("WAF-01");
    expect(ids).not.toContain("HTTP-01");
    expect(ids).not.toContain("BAK-01");
    expect(ids).not.toContain("UNKNOWN-01");
  });

  it("returns empty array when no checks match profile", () => {
    const noMatchChecks = [{ id: "UNKNOWN-01", category: "Unknown Category" }];
    const result = filterChecksByProfile(noMatchChecks, "database");
    expect(result).toHaveLength(0);
  });

  it("preserves all properties of filtered checks", () => {
    const richChecks = [
      { id: "SSH-01", category: "SSH", severity: "critical", passed: false },
    ];
    const result = filterChecksByProfile(richChecks, "web-server");
    expect(result[0]).toEqual({ id: "SSH-01", category: "SSH", severity: "critical", passed: false });
  });
});
