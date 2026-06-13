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
  auditVersion: "1.0.0",
  categories: [
    {
      name: "SSH",
      checks: [
        {
          id: "SSH-PASSWORD-AUTH",
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
  // Windows CI fake timers can be slow — raise from default 5s
  jest.setTimeout(15_000);
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

    // First run happens immediately — flush microtasks generously for Windows CI
    await jest.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledTimes(1);

    // Advance to trigger second run
    await jest.advanceTimersByTimeAsync(10_000);
    for (let i = 0; i < 5; i++) await Promise.resolve();

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

  it("should log error when audit fails (success: false)", async () => {
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: false,
      error: "SSH connection refused",
    });

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

    // Should log the error
    expect(output.some((l) => l.includes("Audit failed") && l.includes("SSH connection refused"))).toBe(true);

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });

  it("should log 'Unknown error' when audit fails without error message", async () => {
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: false,
    });

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Score: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      interval: 10,
      formatter,
      output: (line: string) => output.push(line),
    });

    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(output.some((l) => l.includes("Unknown error"))).toBe(true);

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });

  it("should detect new failures with severity on subsequent runs", async () => {
    const result1 = makeAuditResult(72);
    const result2: AuditResult = {
      ...makeAuditResult(60),
      categories: [
        {
          name: "SSH",
          checks: [
            {
              id: "SSH-PASSWORD-AUTH",
              category: "SSH",
              name: "Password Auth",
              severity: "critical",
              passed: false,
              currentValue: "yes",
              expectedValue: "no",
            },
            {
              id: "SSH-ROOT-LOGIN",
              category: "SSH",
              name: "Root Login",
              severity: "warning",
              passed: false,
              currentValue: "yes",
              expectedValue: "no",
            },
          ],
          score: 0,
          maxScore: 100,
        },
      ],
    };
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

    // First run
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // Second run — new failure SSH-ROOT-LOGIN should appear
    await jest.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    const deltaOutput = output.find((l) => l.includes("SSH-ROOT-LOGIN"));
    expect(deltaOutput).toBeDefined();
    expect(deltaOutput).toMatch(/\(warning\)/);

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });

  it("should show 'unchanged' when score does not change between runs", async () => {
    const result = makeAuditResult(72);
    mockedAuditRunner.runAudit
      .mockResolvedValueOnce({ success: true, data: result })
      .mockResolvedValueOnce({ success: true, data: result });

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Full: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      interval: 10,
      formatter,
      output: (line: string) => output.push(line),
    });

    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(output.some((l) => l.includes("unchanged"))).toBe(true);

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });

  it("should stop after 3 consecutive failures", async () => {
    const result = makeAuditResult(72);
    mockedAuditRunner.runAudit
      .mockResolvedValueOnce({ success: true, data: result }) // initial run succeeds
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"));

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Score: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      interval: 10,
      formatter,
      output: (line: string) => output.push(line),
    });

    // First run (success)
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // Three consecutive failures
    for (let i = 0; i < 3; i++) {
      await jest.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(output.some((l) => l.includes("3 consecutive failures"))).toBe(true);

    // Promise should resolve after cleanup
    await watchPromise.catch(() => {});
  });

  it("should stop when initial audit throws", async () => {
    mockedAuditRunner.runAudit.mockRejectedValue(new Error("SSH timeout"));

    const output: string[] = [];
    const formatter = (r: AuditResult) => `Score: ${r.overallScore}`;

    const watchPromise = watchAudit("1.2.3.4", "test-server", "bare", {
      interval: 10,
      formatter,
      output: (line: string) => output.push(line),
    });

    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(output.some((l) => l.includes("Initial audit failed") && l.includes("SSH timeout"))).toBe(true);

    await watchPromise.catch(() => {});
  });

  it("should track failed checks on first run for delta calculation", async () => {
    // First run with a failing check (score < 50 means check fails)
    const result1 = makeAuditResult(40);
    const result2 = makeAuditResult(40);
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

    // First run — should track SSH-PASSWORD-AUTH as failed
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // Second run — same failures, so "New issues: 0"
    await jest.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(output.some((l) => l.includes("New issues: 0"))).toBe(true);

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });

  it("should show positive score diff with + prefix", async () => {
    const result1 = makeAuditResult(60);
    const result2 = makeAuditResult(72);
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

    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(output.some((l) => l.includes("+12"))).toBe(true);

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

  it("should not announce a newly-skipped check as a new failure", async () => {
    const result1 = makeAuditResult(72); // SSH-PASSWORD-AUTH passes
    const result2: AuditResult = {
      ...makeAuditResult(72),
      categories: [
        {
          name: "SSH",
          checks: [
            {
              id: "SSH-PASSWORD-AUTH",
              category: "SSH",
              name: "Password Auth",
              severity: "critical",
              passed: false,
              currentValue: "yes",
              expectedValue: "no",
              skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-global" },
            },
          ],
          score: 0,
          maxScore: 100,
        },
      ],
    };
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

    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();
    await Promise.resolve();

    // SSH-PASSWORD-AUTH was passing, now skipped — must NOT appear as a new failure
    const skippedAnnouncement = output.find((l) => l.includes("SSH-PASSWORD-AUTH"));
    expect(skippedAnnouncement).toBeUndefined();

    process.emit("SIGINT" as never);
    await watchPromise.catch(() => {});
  });
});
