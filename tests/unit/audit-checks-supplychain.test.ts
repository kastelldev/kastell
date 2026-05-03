import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseSupplyChainChecks } from "../../src/core/audit/checks/supplychain.js";

describe("parseSupplyChainChecks", () => {
  const validOutput = [
    "https://deb.debian.org/debian",
    "KEYS_PRESENT",
    "Listing...",
    "NO_UNSIGNED_PACKAGES",
    "APT_KEY_UNAVAIL",
    "REPOS_HAVE_SIGNATURES",
    "GPG_VERIFY_OK",
    "NO_UNAUTH_SOURCES",
    "NONE",
    "debian-archive-keyring.gpg ubuntu-keyring-2018-archive.gpg",
    "3",
    "/usr/bin/debsums",
  ].join("\n");

  const badOutput = [
    "http://deb.debian.org/debian\nhttp://security.debian.org/debian-security",
    "NO_KEYS",
    "Listing...\ndeprecated\napt-key is deprecated",
    "UNSIGNED_PACKAGES\nhttpd\ncurl",
    "Warning: apt-key is deprecated",
    "REPOS_NO_SIGNATURES",
    "GPG_VERIFY_FAIL",
    "UNAUTH_SOURCES_FOUND",
  ].join("\n");

  describe("N/A handling", () => {
    it("returns checks with passed=false and currentValue='Unable to determine' for N/A input", () => {
      const checks = parseSupplyChainChecks("N/A", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("returns checks with passed=false for empty string input", () => {
      const checks = parseSupplyChainChecks("", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("check count and shape", () => {
    it("returns at least 12 checks", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      expect(checks.length).toBeGreaterThanOrEqual(12);
    });

    it("all check IDs start with SUPPLY-", () => {
      const checks = parseSupplyChainChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^SUPPLY-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseSupplyChainChecks("", "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseSupplyChainChecks("", "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'Supply Chain' on all checks", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("Supply Chain"));
    });
  });

  describe("severity budget", () => {
    it("critical checks <= 40% of total", () => {
      const checks = parseSupplyChainChecks("", "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount / checks.length).toBeLessThanOrEqual(0.4);
    });
  });

  describe("SUPPLY-APT-HTTPS-REPOS", () => {
    it("passes when APT repos use HTTPS", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when APT repos use HTTP (unencrypted)", () => {
      const checks = parseSupplyChainChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SUPPLY-GPG-KEYS-TRUSTED", () => {
    it("passes when trusted GPG keys present", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no trusted GPG keys found", () => {
      const checks = parseSupplyChainChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SUPPLY-NO-UNSIGNED-PACKAGES", () => {
    it("passes when no unsigned packages found", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when unsigned packages detected", () => {
      const checks = parseSupplyChainChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SUPPLY-APT-KEY-DEPRECATED", () => {
    it("passes when apt-key deprecated warning absent", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when apt-key deprecated warning present", () => {
      const checks = parseSupplyChainChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SUPPLY-NO-INSECURE-REPOS", () => {
    it("passes when NONE sentinel in apt-config output", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when AllowUnauthenticated true found in apt-config (no NONE sentinel)", () => {
      // Use output without NONE so the check doesn't short-circuit
      const output = 'APT::Get::AllowUnauthenticated "true";\nAPT::Get::AllowInsecureRepositories "false";';
      const checks = parseSupplyChainChecks(output, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SUPPLY-GPG-KEYS-PRESENT", () => {
    it("passes when .gpg key files found in trusted.gpg.d", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-PRESENT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no GPG key files found", () => {
      const output = validOutput.replace("debian-archive-keyring.gpg ubuntu-keyring-2018-archive.gpg", "NONE_FOUND");
      const checks = parseSupplyChainChecks(output, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-PRESENT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SUPPLY-PACKAGE-VERIFY-CLEAN", () => {
    it("passes when modified package file count <= 5", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-PACKAGE-VERIFY-CLEAN");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when modified package file count > 5", () => {
      const highCountOutput = validOutput + "\n20";
      const checks = parseSupplyChainChecks(highCountOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-PACKAGE-VERIFY-CLEAN");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SUPPLY-DEBSUMS-INSTALLED", () => {
    it("passes when debsums path is in output", () => {
      const checks = parseSupplyChainChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when NOT_INSTALLED sentinel is present", () => {
      const noDebsumsOutput = validOutput.replace("/usr/bin/debsums", "NOT_INSTALLED");
      const checks = parseSupplyChainChecks(noDebsumsOutput, "bare");
      const check = checks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });
});

describe("[MUTATION-KILLER] SupplyChain check string assertions", () => {
  const validOutput = [
    "https://deb.debian.org/debian",
    "KEYS_PRESENT",
    "Listing...",
    "NO_UNSIGNED_PACKAGES",
    "APT_KEY_UNAVAIL",
    "REPOS_HAVE_SIGNATURES",
    "GPG_VERIFY_OK",
    "NO_UNAUTH_SOURCES",
    "NONE",
    "debian-archive-keyring.gpg ubuntu-keyring-2018-archive.gpg",
    "3",
    "/usr/bin/debsums",
  ].join("\n");

  let checks: ReturnType<typeof parseSupplyChainChecks>;

  beforeAll(() => {
    checks = parseSupplyChainChecks(validOutput, "bare");
  });

  it("[MUTATION-KILLER] returns exactly 12 checks", () => {
    expect(checks).toHaveLength(12);
  });

  describe("[MUTATION-KILLER] SUPPLY-APT-HTTPS-REPOS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS")!;
      expect(c.id).toBe("SUPPLY-APT-HTTPS-REPOS");
      expect(c.name).toBe("APT Repositories Use HTTPS");
      expect(c.severity).toBe("critical");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS")!;
      expect(c.expectedValue).toBe("All APT repository URLs begin with https://");
    });

    it("fixCommand contains sed and sources.list", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS")!;
      expect(c.fixCommand).toContain("sed -i");
      expect(c.fixCommand).toContain("sources.list");
    });

    it("explain mentions man-in-the-middle and HTTP", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS")!;
      expect(c.explain).toContain("man-in-the-middle");
      expect(c.explain).toContain("HTTP");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-GPG-KEYS-TRUSTED metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED")!;
      expect(c.id).toBe("SUPPLY-GPG-KEYS-TRUSTED");
      expect(c.name).toBe("APT Trusted GPG Keys Present");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED")!;
      expect(c.expectedValue).toBe("APT trusted.gpg.d/ contains at least one GPG key");
    });

    it("fixCommand contains curl and trusted.gpg.d", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED")!;
      expect(c.fixCommand).toContain("curl -fsSL");
      expect(c.fixCommand).toContain("trusted.gpg.d");
    });

    it("explain mentions signature verification and trusted keys", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED")!;
      expect(c.explain).toContain("signature verification");
      expect(c.explain).toContain("trusted.gpg.d");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-NO-UNSIGNED-PACKAGES metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES")!;
      expect(c.id).toBe("SUPPLY-NO-UNSIGNED-PACKAGES");
      expect(c.name).toBe("No Unsigned APT Packages Installed");
      expect(c.severity).toBe("critical");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES")!;
      expect(c.expectedValue).toBe("All installed packages are GPG-signed by their repository");
    });

    it("fixCommand contains reinstall and dpkg-query", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES")!;
      expect(c.fixCommand).toContain("--reinstall");
      expect(c.fixCommand).toContain("dpkg-query");
    });

    it("explain mentions GPG verification and bypass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES")!;
      expect(c.explain).toContain("GPG verification");
      expect(c.explain).toContain("bypass");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-APT-KEY-DEPRECATED metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED")!;
      expect(c.id).toBe("SUPPLY-APT-KEY-DEPRECATED");
      expect(c.name).toBe("apt-key Not Used (Deprecated)");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED")!;
      expect(c.expectedValue).toBe("GPG keys managed via /etc/apt/trusted.gpg.d/ (not apt-key)");
    });

    it("fixCommand contains apt-key and trusted.gpg.d", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED")!;
      expect(c.fixCommand).toContain("apt-key");
      expect(c.fixCommand).toContain("trusted.gpg.d");
    });

    it("explain mentions deprecated and Ubuntu 22.04", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED")!;
      expect(c.explain).toContain("deprecated");
      expect(c.explain).toContain("22.04");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-REPOS-SIGNED metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-REPOS-SIGNED")!;
      expect(c.id).toBe("SUPPLY-REPOS-SIGNED");
      expect(c.name).toBe("APT Repository Metadata Is Signed");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-REPOS-SIGNED")!;
      expect(c.expectedValue).toBe("APT repository Release/InRelease files are GPG-signed");
    });

    it("fixCommand contains NO_PUBKEY and recv-keys", () => {
      const c = checks.find((c) => c.id === "SUPPLY-REPOS-SIGNED")!;
      expect(c.fixCommand).toContain("NO_PUBKEY");
      expect(c.fixCommand).toContain("recv-keys");
    });

    it("explain mentions Release/InRelease and compromised mirror", () => {
      const c = checks.find((c) => c.id === "SUPPLY-REPOS-SIGNED")!;
      expect(c.explain).toContain("Release/InRelease");
      expect(c.explain).toContain("compromised mirror");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-REPOS-SIGNED")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-GPG-VERIFY-OK metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-VERIFY-OK")!;
      expect(c.id).toBe("SUPPLY-GPG-VERIFY-OK");
      expect(c.name).toBe("GPG Signature Verification Operational");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-VERIFY-OK")!;
      expect(c.expectedValue).toBe("GPG signature verification succeeds for installed packages");
    });

    it("fixCommand contains NO_PUBKEY and keyserver.ubuntu.com", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-VERIFY-OK")!;
      expect(c.fixCommand).toContain("NO_PUBKEY");
      expect(c.fixCommand).toContain("keyserver.ubuntu.com");
    });

    it("explain mentions expired keys and compromised keyring", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-VERIFY-OK")!;
      expect(c.explain).toContain("expired keys");
      expect(c.explain).toContain("compromised keyring");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-VERIFY-OK")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-NO-UNAUTH-SOURCES metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNAUTH-SOURCES")!;
      expect(c.id).toBe("SUPPLY-NO-UNAUTH-SOURCES");
      expect(c.name).toBe("No Unauthorized Package Sources");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNAUTH-SOURCES")!;
      expect(c.expectedValue).toBe("All APT sources are official distribution or known third-party repos");
    });

    it("fixCommand contains sources.list and grep", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNAUTH-SOURCES")!;
      expect(c.fixCommand).toContain("sources.list");
      expect(c.fixCommand).toContain("grep");
    });

    it("explain mentions supply chain compromise and misconfiguration", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNAUTH-SOURCES")!;
      expect(c.explain).toContain("supply chain compromise");
      expect(c.explain).toContain("misconfiguration");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNAUTH-SOURCES")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-DPKG-AUDIT-CLEAN metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DPKG-AUDIT-CLEAN")!;
      expect(c.id).toBe("SUPPLY-DPKG-AUDIT-CLEAN");
      expect(c.name).toBe("dpkg Audit Finds No Broken Packages");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DPKG-AUDIT-CLEAN")!;
      expect(c.expectedValue).toBe("dpkg --audit returns no broken or partially installed packages");
    });

    it("fixCommand contains dpkg --configure and apt-get install -f", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DPKG-AUDIT-CLEAN")!;
      expect(c.fixCommand).toContain("dpkg --configure -a");
      expect(c.fixCommand).toContain("apt-get install -f");
    });

    it("explain mentions interrupted updates and package conflicts", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DPKG-AUDIT-CLEAN")!;
      expect(c.explain).toContain("interrupted updates");
      expect(c.explain).toContain("package conflicts");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DPKG-AUDIT-CLEAN")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-NO-INSECURE-REPOS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS")!;
      expect(c.id).toBe("SUPPLY-NO-INSECURE-REPOS");
      expect(c.name).toBe("No AllowInsecureRepositories or AllowUnauthenticated in APT Config");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS")!;
      expect(c.expectedValue).toBe("No AllowUnauthenticated or AllowInsecureRepositories set to true in apt config");
    });

    it("fixCommand mentions AllowUnauthenticated and AllowInsecureRepositories", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS")!;
      expect(c.fixCommand).toContain("AllowUnauthenticated");
      expect(c.fixCommand).toContain("AllowInsecureRepositories");
    });

    it("explain mentions man-in-the-middle and unauthenticated", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS")!;
      expect(c.explain).toContain("man-in-the-middle");
      expect(c.explain).toContain("unauthenticated");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-GPG-KEYS-PRESENT metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-PRESENT")!;
      expect(c.id).toBe("SUPPLY-GPG-KEYS-PRESENT");
      expect(c.name).toBe("GPG Keys Present for Repository Verification");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-PRESENT")!;
      expect(c.expectedValue).toBe("At least one .gpg or .asc file in /etc/apt/trusted.gpg.d/");
    });

    it("fixCommand contains curl and trusted.gpg.d", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-PRESENT")!;
      expect(c.fixCommand).toContain("curl -fsSL");
      expect(c.fixCommand).toContain("trusted.gpg.d");
    });

    it("explain mentions package integrity and apt operations", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-PRESENT")!;
      expect(c.explain).toContain("package integrity");
      expect(c.explain).toContain("apt operations");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-PRESENT")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-PACKAGE-VERIFY-CLEAN metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-PACKAGE-VERIFY-CLEAN")!;
      expect(c.id).toBe("SUPPLY-PACKAGE-VERIFY-CLEAN");
      expect(c.name).toBe("dpkg Package File Integrity Verified");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-PACKAGE-VERIFY-CLEAN")!;
      expect(c.expectedValue).toBe("5 or fewer modified package files (small intentional modifications are normal)");
    });

    it("fixCommand contains dpkg --verify", () => {
      const c = checks.find((c) => c.id === "SUPPLY-PACKAGE-VERIFY-CLEAN")!;
      expect(c.fixCommand).toContain("dpkg --verify");
      expect(c.fixCommand).toContain("investigate");
    });

    it("explain mentions rootkit and tampering", () => {
      const c = checks.find((c) => c.id === "SUPPLY-PACKAGE-VERIFY-CLEAN")!;
      expect(c.explain).toContain("rootkit");
      expect(c.explain).toContain("tampering");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SUPPLY-PACKAGE-VERIFY-CLEAN")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SUPPLY-DEBSUMS-INSTALLED metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED")!;
      expect(c.id).toBe("SUPPLY-DEBSUMS-INSTALLED");
      expect(c.name).toBe("debsums Package Integrity Tool Installed");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Supply Chain");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED")!;
      expect(c.expectedValue).toBe("debsums is installed on the system");
    });

    it("fixCommand is apt install debsums", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED")!;
      expect(c.fixCommand).toBe("apt install debsums");
    });

    it("explain mentions checksums and unauthorized file modifications", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED")!;
      expect(c.explain).toContain("checksums");
      expect(c.explain).toContain("unauthorized file modifications");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] N/A output preserves all metadata strings", () => {
    it("all 12 checks preserve id, name, severity, category, expectedValue, fixCommand, explain on N/A", () => {
      const naChecks = parseSupplyChainChecks("N/A", "bare");
      const normalChecks = parseSupplyChainChecks(validOutput, "bare");
      expect(naChecks).toHaveLength(12);
      for (let i = 0; i < naChecks.length; i++) {
        expect(naChecks[i].id).toBe(normalChecks[i].id);
        expect(naChecks[i].name).toBe(normalChecks[i].name);
        expect(naChecks[i].severity).toBe(normalChecks[i].severity);
        expect(naChecks[i].category).toBe(normalChecks[i].category);
        expect(naChecks[i].expectedValue).toBe(normalChecks[i].expectedValue);
        expect(naChecks[i].fixCommand).toBe(normalChecks[i].fixCommand);
        expect(naChecks[i].explain).toBe(normalChecks[i].explain);
        expect(naChecks[i].safeToAutoFix).toBe(normalChecks[i].safeToAutoFix);
      }
    });
  });

  describe("[MUTATION-KILLER] Check IDs exact order", () => {
    it("returns all 12 check IDs in exact order", () => {
      const ids = checks.map((c) => c.id);
      expect(ids).toEqual([
        "SUPPLY-APT-HTTPS-REPOS",
        "SUPPLY-GPG-KEYS-TRUSTED",
        "SUPPLY-NO-UNSIGNED-PACKAGES",
        "SUPPLY-APT-KEY-DEPRECATED",
        "SUPPLY-REPOS-SIGNED",
        "SUPPLY-GPG-VERIFY-OK",
        "SUPPLY-NO-UNAUTH-SOURCES",
        "SUPPLY-DPKG-AUDIT-CLEAN",
        "SUPPLY-NO-INSECURE-REPOS",
        "SUPPLY-GPG-KEYS-PRESENT",
        "SUPPLY-PACKAGE-VERIFY-CLEAN",
        "SUPPLY-DEBSUMS-INSTALLED",
      ]);
    });
  });

  describe("[MUTATION-KILLER] currentValue strings on pass", () => {
    it("SUPPLY-APT-HTTPS-REPOS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS")!;
      expect(c.currentValue).toBe("All detected APT repositories use HTTPS");
    });

    it("SUPPLY-GPG-KEYS-TRUSTED currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED")!;
      expect(c.currentValue).toBe("Trusted APT GPG keys present in /etc/apt/trusted.gpg.d/");
    });

    it("SUPPLY-NO-UNSIGNED-PACKAGES currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES")!;
      expect(c.currentValue).toBe("No unsigned packages detected via dpkg/apt audit");
    });

    it("SUPPLY-APT-KEY-DEPRECATED currentValue on pass (unavail)", () => {
      const c = checks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED")!;
      expect(c.currentValue).toBe("apt-key not installed (not applicable)");
    });

    it("SUPPLY-REPOS-SIGNED currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-REPOS-SIGNED")!;
      expect(c.currentValue).toBe("APT repository metadata appears signed");
    });

    it("SUPPLY-GPG-VERIFY-OK currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-VERIFY-OK")!;
      expect(c.currentValue).toBe("GPG signature verification is operational");
    });

    it("SUPPLY-NO-UNAUTH-SOURCES currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-UNAUTH-SOURCES")!;
      expect(c.currentValue).toBe("No unauthorized package sources detected in sources.list");
    });

    it("SUPPLY-NO-INSECURE-REPOS currentValue on pass (NONE)", () => {
      const c = checks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS")!;
      expect(c.currentValue).toBe("No insecure APT configuration options found");
    });

    it("SUPPLY-GPG-KEYS-PRESENT currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-GPG-KEYS-PRESENT")!;
      expect(c.currentValue).toBe("GPG key files found in /etc/apt/trusted.gpg.d/");
    });

    it("SUPPLY-PACKAGE-VERIFY-CLEAN currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-PACKAGE-VERIFY-CLEAN")!;
      expect(c.currentValue).toBe("3 modified package file(s) detected by dpkg --verify");
    });

    it("SUPPLY-DEBSUMS-INSTALLED currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED")!;
      expect(c.currentValue).toBe("debsums is installed");
    });
  });

  describe("[MUTATION-KILLER] currentValue strings on fail", () => {
    const badOutput = [
      "http://deb.debian.org/debian",
      "NO_KEYS",
      "UNSIGNED_PACKAGES",
      "Warning: apt-key is deprecated",
      "REPOS_NO_SIGNATURES",
      "GPG_VERIFY_FAIL",
      "UNAUTH_SOURCES_FOUND",
      "DPKG_ERRORS",
      'AllowUnauthenticated "true"',
      "NONE_FOUND",
      "100",
      "NOT_INSTALLED",
    ].join("\n");

    let failChecks: ReturnType<typeof parseSupplyChainChecks>;

    beforeAll(() => {
      failChecks = parseSupplyChainChecks(badOutput, "bare");
    });

    it("SUPPLY-APT-HTTPS-REPOS currentValue on fail mentions unencrypted HTTP", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-APT-HTTPS-REPOS")!;
      expect(c.currentValue).toContain("unencrypted HTTP");
    });

    it("SUPPLY-GPG-KEYS-TRUSTED currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-GPG-KEYS-TRUSTED")!;
      expect(c.currentValue).toBe("No trusted GPG keys found in /etc/apt/trusted.gpg.d/");
    });

    it("SUPPLY-NO-UNSIGNED-PACKAGES currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-NO-UNSIGNED-PACKAGES")!;
      expect(c.currentValue).toBe("Unsigned packages found — these bypass signature verification");
    });

    it("SUPPLY-APT-KEY-DEPRECATED currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-APT-KEY-DEPRECATED")!;
      expect(c.currentValue).toBe("apt-key in use — deprecated and scheduled for removal");
    });

    it("SUPPLY-REPOS-SIGNED currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-REPOS-SIGNED")!;
      expect(c.currentValue).toBe("APT repository metadata signature not verified");
    });

    it("SUPPLY-GPG-VERIFY-OK currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-GPG-VERIFY-OK")!;
      expect(c.currentValue).toBe("GPG signature verification reported failures");
    });

    it("SUPPLY-NO-UNAUTH-SOURCES currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-NO-UNAUTH-SOURCES")!;
      expect(c.currentValue).toBe("Unauthorized or unknown package sources found in APT configuration");
    });

    it("SUPPLY-DPKG-AUDIT-CLEAN currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-DPKG-AUDIT-CLEAN")!;
      expect(c.currentValue).toBe("dpkg audit detected broken or partially installed packages");
    });

    it("SUPPLY-NO-INSECURE-REPOS currentValue on fail (badOutput contains NONE substring)", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-NO-INSECURE-REPOS")!;
      // badOutput contains "NONE_FOUND" which triggers output.includes("NONE") early return
      expect(c.currentValue).toBe("No insecure APT configuration options found");
    });

    it("SUPPLY-DEBSUMS-INSTALLED currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SUPPLY-DEBSUMS-INSTALLED")!;
      expect(c.currentValue).toBe("debsums is not installed");
    });
  });
});
