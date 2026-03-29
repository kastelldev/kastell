/**
 * Unit tests for fix report generator.
 * Covers: generateFixReport sections, fixReportFilename, dryRun mode.
 */

import { generateFixReport, fixReportFilename } from "../../src/utils/fixReport.js";
import type { FixReportParams } from "../../src/utils/fixReport.js";

const BASE_PARAMS: FixReportParams = {
  server: { name: "myserver", ip: "1.2.3.4" },
  scoreBefore: 72,
  scoreAfter: 85,
  applied: [
    { id: "SSH-01", category: "SSH", severity: "critical" },
    { id: "KRN-01", category: "Kernel", severity: "warning", diff: {
      handlerType: "sysctl",
      key: "kernel.randomize_va_space",
      before: "0",
      after: "2",
    }},
  ],
  failed: [{ id: "FW-01", error: "permission denied" }],
  skipped: [{ id: "DOC-01", category: "Docker", reason: "already correct" }],
  profile: "web-server",
  dryRun: false,
  timestamp: "2026-03-29T10:00:00Z",
};

// ─── generateFixReport sections ───────────────────────────────────────────────

describe("generateFixReport", () => {
  it("contains all 7 required section headers", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("## Summary");
    expect(report).toContain("## Server Info");
    expect(report).toContain("## Score Change");
    expect(report).toContain("## Applied Fixes");
    expect(report).toContain("## Diff Details");
    expect(report).toContain("## Skipped Fixes");
    expect(report).toContain("## Profile");
  });

  it("starts with '# Kastell Fix Report' title", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("# Kastell Fix Report");
  });

  it("contains server name and IP in Server Info", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("myserver");
    expect(report).toContain("1.2.3.4");
  });

  it("contains score before and after in Score Change", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("72");
    expect(report).toContain("85");
  });

  it("contains applied fix IDs in Applied Fixes table", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("SSH-01");
    expect(report).toContain("KRN-01");
  });

  it("contains handler diff details in Diff Details section", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("kernel.randomize_va_space");
    expect(report).toContain("0");
    expect(report).toContain("2");
    expect(report).toContain("sysctl");
  });

  it("shows 'Shell command -- diff not available' for fixes without diff", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("Shell command");
    expect(report).toContain("diff not available");
  });

  it("contains skipped fix IDs in Skipped Fixes table", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("DOC-01");
    expect(report).toContain("already correct");
  });

  it("contains profile name in Profile section", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("web-server");
  });

  it("omits Profile section when no profile provided", () => {
    const paramsNoProfile = { ...BASE_PARAMS, profile: undefined };
    const report = generateFixReport(paramsNoProfile);
    expect(report).not.toContain("## Profile");
  });

  it("contains timestamp in Server Info", () => {
    const report = generateFixReport(BASE_PARAMS);
    expect(report).toContain("2026-03-29T10:00:00Z");
  });

  it("contains summary counts", () => {
    const report = generateFixReport(BASE_PARAMS);
    // 2 applied, 1 failed, 1 skipped
    expect(report).toMatch(/2.*applied|applied.*2/i);
  });
});

// ─── dryRun mode ──────────────────────────────────────────────────────────────

describe("generateFixReport dryRun mode", () => {
  it("starts with DRY RUN prefix when dryRun=true", () => {
    const dryParams: FixReportParams = { ...BASE_PARAMS, dryRun: true, scoreAfter: null };
    const report = generateFixReport(dryParams);
    expect(report).toContain("DRY RUN");
    expect(report.indexOf("DRY RUN")).toBeLessThan(50); // Near top
  });

  it("shows N/A for score after when dryRun=true", () => {
    const dryParams: FixReportParams = { ...BASE_PARAMS, dryRun: true, scoreAfter: null };
    const report = generateFixReport(dryParams);
    expect(report).toContain("N/A");
    expect(report).toContain("dry run");
  });
});

// ─── fixReportFilename ────────────────────────────────────────────────────────

describe("fixReportFilename", () => {
  it("returns correct filename format", () => {
    const filename = fixReportFilename("myserver", "2026-03-29");
    expect(filename).toBe("kastell-fix-report-myserver-2026-03-29.md");
  });

  it("uses provided date string as-is", () => {
    const filename = fixReportFilename("production", "2026-01-15");
    expect(filename).toBe("kastell-fix-report-production-2026-01-15.md");
  });

  it("handles server names with hyphens", () => {
    const filename = fixReportFilename("web-prod-1", "2026-03-29");
    expect(filename).toBe("kastell-fix-report-web-prod-1-2026-03-29.md");
  });
});
