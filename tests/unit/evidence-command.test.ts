/**
 * CLI command wiring tests for `kastell evidence [server]`.
 * Mocks core and utility modules — no SSH calls.
 */

import * as evidenceModule from "../../src/core/evidence";
import * as serverSelectModule from "../../src/utils/serverSelect";
import * as loggerModule from "../../src/utils/logger";
import * as fsModule from "fs";

jest.mock("../../src/core/evidence");
jest.mock("../../src/utils/serverSelect");
jest.mock("fs", () => ({ readFileSync: jest.fn() }));

jest.mock("../../src/utils/logger", () => ({
  createSpinner: jest.fn(() => ({
    start: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  })),
  logger: { error: jest.fn(), info: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

jest.mock("chalk", () => {
  const id = (s: string) => s;
  const chalkMock = { bold: id, yellow: id, green: id, dim: id, cyan: id };
  return { __esModule: true, default: chalkMock, ...chalkMock };
});

// ─── Import SUT ───────────────────────────────────────────────────────────────

import { evidenceCommand } from "../../src/commands/evidence";

// ─── Typed mocks ─────────────────────────────────────────────────────────────

const mockedEvidence = evidenceModule as jest.Mocked<typeof evidenceModule>;
const mockedServerSelect = serverSelectModule as jest.Mocked<typeof serverSelectModule>;
const mockedLogger = loggerModule as jest.Mocked<typeof loggerModule>;
const mockedFs = fsModule as jest.Mocked<typeof fsModule>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    name: "prod-server",
    ip: "1.2.3.4",
    mode: "coolify" as const,
    platform: "coolify",
    ...overrides,
  };
}

function makeResult(overrides: Partial<{
  evidenceDir: string;
  serverName: string;
  serverIp: string;
  platform: string;
  collectedAt: string;
  totalFiles: number;
  skippedFiles: number;
  manifestPath: string;
}> = {}) {
  return {
    success: true as const,
    data: {
      evidenceDir: "/tmp/evidence/prod-server/2026-03-11",
      serverName: "prod-server",
      serverIp: "1.2.3.4",
      platform: "coolify",
      collectedAt: "2026-03-11T08:00:00.000Z",
      totalFiles: 5,
      skippedFiles: 0,
      manifestPath: "/tmp/evidence/prod-server/2026-03-11/MANIFEST.json",
      ...overrides,
    },
  };
}

function getSpinner() {
  return (mockedLogger.createSpinner as jest.Mock).mock.results[0]?.value as {
    start: jest.Mock;
    succeed: jest.Mock;
    fail: jest.Mock;
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("evidenceCommand", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    // Re-apply spinner factory after clearAllMocks
    (mockedLogger.createSpinner as jest.Mock).mockReturnValue({
      start: jest.fn(),
      succeed: jest.fn(),
      fail: jest.fn(),
    });
  });

  it("calls resolveServer with the server argument", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500" });

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith("prod-server", expect.any(String));
  });

  it("passes default options to collectEvidence", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500" });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      "prod-server",
      "1.2.3.4",
      "coolify",
      expect.objectContaining({
        lines: 500,
        noDocker: false,
        noSysinfo: false,
        force: false,
        json: false,
        quiet: false,
      }),
    );
  });

  it("maps --no-docker (options.docker === false) to noDocker=true", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500", docker: false });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ noDocker: true }),
    );
  });

  it("maps --no-sysinfo (options.sysinfo === false) to noSysinfo=true", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500", sysinfo: false });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ noSysinfo: true }),
    );
  });

  it("parses --lines as integer", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "1000" });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ lines: 1000 }),
    );
  });

  it("starts and succeeds spinner on success path", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500" });

    const spinner = getSpinner();
    expect(spinner.start).toHaveBeenCalled();
    expect(spinner.succeed).toHaveBeenCalled();
    expect(spinner.fail).not.toHaveBeenCalled();
  });

  it("does not create spinner when --quiet is set", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500", quiet: true });

    expect(mockedLogger.createSpinner).not.toHaveBeenCalled();
  });

  it("sets process.exitCode = 2 when skippedFiles > 0", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult({ skippedFiles: 2 }) as never);

    await evidenceCommand("prod-server", { lines: "500" });

    expect(process.exitCode).toBe(2);
  });

  it("does not set process.exitCode when no files are skipped", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult({ skippedFiles: 0 }) as never);

    await evidenceCommand("prod-server", { lines: "500" });

    expect(process.exitCode).toBeUndefined();
  });

  it("sets process.exitCode = 1 and calls spinner.fail on failure", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue({ success: false as const, error: "SSH failed" } as never);

    await evidenceCommand("prod-server", { lines: "500" });

    const spinner = getSpinner();
    expect(spinner.fail).toHaveBeenCalledWith("SSH failed");
    expect(process.exitCode).toBe(1);
  });

  it("reads and prints manifest JSON when --json is set", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    const result = makeResult();
    mockedEvidence.collectEvidence.mockResolvedValue(result as never);
    const manifestContent = JSON.stringify({ schemaVersion: 1, files: [] });
    (mockedFs.readFileSync as jest.Mock).mockReturnValue(manifestContent);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await evidenceCommand("prod-server", { lines: "500", json: true });
    consoleSpy.mockRestore();

    expect(mockedFs.readFileSync).toHaveBeenCalledWith(result.data.manifestPath, "utf-8");
  });

  it("returns early when resolveServer returns undefined", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined as never);

    await evidenceCommand(undefined, { lines: "500" });

    expect(mockedEvidence.collectEvidence).not.toHaveBeenCalled();
  });

  it("passes --name option to collectEvidence", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500", name: "pre-incident" });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ name: "pre-incident" }),
    );
  });

  it("passes --output option to collectEvidence", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500", output: "/tmp/custom-evidence" });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ output: "/tmp/custom-evidence" }),
    );
  });

  it("uses server.mode when server.platform is not set", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer({ platform: undefined, mode: "bare" }) as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500" });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "bare",
      expect.any(Object),
    );
  });

  it("falls back to 'bare' when neither platform nor mode is set", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer({ platform: undefined, mode: undefined }) as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500" });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "bare",
      expect.any(Object),
    );
  });

  it("falls back to 500 lines when --lines is non-numeric", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "abc" });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ lines: 500 }),
    );
  });

  it("calls spinner.fail with default message when error is undefined", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue({ success: false as const } as never);

    await evidenceCommand("prod-server", { lines: "500" });

    const spinner = getSpinner();
    expect(spinner.fail).toHaveBeenCalledWith("Evidence collection failed");
    expect(process.exitCode).toBe(1);
  });

  it("passes --force option to collectEvidence", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(makeServer() as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await evidenceCommand("prod-server", { lines: "500", force: true });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ force: true }),
    );
  });
});
