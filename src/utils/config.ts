import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ServerRecord } from "../types/index.js";

const CONFIG_DIR = join(homedir(), ".kastell");
const SERVERS_FILE = join(CONFIG_DIR, "servers.json");
const BACKUPS_DIR = join(CONFIG_DIR, "backups");

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function getServers(): ServerRecord[] {
  try {
    if (!existsSync(SERVERS_FILE)) {
      return [];
    }
    const data = readFileSync(SERVERS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((s: ServerRecord) => ({ ...s, mode: s.mode || "coolify" }));
  } catch {
    return [];
  }
}

export function saveServer(record: ServerRecord): void {
  ensureConfigDir();
  const servers = getServers();
  servers.push(record);
  writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2), { mode: 0o600 });
}

export function updateServer(name: string, updates: Partial<ServerRecord>): boolean {
  const servers = getServers();
  const index = servers.findIndex((s) => s.name === name);
  if (index === -1) return false;
  servers[index] = { ...servers[index], ...updates };
  ensureConfigDir();
  writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2), { mode: 0o600 });
  return true;
}

export function removeServer(id: string): boolean {
  const servers = getServers();
  const filtered = servers.filter((s) => s.id !== id);
  if (filtered.length === servers.length) {
    return false;
  }
  ensureConfigDir();
  writeFileSync(SERVERS_FILE, JSON.stringify(filtered, null, 2), { mode: 0o600 });
  return true;
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
