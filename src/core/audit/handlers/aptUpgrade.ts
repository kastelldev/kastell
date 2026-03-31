/**
 * apt-upgrade fix handler.
 * Runs `apt-get update && apt-get upgrade -y` with DEBIAN_FRONTEND=noninteractive
 * via stdin (avoids shell metacharacter issues).
 * No rollback step — system package upgrades are not reversible.
 */

import { sshExec } from "../../../utils/ssh.js";
import { raw } from "../../../utils/sshCommand.js";
import type { FixHandler, HandlerParams, HandlerResult, RollbackStep } from "./index.js";

const APT_UPGRADE_CMD = "apt-upgrade";

export const aptUpgradeHandler: FixHandler = {
  match(fixCommand: string): HandlerParams | null {
    if (fixCommand.trim() === APT_UPGRADE_CMD) {
      return { type: "apt-upgrade", action: "upgrade" };
    }
    return null;
  },

  async execute(
    ip: string,
    _params: HandlerParams,
  ): Promise<HandlerResult & { rollbackStep?: RollbackStep }> {
    const result = await sshExec(
      ip,
      raw("DEBIAN_FRONTEND=noninteractive apt-get update && apt-get upgrade -y"),
      { useStdin: true },
    );
    if (result.code !== 0) {
      return { success: false, error: result.stderr };
    }
    return { success: true };
  },
};
