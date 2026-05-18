import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

/**
 * SshExecResult — matches the return type of sshExec() in src/utils/ssh.ts.
 * Shape: { code: number; stdout: string; stderr: string }
 */
export type SshExecResult = { code: number; stdout: string; stderr: string };

/**
 * MockChildProcess — typed substitute for ChildProcess in tests.
 *
 * Centralizes the EventEmitter-to-ChildProcess cast for reuse across test files.
 * The constructor auto-emits "close" with the given exitCode (optionally delayed).
 */
export class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin: null = null;
  pid = 12345;

  constructor(exitCode: number = 0, delayMs = 0) {
    super();
    const emit = () => this.emit("close", exitCode);
    if (delayMs > 0) {
      const handle = setTimeout(emit, delayMs);
      handle.unref();
    } else {
      process.nextTick(emit);
    }
  }
}

/**
 * mockProcess — returns a typed ChildProcess mock.
 * Single centralized `as unknown as ChildProcess` cast for all test files.
 */
export function mockProcess(exitCode = 0, delayMs = 0): ChildProcess {
  return new MockChildProcess(exitCode, delayMs) as unknown as ChildProcess;
}

// ─── SSH result builders ──────────────────────────────────────────────────────

const SSH_EXEC_DEFAULT: SshExecResult = { stdout: "", stderr: "", code: 0 };

/**
 * mockSshSuccess — builds a successful sshExec result.
 */
export function mockSshSuccess(stdout = ""): SshExecResult {
  return { ...SSH_EXEC_DEFAULT, stdout };
}

/**
 * mockSshFailure — builds a failed sshExec result.
 */
export function mockSshFailure(stderr = "error", code = 1): SshExecResult {
  return { ...SSH_EXEC_DEFAULT, stderr, code };
}

/**
 * mockSshTimeout — builds a timed-out sshExec result (code 1, stderr with timeout message).
 */
export function mockSshTimeout(timeoutSeconds = 30): SshExecResult {
  return { ...SSH_EXEC_DEFAULT, code: 1, stderr: `SSH command timed out after ${timeoutSeconds}s` };
}
