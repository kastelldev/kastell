import type { ServerRecord } from "../../../src/types/index.js";

export function makeServerRecord(overrides?: Partial<ServerRecord>): ServerRecord {
  return {
    id: "test-server", name: "test-server",
    provider: "hetzner", ip: "10.0.0.1", region: "fsn1", size: "cx22",
    createdAt: "2024-01-01T00:00:00Z", mode: "bare",
    ...overrides,
  };
}

export const twoServerList: ServerRecord[] = [
  makeServerRecord({ id: "web-1", name: "web-1", ip: "10.0.0.1" }),
  makeServerRecord({ id: "db-1", name: "db-1", ip: "10.0.0.2" }),
];