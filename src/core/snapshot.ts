import { createProviderWithToken } from "../utils/providerFactory.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import type { ServerRecord, SnapshotInfo } from "../types/index.js";

// ─── Result Types ────────────────────────────────────────────────────────────

export interface SnapshotCreateResult {
  success: boolean;
  snapshot?: SnapshotInfo;
  costEstimate?: string;
  error?: string;
  hint?: string;
}

export interface SnapshotListResult {
  snapshots: SnapshotInfo[];
  error?: string;
  hint?: string;
}

export interface SnapshotDeleteResult {
  success: boolean;
  error?: string;
  hint?: string;
}

// ─── Async Wrappers ──────────────────────────────────────────────────────────

export async function createSnapshot(
  server: ServerRecord,
  apiToken: string,
): Promise<SnapshotCreateResult> {
  try {
    const provider = createProviderWithToken(server.provider, apiToken);

    // Best-effort cost estimate
    let costEstimate: string | undefined;
    try {
      costEstimate = await provider.getSnapshotCostEstimate(server.id);
    } catch {
      costEstimate = "unknown";
    }

    const snapshotName = `kastell-${Date.now()}`;
    const snapshot = await provider.createSnapshot(server.id, snapshotName);

    return { success: true, snapshot, costEstimate };
  } catch (error: unknown) {
    const hint = mapProviderError(error, server.provider);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export async function listSnapshots(
  server: ServerRecord,
  apiToken: string,
): Promise<SnapshotListResult> {
  try {
    const provider = createProviderWithToken(server.provider, apiToken);
    const snapshots = await provider.listSnapshots(server.id);
    return { snapshots };
  } catch (error: unknown) {
    const hint = mapProviderError(error, server.provider);
    return {
      snapshots: [],
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export async function deleteSnapshot(
  server: ServerRecord,
  apiToken: string,
  snapshotId: string,
): Promise<SnapshotDeleteResult> {
  try {
    const provider = createProviderWithToken(server.provider, apiToken);
    await provider.deleteSnapshot(snapshotId);
    return { success: true };
  } catch (error: unknown) {
    const hint = mapProviderError(error, server.provider);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}
