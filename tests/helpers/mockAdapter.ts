import type { PlatformAdapter } from "../../src/adapters/interface.js";

interface MockAdapterOptions {
  name?: string;
  port?: number;
  defaultLogService?: string;
  platformPorts?: readonly number[];
  overrides?: Partial<Record<keyof PlatformAdapter, jest.Mock>>;
}

const PLATFORM_DEFAULTS: Record<string, { port: number; defaultLogService: string; platformPorts: readonly number[] }> = {
  coolify: { port: 8000, defaultLogService: "coolify", platformPorts: [80, 443, 8000, 6001, 6002] },
  dokploy: { port: 3000, defaultLogService: "dokploy", platformPorts: [80, 443, 3000] },
};

/**
 * Creates a mock PlatformAdapter for testing.
 * Pass a known platform name ("coolify" | "dokploy") to get correct defaults,
 * or provide individual overrides.
 */
export function createMockAdapter(opts: MockAdapterOptions = {}): PlatformAdapter {
  const name = opts.name ?? "coolify";
  const defaults = PLATFORM_DEFAULTS[name] ?? PLATFORM_DEFAULTS.coolify;

  return {
    name,
    port: opts.port ?? defaults.port,
    defaultLogService: opts.defaultLogService ?? defaults.defaultLogService,
    platformPorts: opts.platformPorts ?? defaults.platformPorts,
    getCloudInit: jest.fn(() => ""),
    healthCheck: jest.fn(async () => ({ status: "running" as const })),
    createBackup: jest.fn(async () => ({ success: true })),
    getStatus: jest.fn(async () => ({ platformVersion: "1.0", status: "running" as const })),
    update: jest.fn(async () => ({ success: true })),
    restoreBackup: jest.fn(),
    ...opts.overrides,
  } as PlatformAdapter;
}
