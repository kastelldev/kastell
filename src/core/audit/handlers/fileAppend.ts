/**
 * File-append fix handler.
 * Appends a line to a file via programmatic SSH — no local shell metacharacters.
 * Implements idempotency (skip if line already present) and rollback (remove appended line).
 */

import { sshExec } from "../../../utils/ssh.js";
import { cmd, raw } from "../../../utils/sshCommand.js";
import type { FixHandler, HandlerParams, HandlerResult, RollbackStep } from "./index.js";

// Matches: echo 'line' >> /path  or  echo "line" >> /path
// Strip trailing comment before matching
const ECHO_SINGLE_REGEX = /^echo\s+'([^']+)'\s*>>\s*(\/\S+)$/;
const ECHO_DOUBLE_REGEX = /^echo\s+"([^"]+)"\s*>>\s*(\/\S+)$/;

function stripTrailingComment(cmd: string): string {
  // Remove trailing # comments (not inside quotes)
  return cmd.replace(/\s+#.*$/, "").trim();
}

export const fileAppendHandler: FixHandler = {
  match(fixCommand: string): HandlerParams | null {
    const stripped = stripTrailingComment(fixCommand);
    const mSingle = stripped.match(ECHO_SINGLE_REGEX);
    if (mSingle) {
      return { type: "file-append", line: mSingle[1], path: mSingle[2] };
    }
    const mDouble = stripped.match(ECHO_DOUBLE_REGEX);
    if (mDouble) {
      return { type: "file-append", line: mDouble[1], path: mDouble[2] };
    }
    return null;
  },

  async execute(
    ip: string,
    params: HandlerParams,
  ): Promise<HandlerResult & { rollbackStep?: RollbackStep }> {
    const line = params.line as string;
    const path = params.path as string;

    // Read current file content
    const catResult = await sshExec(ip, cmd("cat", path));
    const content = catResult.stdout;

    // Idempotency: skip if line already present (D-11)
    if (content.includes(line)) {
      return { success: true, skipped: true };
    }

    // Append via stdin to avoid local metachar issues (useStdin=true lets remote bash handle >>)
    const appendCmd = raw(`echo '${line}' >> ${path}`);
    const appendResult = await sshExec(ip, appendCmd, { useStdin: true });
    if (appendResult.code !== 0) {
      return { success: false, error: appendResult.stderr };
    }

    const rollbackStep: RollbackStep = {
      rollback: async (rollbackIp: string) => {
        // Read file, remove last occurrence of line, write back
        const currentContent = (await sshExec(rollbackIp, cmd("cat", path))).stdout;
        const lines = currentContent.split("\n");
        const idx = lines.lastIndexOf(line);
        if (idx >= 0) {
          lines.splice(idx, 1);
          const newContent = lines.join("\n");
          await sshExec(rollbackIp, raw(`printf '%s' '${newContent.replace(/'/g, "'\\''")}' > ${path}`), { useStdin: true });
        }
      },
    };

    return { success: true, rollbackStep };
  },
};
