import { randomBytes, createCipheriv, createDecipheriv, scryptSync, randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { platform } from "os";
import { join } from "path";
import { KASTELL_DIR } from "./paths.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EncryptedPayload {
  encrypted: true;
  version: 1;
  iv: string;   // hex, 12 bytes
  data: string;  // hex, ciphertext
  tag: string;   // hex, 16 bytes auth tag
}

// ─── Encrypt / Decrypt ───────────────────────────────────────────────────────

export function encryptData(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: true,
    version: 1,
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: tag.toString("hex"),
  };
}

export function decryptData(payload: EncryptedPayload, key: Buffer): string {
  try {
    const iv = Buffer.from(payload.iv, "hex");
    const data = Buffer.from(payload.data, "hex");
    const tag = Buffer.from(payload.tag, "hex");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error(
      "Token storage decryption failed — machine key changed. Re-enter tokens with `kastell provider add` or `kastell notify add`.",
    );
  }
}

// ─── Type Guard ──────────────────────────────────────────────────────────────

export function isEncryptedPayload(obj: unknown): obj is EncryptedPayload {
  if (obj === null || obj === undefined || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return o.encrypted === true && typeof o.version === "number";
}

// ─── Machine Key ─────────────────────────────────────────────────────────────

const SALT_FILE = join(KASTELL_DIR, ".encryption-salt");
const FALLBACK_ID_FILE = join(KASTELL_DIR, ".machine-id");

let _cachedKey: Buffer | null = null;

function ensureKastellDir(): void {
  if (!existsSync(KASTELL_DIR)) mkdirSync(KASTELL_DIR, { recursive: true });
}

/** Read persisted value or generate, write, and return a new one. */
function getOrCreatePersistedValue(filePath: string, generate: () => string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf8").trim();
    }
  } catch { /* regenerate */ }
  ensureKastellDir();
  const value = generate();
  writeFileSync(filePath, value, { mode: 0o600 });
  return value;
}

function getRawMachineId(): string {
  const plat = platform();

  try {
    if (plat === "linux") {
      return readFileSync("/etc/machine-id", "utf8").trim();
    }

    if (plat === "darwin") {
      const result = spawnSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
      const match = result.stdout?.match(/IOPlatformUUID[^=]*=\s*"?([^"\n]+)"?/);
      if (match?.[1]) return match[1].trim();
    }

    if (plat === "win32") {
      const result = spawnSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8" });
      const match = result.stdout?.match(/MachineGuid\s+REG_SZ\s+(.+)/);
      if (match?.[1]) return match[1].trim();
    }
  } catch {
    // Fall through to fallback
  }

  return getOrCreatePersistedValue(FALLBACK_ID_FILE, () => randomUUID());
}

export function getMachineKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const machineId = getRawMachineId();
  const salt = getOrCreatePersistedValue(SALT_FILE, () => randomBytes(32).toString("hex"));
  _cachedKey = scryptSync(machineId, salt, 32) as Buffer;
  return _cachedKey;
}
