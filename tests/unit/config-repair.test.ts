import { diagnoseConfig, repairConfig } from "../../src/core/configRepair.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "fs";
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

  describe("repairConfig", () => {
    it("creates backup and drops invalid entries", () => {
      writeFileSync(serversFile, JSON.stringify([
        { id: "s1", name: "good", provider: "hetzner", ip: "1.2.3.4", region: "nbg1", size: "cax11", createdAt: "2026-01-01", mode: "coolify" },
        { id: "s2", name: "bad" },
      ]));
      const result = repairConfig(serversFile);
      expect(result.recoveredCount).toBe(1);
      expect(result.droppedCount).toBe(1);
      expect(result.backupPath).toMatch(/\.backup-/);

      const repaired = JSON.parse(readFileSync(serversFile, "utf-8"));
      expect(repaired).toHaveLength(1);
      expect(repaired[0].name).toBe("good");
    });

    it("auto-fixes missing mode field with coolify default (legacy compat)", () => {
      writeFileSync(serversFile, JSON.stringify([
        { id: "s1", name: "legacy", provider: "hetzner", ip: "1.2.3.4", region: "nbg1", size: "cax11", createdAt: "2026-01-01" }
      ]));
      const result = repairConfig(serversFile);
      expect(result.recoveredCount).toBe(1);
      expect(result.droppedCount).toBe(0);
      expect(result.autoFixedCount).toBe(1);

      const repaired = JSON.parse(readFileSync(serversFile, "utf-8"));
      expect(repaired[0].mode).toBe("coolify");
    });

    it("should remove tmp file when repair writes through the atomic path", () => {
      writeFileSync(serversFile, JSON.stringify([
        { id: "s1", name: "legacy", provider: "hetzner", ip: "1.2.3.4", region: "nbg1", size: "cax11", createdAt: "2026-01-01" },
      ]));

      const result = repairConfig(serversFile);
      const repaired = JSON.parse(readFileSync(serversFile, "utf-8"));

      expect(result.recoveredCount).toBe(1);
      expect(repaired[0].mode).toBe("coolify");
      expect(existsSync(`${serversFile}.tmp`)).toBe(false);
    });

    it("drops entries with unknown provider", () => {
      writeFileSync(serversFile, JSON.stringify([
        { id: "s1", name: "bad", provider: "unknown-cloud", ip: "1.2.3.4", region: "x", size: "y", createdAt: "2026-01-01", mode: "coolify" },
        { id: "s2", name: "good", provider: "hetzner", ip: "5.6.7.8", region: "nbg1", size: "cax11", createdAt: "2026-01-01", mode: "coolify" },
      ]));
      const result = repairConfig(serversFile);
      expect(result.recoveredCount).toBe(1);
      expect(result.droppedCount).toBe(1);
    });

    it("handles completely invalid JSON by writing empty array", () => {
      writeFileSync(serversFile, "not json at all");
      const result = repairConfig(serversFile);
      expect(result.recoveredCount).toBe(0);
      expect(result.droppedCount).toBe(0);

      const repaired = JSON.parse(readFileSync(serversFile, "utf-8"));
      expect(repaired).toEqual([]);
    });

    it("handles non-array JSON by writing empty array", () => {
      writeFileSync(serversFile, JSON.stringify({ obj: true }));
      const result = repairConfig(serversFile);
      expect(result.recoveredCount).toBe(0);

      const repaired = JSON.parse(readFileSync(serversFile, "utf-8"));
      expect(repaired).toEqual([]);
    });

    it("preserves backup of original file", () => {
      const original = JSON.stringify([{ id: "s1", name: "bad" }]);
      writeFileSync(serversFile, original);
      const result = repairConfig(serversFile);

      const backup = readFileSync(result.backupPath, "utf-8");
      expect(backup).toBe(original);
    });

    it("prunes backups to keep only last 3", () => {
      // Create 4 pre-existing backups
      for (let i = 0; i < 4; i++) {
        writeFileSync(serversFile + `.backup-2026-01-0${i + 1}`, "old");
      }
      writeFileSync(serversFile, JSON.stringify([]));
      repairConfig(serversFile);

      const backups = readdirSync(testDir).filter((f) => f.includes(".backup-"));
      expect(backups.length).toBeLessThanOrEqual(3);
    });
  });
});
