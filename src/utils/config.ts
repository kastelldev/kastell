import { readFileSync } from "fs";
import { join } from "path";
import type { ServerRecord } from "../types/index.js";
import { withFileLock } from "./fileLock.js";
import { KASTELL_DIR } from "./paths.js";
import { SUPPORTED_PROVIDERS } from "../constants.js";
import { secureMkdirSync } from "./secureWrite.js";
import { atomicWriteFileSync } from "./atomicWrite.js";
import { memoizeOnStat, type MemoizedEntry } from "./fsMtime.js";

const SERVERS_FILE = join(KASTELL_DIR, "servers.json");

export function getServersRaw(): ServerRecord[] {
  // Same as getServers but without mode default — for migration use only
  const raw = readFileSync(SERVERS_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("servers.json corrupt");
  }
  return parsed as ServerRecord[];
}


function ensureConfigDir(): void {
  secureMkdirSync(KASTELL_DIR, { recursive: true });
}

/** Atomic write: write to tmp file, then rename to prevent corruption on crash */
export function atomicWriteServers(servers: ServerRecord[]): void {
  atomicWriteFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2));
}

const serversCache: Map<string, MemoizedEntry<ServerRecord[]>> = new Map();

export function clearServersCache(): void {
  serversCache.clear();
}

export function getServers(): ServerRecord[] {
  return memoizeOnStat(serversCache, SERVERS_FILE, SERVERS_FILE, () => {
    let data: string;
    try {
      data = readFileSync(SERVERS_FILE, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error("servers.json corrupt (invalid JSON) — check ~/.kastell/servers.json manually");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("servers.json corrupt — check ~/.kastell/servers.json manually");
    }
    const validProviders = new Set(SUPPORTED_PROVIDERS as readonly string[]);
    const validRecords = parsed.filter((s: Record<string, unknown>) => {
      if (s.provider && !validProviders.has(s.provider as string)) {
        process.stderr.write(`Warning: skipping server "${s.name}" — unknown provider "${s.provider}"\n`);
        return false;
      }
      return true;
    });
    return validRecords.map((s: ServerRecord) => ({ ...s, mode: s.mode ?? "coolify" }) as ServerRecord);
  });
}

function isSentinelIp(ip: string): boolean {
  return ip === "" || ip === "pending" || ip === "0.0.0.0";
}

export async function saveServer(record: ServerRecord): Promise<void> {
  await withFileLock(SERVERS_FILE, () => {
    ensureConfigDir();
    const servers = getServers();
    const duplicate = servers.find(
      (server) =>
        server.name === record.name ||
        (!isSentinelIp(record.ip) &&
          !isSentinelIp(server.ip) &&
          server.ip === record.ip),
    );
    if (duplicate) {
      throw new Error(
        `Server already exists: ${duplicate.name === record.name ? `name "${record.name}"` : `IP ${record.ip}`}`,
      );
    }
    servers.push(record);
    atomicWriteServers(servers);
  });
}

export type SaveServerResult =
  | { kind: "created-persisted"; server: ServerRecord; replacedStaleServer?: Readonly<ServerRecord> };

/**
 * Snapshot of a conflict's immutable fields, captured by the caller before
 * the locked CAS re-read. Required so the CAS can detect a concurrent
 * mutation of the conflict (e.g. rename, re-assign to another provider)
 * between the snapshot and the lock acquisition. 5 fields per the P143
 * design: id, name, provider, ip, mode.
 */
export type ConflictSnapshot = {
  id: string;
  name: string;
  provider: string;
  ip: string;
  mode: ServerRecord["mode"];
};

/**
 * Compare-and-swap duplicate-IP recovery.
 *
 * Only callable when a previous `saveServer` (or its own looped re-entry)
 * detected a duplicate concrete IP. The caller MUST have already verified
 * with the provider API that the conflicting local record is gone
 * (`lookupServerResource` returned `not-found`) and MUST pass the
 * conflict's immutable fields as `conflictSnapshot` so this helper can
 * refuse to clobber a record that has been concurrently mutated on disk.
 *
 * Inside the file lock we re-read servers, find the conflict by IP, and
 * compare the immutable fields of the on-disk conflict against
 * `conflictSnapshot` (id, name, provider, ip, mode/defaulted mode).
 * If anything mismatches we reject — the local registry has changed since
 * the snapshot was captured and a CAS would be unsafe.
 *
 * Concurrency: this helper is itself locked, so two simultaneous callers
 * will serialize. The second caller will re-read the file and either see
 * the new record (replacement already applied) or the conflict gone
 * (different path) — both fall into the rejection branch and the
 * `servers.json` file ends with exactly one record holding the IP.
 */
export async function saveServerAfterDuplicateIpVerification(
  record: ServerRecord,
  conflictSnapshot?: ConflictSnapshot,
): Promise<SaveServerResult> {
  if (!conflictSnapshot) {
    throw new Error(
      "saveServerAfterDuplicateIpVerification: conflictSnapshot is required (lookup not performed)",
    );
  }
  return await withFileLock(SERVERS_FILE, () => {
    ensureConfigDir();
    const servers = getServers();
    const conflict = servers.find(
      (server) =>
        !isSentinelIp(record.ip) &&
        !isSentinelIp(server.ip) &&
        server.ip === record.ip,
    );
    if (!conflict) {
      // No conflict on disk — record was added by a different path. Reject
      // to keep CAS semantics strict; caller may retry the normal saveServer.
      throw new Error(
        `saveServerAfterDuplicateIpVerification: no duplicate IP ${record.ip} on disk (concurrent change)`,
      );
    }
    const conflictMode = (conflict.mode ?? "coolify") as ServerRecord["mode"];
    if (
      conflict.id !== conflictSnapshot.id ||
      conflict.name !== conflictSnapshot.name ||
      conflict.provider !== conflictSnapshot.provider ||
      conflict.ip !== conflictSnapshot.ip ||
      conflictMode !== conflictSnapshot.mode
    ) {
      throw new Error(
        `saveServerAfterDuplicateIpVerification: conflict snapshot mismatch for IP ${record.ip} (concurrent registry change)`,
      );
    }
    const replaced: ServerRecord = { ...conflict };
    const next = servers.map((server) =>
      server.ip === record.ip ? record : server,
    );
    atomicWriteServers(next);
    return { kind: "created-persisted", server: record, replacedStaleServer: replaced };
  });
}

export async function updateServer(name: string, updates: Partial<ServerRecord>): Promise<boolean> {
  return await withFileLock(SERVERS_FILE, () => {
    const servers = getServers();
    const index = servers.findIndex((s) => s.name === name);
    if (index === -1) return false;
    servers[index] = { ...servers[index], ...updates };
    ensureConfigDir();
    atomicWriteServers(servers);
    return true;
  });
}

export async function removeServer(id: string): Promise<boolean> {
  return await withFileLock(SERVERS_FILE, () => {
    const servers = getServers();
    const filtered = servers.filter((s) => s.id !== id);
    if (filtered.length === servers.length) {
      return false;
    }
    ensureConfigDir();
    atomicWriteServers(filtered);
    return true;
  });
}

export function findServer(query: string): ServerRecord | undefined {
  const servers = getServers();
  // Search by IP first (unique), then by name
  return servers.find((s) => s.ip === query) || servers.find((s) => s.name === query);
}

export function findServers(query: string): ServerRecord[] {
  const servers = getServers();
  const byIp = servers.filter((s) => s.ip === query);
  if (byIp.length > 0) return byIp;
  return servers.filter((s) => s.name === query);
}

export { BACKUPS_DIR } from "./paths.js";
export { SERVERS_FILE };
