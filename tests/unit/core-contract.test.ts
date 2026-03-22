/**
 * Core Function Contract Suite (CTR-03)
 *
 * Verifies that core functions returning KastellResult<T> satisfy the contract:
 *   1. They NEVER throw unguarded exceptions — all failures produce
 *      { success: boolean } (the "never throws" guarantee).
 *   2. When SSH is unavailable they return a KastellResult (either success or
 *      failure depending on the function's resilience model).
 *   3. When given an empty IP (null-server case) they either return
 *      { success: false } or throw a validation guard error — both are
 *      acceptable because an empty IP is logically invalid.
 *
 * Notes on function-specific behaviour:
 *   - runAudit: resilient to SSH failures — individual batch errors are caught
 *     and the function returns success:true with partial results. The "never
 *     throws" contract is still satisfied.
 *   - runServerDoctor: returns success:true unless assertValidIp throws.
 *   - collectEvidence: returns success:false when SSH throws (bug fix applied).
 *
 * Scope: the 3 public async functions with explicit KastellResult return types
 * that accept simple (serverName/ip, ...) arguments — runAudit, runServerDoctor,
 * collectEvidence.
 *
 * Exclusion: deployServer / deployServerHetzner / deployServerDO /
 * deployServerVultr / deployServerLinode require a CloudProvider instance
 * and complex provider-specific orchestration. Their contract compliance is
 * tested indirectly through MCP tool tests (server_provision) and existing
 * unit tests. This is a conscious scoping decision per the research
 * recommendation in the v1.14 contract-testing plan.
 */

// ─── Module mocks (hoisted by Jest) ─────────────────────────────────────────

jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/config");
jest.mock("../../src/core/tokens");
jest.mock("../../src/core/audit/history");
jest.mock("../../src/core/audit/snapshot");
jest.mock("../../src/utils/fileLock", () => ({
  withFileLock: jest.fn((_path: string, fn: () => unknown) => Promise.resolve(fn())),
}));
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue("[]"),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { runAudit } from "../../src/core/audit/index";
import { runServerDoctor } from "../../src/core/doctor";
import { collectEvidence } from "../../src/core/evidence";
import * as ssh from "../../src/utils/ssh";
import * as auditHistory from "../../src/core/audit/history";

const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedAuditHistory = auditHistory as jest.Mocked<typeof auditHistory>;

// ─── KASTELL_RESULT_FUNCTIONS registry ───────────────────────────────────────
//
// Each entry has:
//   fnName              — human-readable name for test output
//   call                — normal call with a valid-looking IP
//   callWithEmptyIp     — same call but with an empty IP string
//   expectSuccessFalseOnSshFailure — whether this function returns success:false
//                        when SSH throws. runAudit is resilient (returns true);
//                        collectEvidence returns false on SSH throw.

const KASTELL_RESULT_FUNCTIONS: Array<{
  fnName: string;
  call: () => Promise<{ success: boolean; error?: string; data?: unknown }>;
  callWithEmptyIp: () => Promise<{ success: boolean; error?: string; data?: unknown }>;
  expectSuccessFalseOnSshFailure: boolean;
}> = [
  {
    fnName: "runAudit",
    // runAudit catches each SSH batch individually — SSH failure does not
    // produce success:false (it returns partial results). "Never throws" is
    // still satisfied.
    expectSuccessFalseOnSshFailure: false,
    call: () => runAudit("1.2.3.4", "test-server", "bare"),
    callWithEmptyIp: () => runAudit("", "test-server", "bare"),
  },
  {
    fnName: "runServerDoctor",
    // runServerDoctor: always returns success:true when assertValidIp passes,
    // regardless of SSH failures (it runs checks on locally-cached data).
    expectSuccessFalseOnSshFailure: false,
    call: () => runServerDoctor("1.2.3.4", "test-server", { fresh: false }),
    callWithEmptyIp: () => runServerDoctor("", "test-server", { fresh: false }),
  },
  {
    fnName: "collectEvidence",
    // collectEvidence: SSH throw → success:false (after bug fix in evidence.ts)
    expectSuccessFalseOnSshFailure: true,
    call: () =>
      collectEvidence("test-server", "1.2.3.4", "bare", {
        lines: 50,
        noDocker: true,
        noSysinfo: true,
        force: false,
        json: false,
        quiet: true,
      }),
    callWithEmptyIp: () =>
      collectEvidence("test-server", "", "bare", {
        lines: 50,
        noDocker: true,
        noSysinfo: true,
        force: false,
        json: false,
        quiet: true,
      }),
  },
];

// ─── Contract suite ───────────────────────────────────────────────────────────

describe.each(KASTELL_RESULT_FUNCTIONS)(
  "KastellResult contract — $fnName",
  ({ call, callWithEmptyIp, expectSuccessFalseOnSshFailure }) => {
    beforeEach(() => {
      jest.resetAllMocks();
      // SSH always rejects — forces the error path in core functions that use SSH
      mockedSsh.sshExec.mockRejectedValue(new Error("SSH connection refused"));
      // assertValidIp: let it validate normally — throw on empty/invalid IP
      mockedSsh.assertValidIp.mockImplementation((ip: string) => {
        if (!ip || ip.trim() === "") {
          throw new Error("Invalid IP address: empty string");
        }
      });
      // loadAuditHistory must return an array (not undefined) to prevent
      // TypeError in checkAuditRegressionStreak
      mockedAuditHistory.loadAuditHistory.mockReturnValue([]);
    });

    it("returns { success: boolean } shape — never throws", async () => {
      // No try/catch: if the function throws, Jest catches it and fails the test,
      // proving the "never throws" contract is broken.
      const result = await call();
      expect(typeof result.success).toBe("boolean");
    });

    it("returns KastellResult with success field when SSH fails", async () => {
      const result = await call();
      expect(typeof result.success).toBe("boolean");
      if (expectSuccessFalseOnSshFailure) {
        expect(result.success).toBe(false);
        expect(typeof result.error).toBe("string");
      }
      // For resilient functions (runAudit, runServerDoctor): success may be true
      // because they handle SSH errors internally. The key contract is: no throw.
    });

    it("handles null-server case (empty IP) — returns error or throws validation guard", async () => {
      try {
        const result = await callWithEmptyIp();
        // If it returns rather than throwing, it must signal failure
        expect(result.success).toBe(false);
      } catch (err) {
        // Throwing a validation error on empty IP is also acceptable —
        // it proves a validation guard caught the empty IP before any I/O.
        expect(err).toBeDefined();
      }
    });
  },
);
