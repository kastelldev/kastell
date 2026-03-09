import axios from "axios";
import type {
  Region,
  ServerSize,
  ServerConfig,
  ServerResult,
  SnapshotInfo,
  ServerMode,
} from "../types/index.js";

/** Default timeout for provider API calls (15 seconds) */
export const API_TIMEOUT_MS = 15_000;

/** Pre-configured axios instance with timeout for all provider API calls */
export const apiClient = axios.create({
  timeout: API_TIMEOUT_MS,
});

export interface CloudProvider {
  name: string;
  displayName: string;
  validateToken(token: string): Promise<boolean>;
  getRegions(): Region[];
  getServerSizes(): ServerSize[];
  getAvailableLocations(): Promise<Region[]>;
  getAvailableServerTypes(location: string, mode?: ServerMode): Promise<ServerSize[]>;
  uploadSshKey(name: string, publicKey: string): Promise<string>;
  createServer(config: ServerConfig): Promise<ServerResult>;
  getServerStatus(serverId: string): Promise<string>;
  getServerDetails(serverId: string): Promise<ServerResult>;
  destroyServer(serverId: string): Promise<void>;
  rebootServer(serverId: string): Promise<void>;
  createSnapshot(serverId: string, name: string): Promise<SnapshotInfo>;
  listSnapshots(serverId: string): Promise<SnapshotInfo[]>;
  deleteSnapshot(snapshotId: string): Promise<void>;
  getSnapshotCostEstimate(serverId: string): Promise<string>;
}

/**
 * Sanitize axios response data — whitelist-only approach.
 * Preserves known error message fields, strips everything else
 * to prevent API tokens or sensitive data from leaking via error cause chains.
 */
export function sanitizeResponseData(data: unknown): unknown {
  if (data === null || data === undefined) return undefined;
  if (typeof data === "string") return data;
  if (typeof data !== "object") return undefined;

  const d = data as Record<string, unknown>;
  const clean: Record<string, unknown> = {};

  // Hetzner: { error: { message, code } }
  if (d.error && typeof d.error === "object") {
    const err = d.error as Record<string, unknown>;
    const errClean: Record<string, unknown> = {};
    if (typeof err.message === "string") errClean.message = err.message;
    if (typeof err.code === "string") errClean.code = err.code;
    if (Object.keys(errClean).length > 0) clean.error = errClean;
  }
  // Vultr: { error: "string" }
  else if (typeof d.error === "string") {
    clean.error = d.error;
  }

  // DigitalOcean: { message: "..." }
  if (typeof d.message === "string") clean.message = d.message;

  // Linode: { errors: [{ reason: "..." }] }
  if (Array.isArray(d.errors)) {
    clean.errors = d.errors
      .filter(
        (e): e is Record<string, unknown> =>
          e !== null && typeof e === "object",
      )
      .map((e) => ({
        ...(typeof e.reason === "string" && { reason: e.reason }),
      }));
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Higher-order function for standard provider error handling.
 * Wraps an async operation with stripSensitiveData + consistent error formatting.
 * Use for methods with the standard try/catch pattern. Methods with custom error
 * handling (e.g., uploadSshKey with 409, typed API error responses) should NOT use this.
 */
export async function withProviderErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    stripSensitiveData(error);
    throw new Error(
      `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Assert serverId is safe for API URLs (alphanumeric, hyphens, slashes for Linode image IDs) */
export function assertValidServerId(serverId: string): void {
  if (!/^[a-zA-Z0-9-]+(\/[a-zA-Z0-9.-]+)?$/.test(serverId)) {
    throw new Error(`Invalid server ID format: ${serverId}`);
  }
}

export function stripSensitiveData(error: unknown): void {
  if (axios.isAxiosError(error)) {
    if (error.config) {
      error.config.headers = undefined as unknown as typeof error.config.headers;
      error.config.data = undefined;
    }
    (error as unknown as Record<string, unknown>).request = undefined;

    if (error.response) {
      error.response.data = sanitizeResponseData(error.response.data);
      error.response.headers = {} as typeof error.response.headers;
    }
  }
}
