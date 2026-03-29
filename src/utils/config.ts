import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ServerRecord } from "../types/index.js";
import { withFileLock } from "./fileLock.js";

const CONFIG_DIR = join(homedir(), ".kastell");
const SERVERS_FILE = join(CONFIG_DIR, "servers.json");
const BACKUPS_DIR = join(CONFIG_DIR, "backups");

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/** Atomic write: write to tmp file, then rename to prevent corruption on crash */
function atomicWriteServers(servers: ServerRecord[]): void {
  const tmpFile = SERVERS_FILE + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(servers, null, 2), { mode: 0o600 });
  renameSync(tmpFile, SERVERS_FILE);
}

export function getServers(): ServerRecord[] {
  if (!existsSync(SERVERS_FILE)) {
    return [];
  }
  const data = readFileSync(SERVERS_FILE, "utf-8");
  const parsed = JSON.parse(data);
  if (!Array.isArray(parsed)) {
    throw new Error("servers.json corrupt — check ~/.kastell/servers.json manually");
  }
  const needsMigration = parsed.some((s: Record<string, unknown>) => !s.mode);
  const servers = parsed.map((s: ServerRecord) => ({ ...s, mode: s.mode || "coolify" }) as ServerRecord);
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

// Exported for testing
export { CONFIG_DIR, SERVERS_FILE, BACKUPS_DIR };
