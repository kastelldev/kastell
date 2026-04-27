import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadDefaults, saveDefaults } from "../../../src/core/defaults.js";
import type { DefaultsConfig } from "../../../src/types/index.js";

const MOCK_ID = `kastell-defaults-test-${process.pid}`;
const mockTestDir = join(tmpdir(), MOCK_ID);

jest.mock("../../../src/utils/paths.js", () => {
  const { tmpdir: t } = require("os");
  const { join: j } = require("path");
  const d = j(t(), `kastell-defaults-test-${process.pid}`);
  return { KASTELL_DIR: d, BACKUPS_DIR: j(d, "backups"), SECURITY_LOG: j(d, "security.log") };
});

jest.mock("../../../src/utils/secureWrite.js", () => ({
  secureWriteFileSync: (path: string, data: string) => writeFileSync(path, data, "utf-8"),
  secureMkdirSync: (path: string, opts?: { recursive?: boolean }) => mkdirSync(path, opts),
}));

describe("defaults", () => {
  beforeEach(() => {
    if (existsSync(mockTestDir)) rmSync(mockTestDir, { recursive: true, force: true });
    mkdirSync(mockTestDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(mockTestDir)) rmSync(mockTestDir, { recursive: true, force: true });
  });

  describe("loadDefaults", () => {
    it("should return empty object when defaults.json does not exist", () => {
      const result = loadDefaults();
      expect(result).toEqual({});
    });

    it("should return saved config when defaults.json exists", () => {
      const config: DefaultsConfig = { threshold: 70, framework: "cis-level1" };
      writeFileSync(join(mockTestDir, "defaults.json"), JSON.stringify(config));
      const result = loadDefaults();
      expect(result).toEqual(config);
    });

    it("should return empty object when defaults.json is corrupt", () => {
      writeFileSync(join(mockTestDir, "defaults.json"), "not-json{{{");
      const result = loadDefaults();
      expect(result).toEqual({});
    });

    it("should strip unknown fields via Zod schema", () => {
      writeFileSync(
        join(mockTestDir, "defaults.json"),
        JSON.stringify({ threshold: 80, unknownField: "hack" }),
      );
      const result = loadDefaults();
      expect(result).toEqual({ threshold: 80 });
      expect((result as Record<string, unknown>).unknownField).toBeUndefined();
    });
  });

  describe("saveDefaults", () => {
    it("should create defaults.json with valid config", () => {
      const config: DefaultsConfig = { threshold: 60, framework: "pci-dss" };
      saveDefaults(config);
      expect(existsSync(join(mockTestDir, "defaults.json"))).toBe(true);
      const saved = JSON.parse(
        require("fs").readFileSync(join(mockTestDir, "defaults.json"), "utf-8"),
      );
      expect(saved).toEqual(config);
    });

    it("should create config directory if it does not exist", () => {
      rmSync(mockTestDir, { recursive: true, force: true });
      const config: DefaultsConfig = { threshold: 50 };
      saveDefaults(config);
      expect(existsSync(join(mockTestDir, "defaults.json"))).toBe(true);
    });

    it("should overwrite existing defaults.json", () => {
      saveDefaults({ threshold: 50 });
      saveDefaults({ threshold: 90, framework: "hipaa" });
      const result = loadDefaults();
      expect(result).toEqual({ threshold: 90, framework: "hipaa" });
    });
  });
});
