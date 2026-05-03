import axios from "axios";
import { ZodError } from "zod";
import type {
  Region,
  ServerSize,
  ServerConfig,
  ServerResult,
  SnapshotInfo,
  ServerMode,
} from "../types/index.js";
import { TransientError, BusinessError, PermissionError, ValidationError } from "../utils/errors.js";
import { extractReason } from "../utils/errors.js";

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
  restoreSnapshot(serverId: string, snapshotId: string): Promise<void>;
  getSnapshotCostEstimate(serverId: string): Promise<string>;
  findServerByIp(ip: string): Promise<string | null>;
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
 * handling (e.g., uploadSshKey with 409) should NOT use this.
 *
 * @param extractApiMessage - Optional function to extract provider-specific error
 *   messages from axios response data (e.g., Hetzner's `data.error.message`,
 *   Linode's `data.errors[].reason`). When provided and the error is an AxiosError,
 *   the extracted message takes priority over `error.message`.
 */
export async function withProviderErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>,
  extractApiMessage?: (data: unknown) => string | undefined,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    stripSensitiveData(error);
    const errRecord = error as Record<string, unknown> | null | undefined;
    let message =
      error instanceof Error
        ? error.message
        : typeof errRecord?.message === "string"
          ? errRecord.message
          : String(error);
    if (extractApiMessage && axios.isAxiosError(error) && error.response?.data) {
      message = extractApiMessage(error.response.data) || message;
    }
    if (error instanceof ZodError) {
      throw new ValidationError(
        `Failed to ${operation}: unexpected API response shape — ${error.issues.map((i) => i.message).join(", ")}`,
        { cause: error },
      );
    }
    const fullMessage = `Failed to ${operation}: ${message}`;
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0;
      if (status === 401 || status === 403) {
        throw new PermissionError(fullMessage, { cause: error });
      }
      if (status === 404 || status === 409) {
        throw new BusinessError(fullMessage, { cause: error });
      }
      // status >= 500, network error (status === 0), or other non-auth/non-client errors
      throw new TransientError(fullMessage, { cause: error });
    }
    // Non-axios errors — safe default: retry-eligible
    throw new TransientError(fullMessage, { cause: error });
  }
}

/** Assert serverId is safe for API URLs (alphanumeric, hyphens, slashes for Linode image IDs) */
export function assertValidServerId(serverId: string): void {
  if (!/^[a-zA-Z0-9-]+(\/[a-zA-Z0-9.-]+)?$/.test(serverId)) {
    throw new ValidationError(`Invalid server ID format: ${serverId}`, { hint: "Server ID must be alphanumeric with optional hyphens" });
  }
}

/**
 * Shared SSH key upload with conflict recovery.
 * All providers follow the same pattern: POST to create, catch conflict status,
 * GET list to find existing key by matching public key.
 */
export interface SshKeyUploadConfig {
  apiToken: string;
  baseUrl: string;
  /** POST endpoint path (e.g., "/ssh_keys", "/account/keys") */
  createPath: string;
  /** POST body key name for the public key (e.g., "public_key", "ssh_key") */
  bodyKeyField: string;
  /** POST body key for the name field (default: "name", Linode uses "label") */
  nameField?: string;
  /** GET endpoint path for listing keys */
  listPath: string;
  /** Response array field (e.g., "ssh_keys", "data") */
  listArrayField: string;
  /** Key field in list response items (e.g., "public_key", "ssh_key") */
  listKeyField: string;
  /** HTTP status codes that indicate key conflict (e.g., [409], [422], [400]) */
  conflictStatuses: number[];
  /** Whether to call .toString() on the returned ID */
  idToString?: boolean;
}

export async function uploadSshKeyWithConflict(
  name: string,
  publicKey: string,
  config: SshKeyUploadConfig,
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${config.apiToken}`,
    "Content-Type": "application/json",
  };
  try {
    const body: Record<string, unknown> = {
      [config.nameField ?? "name"]: name,
      [config.bodyKeyField]: publicKey,
    };
    const response = await apiClient.post(
      `${config.baseUrl}${config.createPath}`,
      body,
      { headers },
    );
    const key = response.data.ssh_key ?? response.data;
    const id = key.id;
    return config.idToString !== false ? id.toString() : id;
  } catch (error: unknown) {
    stripSensitiveData(error);
    if (axios.isAxiosError(error) && config.conflictStatuses.includes(error.response?.status ?? 0)) {
      const listResponse = await apiClient.get(
        `${config.baseUrl}${config.listPath}`,
        { headers },
      );
      const items = listResponse.data[config.listArrayField] ?? listResponse.data;
      const existing = (items as Record<string, unknown>[]).find(
        (k) => (k[config.listKeyField] as string).trim() === publicKey.trim(),
      );
      if (existing) {
        const id = existing.id;
        return config.idToString !== false ? String(id) : (id as string);
      }
    }
    throw new TransientError(
      `Failed to upload SSH key: ${extractReason(error)}`,
      { cause: error },
    );
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
