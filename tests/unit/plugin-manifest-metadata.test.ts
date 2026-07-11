// Mock version.ts which uses import.meta.url (ESM-only)
jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "0.0.0-test",
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_REGISTRY } from "../../src/core/audit/checks/index.js";
import { listAllChecks } from "../../src/core/audit/listChecks.js";
import { ALL_MCP_TOOLS } from "../../src/mcp/server.js";

const repoRoot = process.cwd();

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(collectText).join("\n");
  }
  return "";
}

describe("Claude plugin public metadata", () => {
  it("derives catalog and static MCP counts from runtime sources", () => {
    const categoryCount = CHECK_REGISTRY.length;
    const runtimeCatalogCheckCount = listAllChecks().length;
    const staticMcpToolCount = ALL_MCP_TOOLS.length;

    expect(categoryCount).toBe(31);
    expect(runtimeCatalogCheckCount).toBeGreaterThan(400);
    expect(staticMcpToolCount).toBe(17);
  });

  it("does not publish drift-prone exact counts in plugin or marketplace descriptions", () => {
    const plugin = readJson(".claude-plugin/plugin.json");
    const marketplace = readJson(".claude-plugin/marketplace.json");
    const text = `${collectText(plugin)}\n${collectText(marketplace)}`;

    expect(text).not.toMatch(/\b449\b/);
    expect(text).not.toMatch(/\b31 categories\b/i);
    expect(text).not.toMatch(/\b24-step\b/i);
    expect(text).not.toMatch(/\b17 MCP tools\b/i);
  });
});
