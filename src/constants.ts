// ─── Provider Registry ────────────────────────────────────────────────────────

export const PROVIDER_REGISTRY = {
  hetzner: {
    envKey: "HETZNER_TOKEN",
    displayName: "Hetzner Cloud",
    apiBaseUrl: "https://api.hetzner.cloud/v1",
  },
  digitalocean: {
    envKey: "DIGITALOCEAN_TOKEN",
    displayName: "DigitalOcean",
    apiBaseUrl: "https://api.digitalocean.com/v2",
  },
  vultr: {
    envKey: "VULTR_TOKEN",
    displayName: "Vultr",
    apiBaseUrl: "https://api.vultr.com/v2",
  },
  linode: {
    envKey: "LINODE_TOKEN",
    displayName: "Linode (Akamai)",
    apiBaseUrl: "https://api.linode.com/v4",
  },
} as const;

export type SupportedProvider = keyof typeof PROVIDER_REGISTRY;

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_REGISTRY) as [SupportedProvider, ...SupportedProvider[]];

export const PROVIDER_ENV_KEYS: Record<SupportedProvider, string> = Object.fromEntries(
  SUPPORTED_PROVIDERS.map((p) => [p, PROVIDER_REGISTRY[p].envKey]),
) as Record<SupportedProvider, string>;

export const PROVIDER_DISPLAY_NAMES: Record<SupportedProvider, string> = Object.fromEntries(
  SUPPORTED_PROVIDERS.map((p) => [p, PROVIDER_REGISTRY[p].displayName]),
) as Record<SupportedProvider, string>;

export function invalidProviderError(value: string): string {
  return `Invalid provider: "${value}". Use ${SUPPORTED_PROVIDERS.map((p) => `"${p}"`).join(", ")}.`;
}

// ─── Provider-specific IP wait configuration (IP assignment latency varies significantly)
export const IP_WAIT: Record<string, { attempts: number; interval: number }> = {
  hetzner:      { attempts: 10, interval: 3000 },   // 30s (instant IP)
  digitalocean: { attempts: 20, interval: 3000 },   // 60s
  vultr:        { attempts: 40, interval: 5000 },   // 200s (slowest IP assignment)
  linode:       { attempts: 30, interval: 5000 },   // 150s
};

// Provider-specific minimum wait before first Coolify health check
export const COOLIFY_MIN_WAIT: Record<string, number> = {
  hetzner: 60000, digitalocean: 120000, vultr: 180000, linode: 120000,
};

// Server boot polling
export const BOOT_MAX_ATTEMPTS = 30;
export const BOOT_INTERVAL = 1000;

// SCP file transfer timeout — prevents CLI hang on network failures (MCP + interactive mode)
export const SCP_TIMEOUT_MS = 300_000; // 5 minutes

// Platform update commands
export const COOLIFY_UPDATE_CMD = "curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash";
export const DOKPLOY_UPDATE_CMD = "curl -sSL https://dokploy.com/install.sh | sh";
export const COOLIFY_RESTART_CMD =
  "cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart coolify";

// Coolify database/paths
export const COOLIFY_SOURCE_DIR = "/data/coolify/source";
export const COOLIFY_DB_CONTAINER = "coolify-db";
export const COOLIFY_DB_USER = "coolify";
export const COOLIFY_DB_NAME = "coolify";
