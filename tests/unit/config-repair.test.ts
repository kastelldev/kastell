import { diagnoseConfig, repairConfig } from "../../src/core/configRepair.js";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("configRepair", () => {
  let testDir: string;
  let serversFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kastell-repair-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    serversFile = join(testDir, "servers.json");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("diagnoseConfig", () => {
    it("returns healthy for valid servers.json", () => {
      writeFileSync(serversFile, JSON.stringify([
        { id: "s1", name: "test", provider: "hetzner", ip: "1.2.3.4", region: "nbg1", size: "cax11", createdAt: "2026-01-01", mode: "coolify" }
      ]));
      const result = diagnoseConfig(serversFile);
      expect(result.status).toBe("healthy");
      expect(result.issues).toHaveLength(0);
    });

    it("returns corrupt for invalid JSON", () => {
      writeFileSync(serversFile, "{broken json");
      const result = diagnoseConfig(serversFile);
      expect(result.status).toBe("corrupt");
      expect(result.issues).toContainEqual(expect.objectContaining({ type: "invalid_json" }));
    });

    it("returns corrupt for non-array JSON", () => {
      writeFileSync(serversFile, JSON.stringify({ not: "array" }));
      const result = diagnoseConfig(serversFile);
      expect(result.status).toBe("corrupt");
      expect(result.issues).toContainEqual(expect.objectContaining({ type: "not_array" }));
    });

    it("returns degraded for entries missing required fields", () => {
      writeFileSync(serversFile, JSON.stringify([
        { id: "s1", name: "test" },
        { id: "s2", name: "ok", provider: "hetzner", ip: "1.2.3.4", region: "nbg1", size: "cax11", createdAt: "2026-01-01", mode: "coolify" }
      ]));
      const result = diagnoseConfig(serversFile);
      expect(result.status).toBe("degraded");
      expect(result.issues).toContainEqual(expect.objectContaining({ type: "missing_fields" }));
      expect(result.validCount).toBe(1);
      expect(result.invalidCount).toBe(1);
    });

    it("returns degraded with auto_fixable for entries missing mode (legacy migration)", () => {
      writeFileSync(serversFile, JSON.stringify([
        { id: "s1", name: "legacy", provider: "hetzner", ip: "1.2.3.4", region: "nbg1", size: "cax11", createdAt: "2026-01-01" }
      ]));
      const result = diagnoseConfig(serversFile);
      expect(result.status).toBe("degraded");
      expect(result.autoFixableCount).toBe(1);
      expect(result.invalidCount).toBe(0);
      expect(result.issues).toContainEqual(expect.objectContaining({ type: "auto_fixable" }));
    });

    it("flags unknown provider", () => {
      writeFileSync(serversFile, JSON.stringify([
        { id: "s1", name: "bad-provider", provider: "unknown-cloud", ip: "1.2.3.4", region: "x", size: "y", createdAt: "2026-01-01", mode: "coolify" }
      ]));
      const result = diagnoseConfig(serversFile);
      expect(result.status).toBe("degraded");
      expect(result.issues).toContainEqual(expect.objectContaining({ type: "unknown_provider" }));
    });

    it("returns missing when file does not exist", () => {
      const result = diagnoseConfig(join(testDir, "nonexistent.json"));
      expect(result.status).toBe("missing");
    });
  });
});
