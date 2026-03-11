import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { SUPPORTED_PROVIDERS, PROVIDER_ENV_KEYS } from "../constants.js";
import type { SupportedProvider } from "../constants.js";

const SERVICE_NAME = "kastell";

const IS_ANDROID =
  process.platform === "android" ||
  process.env["PREFIX"]?.includes("com.termux") ||
  existsSync("/data/data/com.termux");

const KASTELL_DIR = join(homedir(), ".kastell");
const TOKENS_FILE = join(KASTELL_DIR, "tokens.json");

function readTokensFile(): Record<string, string> {
  try {
    if (!existsSync(TOKENS_FILE)) return {};
    return JSON.parse(readFileSync(TOKENS_FILE, "utf8"));
  } catch { return {}; }
}

function writeTokensFile(data: Record<string, string>): boolean {
  try {
    if (!existsSync(KASTELL_DIR)) mkdirSync(KASTELL_DIR, { recursive: true });
    writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    return true;
  } catch { return false; }
}

type KeyringEntry = import("@napi-rs/keyring").Entry;
let _Entry: (new (service: string, key: string) => KeyringEntry) | null = null;
let _keyringLoaded = false;

function loadKeyring(): typeof _Entry {
  if (_keyringLoaded) return _Entry;
  _keyringLoaded = true;
  if (IS_ANDROID) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    _Entry = mod.Entry;
  } catch { _Entry = null; }
  return _Entry;
}

function getKeychainEntry(provider: string) {
  const envKey = PROVIDER_ENV_KEYS[provider as SupportedProvider];
  if (!envKey) return null;
  const EntryClass = loadKeyring();
  if (!EntryClass) return null;
  try { return new EntryClass(SERVICE_NAME, envKey); }
  catch { return null; }
}

export function setToken(provider: string, token: string): boolean {
  if (!SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)) return false;
  if (IS_ANDROID || !loadKeyring()) {
    const data = readTokensFile();
    data[provider] = token;
    return writeTokensFile(data);
  }
  const entry = getKeychainEntry(provider);
  if (!entry) return false;
  try { entry.setPassword(token); return true; }
  catch { return false; }
}

export function getToken(provider: string): string | undefined {
  if (IS_ANDROID || !loadKeyring()) return readTokensFile()[provider] ?? undefined;
  const entry = getKeychainEntry(provider);
  if (!entry) return undefined;
  try { return entry.getPassword() ?? undefined; }
  catch { return undefined; }
}

export function removeToken(provider: string): boolean {
  if (!SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)) return false;
  if (IS_ANDROID || !loadKeyring()) {
    const data = readTokensFile();
    delete data[provider];
    return writeTokensFile(data);
  }
  const entry = getKeychainEntry(provider);
  if (!entry) return false;
  try { entry.deletePassword(); return true; }
  catch { return false; }
}

export function listStoredProviders(): string[] {
  const stored: string[] = [];
  for (const provider of SUPPORTED_PROVIDERS) {
    try {
      const token = getToken(provider);
      if (token) stored.push(provider);
    } catch { /* skip */ }
  }
  return stored;
}

export function isKeychainAvailable(): boolean {
  const EntryClass = loadKeyring();
  if (IS_ANDROID || !EntryClass) return false;
  try { new EntryClass(SERVICE_NAME, "__test__"); return true; }
  catch { return false; }
}