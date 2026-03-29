/**
 * Chmod/chown fix handler.
 * Applies chmod or chown via programmatic SSH — stat-based idempotency and atomic rollback.
 * Supports glob paths via useStdin mode.
 */

import { sshExec } from "../../../utils/ssh.js";
import { cmd, raw } from "../../../utils/sshCommand.js";
import type { FixHandler, HandlerParams, HandlerResult, RollbackStep, DiffLine } from "./index.js";

// chmod with octal mode: chmod 700 /root
const CHMOD_REGEX = /^chmod\s+(\d{3,4})\s+(\/\S+)$/;

// chown with owner/group: chown root:root /path or chown root /path
const CHOWN_REGEX = /^chown\s+([\w.:+-]+)\s+(\/\S+)$/;

/** Returns true if path contains glob characters */
function hasGlob(path: string): boolean {
  return path.includes("*") || path.includes("?");
}

export const chmodChownHandler: FixHandler = {
  match(fixCommand: string): HandlerParams | null {
    const mChmod = fixCommand.match(CHMOD_REGEX);
    if (mChmod) {
      return { type: "chmod-chown", mode: mChmod[1], path: mChmod[2] };
    }
    const mChown = fixCommand.match(CHOWN_REGEX);
    if (mChown) {
      return { type: "chmod-chown", owner: mChown[1], path: mChown[2] };
    }
    return null;
  },

  async execute(
    ip: string,
    params: HandlerParams,
  ): Promise<HandlerResult & { rollbackStep?: RollbackStep }> {
    const path = params.path as string;
    const mode = params.mode as string | undefined;
    const owner = params.owner as string | undefined;
    const useGlob = hasGlob(path);

    // Read current permissions/ownership via stat
    const statOpts = useGlob ? { useStdin: true } : undefined;
    const statCmd = useGlob
      ? raw(`stat -c '%a %U:%G' ${path}`)
      : cmd("stat", "-c", "%a %U:%G", path);

    const statResult = await sshExec(ip, statCmd, statOpts);
    const statLine = statResult.stdout.trim();
    // stat output: "755 root:root"
    const parts = statLine.split(" ");
    const currentMode = parts[0] ?? "";
    const currentOwner = parts[1] ?? "";

    if (mode !== undefined) {
      // Idempotency: skip if mode already correct (D-13)
      if (currentMode === mode) {
        return { success: true, skipped: true };
      }

      const applyCmd = useGlob
        ? raw(`chmod ${mode} ${path}`)
        : cmd("chmod", mode, path);
      const applyResult = await sshExec(ip, applyCmd, useGlob ? { useStdin: true } : undefined);
      if (applyResult.code !== 0) {
        return { success: false, error: applyResult.stderr };
      }

      const oldMode = currentMode;
      const rollbackStep: RollbackStep = {
        rollback: async (rollbackIp: string) => {
          const rollbackCmd = useGlob
            ? raw(`chmod ${oldMode} ${path}`)
            : cmd("chmod", oldMode, path);
          await sshExec(rollbackIp, rollbackCmd, useGlob ? { useStdin: true } : undefined);
        },
      };
      const diff: DiffLine = { handlerType: "chmod-chown", key: path, before: oldMode, after: mode };
      return { success: true, rollbackStep, diff };
    }

    if (owner !== undefined) {
      // Idempotency: skip if owner already correct
      if (currentOwner === owner) {
        return { success: true, skipped: true };
      }

      const applyCmd = useGlob
        ? raw(`chown ${owner} ${path}`)
        : cmd("chown", owner, path);
      const applyResult = await sshExec(ip, applyCmd, useGlob ? { useStdin: true } : undefined);
      if (applyResult.code !== 0) {
        return { success: false, error: applyResult.stderr };
      }

      const oldOwner = currentOwner;
      const rollbackStep: RollbackStep = {
        rollback: async (rollbackIp: string) => {
          const rollbackCmd = useGlob
            ? raw(`chown ${oldOwner} ${path}`)
            : cmd("chown", oldOwner, path);
          await sshExec(rollbackIp, rollbackCmd, useGlob ? { useStdin: true } : undefined);
        },
      };
      const diff: DiffLine = { handlerType: "chmod-chown", key: path, before: oldOwner, after: owner };
      return { success: true, rollbackStep, diff };
    }

    return { success: false, error: "No mode or owner specified in params" };
  },
};
