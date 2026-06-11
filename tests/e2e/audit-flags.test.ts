/**
 * E2E tests for audit --watch/--ci/--badge flag behaviors.
 * Covers: flag dispatch, threshold exit code, badge color mapping.
 */

import { auditCommand } from "../../src/commands/audit";
import { AuditError } from "../../src/core/audit/errors";
import * as config from "../../src/utils/config";
import * as serverSelect from "../../src/utils/serverSelect";
import * as auditIndex from "../../src/core/audit/index";
import * as watchModule from "../../src/core/audit/watch";
import * as badgeModule from "../../src/core/audit/formatters/badge";
import * as historyModule from "../../src/core/audit/history";
import * as regressionModule from "../../src/core/audit/regression";
import * as formatters from "../../src/core/audit/formatters";
import type { AuditResult } from "../../src/core/audit/types";
import type { ServerRecord } from "../../src/types";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/watch");
jest.mock("../../src/core/audit/formatters/badge", () => ({
  formatBadge: jest.fn(),
}));
jest.mock("../../src/core/audit/history");
jest.mock("../../src/core/audit/regression");
jest.mock("../../src/core/audit/formatters", () => ({
  selectFormatter: jest.fn(),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedAuditIndex = auditIndex as jest.Mocked<typeof auditIndex>;
const mockedWatch = watchModule as jest.Mocked<typeof watchModule>;
const mockedBadge = badgeModule as jest.Mocked<typeof badgeModule>;
const mockedHistory = historyModule as jest.Mocked<typeof historyModule>;
const mockedRegression = regressionModule as jest.Mocked<typeof regressionModule>;
const mockedFormatters = formatters as jest.Mocked<typeof formatters>;

function makeSampleResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: new Date().toISOString(),
    auditVersion: "1.0.0",
    categories: [],
    overallScore: 75,
    quickWins: [],
    ...overrides,
  };
}

function mockServerResolve(overrides: Partial<ServerRecord> = {}): void {
  mockedServerSelect.resolveServer.mockResolvedValueOnce({
    ip: "1.2.3.4",
    name: "test-server",
    platform: undefined,
    ...overrides,
  } as ServerRecord);
}

function mockAuditSuccess(result: AuditResult, formatterFn?: (r: AuditResult) => string): void {
  mockedServerSelect.resolveServer.mockResolvedValueOnce({
    ip: "1.2.3.4",
    name: "test-server",
    platform: undefined,
  } as ServerRecord);
  mockedAuditIndex.runAudit.mockResolvedValueOnce({ success: true, data: result });
  mockedHistory.loadAuditHistory.mockReturnValueOnce([]);
  mockedRegression.loadBaseline.mockReturnValueOnce(null);
  mockedRegression.shouldUpdateBaseline.mockReturnValueOnce(false);
  if (formatterFn) {
    mockedFormatters.selectFormatter.mockResolvedValue(formatterFn);
  }
}

function safeParse(payload: string): Record<string, unknown> | null {
  try { return JSON.parse(payload); } catch { return null; }
}

function captureStdio(consoleSpy: jest.SpyInstance, stderrSpy: jest.SpyInstance): string {
  return [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].join("\n");
}

function findStdioJsonCall(consoleSpy: jest.SpyInstance, stderrSpy: jest.SpyInstance): unknown[] | undefined {
  return [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].find((call) => {
    const arg = call[0];
    if (typeof arg !== "string") return false;
    return safeParse(arg) !== null;
  });
}

describe("audit --watch flag", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    process.exitCode = 0;
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
    mockServerResolve();
    // Default: watchAudit returns undefined (real watch logic not needed for handler arg verification)
    mockedWatch.watchAudit.mockResolvedValue(undefined);
    // Mock formatter for non-watch paths
    mockedFormatters.selectFormatter.mockResolvedValue(() => JSON.stringify({}));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
    process.exitCode = 0;
    jest.useRealTimers();
  });

  it("should call watchAudit once with interval undefined when --watch has no value", async () => {
    await auditCommand("test-server", { watch: "" });
    expect(mockedWatch.watchAudit).toHaveBeenCalledTimes(1);
    expect(mockedWatch.watchAudit).toHaveBeenCalledWith(
      "1.2.3.4",
      "test-server",
      "bare",
      expect.objectContaining({ interval: undefined }),
    );
  });

  it("should parse --watch 60 as integer interval 60", async () => {
    await auditCommand("test-server", { watch: "60" });
    expect(mockedWatch.watchAudit).toHaveBeenCalledWith(
      "1.2.3.4",
      "test-server",
      "bare",
      expect.objectContaining({ interval: 60 }),
    );
  });

  it("should set exitCode=1 and log error when --watch abc is not a positive number", async () => {
    await auditCommand("test-server", { watch: "abc" });
    expect(process.exitCode).toBe(1);
    expect(captureStdio(consoleSpy, stderrSpy)).toContain("Watch interval must be a positive number");
  });
});

describe("audit --ci flag", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    process.exitCode = 0;
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
    mockedFormatters.selectFormatter.mockResolvedValue(() => JSON.stringify({}));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
    process.exitCode = 0;
  });

  it("should set exitCode=1 and log error when --ci is used without --threshold", async () => {
    mockServerResolve();
    await auditCommand("test-server", { ci: true });
    expect(process.exitCode).toBe(1);
    expect(captureStdio(consoleSpy, stderrSpy)).toContain("--ci requires --threshold");
  });

  it("should exit with code 0 when --ci --threshold 70 and score is 80", async () => {
    mockAuditSuccess(makeSampleResult({ overallScore: 80 }));
    await auditCommand("test-server", { ci: true, threshold: "70" });
    expect(process.exitCode).toBe(0);
  });

  it("should exit with code 1 when --ci --threshold 90 and score is 70", async () => {
    mockAuditSuccess(makeSampleResult({ overallScore: 70 }));
    await auditCommand("test-server", { ci: true, threshold: "90" });
    expect(process.exitCode).toBe(1);
  });
});

describe("audit --badge flag", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    process.exitCode = 0;
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
    // Set up formatBadge mock before selectFormatter uses it
    mockedBadge.formatBadge.mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg">mocked</svg>');
    // Let selectFormatter use real implementation (async, imports formatBadge from real module)
    mockedFormatters.selectFormatter.mockImplementation(async () => {
      // Return the real formatBadge so our mock is used
      const { formatBadge } = await import("../../src/core/audit/formatters/badge");
      return formatBadge;
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
    process.exitCode = 0;
  });

  it("should call formatBadge when --badge is used", async () => {
    const svgOutput = '<svg xmlns="http://www.w3.org/2000/svg">mocked</svg>';
    mockedBadge.formatBadge.mockReturnValue(svgOutput);
    mockAuditSuccess(makeSampleResult());

    await auditCommand("test-server", { badge: true });
    expect(mockedBadge.formatBadge).toHaveBeenCalledTimes(1);
    expect(captureStdio(consoleSpy, stderrSpy)).toContain("mocked");
  });

  it("should use green color for score >= 80", () => {
    const { formatBadge } = jest.requireActual("../../src/core/audit/formatters/badge");
    const svg = formatBadge(makeSampleResult({ overallScore: 85 }));
    expect(svg).toContain("#4c1"); // green
  });

  it("should use yellow color for score 60-79", () => {
    const { formatBadge } = jest.requireActual("../../src/core/audit/formatters/badge");
    const svg = formatBadge(makeSampleResult({ overallScore: 70 }));
    expect(svg).toContain("#dfb317"); // yellow
  });

  it("should use red color for score < 60", () => {
    const { formatBadge } = jest.requireActual("../../src/core/audit/formatters/badge");
    const svg = formatBadge(makeSampleResult({ overallScore: 45 }));
    expect(svg).toContain("#e05d44"); // red
  });
});

describe("audit --ci --threshold --json combination", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    process.exitCode = 0;
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
    mockedFormatters.selectFormatter.mockResolvedValue((r: AuditResult) => JSON.stringify(r));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
    process.exitCode = 0;
  });

  it("should output JSON to stdout when --ci --threshold 70 --json", async () => {
    mockAuditSuccess(makeSampleResult(), (r: AuditResult) => JSON.stringify(r));
    await auditCommand("test-server", { ci: true, threshold: "70", json: true });
    const jsonCall = findStdioJsonCall(consoleSpy, stderrSpy);
    expect(jsonCall).toBeDefined();
    expect(safeParse(jsonCall![0] as string)).not.toBeNull();
  });
});

describe("audit machine-output stdout contract", () => {
  let stdoutWrites: string[];
  let stderrWrites: string[];
  let stdoutSpy: jest.SpyInstance;
  let stderrStreamSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;

  const captureStdout = (): string => stdoutWrites.join("");

  beforeEach(() => {
    stdoutWrites = [];
    stderrWrites = [];
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdoutWrites.push(typeof chunk === "string" ? chunk : (chunk as Buffer).toString());
      return true;
    });
    stderrStreamSpy = jest.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrWrites.push(typeof chunk === "string" ? chunk : (chunk as Buffer).toString());
      return true;
    });
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdoutWrites.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
    consoleErrSpy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrWrites.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
    process.exitCode = 0;
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrStreamSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrSpy.mockRestore();
    process.exitCode = 0;
  });

  it("stdout is parseable JSON when --json is set", async () => {
    mockAuditSuccess(makeSampleResult({ overallScore: 80 }), (r: AuditResult) => JSON.stringify(r));
    await auditCommand("test-server", { json: true });

    const stdout = captureStdout();
    expect(stdout.length).toBeGreaterThan(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).not.toMatch(/Trend:|Score:|quick win|regression/i);
  });

  it("stdout is parseable JSON when --ci --threshold 0 --category SSH", async () => {
    mockAuditSuccess(makeSampleResult({ overallScore: 70 }), (r: AuditResult) => JSON.stringify(r));
    await auditCommand("test-server", { ci: true, threshold: "0", category: "SSH" });

    const stdout = captureStdout();
    expect(stdout.length).toBeGreaterThan(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).not.toMatch(/Trend:|Score:|quick win|regression/i);
  });

  it("threshold failure in machine mode sets exitCode=1 without threshold prose on stdout", async () => {
    mockAuditSuccess(makeSampleResult({ overallScore: 50 }), (r: AuditResult) => JSON.stringify(r));
    await auditCommand("test-server", { ci: true, threshold: "999" });

    expect(process.exitCode).toBe(1);
    const stdout = captureStdout();
    const stderr = stderrWrites.join("");
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).not.toMatch(/below threshold/i);
    // Regression guard: a future change that re-introduces the threshold prose
    // via stderr (e.g. machineDiagnostic) would be caught here.
    expect(stderr).not.toMatch(/below threshold/i);
  });
});
