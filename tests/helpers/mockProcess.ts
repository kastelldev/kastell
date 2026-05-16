import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

/**
 * createMockProcess — returns a typed ChildProcess mock for test spawn mocking.
 * Auto-emits "close" with the given exitCode. Supports optional stderr data and delay.
 */
export function createMockProcess(
  exitCode: number = 0,
  options?: { stderrData?: string; delayMs?: number },
): ChildProcess {
  const cp = new EventEmitter() as ChildProcess;
  (cp as any).stdout = new EventEmitter();
  (cp as any).stderr = new EventEmitter();

  const delayMs = options?.delayMs;
  const stderrData = options?.stderrData;

  if (delayMs !== undefined && delayMs > 0) {
    // stderr must emit BEFORE close — nextTick (microtask) is guaranteed
    // to run before any setTimeout regardless of host timer drift (macOS CI flake).
    if (stderrData) {
      process.nextTick(() => (cp as any).stderr.emit("data", Buffer.from(stderrData)));
    }
    setTimeout(() => cp.emit("close", exitCode), delayMs);
  } else {
    if (stderrData) {
      process.nextTick(() => (cp as any).stderr.emit("data", Buffer.from(stderrData)));
    }
    process.nextTick(() => cp.emit("close", exitCode));
  }

  return cp;
}
