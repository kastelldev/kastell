/**
 * Package-install fix handler.
 * Installs a Debian/Ubuntu package via apt-get — no shell metacharacters via dpkg check.
 * Implements idempotency (skip if already installed) and rollback (apt-get remove).
 */

import { sshExec } from "../../../utils/ssh.js";
import { cmd, raw } from "../../../utils/sshCommand.js";
import type { FixHandler, HandlerParams, HandlerResult, RollbackStep, DiffLine } from "./index.js";

// Matches: apt-get install -y <pkg> or apt install -y <pkg> (or without -y)
// Anchored at end to prevent partial match on "bad;cmd" (security)
const APT_REGEX = /^(?:apt-get|apt)\s+install\s+(?:-y\s+)?([a-zA-Z0-9._+-]+)\s*$/;

// Valid package name: only alphanumeric + dots, underscores, hyphens, plus
const VALID_PKG_REGEX = /^[a-zA-Z0-9._+-]+$/;

export const packageInstallHandler: FixHandler = {
  match(fixCommand: string): HandlerParams | null {
    const m = fixCommand.match(APT_REGEX);
    if (!m) return null;
    const pkgName = m[1];
    // Validate package name to prevent shell injection
    if (!VALID_PKG_REGEX.test(pkgName)) return null;
    return { type: "package-install", package: pkgName };
  },

  async execute(
    ip: string,
    params: HandlerParams,
  ): Promise<HandlerResult & { rollbackStep?: RollbackStep }> {
    const pkgName = params.package as string;

    // Validate package name (defense in depth)
    if (!VALID_PKG_REGEX.test(pkgName)) {
      return { success: false, error: `Invalid package name: ${pkgName}` };
    }

    // Check if already installed via dpkg (idempotent, D-13)
    const dpkgResult = await sshExec(ip, cmd("dpkg", "-l", pkgName));
    if (dpkgResult.stdout.includes(`ii  ${pkgName}`)) {
      return { success: true, skipped: true };
    }

    // Install via stdin to allow DEBIAN_FRONTEND env var and avoid arg escaping
    const installCmd = raw(`DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgName}`);
    const installResult = await sshExec(ip, installCmd, { useStdin: true });
    if (installResult.code !== 0) {
      return { success: false, error: installResult.stderr };
    }

    const rollbackStep: RollbackStep = {
      rollback: async (rollbackIp: string) => {
        await sshExec(rollbackIp, raw(`apt-get remove -y ${pkgName}`), { useStdin: true });
      },
    };

    const diff: DiffLine = {
      handlerType: "package-install",
      key: pkgName,
      before: "not installed",
      after: "installed",
    };
    return { success: true, rollbackStep, diff };
  },
};
