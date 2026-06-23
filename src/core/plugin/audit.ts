import { chunkConcurrent } from "../../utils/concurrency.js";
import type { PluginReadCheck } from "../../plugin/registry.js";

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

/**
 * Execute normalized plugin read checks (P144 T5).
 *
 * Caller supplies `readChecks` — the registry's already-ordered subset of
 * checks that expose a `read.cmd`. Mutating and probe-only checks are
 * excluded upstream: `buildPluginBatchSection` builds the heredoc from
 * `entry.readChecks`, and `pluginAudit` emits structured skip metadata
 * for the excluded checks (mutating → `legacy-mutating`, probe-only →
 * `probe-only`).
 *
 * Envelope preserved unchanged: `PLUGIN_AUDIT_PARALLELISM` env override
 * (lazy lookup per invocation), `AGGREGATE_TIMEOUT_MS` abort ceiling,
 * `chunkConcurrent` ordering, abort propagation, partial-result semantics,
 * 15-second per-check timeout.
 */
export async function executePluginChecks(
  readChecks: PluginReadCheck[],
  ctx: ExecutePluginChecksContext,
): Promise<ExecutePluginChecksResult> {
  const concurrency = getDefaultParallelism();

  const controller = new AbortController();
  const aggregateTimer = setTimeout(() => controller.abort(), AGGREGATE_TIMEOUT_MS);

  const runCheck = async (check: PluginReadCheck): Promise<CheckResult> => {
    if (controller.signal.aborted) {
      return { checkId: check.id, status: "timeout" };
    }
    try {
      const ssh = await ctx.ssh(check.read.cmd, { timeoutMs: 15000, signal: controller.signal });
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
    const results = await chunkConcurrent(readChecks, concurrency, runCheck);
    const completed = results.filter((r) => r.status !== "timeout").length;
    return { results, completed, pending: readChecks.length - completed };
  } finally {
    clearTimeout(aggregateTimer);
  }
}