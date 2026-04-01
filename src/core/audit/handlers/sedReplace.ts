/**
 * Sed-replace fix handler.
 * Replaces a matching line in a remote config file via SSH sed command.
 * Uses `|` as sed delimiter to avoid issues with `/` in patterns.
 * Implements idempotency (skip if already applied) and rollback (reverse sed).
 */

import { sshExec } from "../../../utils/ssh.js";
import { cmd, raw } from "../../../utils/sshCommand.js";
import type { FixHandler, HandlerParams, HandlerResult, RollbackStep, DiffLine } from "./index.js";

// Matches: sed-replace:/path/to/file:old-pattern:new-value
// The last group is greedy to handle colons in newValue
const SED_REPLACE_REGEX = /^sed-replace:([^:]+):([^:]+):(.+)$/;

/**
 * Escape special characters for sed with `|` delimiter.
 * Escapes `\` and `|` to prevent sed interpretation issues.
 */
function escapeSedPipe(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

export const sedReplaceHandler: FixHandler = {
  match(fixCommand: string): HandlerParams | null {
    const m = fixCommand.match(SED_REPLACE_REGEX);
    if (!m) return null;
    return {
      type: "sed-replace",
      path: m[1],
      oldPattern: m[2],
      newValue: m[3],
    };
  },

  async execute(
    ip: string,
    params: HandlerParams,
  ): Promise<HandlerResult & { rollbackStep?: RollbackStep }> {
    const path = params.path as string;
    const oldPattern = params.oldPattern as string;
    const newValue = params.newValue as string;

    const catResult = await sshExec(ip, cmd("cat", path));
    if (catResult.code !== 0) {
      return { success: false, error: catResult.stderr };
    }

    const lines = catResult.stdout.split("\n");
    const matchIndex = lines.findIndex((line) => line.includes(oldPattern));

    if (matchIndex === -1) {
      const hasNewValue = lines.some((line) => line.includes(newValue));
      if (hasNewValue) {
        return { success: true, skipped: true };
      }
      return {
        success: false,
        error: `Pattern not found: "${oldPattern}" in ${path}`,
      };
    }

    const originalLine = lines[matchIndex];
    const quotedPath = path.replace(/'/g, "'\\''");
    const sedCmd = `sed -i 's|${escapeSedPipe(oldPattern)}|${escapeSedPipe(newValue)}|' '${quotedPath}'`;
    const applyResult = await sshExec(ip, raw(sedCmd), { useStdin: true });

    if (applyResult.code !== 0) {
      return { success: false, error: applyResult.stderr };
    }

    const rollbackStep: RollbackStep = {
      rollback: async (rollbackIp: string) => {
        const reverseSedCmd = `sed -i 's|${escapeSedPipe(newValue)}|${escapeSedPipe(oldPattern)}|' ${path}`;
        await sshExec(rollbackIp, raw(reverseSedCmd), { useStdin: true });
      },
    };

    const diff: DiffLine = {
      handlerType: "sed-replace",
      key: path,
      before: originalLine.trim(),
      after: originalLine.trim().replace(oldPattern, newValue),
    };

    return { success: true, rollbackStep, diff };
  },
};
