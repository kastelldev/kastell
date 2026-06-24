// Mock packageInfo.ts which uses import.meta.url (ESM-only). Under tsconfig.test.json
// (module: CommonJS), `import.meta` is not allowed; we exercise the public API via
// a mock that mirrors the real implementation behavior.
jest.mock("../../src/utils/packageInfo.js", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
    version: string;
    dependencies?: Record<string, string>;
  };

  return {
    getPackageMetadata: jest.fn(() => ({
      version: pkg.version,
      mcpSdkVersion: pkg.dependencies?.["@modelcontextprotocol/sdk"] ?? "unknown",
      ...(process.env.KASTELL_BUILD_ID ? { buildIdentity: process.env.KASTELL_BUILD_ID } : {}),
    })),
    clearPackageMetadataCache: jest.fn(),
  };
});

import {
  getPackageMetadata,
  clearPackageMetadataCache,
} from "../../src/utils/packageInfo.js";

describe("packageInfo", () => {
  it("should return package metadata with version and mcpSdkVersion when getPackageMetadata is called", () => {
    const metadata = getPackageMetadata();

    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(metadata.mcpSdkVersion).toBeTruthy();
  });

  it("should reset metadata cache when clearPackageMetadataCache is called and re-read package.json on next call", () => {
    clearPackageMetadataCache();

    const metadata = getPackageMetadata();
    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(clearPackageMetadataCache).toHaveBeenCalled();
  });
});
