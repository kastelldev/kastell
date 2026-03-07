import { createProviderWithToken } from "../utils/providerFactory.js";
import { getCloudServerStatus } from "./status.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import type { ServerRecord } from "../types/index.js";
import type { PlatformAdapter } from "../adapters/interface.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StepResult {
  step: number;
  name: string;
  status: "success" | "failure" | "skipped";
  detail?: string;
  error?: string;
  hint?: string;
}

export interface MaintainResult {
  server: string;
  ip: string;
  provider: string;
  steps: StepResult[];
  success: boolean;
}

export type { UpdateResult } from "../adapters/interface.js";

export interface RestartResult {
  success: boolean;
  finalStatus?: string;
  error?: string;
  hint?: string;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

export async function pollHealth(
  adapter: PlatformAdapter,
  ip: string,
  maxAttempts: number,
  intervalMs: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await adapter.healthCheck(ip);
    if (result.status === "running") return true;
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

export async function rebootAndWait(
  server: ServerRecord,
  apiToken: string,
  maxAttempts: number = 30,
  intervalMs: number = 2000,
  initialWaitMs: number = 10000,
): Promise<RestartResult> {
  if (server.id.startsWith("manual-")) {
    return {
      success: false,
      error: `Cannot reboot manually added server via API. Use SSH: ssh root@${server.ip} reboot`,
    };
  }

  try {
    const provider = createProviderWithToken(server.provider, apiToken);
    await provider.rebootServer(server.id);

    // Wait for reboot to initiate
    await new Promise((resolve) => setTimeout(resolve, initialWaitMs));

    // Poll until running
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const status = await provider.getServerStatus(server.id);
        if (status === "running") {
          return { success: true, finalStatus: "running" };
        }
      } catch {
        // Server may be temporarily unreachable during reboot
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return {
      success: false,
      finalStatus: "timeout",
      error: "Server did not come back online in time",
      hint: "The server may still be rebooting. Check status later.",
    };
  } catch (error: unknown) {
    const hint = mapProviderError(error, server.provider);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export interface MaintainOptions {
  skipReboot?: boolean;
  healthPollAttempts?: number;
  healthPollIntervalMs?: number;
  rebootMaxAttempts?: number;
  rebootIntervalMs?: number;
  rebootInitialWaitMs?: number;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function maintainServer(
  server: ServerRecord,
  apiToken: string,
  options: MaintainOptions = {},
): Promise<MaintainResult> {
  const platform = resolvePlatform(server);
  const adapter = platform ? getAdapter(platform) : null;
  const adapterName = adapter ? capitalize(adapter.name) : "Platform";

  const isManual = server.id.startsWith("manual-");
  const healthAttempts = options.healthPollAttempts ?? 12;
  const healthInterval = options.healthPollIntervalMs ?? 5000;
  const rebootAttempts = options.rebootMaxAttempts ?? 30;
  const rebootInterval = options.rebootIntervalMs ?? 2000;
  const rebootInitialWait = options.rebootInitialWaitMs ?? 10000;
  const steps: StepResult[] = [];

  const result: MaintainResult = {
    server: server.name,
    ip: server.ip,
    provider: server.provider,
    steps,
    success: false,
  };

  // Step 1: Status check
  if (isManual) {
    steps.push({ step: 1, name: "Status Check", status: "skipped", detail: "Manual server — assuming running" });
  } else {
    try {
      const serverStatus = await getCloudServerStatus(server, apiToken);
      if (serverStatus !== "running") {
        steps.push({ step: 1, name: "Status Check", status: "failure", detail: `Server is ${serverStatus}` });
        steps.push({ step: 2, name: `${adapterName} Update`, status: "skipped" });
        steps.push({ step: 3, name: "Health Check", status: "skipped" });
        steps.push({ step: 4, name: "Reboot", status: "skipped" });
        steps.push({ step: 5, name: "Final Check", status: "skipped" });
        return result;
      }
      steps.push({ step: 1, name: "Status Check", status: "success", detail: "Server is running" });
    } catch (error: unknown) {
      const hint = mapProviderError(error, server.provider);
      steps.push({
        step: 1, name: "Status Check", status: "failure",
        error: getErrorMessage(error), ...(hint ? { hint } : {}),
      });
      steps.push({ step: 2, name: `${adapterName} Update`, status: "skipped" });
      steps.push({ step: 3, name: "Health Check", status: "skipped" });
      steps.push({ step: 4, name: "Reboot", status: "skipped" });
      steps.push({ step: 5, name: "Final Check", status: "skipped" });
      return result;
    }
  }

  // Step 2: Platform update via adapter
  if (!adapter) {
    steps.push({ step: 2, name: "Platform Update", status: "failure", error: "No platform adapter available" });
    steps.push({ step: 3, name: "Health Check", status: "skipped" });
    steps.push({ step: 4, name: "Reboot", status: "skipped" });
    steps.push({ step: 5, name: "Final Check", status: "skipped" });
    return result;
  }

  const updateResult = await adapter.update(server.ip);
  if (!updateResult.success) {
    steps.push({
      step: 2, name: `${adapterName} Update`, status: "failure",
      error: updateResult.error, ...(updateResult.hint ? { hint: updateResult.hint } : {}),
    });
    steps.push({ step: 3, name: "Health Check", status: "skipped" });
    steps.push({ step: 4, name: "Reboot", status: "skipped" });
    steps.push({ step: 5, name: "Final Check", status: "skipped" });
    return result;
  }
  steps.push({ step: 2, name: `${adapterName} Update`, status: "success" });

  // Step 3: Health check after update
  const healthOk = await pollHealth(adapter, server.ip, healthAttempts, healthInterval);
  if (!healthOk) {
    steps.push({ step: 3, name: "Health Check", status: "failure", detail: `${adapterName} did not respond after update` });
    // Continue — partial success
  } else {
    steps.push({ step: 3, name: "Health Check", status: "success", detail: `${adapterName} is healthy` });
  }

  // Steps 4 & 5: Reboot + Final check (skip both if skipReboot or manual)
  if (options.skipReboot || isManual) {
    const reason = isManual ? "Manual server — no API reboot" : "Skipped by user";
    steps.push({ step: 4, name: "Reboot", status: "skipped", detail: reason });
    steps.push({ step: 5, name: "Final Check", status: "skipped", detail: reason });
    result.success = steps.every((s) => s.status !== "failure");
    return result;
  }

  // Step 4: Reboot
  const rebootResult = await rebootAndWait(server, apiToken, rebootAttempts, rebootInterval, rebootInitialWait);
  if (!rebootResult.success) {
    steps.push({
      step: 4, name: "Reboot", status: "failure",
      error: rebootResult.error, ...(rebootResult.hint ? { hint: rebootResult.hint } : {}),
    });
    steps.push({ step: 5, name: "Final Check", status: "skipped" });
    result.success = false;
    return result;
  }
  steps.push({ step: 4, name: "Reboot", status: "success", detail: "Server rebooted" });

  // Step 5: Final health check after reboot
  const finalHealthOk = await pollHealth(adapter, server.ip, healthAttempts, healthInterval);
  if (finalHealthOk) {
    steps.push({ step: 5, name: "Final Check", status: "success", detail: `Server and ${adapterName} are running` });
  } else {
    steps.push({ step: 5, name: "Final Check", status: "failure", detail: `Server running but ${adapterName} did not respond` });
  }

  result.success = steps.every((s) => s.status !== "failure");
  return result;
}
