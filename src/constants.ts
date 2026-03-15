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

// Platform install/update URLs (pinned to HTTPS CDN)
export const COOLIFY_INSTALL_URL = "https://cdn.coollabs.io/coolify/install.sh";
export const DOKPLOY_INSTALL_URL = "https://dokploy.com/install.sh";

// Install script validation — verify shebang and minimum size before execution
const SCRIPT_VALIDATE = 'head -c2 "$1" | grep -q "#!" && [ "$(wc -c < "$1")" -gt 100 ]';

// Platform update commands — download-then-execute with validation for auditability
export const COOLIFY_UPDATE_CMD = `curl -fsSL ${COOLIFY_INSTALL_URL} -o /tmp/coolify-install.sh && ${SCRIPT_VALIDATE.replace(/\$1/g, "/tmp/coolify-install.sh")} && bash /tmp/coolify-install.sh && rm -f /tmp/coolify-install.sh`;
export const DOKPLOY_UPDATE_CMD = `curl -sSL ${DOKPLOY_INSTALL_URL} -o /tmp/dokploy-install.sh && ${SCRIPT_VALIDATE.replace(/\$1/g, "/tmp/dokploy-install.sh")} && sh /tmp/dokploy-install.sh update && rm -f /tmp/dokploy-install.sh`;
export const COOLIFY_RESTART_CMD =
  "cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart coolify";

// Coolify database/paths
export const COOLIFY_SOURCE_DIR = "/data/coolify/source";
export const COOLIFY_DB_CONTAINER = "coolify-db";
export const COOLIFY_DB_USER = "coolify";
export const COOLIFY_DB_NAME = "coolify";

// Provider-specific OS IDs
export const VULTR_UBUNTU_OS_ID = 2284; // Ubuntu 24.04

// Dokploy database/paths
export const DOKPLOY_DB_CONTAINER = "dokploy-postgres";
export const DOKPLOY_DB_USER = "dokploy";
export const DOKPLOY_DB_NAME = "dokploy";

// Platform default ports
export const COOLIFY_PORT = 8000;
export const DOKPLOY_PORT = 3000;

// ─── Timeout & Delay Constants ──────────────────────────────────────────────
export const HTTP_TIMEOUT_MS = 5_000;       // axios health/status checks
export const DOCTOR_TIMEOUT_MS = 10_000;    // doctor token validation
export const LOCK_FIREWALL_TIMEOUT_MS = 60_000;
export const LOCK_UPGRADES_TIMEOUT_MS = 120_000;
export const EVIDENCE_TIMEOUT_MS = 120_000;
export const POLL_DELAY_MS = 5_000;         // status/deploy polling
export const RESTART_DELAY_MS = 2_000;      // restart wait
export const DEPLOY_STEP_DELAY_MS = 1_000;  // deploy inter-step
