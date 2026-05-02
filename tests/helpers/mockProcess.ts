import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

/**
 * createMockProcess — returns a typed ChildProcess mock for test spawn mocking.
 * Auto-emits "close" with the given exitCode on next tick.
 */
export function createMockProcess(exitCode: number = 0): ChildProcess {
  const cp = new EventEmitter() as ChildProcess;
  (cp as any).stdout = new EventEmitter();
  (cp as any).stderr = new EventEmitter();
  process.nextTick(() => cp.emit("close", exitCode));
  return cp;
}