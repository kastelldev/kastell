/**
 * Programmatic fix handler registry.
 * Provides matchHandler(), resolveHandlerChain(), executeHandlerChain() for
 * replacing shell-metachar-blocked fixCommands with safe TypeScript handlers.
 *
 * Handler registration order: sysctl, fileAppend, packageInstall, chmodChown
 */

import { sysctlHandler } from "./sysctl.js";
import { fileAppendHandler } from "./fileAppend.js";
import { packageInstallHandler } from "./packageInstall.js";
import { chmodChownHandler } from "./chmodChown.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface HandlerParams {
  type: "sysctl" | "file-append" | "package-install" | "chmod-chown";
  [key: string]: unknown;
}

export interface HandlerResult {
  success: boolean;
  skipped?: boolean; // idempotent: already in desired state
  error?: string;
}

/** Rollback info collected during chain execution for atomic undo (D-08, D-16) */
export interface RollbackStep {
  rollback: (ip: string) => Promise<void>;
}

export interface FixHandler {
  match(fixCommand: string): HandlerParams | null;
  execute(ip: string, params: HandlerParams): Promise<HandlerResult & { rollbackStep?: RollbackStep }>;
}

// ─── Handler registry (order matters — first match wins) ──────────────────────

const HANDLERS: FixHandler[] = [
  sysctlHandler,
  fileAppendHandler,
  packageInstallHandler,
  chmodChownHandler,
];

// ─── matchHandler ──────────────────────────────────────────────────────────────

/**
 * Returns the first matching handler+params pair, or null if no handler matches.
 */
export function matchHandler(
  fixCommand: string,
): { handler: FixHandler; params: HandlerParams } | null {
  for (const handler of HANDLERS) {
    const params = handler.match(fixCommand);
    if (params !== null) {
      return { handler, params };
    }
  }
  return null;
}

// ─── resolveHandlerChain ───────────────────────────────────────────────────────

/**
 * Splits a compound fixCommand on ' && ', resolves each part to a handler.
 * Returns null if ANY part is unmatched (D-15 — no partial dispatch).
 */
export function resolveHandlerChain(
  fixCommand: string,
): Array<{ handler: FixHandler; params: HandlerParams }> | null {
  const parts = fixCommand
    .split(" && ")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chain: Array<{ handler: FixHandler; params: HandlerParams }> = [];
  for (const part of parts) {
    const match = matchHandler(part);
    if (match === null) return null;
    chain.push(match);
  }

  return chain.length > 0 ? chain : null;
}

// ─── executeHandlerChain ───────────────────────────────────────────────────────

/**
 * Executes each step in the chain sequentially.
 * If any step fails, rolls back all previously collected rollback steps in reverse order.
 * Implements atomic rollback (D-16).
 */
export async function executeHandlerChain(
  ip: string,
  chain: Array<{ handler: FixHandler; params: HandlerParams }>,
): Promise<HandlerResult> {
  const rollbackSteps: RollbackStep[] = [];

  for (const { handler, params } of chain) {
    const result = await handler.execute(ip, params);

    if (!result.success) {
      // Rollback in reverse order (D-16)
      for (const step of [...rollbackSteps].reverse()) {
        try {
          await step.rollback(ip);
        } catch {
          // Best-effort rollback — swallow errors to not mask the original failure
        }
      }
      return { success: false, error: result.error };
    }

    if (result.rollbackStep) {
      rollbackSteps.push(result.rollbackStep);
    }
  }

  return { success: true };
}
