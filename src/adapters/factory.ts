import type { PlatformAdapter } from "./interface.js";
import type { ServerRecord } from "../types/index.js";
import type { Platform } from "../types/index.js";
import { CoolifyAdapter } from "./coolify.js";
import { DokployAdapter } from "./dokploy.js";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";

export type { Platform };

export async function detectPlatform(ip: string): Promise<Platform | "bare"> {
  assertValidIp(ip);
  try {
    // Check Dokploy first (newer platform, less likely false positive)
    const dokployCheck = await sshExec(ip, raw("test -d /etc/dokploy && echo dokploy || echo no"));
    if (dokployCheck.code === 0 && dokployCheck.stdout.trim() === "dokploy") {
      return "dokploy";
    }
    // Check Coolify
    const coolifyCheck = await sshExec(ip, raw("test -d /data/coolify/source && echo coolify || echo no"));
    if (coolifyCheck.code === 0 && coolifyCheck.stdout.trim() === "coolify") {
      return "coolify";
    }
    return "bare";
  } catch {
    return "bare";
  }
}

const adapterCache: Partial<Record<Platform, PlatformAdapter>> = {};

export function getAdapter(platform: Platform): PlatformAdapter {
  const cached = adapterCache[platform];
  if (cached) return cached;

  let adapter: PlatformAdapter;
  switch (platform) {
    case "coolify":
      adapter = new CoolifyAdapter();
      break;
    case "dokploy":
      adapter = new DokployAdapter();
      break;
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
  adapterCache[platform] = adapter;
  return adapter;
}

export function resolvePlatform(server: ServerRecord): Platform | undefined {
  if (server.platform) return server.platform;
  if (server.mode === "bare") return undefined;
  return "coolify";
}
