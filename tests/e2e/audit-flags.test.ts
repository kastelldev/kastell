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
import type { AuditResult } from "../../src/core/audit/types";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/watch");
jest.mock("../../src/core/audit/formatters/badge", () => ({
  formatBadge: jest.fn(),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedAuditIndex = auditIndex as jest.Mocked<typeof auditIndex>;
const mockedWatch = watchModule as jest.Mocked<typeof watchModule>;
const mockedBadge = badgeModule as jest.Mocked<typeof badgeModule>;

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

function mockServerResolve(overrides: Partial<{ ip: string; name: string; platform: string }> = {}) {
  mockedServerSelect.resolveServer.mockResolvedValueOnce({
    ip: "1.2.3.4",
    name: "test-server",
    platform: "bare",
    ...overrides,
  });
}

describe("audit --watch flag", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
    mockServerResolve();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.useRealTimers();
  });

  it("should call watchAudit once with interval undefined when --watch has no value", async () => {
    mockedWatch.watchAudit.mockImplementation(async () => {});
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
    mockedWatch.watchAudit.mockImplementation(async () => {});
    await auditCommand("test-server", { watch: "60" });
    expect(mockedWatch.watchAudit).toHaveBeenCalledWith(
      "1.2.3.4",
      "test-server",
      "bare",
      expect.objectContaining({ interval: 60 }),
    );
  });

  it("should throw AuditError when --watch abc is not a positive number", async () => {
    await expect(auditCommand("test-server", { watch: "abc" })).rejects.toThrow(
      "Watch interval must be a positive number",
    );
  });
});

describe("audit --ci flag", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should throw AuditError when --ci is used without --threshold", async () => {
    mockServerResolve();
    await expect(auditCommand("test-server", { ci: true })).rejects.toThrow(
      "--ci requires --threshold",
    );
  });

  it("should exit with code 0 when --ci --threshold 70 and score is 80", async () => {
    mockServerResolve();
    mockedAuditIndex.runAudit.mockResolvedValueOnce({
      success: true,
      data: makeSampleResult({ overallScore: 80 }),
    });

    process.exitCode = 0;
    await auditCommand("test-server", { ci: true, threshold: "70" });
    expect(process.exitCode).toBe(0);
  });

  it("should exit with code 1 when --ci --threshold 90 and score is 70", async () => {
    mockServerResolve();
    mockedAuditIndex.runAudit.mockResolvedValueOnce({
      success: true,
      data: makeSampleResult({ overallScore: 70 }),
    });

    process.exitCode = 0;
    await auditCommand("test-server", { ci: true, threshold: "90" });
    expect(process.exitCode).toBe(1);
  });
});

describe("audit --badge flag", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
    mockServerResolve();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should output badge SVG when --badge is used", async () => {
    const svgOutput = '<svg xmlns="http://www.w3.org/2000/svg">mocked</svg>';
    mockedBadge.formatBadge.mockReturnValue(svgOutput);
    mockedAuditIndex.runAudit.mockResolvedValueOnce({
      success: true,
      data: makeSampleResult(),
    });

    await auditCommand("test-server", { badge: true });
    expect(mockedBadge.formatBadge).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls.join("\n")).toContain("mocked");
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

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    mockedConfig.findServers.mockReturnValue([]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should output JSON to stdout when --ci --threshold 70 --json", async () => {
    mockServerResolve();
    mockedAuditIndex.runAudit.mockResolvedValueOnce({
      success: true,
      data: makeSampleResult(),
    });

    await auditCommand("test-server", { ci: true, threshold: "70", json: true });
    // --ci forces options.json = true; output should be valid JSON
    const output = consoleSpy.mock.calls.join("\n");
    expect(() => JSON.parse(output)).not.toThrow();
  });
});