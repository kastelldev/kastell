const tokenStore = new Map<string, Buffer>();
let registered = false;

export function storeToken(key: string, token: string): void {
  const existing = tokenStore.get(key);
  if (existing) {
    existing.fill(0);
  }
  tokenStore.set(key, Buffer.from(token, "utf-8"));
}

export function readToken(key: string): string | undefined {
  const buf = tokenStore.get(key);
  if (!buf) return undefined;
  return buf.toString("utf-8");
}

export function clearAllTokens(): void {
  for (const buf of tokenStore.values()) {
    buf.fill(0);
  }
  tokenStore.clear();
}

export function registerCleanupHandlers(): void {
  if (registered) return;
  registered = true;
  process.on("exit", clearAllTokens);
  process.on("SIGINT", () => {
    clearAllTokens();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    clearAllTokens();
    process.exit(0);
  });
}
