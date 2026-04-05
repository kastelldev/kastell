import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import type { ServerRecord } from "../types/index.js";
import { withFileLock } from "./fileLock.js";
import { KASTELL_DIR } from "./paths.js";
import { SUPPORTED_PROVIDERS } from "../constants.js";

const SERVERS_FILE = join(KASTELL_DIR, "servers.json");


function ensureConfigDir(): void {
  mkdirSync(KASTELL_DIR, { recursive: true, mode: 0o700 });
}

/** Atomic write: write to tmp file, then rename to prevent corruption on crash */
function atomicWriteServers(servers: ServerRecord[]): void {
  const tmpFile = SERVERS_FILE + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(servers, null, 2), { mode: 0o600 });
  renameSync(tmpFile, SERVERS_FILE);
}

export function getServers(): ServerRecord[] {
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
  const needsMigration = validRecords.some((s: Record<string, unknown>) => !s.mode);
  const servers = validRecords.map((s: ServerRecord) => ({ ...s, mode: s.mode || "coolify" }) as ServerRecord);
  if (needsMigration) {
    atomicWriteServers(servers);
  }
  return servers;
}

export async function saveServer(record: ServerRecord): Promise<void> {
  await withFileLock(SERVERS_FILE, () => {
    ensureConfigDir();
    const servers = getServers();
    const duplicate = servers.find((s) => s.name === record.name || s.ip === record.ip);
    if (duplicate) {
      throw new Error(
        `Server already exists: ${duplicate.name === record.name ? `name "${record.name}"` : `IP ${record.ip}`}`,
      );
    }
    servers.push(record);
    atomicWriteServers(servers);
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
