import { chunkConcurrent } from "../../utils/concurrency.js";
import { sshExec, sshMasterOpen, sshMasterClose } from "../../utils/ssh.js";
import type { PluginCheck } from "../../plugin/sdk/types.js";

export interface CheckResult {
  checkId: string;
  status: "pass" | "error" | "timeout";
  output?: string;
  reason?: string;
}

const MAX_CONCURRENT_PER_HOST = 4;
const DEFAULT_AGGREGATE_TIMEOUT_MS = 120_000;

export async function executePluginChecks(checks: PluginCheck[], host: string): Promise<CheckResult[]> {
  const aggregateMs = Number(process.env.PLUGIN_AUDIT_TIMEOUT_MS) || DEFAULT_AGGREGATE_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), aggregateMs);
  const masterOpened = await sshMasterOpen(host).catch(() => false);

  try {
    const results = await chunkConcurrent(checks, MAX_CONCURRENT_PER_HOST, async (check) => {
      if (ac.signal.aborted) {
        return { checkId: check.id, status: "timeout" as const, reason: `Aggregate timeout (${aggregateMs}ms)` };
      }
      try {
        const ssh = await sshExec(host, check.checkCommand, { signal: ac.signal });
        if (ssh.code !== 0) {
          return { checkId: check.id, status: "error" as const, reason: ssh.stderr || `Exit code ${ssh.code}` };
        }
        return { checkId: check.id, status: "pass" as const, output: ssh.stdout };
      } catch (err) {
        if (ac.signal.aborted) {
          return { checkId: check.id, status: "timeout" as const, reason: `Aggregate timeout` };
        }
        return { checkId: check.id, status: "error" as const, reason: (err as Error).message };
      }
    });
    return results;
  } finally {
    clearTimeout(timer);
    if (masterOpened) {
      try { sshMasterClose(host); } catch { /* best effort */ }
    }
  }
}