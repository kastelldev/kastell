import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { platform } from "os";
import { join } from "path";
import { storeToken, readToken } from "./tokenBuffer.js";
import type { NotifyConfig } from "./notify.js";
import { isKeychainAvailable as _isKeychainAvailable, getKeychainEntry as _getKeychainEntry } from "../utils/keyring.js";
import { encryptData, decryptData, getMachineKey, isEncryptedPayload } from "../utils/encryption.js";
import { KASTELL_DIR } from "../utils/paths.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTIFY_SERVICE = "kastell-notify";
const NOTIFY_CHANNELS_FILE = join(KASTELL_DIR, "notify-channels.json");
const NOTIFY_SECRETS_FILE = join(KASTELL_DIR, "notify-secrets.json");
const NOTIFY_LEGACY_FILE = join(KASTELL_DIR, "notify.json");

// Channel field definitions
const CHANNEL_FIELDS: Record<string, string[]> = {
  telegram: ["botToken", "chatId"],
  discord: ["webhookUrl"],
  slack: ["webhookUrl"],
};

// ─── Keyring helpers ─────────────────────────────────────────────────────────

function getKeychainEntry(channel: string, field: string) {
  return _getKeychainEntry(NOTIFY_SERVICE, `${channel}:${field}`);
}

// ─── Fallback file helpers ────────────────────────────────────────────────────

function readSecretsFile(): Record<string, string> {
  try {
    const raw = readFileSync(NOTIFY_SECRETS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (isEncryptedPayload(parsed)) {
      return JSON.parse(decryptData(parsed, getMachineKey()));
    }
    // Plaintext legacy — will be migrated on next write
    return parsed as Record<string, string>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      process.stderr.write(
        "[warn] Notify secret decryption failed — re-enter secrets with 'kastell notify add'\n",
      );
    }
    return {};
  }
}

function writeSecretsFile(data: Record<string, string>): void {
  try {
    mkdirSync(KASTELL_DIR, { recursive: true });
    const payload = encryptData(JSON.stringify(data), getMachineKey());
    writeFileSync(NOTIFY_SECRETS_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
  } catch { /* ignore */ }
}

// ─── Channel metadata helpers ─────────────────────────────────────────────────

function readChannelMetadata(): Record<string, boolean> {
  try {
    return JSON.parse(readFileSync(NOTIFY_CHANNELS_FILE, "utf-8")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeChannelMetadata(metadata: Record<string, boolean>): void {
  mkdirSync(KASTELL_DIR, { recursive: true });
  writeFileSync(NOTIFY_CHANNELS_FILE, JSON.stringify(metadata, null, 2), { mode: 0o600 });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Store a notify secret in the OS keychain.
 * Falls back to tokenBuffer + file when keychain unavailable.
 */
export function storeNotifySecret(channel: string, field: string, value: string): boolean {
  const entry = getKeychainEntry(channel, field);
  if (entry) {
    try {
      entry.setPassword(value);
      return true;
    } catch {
      return false;
    }
  }

  // Fallback: tokenBuffer (in-memory) + file persistence
  if (platform() === "win32") {
    process.stderr.write(
      "[warn] OS keychain unavailable — notify secret stored encrypted at ~/.kastell/notify-secrets.json\n",
    );
  }
  storeToken(`${channel}:${field}`, value);
  const existing = readSecretsFile();
  existing[`${channel}:${field}`] = value;
  writeSecretsFile(existing);
  return true;
}

/**
 * Read a notify secret from the OS keychain.
 * Falls back to tokenBuffer → file when keychain unavailable.
 */
export function readNotifySecret(channel: string, field: string): string | undefined {
  const entry = getKeychainEntry(channel, field);
  if (entry) {
    try {
      return entry.getPassword() ?? undefined;
    } catch {
      return undefined;
    }
  }

  // Fallback: check tokenBuffer first
  const buffered = readToken(`${channel}:${field}`);
  if (buffered !== undefined) return buffered;

  // Then check file
  const secrets = readSecretsFile();
  return secrets[`${channel}:${field}`];
}

/**
 * Remove a notify secret from the OS keychain.
 * Falls back to tokenBuffer + file removal when keychain unavailable.
 */
export function removeNotifySecret(channel: string, field: string): boolean {
  const entry = getKeychainEntry(channel, field);
  if (entry) {
    try {
      entry.deletePassword();
      return true;
    } catch {
      return false;
    }
  }

  // Fallback: remove from file
  const secrets = readSecretsFile();
  if (!((`${channel}:${field}`) in secrets)) return false;
  delete secrets[`${channel}:${field}`];
  writeSecretsFile(secrets);
  return true;
}

/**
 * Save all secrets for a channel to keychain, then update channel metadata.
 * Metadata file only records which channels are active — no secrets.
 */
export function saveNotifyChannel(
  channel: string,
  config: NonNullable<NotifyConfig[keyof NotifyConfig]>,
): void {
  const fields = CHANNEL_FIELDS[channel];
  if (!fields) return;

  for (const field of fields) {
    const value = (config as Record<string, string>)[field];
    if (value !== undefined) {
      storeNotifySecret(channel, field, value);
    }
  }

  const metadata = readChannelMetadata();
  metadata[channel] = true;
  writeChannelMetadata(metadata);
}

/**
 * Load all configured channels by reading metadata + resolving secrets from keychain.
 * Automatically migrates legacy notify.json on first call.
 */
export function loadNotifyChannels(): NotifyConfig {
  // Migration: check for legacy notify.json with plain-text secrets
  let migrationMetadata: Record<string, boolean> | undefined;
  try {
    readFileSync(NOTIFY_CHANNELS_FILE, "utf-8");
  } catch {
    // Channels file missing — check for legacy file to migrate
    try {
      readFileSync(NOTIFY_LEGACY_FILE, "utf-8");
      migrationMetadata = migrateFromLegacyNotifyJson();
    } catch {
      // No legacy file either — fresh install
    }
  }

  const metadata = migrationMetadata ?? readChannelMetadata();
  const config: NotifyConfig = {};

  if (metadata.telegram) {
    const botToken = readNotifySecret("telegram", "botToken");
    const chatId = readNotifySecret("telegram", "chatId");
    if (botToken && chatId) {
      config.telegram = { botToken, chatId };
    }
  }

  if (metadata.discord) {
    const webhookUrl = readNotifySecret("discord", "webhookUrl");
    if (webhookUrl) {
      config.discord = { webhookUrl };
    }
  }

  if (metadata.slack) {
    const webhookUrl = readNotifySecret("slack", "webhookUrl");
    if (webhookUrl) {
      config.slack = { webhookUrl };
    }
  }

  return config;
}

/**
 * Remove all secrets for a channel from keychain, then update metadata.
 */
export function removeNotifyChannel(channel: string): void {
  const fields = CHANNEL_FIELDS[channel] ?? [];
  for (const field of fields) {
    removeNotifySecret(channel, field);
  }

  const metadata = readChannelMetadata();
  metadata[channel] = false;
  writeChannelMetadata(metadata);
}

/**
 * Check if the OS keychain is available for notify secrets.
 */
export function isNotifyKeychainAvailable(): boolean {
  return _isKeychainAvailable(NOTIFY_SERVICE);
}

/**
 * Load the allowedChatIds array from notify-channels.json metadata.
 * Returns [] if the file does not exist, the field is absent, or is not an array.
 */
export function loadAllowedChatIds(): string[] {
  try {
    const raw = JSON.parse(readFileSync(NOTIFY_CHANNELS_FILE, "utf-8")) as Record<string, unknown>;
    const ids = raw?.allowedChatIds;
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Persist allowedChatIds to notify-channels.json, preserving existing channel flags.
 */
export function saveAllowedChatIds(ids: string[]): void {
  mkdirSync(KASTELL_DIR, { recursive: true });
  const existing = readChannelMetadata() as Record<string, unknown>;
  existing.allowedChatIds = ids;
  writeFileSync(NOTIFY_CHANNELS_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
}

// ─── Migration ────────────────────────────────────────────────────────────────

function migrateFromLegacyNotifyJson(): Record<string, boolean> | undefined {
  try {
    const raw = JSON.parse(readFileSync(NOTIFY_LEGACY_FILE, "utf-8")) as Record<string, unknown>;
    const metadata: Record<string, boolean> = { telegram: false, discord: false, slack: false };

    if (raw.telegram && typeof raw.telegram === "object") {
      const tg = raw.telegram as { botToken?: string; chatId?: string };
      if (tg.botToken && tg.chatId) {
        storeNotifySecret("telegram", "botToken", tg.botToken);
        storeNotifySecret("telegram", "chatId", tg.chatId);
        metadata.telegram = true;
      }
    }

    if (raw.discord && typeof raw.discord === "object") {
      const dc = raw.discord as { webhookUrl?: string };
      if (dc.webhookUrl) {
        storeNotifySecret("discord", "webhookUrl", dc.webhookUrl);
        metadata.discord = true;
      }
    }

    if (raw.slack && typeof raw.slack === "object") {
      const sl = raw.slack as { webhookUrl?: string };
      if (sl.webhookUrl) {
        storeNotifySecret("slack", "webhookUrl", sl.webhookUrl);
        metadata.slack = true;
      }
    }

    // Write channel metadata (no secrets)
    writeChannelMetadata(metadata);

    // Strip secrets from legacy notify.json (write empty channel flags only)
    const stripped: Record<string, unknown> = {};
    if (raw.telegram) stripped.telegram = true;
    if (raw.discord) stripped.discord = true;
    if (raw.slack) stripped.slack = true;
    writeFileSync(NOTIFY_LEGACY_FILE, JSON.stringify(stripped, null, 2), { mode: 0o600 });

    return metadata;
  } catch {
    // Migration failed silently — don't break normal operation
    return undefined;
  }
}
