/**
 * Tests for src/commands/regression.ts (regressionStatusCommand) and the
 * no-baseline branch of regressionResetCommand — both uncovered paths in
 * P142 coverage baseline (regression.ts at 49.09% lines).
 *
 * The sibling file `tests/unit/regression-command.test.ts` already covers
 * `regressionResetCommand` against the ConfirmationDecision contract, and
 * tests pure functions in `core/audit/regression.ts`. This file focuses on
 * the command-level orchestration.
 */
import { createConsoleSpy } from "../helpers/consoleSpy.js";
import { logger } from "../../src/utils/logger.js";

const spy = createConsoleSpy();
const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
const titleSpy = jest.spyOn(logger, "title").mockImplementation(() => {});

beforeEach(() => {
  // Use mockReset (not clearAllMocks) — clearAllMocks leaves mockReturnValue/Implementation
  // intact and silently leaks between tests. mockReset clears implementations too.
  infoSpy.mockReset();
  titleSpy.mockReset();
  infoSpy.mockImplementation(() => {});
  titleSpy.mockImplementation(() => {});
  spy.setup();
});

afterAll(() => {
  infoSpy.mockRestore();
  titleSpy.mockRestore();
  spy.restore();
});

describe("regressionStatusCommand — single server branch", () => {
  it("logs 'No baseline found' when server arg is given but no baseline exists", async () => {
    const regressionCore = await import("../../src/core/audit/regression.js");
    const loadSpy = jest.spyOn(regressionCore, "loadBaseline").mockReturnValue(null);

    const { regressionStatusCommand } = await import("../../src/commands/regression.js");
    await regressionStatusCommand("1.2.3.4");

    expect(loadSpy).toHaveBeenCalledWith("1.2.3.4");
    expect(infoSpy).toHaveBeenCalledWith("No baseline found for 1.2.3.4");
    expect(spy.getCalls()).toEqual([]);
    expect(titleSpy).not.toHaveBeenCalled();
  });

  it("prints formatted baseline status when server arg is given and baseline exists", async () => {
    const fakeBaseline = {
      version: 1 as const,
      serverIp: "1.2.3.4",
      lastUpdated: "2026-04-20T10:00:00Z",
      bestScore: 78,
      passedChecks: ["CHECK-A", "CHECK-B", "CHECK-C"],
    };
    const regressionCore = await import("../../src/core/audit/regression.js");
    jest.spyOn(regressionCore, "loadBaseline").mockReturnValue(fakeBaseline);

    const { regressionStatusCommand } = await import("../../src/commands/regression.js");
    await regressionStatusCommand("1.2.3.4");

    const calls = spy.getCalls();
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain("1.2.3.4");
    expect(String(calls[0][0])).toContain("78");
    expect(String(calls[0][0])).toContain("3");
    expect(infoSpy).not.toHaveBeenCalled();
    expect(titleSpy).not.toHaveBeenCalled();
  });
});

describe("regressionStatusCommand — list branch", () => {
  it("logs 'No baselines found' when no server arg and baseline list is empty", async () => {
    const regressionCore = await import("../../src/core/audit/regression.js");
    jest.spyOn(regressionCore, "listBaselines").mockReturnValue([]);

    const { regressionStatusCommand } = await import("../../src/commands/regression.js");
    await regressionStatusCommand();

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("No baselines found"),
    );
    expect(titleSpy).not.toHaveBeenCalled();
    expect(spy.getCalls()).toEqual([]);
  });

  it("prints table header and one row per baseline when no server arg and list is non-empty", async () => {
    const fakeBaselines = [
      {
        version: 1 as const,
        serverIp: "1.2.3.4",
        lastUpdated: "2026-04-20T10:00:00Z",
        bestScore: 78,
        passedChecks: ["A", "B", "C"],
      },
      {
        version: 1 as const,
        serverIp: "10.0.0.5",
        lastUpdated: new Date().toISOString(),
        bestScore: 92,
        passedChecks: ["X", "Y"],
      },
    ];
    const regressionCore = await import("../../src/core/audit/regression.js");
    jest.spyOn(regressionCore, "listBaselines").mockReturnValue(fakeBaselines);

    const { regressionStatusCommand } = await import("../../src/commands/regression.js");
    await regressionStatusCommand();

    // Header via logger.title
    expect(titleSpy).toHaveBeenCalledTimes(1);
    const header = String(titleSpy.mock.calls[0][0]);
    expect(header).toContain("Server");
    expect(header).toContain("Best Score");
    expect(header).toContain("Checks");

    // One console.log per baseline
    const calls = spy.getCalls();
    expect(calls).toHaveLength(2);
    expect(String(calls[0][0])).toContain("1.2.3.4");
    expect(String(calls[0][0])).toContain("78");
    expect(String(calls[1][0])).toContain("10.0.0.5");
    expect(String(calls[1][0])).toContain("92");

    // formatRelativeTime output ("today" for current timestamp) is appended
    expect(String(calls[1][0])).toMatch(/today|ago/i);
  });
});

describe("regressionResetCommand — no baseline branch", () => {
  it("logs 'No baseline found' and skips confirm/delete when loadBaseline returns null", async () => {
    const regressionCore = await import("../../src/core/audit/regression.js");
    jest.spyOn(regressionCore, "loadBaseline").mockReturnValue(null);

    const { regressionResetCommand } = await import("../../src/commands/regression.js");
    await regressionResetCommand("1.2.3.4", {});

    expect(infoSpy).toHaveBeenCalledWith("No baseline found for 1.2.3.4");
    // confirmOrCancel + markCommandFailed must NOT be reached
    expect(titleSpy).not.toHaveBeenCalled();
    expect(spy.getCalls()).toEqual([]);
  });
});
