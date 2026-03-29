/**
 * Sysctl fix handler.
 * Applies sysctl -w key=value via programmatic SSH — no shell metacharacters.
 * Implements idempotency (skip if already set) and atomic rollback.
 */

import { sshExec } from "../../../utils/ssh.js";
import { cmd } from "../../../utils/sshCommand.js";
import type { FixHandler, HandlerParams, HandlerResult, RollbackStep, DiffLine } from "./index.js";

const SYSCTL_REGEX = /^sysctl\s+-w\s+([\w.]+)=([\w.]+)$/;

export const sysctlHandler: FixHandler = {
  match(fixCommand: string): HandlerParams | null {
    const m = fixCommand.match(SYSCTL_REGEX);
    if (!m) return null;
    return { type: "sysctl", key: m[1], value: m[2] };
  },

  async execute(
    ip: string,
    params: HandlerParams,
  ): Promise<HandlerResult & { rollbackStep?: RollbackStep }> {
    const key = params.key as string;
    const value = params.value as string;

    // Read current runtime value
    const readResult = await sshExec(ip, cmd("sysctl", "-n", key));
    const currentValue = readResult.stdout.trim();

    // Idempotency: skip if already correct (D-12)
    if (currentValue === value) {
      return { success: true, skipped: true };
    }

    // Apply new value
    const applyResult = await sshExec(ip, cmd("sysctl", "-w", `${key}=${value}`));
    if (applyResult.code !== 0) {
      return { success: false, error: applyResult.stderr };
    }

    // Capture old value for atomic rollback (D-08)
    const oldValue = currentValue;
    const rollbackStep: RollbackStep = {
      rollback: async (rollbackIp: string) => {
        await sshExec(rollbackIp, cmd("sysctl", "-w", `${key}=${oldValue}`));
      },
    };

    const diff: DiffLine = { handlerType: "sysctl", key, before: oldValue, after: value };
    return { success: true, rollbackStep, diff };
  },
};
