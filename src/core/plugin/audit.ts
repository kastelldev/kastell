import { chunkConcurrent } from "../../utils/concurrency.js";
import type { PluginCheck } from "../../plugin/sdk/types.js";

export interface CheckResult {
  checkId: string;
  status: "pass" | "error" | "timeout";
  output?: string;
  reason?: string;
}

export interface ExecutePluginChecksResult {
  results: CheckResult[];
  aborted?: boolean;
  completed: number;
  pending: number;
}

// Lazy lookup — module-load `parseInt(process.env, …)` traps tests that
// mutate PLUGIN_AUDIT_PARALLELISM after import. Evaluated per-call so
// `jest.isolateModules` is no longer required for env variation.
function getDefaultParallelism(): number {
  return parseInt(process.env.PLUGIN_AUDIT_PARALLELISM ?? "3", 10);
}

// Aggregate ceiling — bounds worst-case latency for N slow checks (LESSONS.md
// "Plugin Parallel Execution" flags this as mandatory: N × per-check = stall risk).
const AGGREGATE_TIMEOUT_MS = 120_000;

export interface ExecutePluginChecksContext {
  ssh: (cmd: string, opts?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string; code: number }>;
}

export async function executePluginChecks(
  checks: PluginCheck[],
  ctx: ExecutePluginChecksContext,
): Promise<ExecutePluginChecksResult> {
  const hasMutatingCheck = checks.some((check) => check.checkCommand.kind !== "read");
  const concurrency = hasMutatingCheck ? 1 : getDefaultParallelism();

  const controller = new AbortController();
  const aggregateTimer = setTimeout(() => controller.abort(), AGGREGATE_TIMEOUT_MS);

  const runCheck = async (check: PluginCheck): Promise<CheckResult> => {
    if (controller.signal.aborted) {
      return { checkId: check.id, status: "timeout" };
    }
    try {
      const ssh = await ctx.ssh(check.checkCommand.cmd, { timeoutMs: 15000, signal: controller.signal });
      if (ssh.code !== 0) {
        return { checkId: check.id, status: "error", reason: ssh.stderr || `Exit code ${ssh.code}` };
      }
      return { checkId: check.id, status: "pass", output: ssh.stdout };
    } catch (err) {
      if (controller.signal.aborted) {
        return { checkId: check.id, status: "timeout" };
      }
      return { checkId: check.id, status: "error", reason: err instanceof Error ? err.message : String(err) };
    }
  };

  try {
    const results = await chunkConcurrent(checks, concurrency, runCheck);
    const completed = results.filter((r) => r.status !== "timeout").length;
    return { results, completed, pending: checks.length - completed };
  } finally {
    clearTimeout(aggregateTimer);
  }
}
