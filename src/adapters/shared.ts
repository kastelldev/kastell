import axios from "axios";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import type { HealthResult, PlatformStatusResult, UpdateResult } from "./interface.js";

/**
 * Shared health check for platform adapters.
 * Tries HTTPS via domain first (if provided), then falls back to HTTP on the given port.
 */
export async function sharedHealthCheck(
  ip: string,
  port: number,
  domain?: string,
): Promise<HealthResult> {
  assertValidIp(ip);
  if (domain) {
    try {
      await axios.get(`https://${domain}`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      return { status: "running" };
    } catch {
      // HTTPS failed, fall back to HTTP
    }
  }
  try {
    await axios.get(`http://${ip}:${port}`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    return { status: "running" };
  } catch {
    return { status: "not reachable" };
  }
}

/**
 * Shared update for platform adapters.
 * Executes the update command via SSH and maps errors.
 */
export async function sharedUpdate(
  ip: string,
  updateCmd: string,
): Promise<UpdateResult> {
  assertValidIp(ip);
  try {
    const result = await sshExec(ip, updateCmd);
    if (result.code === 0) {
      return { success: true, output: result.stdout || undefined };
    }
    return {
      success: false,
      error: `Update failed (exit code ${result.code})`,
      output: result.stderr || result.stdout || undefined,
    };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

/**
 * Shared getStatus for platform adapters.
 * Gets version via SSH, runs health check, and combines results.
 */
export async function sharedGetStatus(
  ip: string,
  versionCmd: string,
  port: number,
  domain?: string,
): Promise<PlatformStatusResult> {
  assertValidIp(ip);
  const versionResult = await sshExec(ip, versionCmd);
  const platformVersion = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";
  const health = await sharedHealthCheck(ip, port, domain);
  return {
    platformVersion,
    status: health.status,
  };
}
