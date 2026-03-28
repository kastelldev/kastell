import { parseDdosChecks } from "../../src/core/audit/checks/ddos.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_DDOS_OUTPUT = [
  "net.ipv4.tcp_max_syn_backlog = 4096",
  "net.ipv4.tcp_synack_retries = 2",
  "net.ipv4.tcp_fin_timeout = 15",
  "net.ipv4.tcp_tw_reuse = 1",
  "net.ipv4.icmp_ratelimit = 1000",
  "net.ipv4.icmp_ignore_bogus_error_responses = 1",
  "net.core.somaxconn = 4096",
  "net.ipv4.tcp_syn_retries = 3",
].join("\n");

const BAD_VALUES_OUTPUT = [
  "net.ipv4.tcp_max_syn_backlog = 128",
  "net.ipv4.tcp_synack_retries = 6",
  "net.ipv4.tcp_fin_timeout = 120",
  "net.ipv4.tcp_tw_reuse = 0",
  "net.ipv4.icmp_ratelimit = 5000",
  "net.ipv4.icmp_ignore_bogus_error_responses = 0",
  "net.core.somaxconn = 128",
  "net.ipv4.tcp_syn_retries = 6",
].join("\n");

const DOCKER_OUTPUT = [
  "net.ipv4.tcp_max_syn_backlog = 2048",
  "net.ipv4.tcp_synack_retries = 3",
  "net.ipv4.tcp_fin_timeout = 30",
  "net.ipv4.tcp_tw_reuse = 0",
  "net.ipv4.icmp_ratelimit = 1000",
  "net.ipv4.icmp_ignore_bogus_error_responses = 1",
  "net.core.somaxconn = 1024",
  "net.ipv4.tcp_syn_retries = 3",
].join("\n");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseDdosChecks -- full valid output", () => {
  it("returns exactly 8 AuditCheck objects", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    expect(checks).toHaveLength(8);
  });

  it("all check IDs start with 'DDOS-'", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^DDOS-/));
  });

  it("all checks have category 'DDoS Hardening'", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    checks.forEach((c) => expect(c.category).toBe("DDoS Hardening"));
  });

  it("all 8 checks pass with valid values on bare platform", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    checks.forEach((c) => expect(c.passed).toBe(true));
  });

  it("each check has non-empty fixCommand", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    checks.forEach((c) => {
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("each check has non-empty explain", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    checks.forEach((c) => {
      expect(c.explain).toBeDefined();
      expect(c.explain!.length).toBeGreaterThan(0);
    });
  });

  it("returns checks in expected ID order", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const ids = checks.map((c) => c.id);
    expect(ids).toEqual([
      "DDOS-SYN-BACKLOG",
      "DDOS-SYNACK-RETRIES",
      "DDOS-FIN-TIMEOUT",
      "DDOS-TW-REUSE",
      "DDOS-ICMP-RATELIMIT",
      "DDOS-ICMP-BOGUS",
      "DDOS-SOMAXCONN",
      "DDOS-SYN-RETRIES",
    ]);
  });
});

describe("parseDdosChecks -- bad values", () => {
  it("DDOS-SYN-BACKLOG fails with backlog=128 (< 2048)", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-BACKLOG")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("net.ipv4.tcp_max_syn_backlog = 128");
  });

  it("DDOS-SYNACK-RETRIES fails with retries=6 (> 3)", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYNACK-RETRIES")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("net.ipv4.tcp_synack_retries = 6");
  });

  it("DDOS-FIN-TIMEOUT fails with timeout=120 (> 30)", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-FIN-TIMEOUT")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("net.ipv4.tcp_fin_timeout = 120");
  });

  it("DDOS-TW-REUSE fails with reuse=0 on bare platform", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-TW-REUSE")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("net.ipv4.tcp_tw_reuse = 0");
  });

  it("DDOS-ICMP-RATELIMIT fails with ratelimit=5000 (> 1000)", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-ICMP-RATELIMIT")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("net.ipv4.icmp_ratelimit = 5000");
  });

  it("DDOS-ICMP-BOGUS fails with bogus=0 (not 1)", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-ICMP-BOGUS")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("net.ipv4.icmp_ignore_bogus_error_responses = 0");
  });

  it("DDOS-SOMAXCONN fails with somaxconn=128 (< 1024)", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-SOMAXCONN")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("net.core.somaxconn = 128");
  });

  it("DDOS-SYN-RETRIES fails with retries=6 (> 3)", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-RETRIES")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("net.ipv4.tcp_syn_retries = 6");
  });
});

describe("parseDdosChecks -- N/A input", () => {
  it("returns 8 checks with passed=false for empty string", () => {
    const checks = parseDdosChecks("", "bare");
    expect(checks).toHaveLength(8);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("returns 8 checks with passed=false for 'N/A'", () => {
    const checks = parseDdosChecks("N/A", "bare");
    expect(checks).toHaveLength(8);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("returns 8 checks with passed=false for whitespace-only input", () => {
    const checks = parseDdosChecks("   \n  \n  ", "bare");
    expect(checks).toHaveLength(8);
    checks.forEach((c) => expect(c.passed).toBe(false));
  });
});

describe("parseDdosChecks -- Docker platform guard (DDOS-02)", () => {
  it("DDOS-TW-REUSE passes on 'coolify' with tcp_tw_reuse=0", () => {
    const checks = parseDdosChecks(DOCKER_OUTPUT, "coolify");
    const c = checks.find((c) => c.id === "DDOS-TW-REUSE")!;
    expect(c.passed).toBe(true);
    expect(c.currentValue).toBe("net.ipv4.tcp_tw_reuse = 0");
  });

  it("DDOS-TW-REUSE passes on 'dokploy' with tcp_tw_reuse=0", () => {
    const checks = parseDdosChecks(DOCKER_OUTPUT, "dokploy");
    const c = checks.find((c) => c.id === "DDOS-TW-REUSE")!;
    expect(c.passed).toBe(true);
  });

  it("DDOS-TW-REUSE fails on 'bare' with tcp_tw_reuse=0", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-TW-REUSE")!;
    expect(c.passed).toBe(false);
  });

  it("DDOS-TW-REUSE expectedValue mentions 'Docker' on coolify platform", () => {
    const checks = parseDdosChecks(DOCKER_OUTPUT, "coolify");
    const c = checks.find((c) => c.id === "DDOS-TW-REUSE")!;
    expect(c.expectedValue).toContain("Docker");
  });

  it("DDOS-TW-REUSE expectedValue shows sysctl key on bare platform", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-TW-REUSE")!;
    expect(c.expectedValue).toBe("net.ipv4.tcp_tw_reuse = 1");
  });

  it("non-TW-REUSE checks are unaffected by platform (DDOS-SYN-BACKLOG still fails with bad value on coolify)", () => {
    const checks = parseDdosChecks(BAD_VALUES_OUTPUT, "coolify");
    const c = checks.find((c) => c.id === "DDOS-SYN-BACKLOG")!;
    expect(c.passed).toBe(false);
  });

  it("N/A input always fails DDOS-TW-REUSE on all platforms", () => {
    for (const platform of ["bare", "coolify", "dokploy"]) {
      const checks = parseDdosChecks("N/A", platform);
      const c = checks.find((c) => c.id === "DDOS-TW-REUSE")!;
      expect(c.passed).toBe(false);
    }
  });
});

describe("parseDdosChecks -- boundary values", () => {
  it("tcp_max_syn_backlog=2048 exactly passes (>= threshold)", () => {
    const output = "net.ipv4.tcp_max_syn_backlog = 2048";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-BACKLOG")!;
    expect(c.passed).toBe(true);
    expect(c.currentValue).toBe("net.ipv4.tcp_max_syn_backlog = 2048");
  });

  it("tcp_max_syn_backlog=2047 fails (just below threshold)", () => {
    const output = "net.ipv4.tcp_max_syn_backlog = 2047";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-BACKLOG")!;
    expect(c.passed).toBe(false);
  });

  it("tcp_synack_retries=3 exactly passes (<= threshold)", () => {
    const output = "net.ipv4.tcp_synack_retries = 3";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYNACK-RETRIES")!;
    expect(c.passed).toBe(true);
  });

  it("tcp_synack_retries=4 fails (one above threshold)", () => {
    const output = "net.ipv4.tcp_synack_retries = 4";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYNACK-RETRIES")!;
    expect(c.passed).toBe(false);
  });

  it("tcp_fin_timeout=30 exactly passes (<= threshold)", () => {
    const output = "net.ipv4.tcp_fin_timeout = 30";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-FIN-TIMEOUT")!;
    expect(c.passed).toBe(true);
  });

  it("tcp_fin_timeout=31 fails (one above threshold)", () => {
    const output = "net.ipv4.tcp_fin_timeout = 31";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-FIN-TIMEOUT")!;
    expect(c.passed).toBe(false);
  });

  it("somaxconn=1024 exactly passes (>= threshold)", () => {
    const output = "net.core.somaxconn = 1024";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-SOMAXCONN")!;
    expect(c.passed).toBe(true);
  });

  it("somaxconn=1023 fails (just below threshold)", () => {
    const output = "net.core.somaxconn = 1023";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-SOMAXCONN")!;
    expect(c.passed).toBe(false);
  });

  it("icmp_ratelimit=1000 exactly passes (<= threshold)", () => {
    const output = "net.ipv4.icmp_ratelimit = 1000";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-ICMP-RATELIMIT")!;
    expect(c.passed).toBe(true);
  });

  it("icmp_ratelimit=1001 fails (one above threshold)", () => {
    const output = "net.ipv4.icmp_ratelimit = 1001";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-ICMP-RATELIMIT")!;
    expect(c.passed).toBe(false);
  });

  it("tcp_syn_retries=3 exactly passes (<= threshold)", () => {
    const output = "net.ipv4.tcp_syn_retries = 3";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-RETRIES")!;
    expect(c.passed).toBe(true);
  });

  it("tcp_syn_retries=4 fails (one above threshold)", () => {
    const output = "net.ipv4.tcp_syn_retries = 4";
    const checks = parseDdosChecks(output, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-RETRIES")!;
    expect(c.passed).toBe(false);
  });

  it("DDOS-ICMP-BOGUS only passes with exactly '1'", () => {
    const output1 = "net.ipv4.icmp_ignore_bogus_error_responses = 1";
    const checks1 = parseDdosChecks(output1, "bare");
    const c1 = checks1.find((c) => c.id === "DDOS-ICMP-BOGUS")!;
    expect(c1.passed).toBe(true);

    const output0 = "net.ipv4.icmp_ignore_bogus_error_responses = 0";
    const checks0 = parseDdosChecks(output0, "bare");
    const c0 = checks0.find((c) => c.id === "DDOS-ICMP-BOGUS")!;
    expect(c0.passed).toBe(false);
  });
});

describe("parseDdosChecks -- severity assignments", () => {
  it("DDOS-SYN-BACKLOG has 'warning' severity", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-BACKLOG")!;
    expect(c.severity).toBe("warning");
  });

  it("DDOS-SYNACK-RETRIES has 'warning' severity", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYNACK-RETRIES")!;
    expect(c.severity).toBe("warning");
  });

  it("DDOS-FIN-TIMEOUT has 'warning' severity", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-FIN-TIMEOUT")!;
    expect(c.severity).toBe("warning");
  });

  it("DDOS-TW-REUSE has 'info' severity", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-TW-REUSE")!;
    expect(c.severity).toBe("info");
  });

  it("DDOS-ICMP-RATELIMIT has 'info' severity", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-ICMP-RATELIMIT")!;
    expect(c.severity).toBe("info");
  });

  it("DDOS-ICMP-BOGUS has 'info' severity", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-ICMP-BOGUS")!;
    expect(c.severity).toBe("info");
  });

  it("DDOS-SOMAXCONN has 'warning' severity", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-SOMAXCONN")!;
    expect(c.severity).toBe("warning");
  });

  it("DDOS-SYN-RETRIES has 'info' severity", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-RETRIES")!;
    expect(c.severity).toBe("info");
  });
});

describe("parseDdosChecks -- missing sysctl keys return Unable to determine", () => {
  it("DDOS-SYN-BACKLOG shows 'Unable to determine' when key absent", () => {
    const checks = parseDdosChecks("some unrelated output", "bare");
    const c = checks.find((c) => c.id === "DDOS-SYN-BACKLOG")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("Unable to determine");
  });

  it("DDOS-SOMAXCONN shows 'Unable to determine' when key absent", () => {
    const checks = parseDdosChecks("some unrelated output", "bare");
    const c = checks.find((c) => c.id === "DDOS-SOMAXCONN")!;
    expect(c.passed).toBe(false);
    expect(c.currentValue).toBe("Unable to determine");
  });

  describe("[MUTATION-KILLER] DDoS check metadata", () => {
    const checks = parseDdosChecks(VALID_DDOS_OUTPUT, "bare");

    const expectedMeta: Array<[string, string]> = [
      ["DDOS-SYN-BACKLOG", "warning"],
      ["DDOS-SYNACK-RETRIES", "warning"],
      ["DDOS-FIN-TIMEOUT", "warning"],
      ["DDOS-TW-REUSE", "info"],
      ["DDOS-ICMP-RATELIMIT", "info"],
      ["DDOS-ICMP-BOGUS", "info"],
      ["DDOS-SOMAXCONN", "warning"],
      ["DDOS-SYN-RETRIES", "info"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=SAFE", (id, severity) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("DDoS Hardening");
      expect(c!.severity).toBe(severity);
      expect(c!.safeToAutoFix).toBe("SAFE");
    });

    it("[MUTATION-KILLER] every check has non-empty fixCommand and explain", () => {
      checks.forEach((c) => {
        expect(c.fixCommand).toBeDefined();
        expect(c.fixCommand!.length).toBeGreaterThan(0);
        expect(c.explain).toBeDefined();
        expect(c.explain!.length).toBeGreaterThan(10);
      });
    });

    it("[MUTATION-KILLER] all IDs start with DDOS-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^DDOS-/));
    });
  });
});
