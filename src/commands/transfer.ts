import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getServers, saveServer } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { getErrorMessage, mapFileSystemError } from "../utils/errorMapper.js";
import { assertValidIp } from "../utils/ssh.js";
import type { ServerRecord } from "../types/index.js";

const REQUIRED_FIELDS: (keyof ServerRecord)[] = [
  "id",
  "name",
  "provider",
  "ip",
  "region",
  "size",
  "createdAt",
];

export function validateServerRecords(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(data)) {
    return { valid: false, errors: ["Data must be a JSON array"] };
  }

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (typeof item !== "object" || item === null) {
      errors.push(`Item [${i}]: must be an object`);
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (typeof (item as Record<string, unknown>)[field] !== "string") {
        errors.push(`Item [${i}]: missing or invalid field "${field}"`);
      }
    }
    // Validate IP format to prevent injection via malicious import files
    const ip = (item as Record<string, unknown>).ip;
    if (typeof ip === "string") {
      try {
        assertValidIp(ip);
      } catch {
        errors.push(`Item [${i}]: invalid IP address format`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function exportCommand(filePath?: string): Promise<void> {
  const servers = getServers();

  if (servers.length === 0) {
    logger.info("No servers to export. Deploy one with: kastell init");
    return;
  }

  const outPath = resolve(filePath || "kastell-export.json");

  try {
    writeFileSync(outPath, JSON.stringify(servers, null, 2), { encoding: "utf-8", mode: 0o600 });
    logger.success(`Exported ${servers.length} server(s) to ${outPath}`);
    logger.warning("This file contains server information. Store it securely.");
  } catch (error: unknown) {
    logger.error(`Failed to write export file: ${getErrorMessage(error)}`);
    const hint = mapFileSystemError(error);
    if (hint) logger.info(hint);
  }
}

export async function importCommand(filePath: string): Promise<void> {
  if (!filePath) {
    logger.error("Usage: kastell import <path>");
    return;
  }

  const inPath = resolve(filePath);
  let raw: string;

  try {
    raw = readFileSync(inPath, "utf-8");
  } catch (error: unknown) {
    logger.error(`Failed to read file: ${getErrorMessage(error)}`);
    const hint = mapFileSystemError(error);
    if (hint) logger.info(hint);
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    logger.error("File is not valid JSON");
    return;
  }

  const validation = validateServerRecords(data);
  if (!validation.valid) {
    logger.error("Invalid server data:");
    for (const err of validation.errors) {
      logger.step(err);
    }
    return;
  }

  const incoming = data as ServerRecord[];
  const existing = getServers();
  const existingIds = new Set(existing.map((s) => s.id));

  let imported = 0;
  let skipped = 0;

  for (const server of incoming) {
    if (existingIds.has(server.id)) {
      skipped++;
      continue;
    }
    const sanitized: ServerRecord = {
      id: server.id,
      name: server.name,
      provider: server.provider,
      ip: server.ip,
      region: server.region,
      size: server.size,
      createdAt: server.createdAt,
      mode: server.mode || "coolify",
      ...(server.platform ? { platform: server.platform } : {}),
      ...(server.domain ? { domain: server.domain } : {}),
    };
    await saveServer(sanitized);
    existingIds.add(server.id);
    imported++;
  }

  logger.success(`Imported ${imported} server(s), skipped ${skipped} duplicate(s)`);
}
