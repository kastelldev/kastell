import * as auditRunner from "../../src/core/audit/index";
import * as history from "../../src/core/audit/history";
import { watchAudit } from "../../src/core/audit/watch";
import type { AuditResult } from "../../src/core/audit/types";

jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/history");

const mockedAuditRunner = auditRunner as jest.Mocked<typeof auditRunner>;
const mockedHistory = history as jest.Mocked<typeof history>;

const makeAuditResult = (score: number): AuditResult => ({
  serverName: "test-server",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: new Date().toISOString(),
  categories: [
    {
      name: "SSH",
      checks: [
        {
          id: "SSH-01",
          category: "SSH",
          name: "Password Auth",
          severity: "critical",
          passed: score >= 50,
          currentValue: score >= 50 ? "no" : "yes",
          expectedValue: "no",
        },
      ],
      score: score >= 50 ? 100 : 0,
      maxScore: 100,
    },
  ],
  overallScore: score,
  quickWins: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockedHistory.saveAuditHistory.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  jest.useRealTimers();
});

describe("watchAudit", () => {
  it("should call runAudit repeatedly at given interval", async () => {
    const result = makeAuditResult(72);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: result });

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Score: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      interval: 10,
      formatter,
      output: (line: string) => output.push(line),
    });

    // First run happens immediately
    await jest.advanceTimersByTimeAsync(0);
    // Wait for the async runAudit to resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(1);

    // Advance to trigger second run
    await jest.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(2);

    // Clean up - simulate SIGINT
    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });

  it("should show only score changes between runs (not full output)", async () => {
    const result1 = makeAuditResult(72);
    const result2 = makeAuditResult(68);
    mockedAuditRunner.runAudit
      .mockResolvedValueOnce({ success: true, data: result1 })
      .mockResolvedValueOnce({ success: true, data: result2 });

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Full: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      interval: 10,
      formatter,
      output: (line: string) => output.push(line),
    });

    // First run — full output
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // Second run — delta only
    await jest.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    // Second output should contain delta info, not full formatter output
    const deltaOutput = output.find((l) => l.includes("-4"));
    expect(deltaOutput).toBeDefined();

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });

  it("should stop on SIGINT", async () => {
    const result = makeAuditResult(72);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: result });

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Score: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      interval: 10,
      formatter,
      output: (line: string) => output.push(line),
    });

    // First run
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // Emit SIGINT
    process.emit("SIGINT" as never);

    // Promise should resolve
    await watchPromise.catch(() => {});

    // No more calls after SIGINT
    const callsBefore = mockedAuditRunner.runAudit.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(callsBefore);
  });

  it("should use default interval of 300 seconds", async () => {
    const result = makeAuditResult(72);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: result });

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Score: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      formatter,
      output: (line: string) => output.push(line),
    });

    // First run
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(1);

    // At 299 seconds, no second call
    await jest.advanceTimersByTimeAsync(299_000);
    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(1);

    // At 300 seconds, second call
    await jest.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(2);

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });

  it("should accept custom interval (--watch 60)", async () => {
    const result = makeAuditResult(72);
    mockedAuditRunner.runAudit.mockResolvedValue({ success: true, data: result });

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Score: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      interval: 60,
      formatter,
      output: (line: string) => output.push(line),
    });

    // First run
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(1);

    // At 59 seconds, no second call
    await jest.advanceTimersByTimeAsync(59_000);
    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(1);

    // At 60 seconds, second call
    await jest.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(2);

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });
});
