import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { hostname, platform, arch } from "os";

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

let _cachedKey: Buffer | null = null;

function getRawMachineId(): string {
  const plat = platform();

  try {
    if (plat === "linux") {
      return readFileSync("/etc/machine-id", "utf8").trim();
    }

    if (plat === "darwin") {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", { encoding: "utf8" });
      const match = out.match(/IOPlatformUUID[^=]*=\s*"?([^"\n]+)"?/);
      if (match?.[1]) return match[1].trim();
    }

    if (plat === "win32") {
      const out = execSync(
        "cmd /c reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid",
        { encoding: "utf8" },
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+(.+)/);
      if (match?.[1]) return match[1].trim();
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: hostname + platform + arch
  return `${hostname()}-${plat}-${arch()}`;
}

export function getMachineKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const machineId = getRawMachineId();
  _cachedKey = scryptSync(machineId, "kastell-v1", 32) as Buffer;
  return _cachedKey;
}
