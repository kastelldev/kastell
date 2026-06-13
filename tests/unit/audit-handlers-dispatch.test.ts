/**
 * Tests for src/core/audit/handlers/index.ts: tryHandlerDispatch
 * (coverage gap: lines 161-176). Sibling file tests/unit/fix-handlers.test.ts
 * tests matchHandler, resolveHandlerChain, executeHandlerChain, and atomic
 * rollback, but does NOT test tryHandlerDispatch — the public dispatch entry
 * point used by runFix(), fixSafeCommand(), and handleServerFix() to decide
 * whether a fix command has a handler or should fall through to the shell path.
 *
 * Strategy: real tryHandlerDispatch + real resolveHandlerChain +
 * real executeHandlerChain + sshExec mocked. The two test cases exercise
 * the handled=false (no chain match) and handled=true (chain matches →
 * executeHandlerChain) paths. Test contents stay focused on dispatch
 * contract, not on handler-internal success/failure variants.
 */
import { sshExec } from "../../src/utils/ssh.js";
import { tryHandlerDispatch } from "../../src/core/audit/handlers/index.js";

jest.mock("../../src/utils/ssh.js", () => ({
  sshExec: jest.fn(),
  sshExecInner: jest.fn(),
  sshStream: jest.fn(),
  sshConnect: jest.fn(),
  assertValidIp: jest.fn(),
  resolveSshPath: jest.fn(() => "ssh"),
  resolveScpPath: jest.fn(() => "scp"),
  removeStaleHostKey: jest.fn(),
  getObservedHostFingerprint: jest.fn(),
  clearKnownHostKey: jest.fn(),
  isHostKeyMismatch: jest.fn(),
  getHostKeyPolicy: jest.fn(() => "accept-new"),
  checkSshAvailable: jest.fn(() => true),
  sanitizedEnv: jest.fn(() => ({})),
  getControlArgs: jest.fn(() => []),
  sshMasterOpen: jest.fn(),
  sshMasterClose: jest.fn(),
}));

const mockedSshExec = sshExec as jest.MockedFunction<typeof sshExec>;
const MOCK_IP = "1.2.3.4";

describe("tryHandlerDispatch", () => {
  beforeEach(() => {
    // mockReset (not clearAllMocks) per LESSONS — fully clears mockReturnValue queues
    mockedSshExec.mockReset();
  });

  it("returns handled=false when no handler matches the command", async () => {
    const applied: string[] = [];
    const errors: string[] = [];
    const result = await tryHandlerDispatch(
      MOCK_IP,
      { id: "CHECK-1", fixCommand: "totally-unknown-command-pattern" },
      applied,
      errors,
    );

    expect(result).toEqual({ handled: false });
    expect(applied).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("returns handled=true when handler chain resolves (applied or errors, contract holds)", async () => {
    // "echo ... >> /path" matches file-append handler. Mock sshExec to
    // succeed — the handler may or may not push to applied (depends on
    // idempotency) but the dispatch contract holds: handled=true, no throw,
    // result has expected shape.
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const applied: string[] = [];
    const errors: string[] = [];
    const result = await tryHandlerDispatch(
      MOCK_IP,
      { id: "CHECK-2", fixCommand: "echo 'net.ipv4.ip_forward=0' >> /etc/sysctl.conf" },
      applied,
      errors,
    );

    expect(result.handled).toBe(true);
    // Function must not throw, and must mutate exactly one of applied/errors
    expect(applied.length + errors.length).toBe(1);
  });

  it("accumulates handler errors across multiple dispatch calls", async () => {
    // Force a handler failure: echo a line that's NOT in the file (would
    // trigger file-append). Make sshExec return code 1 to fail the append.
    mockedSshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "permission denied" });

    const applied: string[] = [];
    const errors: string[] = [];
    const result1 = await tryHandlerDispatch(
      MOCK_IP,
      { id: "CHECK-A", fixCommand: "echo 'new-line' >> /etc/sysctl.conf" },
      applied,
      errors,
    );

    const result2 = await tryHandlerDispatch(
      MOCK_IP,
      { id: "CHECK-B", fixCommand: "echo 'new-line-2' >> /etc/sysctl.conf" },
      applied,
      errors,
    );

    expect(result1.handled).toBe(true);
    expect(result2.handled).toBe(true);
    expect(applied).toEqual([]);
    // At least one error from each dispatch — but we don't pin to exact count
    // (handler may collapse retries). Just assert both CHECK-IDs appear.
    const allErr = errors.join("|");
    expect(allErr).toMatch(/CHECK-A/);
    expect(allErr).toMatch(/CHECK-B/);
  });
});
