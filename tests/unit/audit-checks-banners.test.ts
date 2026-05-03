import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseBannersChecks } from "../../src/core/audit/checks/banners.js";

describe("parseBannersChecks", () => {
  const secureOutput = [
    "Authorized access only. All activity is monitored and logged.",
    "issue.net Authorized access only.",
    "motd This system is for authorized use only.",
    "Banner /etc/issue.net",
  ].join("\n");

  const insecureOutput = [
    "Ubuntu 22.04.3 LTS \\n \\l",
    "MISSING",
    "MISSING",
    "N/A",
  ].join("\n");

  it("should return 6 checks for the Banners category", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    expect(checks.length).toBeGreaterThanOrEqual(6);
    checks.forEach((c) => expect(c.category).toBe("Banners"));
  });

  it("all check IDs should start with BANNER- or BNR-", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^(BANNER|BNR)-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
    });
  });

  it("BANNER-SSH-BANNER passes when Banner points to a file", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-SSH-BANNER");
    expect(check!.passed).toBe(true);
  });

  it("BANNER-SSH-BANNER fails when no Banner configured", () => {
    const checks = parseBannersChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-SSH-BANNER");
    expect(check!.passed).toBe(false);
  });

  it("BANNER-NO-OS-INFO passes when no OS info in banners", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-NO-OS-INFO");
    expect(check!.passed).toBe(true);
  });

  it("BANNER-NO-OS-INFO fails when Ubuntu found in banner", () => {
    const checks = parseBannersChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-NO-OS-INFO");
    expect(check!.passed).toBe(false);
  });

  it("BANNER-MOTD-EXISTS passes when motd is present", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-MOTD-EXISTS");
    expect(check!.passed).toBe(true);
  });

  it("BNR-ISSUE-NET-SET passes when issue.net has a proper warning banner", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BNR-ISSUE-NET-SET");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("BNR-ISSUE-NET-SET fails when issue.net is MISSING", () => {
    const checks = parseBannersChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BNR-ISSUE-NET-SET");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseBannersChecks("N/A", "bare");
    expect(checks.length).toBeGreaterThanOrEqual(6);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });
});

describe("[MUTATION-KILLER] Banners check string assertions", () => {
  const secureOutput = [
    "Authorized access only. All activity is monitored and logged.",
    "issue.net Authorized access only.",
    "motd This system is for authorized use only.",
    "Banner /etc/issue.net",
  ].join("\n");

  const checks = parseBannersChecks(secureOutput, "bare");

  const expectedChecks = [
    {
      id: "BANNER-ISSUE-EXISTS",
      name: "/etc/issue Login Banner Exists",
      severity: "info",
      expectedValue: "/etc/issue contains a warning banner",
      fixCommand: "echo 'Authorized access only. All activity is monitored and logged.' > /etc/issue",
      safeToAutoFix: "SAFE",
      explain: "A login banner provides legal notice to potential intruders, which may be required for prosecution in some jurisdictions.",
    },
    {
      id: "BANNER-ISSUE-NET-EXISTS",
      name: "/etc/issue.net Banner Exists",
      severity: "info",
      expectedValue: "/etc/issue.net contains a network login banner",
      fixCommand: "echo 'Authorized access only. All activity is monitored and logged.' > /etc/issue.net",
      safeToAutoFix: "SAFE",
      explain: "The issue.net file provides a pre-login banner for network services like SSH, serving as a legal deterrent.",
    },
    {
      id: "BANNER-MOTD-EXISTS",
      name: "/etc/motd Message of the Day Exists",
      severity: "info",
      expectedValue: "/etc/motd contains a message for authenticated users",
      fixCommand: "echo 'This system is for authorized use only.' > /etc/motd",
      safeToAutoFix: "SAFE",
      explain: "The message of the day is shown after login and can remind users of security policies and acceptable use.",
    },
    {
      id: "BANNER-SSH-BANNER",
      name: "SSH Warning Banner Configured",
      severity: "info",
      expectedValue: "SSH Banner points to a file (e.g., /etc/issue.net)",
      fixCommand: "echo 'Banner /etc/issue.net' >> /etc/ssh/sshd_config && systemctl restart sshd",
      safeToAutoFix: "GUARDED",
      explain: "An SSH banner displays a warning message before authentication, providing legal notice and deterring unauthorized access.",
    },
    {
      id: "BANNER-NO-OS-INFO",
      name: "Banners Hide OS Version Info",
      severity: "info",
      expectedValue: "No OS version info in /etc/issue or /etc/issue.net",
      fixCommand: "echo 'Authorized access only.' > /etc/issue && echo 'Authorized access only.' > /etc/issue.net",
      safeToAutoFix: "SAFE",
      explain: "OS version disclosure in banners helps attackers identify specific vulnerabilities for the server's distribution and version.",
    },
    {
      id: "BNR-ISSUE-NET-SET",
      name: "/etc/issue.net Contains a Warning Banner",
      severity: "info",
      expectedValue: "/etc/issue.net has a warning banner without OS version identifiers",
      fixCommand: "echo 'Authorized users only. All activity may be monitored.' > /etc/issue.net",
      safeToAutoFix: "SAFE",
      explain: "A network login banner provides legal notice to unauthorized users and is required by many compliance frameworks.",
    },
  ];

  it("[MUTATION-KILLER] returns exactly 6 checks", () => {
    expect(checks).toHaveLength(6);
    expect(expectedChecks).toHaveLength(6);
  });

  expectedChecks.forEach((expected) => {
    describe(`${expected.id}`, () => {
      it("[MUTATION-KILLER] has correct id", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check).toBeDefined();
        expect(check!.id).toBe(expected.id);
      });

      it("[MUTATION-KILLER] has correct name", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.name).toBe(expected.name);
      });

      it("[MUTATION-KILLER] has correct severity", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.severity).toBe(expected.severity);
      });

      it("[MUTATION-KILLER] has correct category", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.category).toBe("Banners");
      });

      it("[MUTATION-KILLER] has correct expectedValue", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.expectedValue).toBe(expected.expectedValue);
      });

      it("[MUTATION-KILLER] has correct fixCommand", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.fixCommand).toBe(expected.fixCommand);
      });

      it("[MUTATION-KILLER] has correct explain", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.explain).toBe(expected.explain);
      });

      it("[MUTATION-KILLER] has correct safeToAutoFix", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.safeToAutoFix).toBe(expected.safeToAutoFix);
      });
    });
  });

  it("[MUTATION-KILLER] every check has non-empty fixCommand", () => {
    checks.forEach((c) => {
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty explain (> 10 chars)", () => {
    checks.forEach((c) => {
      expect(c.explain).toBeDefined();
      expect(c.explain!.length).toBeGreaterThan(10);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty name", () => {
    checks.forEach((c) => {
      expect(c.name.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty id", () => {
    checks.forEach((c) => {
      expect(c.id.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty expectedValue", () => {
    checks.forEach((c) => {
      expect(c.expectedValue.length).toBeGreaterThan(0);
    });
  });
});

describe("[MUTATION-KILLER] Banners N/A output string assertions", () => {
  const naChecks = parseBannersChecks("N/A", "bare");

  it("[MUTATION-KILLER] every N/A check has currentValue 'Unable to determine'", () => {
    naChecks.forEach((c) => {
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("[MUTATION-KILLER] every N/A check has category Banners", () => {
    naChecks.forEach((c) => {
      expect(c.category).toBe("Banners");
    });
  });

  it("[MUTATION-KILLER] N/A check count matches expected", () => {
    expect(naChecks).toHaveLength(6);
  });

  it("[MUTATION-KILLER] N/A output preserves all check IDs", () => {
    const ids = naChecks.map((c) => c.id);
    expect(ids).toContain("BANNER-ISSUE-EXISTS");
    expect(ids).toContain("BANNER-ISSUE-NET-EXISTS");
    expect(ids).toContain("BANNER-MOTD-EXISTS");
    expect(ids).toContain("BANNER-SSH-BANNER");
    expect(ids).toContain("BANNER-NO-OS-INFO");
    expect(ids).toContain("BNR-ISSUE-NET-SET");
  });
});

describe("[MUTATION-KILLER] Banners currentValue strings for secure output", () => {
  const secureOutput = [
    "Authorized access only. All activity is monitored and logged.",
    "issue.net Authorized access only.",
    "motd This system is for authorized use only.",
    "Banner /etc/issue.net",
  ].join("\n");

  const checks = parseBannersChecks(secureOutput, "bare");

  it("[MUTATION-KILLER] BANNER-ISSUE-EXISTS currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BANNER-ISSUE-EXISTS");
    expect(check!.currentValue).toBe("/etc/issue contains a login banner");
  });

  it("[MUTATION-KILLER] BANNER-ISSUE-NET-EXISTS currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BANNER-ISSUE-NET-EXISTS");
    expect(check!.currentValue).toBe("/etc/issue.net contains a network banner");
  });

  it("[MUTATION-KILLER] BANNER-MOTD-EXISTS currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BANNER-MOTD-EXISTS");
    expect(check!.currentValue).toBe("/etc/motd is configured");
  });

  it("[MUTATION-KILLER] BANNER-SSH-BANNER currentValue contains path", () => {
    const check = checks.find((c) => c.id === "BANNER-SSH-BANNER");
    expect(check!.currentValue).toBe("SSH Banner: /etc/issue.net");
  });

  it("[MUTATION-KILLER] BANNER-NO-OS-INFO currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BANNER-NO-OS-INFO");
    expect(check!.currentValue).toBe("Banners do not reveal OS distribution");
  });

  it("[MUTATION-KILLER] BNR-ISSUE-NET-SET currentValue for passing check", () => {
    const check = checks.find((c) => c.id === "BNR-ISSUE-NET-SET");
    expect(check!.currentValue).toBe("/etc/issue.net contains a generic warning banner");
  });
});

describe("[MUTATION-KILLER] Banners currentValue strings for insecure output", () => {
  const insecureOutput = [
    "Ubuntu 22.04.3 LTS \\n \\l",
    "MISSING",
    "MISSING",
    "N/A",
  ].join("\n");

  const checks = parseBannersChecks(insecureOutput, "bare");

  it("[MUTATION-KILLER] BANNER-SSH-BANNER insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BANNER-SSH-BANNER");
    expect(check!.currentValue).toBe("SSH Banner not configured");
  });

  it("[MUTATION-KILLER] BANNER-NO-OS-INFO insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BANNER-NO-OS-INFO");
    expect(check!.currentValue).toBe("Banner discloses OS distribution information");
  });

  it("[MUTATION-KILLER] BANNER-MOTD-EXISTS insecure currentValue", () => {
    const check = checks.find((c) => c.id === "BANNER-MOTD-EXISTS");
    expect(check!.currentValue).toBe("/etc/motd is empty or missing");
  });

  it("[MUTATION-KILLER] BNR-ISSUE-NET-SET insecure currentValue when MISSING", () => {
    const check = checks.find((c) => c.id === "BNR-ISSUE-NET-SET");
    expect(check!.currentValue).toBe("/etc/issue.net is missing");
  });
});
