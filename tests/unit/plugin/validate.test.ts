jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

import { validateManifest } from "../../../src/plugin/validate.js";
import { ValidationError } from "../../../src/utils/errors.js";

const VALID_MANIFEST = {
  name: "kastell-plugin-wordpress",
  version: "1.0.0",
  apiVersion: "1",
  kastell: ">=2.2.0 <3.0.0",
  capabilities: ["audit"],
  checkPrefix: "WP",
  entry: "dist/index.js",
};

describe("validateManifest", () => {
  describe("valid manifests", () => {
    it("accepts a fully valid manifest", () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.name).toBe("kastell-plugin-wordpress");
      expect(result.checkPrefix).toBe("WP");
    });

    it("accepts checkPrefix with 2 chars", () => {
      const result = validateManifest({ ...VALID_MANIFEST, checkPrefix: "WP" });
      expect(result.checkPrefix).toBe("WP");
    });

    it("accepts checkPrefix with 6 chars", () => {
      const result = validateManifest({ ...VALID_MANIFEST, checkPrefix: "WORDPR" });
      expect(result.checkPrefix).toBe("WORDPR");
    });
  });

  describe("name validation", () => {
    it("rejects missing name", () => {
      const { name: _, ...noName } = VALID_MANIFEST;
      expect(() => validateManifest(noName)).toThrow(ValidationError);
    });

    it("rejects name without kastell-plugin- prefix", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, name: "my-plugin" }))
        .toThrow(ValidationError);
    });

    it("rejects name with uppercase", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, name: "kastell-plugin-WordPress" }))
        .toThrow(ValidationError);
    });
  });

  describe("apiVersion validation", () => {
    it("rejects apiVersion 2", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, apiVersion: "2" }))
        .toThrow(ValidationError);
    });

    it("rejects numeric apiVersion", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, apiVersion: 1 as unknown as string }))
        .toThrow(ValidationError);
    });
  });

  describe("capabilities validation", () => {
    it("rejects non-audit capability", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, capabilities: ["command"] }))
        .toThrow(ValidationError);
    });

    it("rejects empty capabilities", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, capabilities: [] }))
        .toThrow(ValidationError);
    });

    it("rejects multiple capabilities", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, capabilities: ["audit", "audit"] }))
        .toThrow(ValidationError);
    });
  });

  describe("checkPrefix validation", () => {
    it("rejects lowercase prefix", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, checkPrefix: "wp" }))
        .toThrow(ValidationError);
    });

    it("rejects prefix with 1 char", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, checkPrefix: "W" }))
        .toThrow(ValidationError);
    });

    it("rejects prefix with 7 chars", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, checkPrefix: "TOOLONG" }))
        .toThrow(ValidationError);
    });

    it("rejects prefix with numbers", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, checkPrefix: "WP1" }))
        .toThrow(ValidationError);
    });
  });

  describe("strict mode", () => {
    it("rejects extra fields", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, extraField: "hack" }))
        .toThrow(ValidationError);
    });
  });

  describe("kastell version compatibility", () => {
    it("accepts compatible version range", () => {
      const result = validateManifest({ ...VALID_MANIFEST, kastell: ">=2.2.0" });
      expect(result.kastell).toBe(">=2.2.0");
    });

    it("accepts exact version match", () => {
      const result = validateManifest({ ...VALID_MANIFEST, kastell: "2.2.0" });
      expect(result.kastell).toBe("2.2.0");
    });

    it("rejects incompatible version range (too high)", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, kastell: ">=2.3.0" }))
        .toThrow(ValidationError);
    });

    it("rejects incompatible version range (too low)", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, kastell: "<2.0.0" }))
        .toThrow(ValidationError);
    });

    it("error message includes current and required version", () => {
      let err: unknown;
      try { validateManifest({ ...VALID_MANIFEST, kastell: ">=3.0.0" }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toMatch(/2\.2\.0/);
      expect((err as Error).message).toMatch(/3\.0\.0/);
    });

    it("rejects invalid semver range syntax", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, kastell: "not-a-range" }))
        .toThrow(ValidationError);
    });
  });
});
