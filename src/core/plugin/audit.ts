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

const DEFAULT_PARALLELISM = parseInt(process.env.PLUGIN_AUDIT_PARALLELISM ?? "3", 10);

export interface ExecutePluginChecksContext {
  ssh: (cmd: string, opts?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string; code: number }>;
  manifest: { safeToParallel?: boolean | null; [key: string]: unknown };
}

export async function executePluginChecks(
  checks: PluginCheck[],
  ctx: ExecutePluginChecksContext,
): Promise<ExecutePluginChecksResult> {
  const concurrency = ctx.manifest.safeToParallel === false ? 1 : DEFAULT_PARALLELISM;

  const runCheck = async (check: PluginCheck): Promise<CheckResult> => {
    try {
      const ssh = await ctx.ssh(check.checkCommand, { timeoutMs: 15000 });
      if (ssh.code !== 0) {
        return { checkId: check.id, status: "error", reason: ssh.stderr || `Exit code ${ssh.code}` };
      }
      return { checkId: check.id, status: "pass", output: ssh.stdout };
    } catch (err) {
      return { checkId: check.id, status: "error", reason: err instanceof Error ? err.message : String(err) };
    }
  };

  const results = await chunkConcurrent(checks, concurrency, runCheck);

  const completed = results.filter((r) => r.status !== "timeout").length;
  return {
    results,
    completed,
    pending: checks.length - completed,
  };
}
