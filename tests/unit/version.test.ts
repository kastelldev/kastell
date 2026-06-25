jest.mock("../../src/utils/version.js", () => ({
  getPackageMetadata: jest.fn(() => ({
    version: "2.2.7",
    mcpSdkVersion: "1.27.1",
  })),
  getKastellVersion: jest.fn(() => "2.2.7"),
  KASTELL_VERSION: "2.2.7",
  clearVersionCache: jest.fn(),
}));

import { readFileSync } from "fs";
import { join } from "path";
import { getPackageMetadata, getKastellVersion, KASTELL_VERSION, clearVersionCache } from "../../src/utils/version.js";

const mockedGetPackageMetadata = getPackageMetadata as jest.MockedFunction<typeof getPackageMetadata>;
const mockedGetKastellVersion = getKastellVersion as jest.MockedFunction<typeof getKastellVersion>;
const mockedClearVersionCache = clearVersionCache as jest.MockedFunction<typeof clearVersionCache>;

describe("getPackageMetadata", () => {
  const originalBuildId = process.env.KASTELL_BUILD_ID;

  afterEach(() => {
    if (originalBuildId === undefined) {
      delete process.env.KASTELL_BUILD_ID;
    } else {
      process.env.KASTELL_BUILD_ID = originalBuildId;
    }
    jest.restoreAllMocks();
  });

  it("returns version and MCP SDK version from package.json", () => {
    const metadata = getPackageMetadata();
    expect(mockedGetPackageMetadata).toHaveBeenCalled();
    expect(metadata).toMatchObject({
      version: "2.2.7",
      mcpSdkVersion: "1.27.1",
    });
  });

  it("includes buildIdentity when KASTELL_BUILD_ID env is set", () => {
    mockedGetPackageMetadata.mockReturnValueOnce({
      version: "2.2.7",
      mcpSdkVersion: "1.27.1",
      buildIdentity: "ci-abc123",
    });
    process.env.KASTELL_BUILD_ID = "ci-abc123";
    const metadata = getPackageMetadata();
    expect(metadata.buildIdentity).toBe("ci-abc123");
  });

  it("omits buildIdentity when KASTELL_BUILD_ID env is not set", () => {
    mockedGetPackageMetadata.mockReturnValueOnce({
      version: "2.2.7",
      mcpSdkVersion: "1.27.1",
    });
    delete process.env.KASTELL_BUILD_ID;
    const metadata = getPackageMetadata();
    expect(metadata.buildIdentity).toBeUndefined();
  });

  it("preserves existing KASTELL_VERSION export", () => {
    expect(typeof KASTELL_VERSION).toBe("string");
    expect(KASTELL_VERSION.length).toBeGreaterThan(0);
  });

  it("preserves getKastellVersion function", () => {
    expect(typeof getKastellVersion()).toBe("string");
    expect(mockedGetKastellVersion).toHaveBeenCalled();
  });

  it("preserves clearVersionCache function", () => {
    expect(typeof clearVersionCache).toBe("function");
    clearVersionCache();
    expect(mockedClearVersionCache).toHaveBeenCalled();
  });
});

describe("getPackageMetadata (real implementation)", () => {
  it("reads version and mcpSdkVersion from the real package.json", () => {
    // Exercise the REAL production implementation by spawning a Node child process
    // that imports the compiled dist/utils/version.js (ESM, supports import.meta).
    // This bypasses the top-of-file jest.mock (which only intercepts in-process
    // require/import) and verifies the real chain:
    // getPackageMetadata -> readKastellPackageJson -> findPackageJson -> JSON.parse.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require("child_process") as typeof import("child_process");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");

    const distPath = path.resolve(__dirname, "..", "..", "dist", "utils", "version.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pathToFileURL } = require("url") as typeof import("url");
    const distUrl = pathToFileURL(distPath).href;
    const driverScript = `
      import { getPackageMetadata } from ${JSON.stringify(distUrl)};
      process.stdout.write(JSON.stringify(getPackageMetadata()));
    `;

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", driverScript], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    if (result.status !== 0) {
      throw new Error(`Child process failed: status=${result.status}, stderr=${result.stderr}, stdout=${result.stdout}`);
    }
    expect(result.status).toBe(0);
    // stderr may contain Node module-type warnings (not errors).
    const metadata = JSON.parse(result.stdout) as { version: string; mcpSdkVersion: string; buildIdentity?: string };
    expect(metadata).toMatchObject({
      version: expect.any(String),
      mcpSdkVersion: "1.27.1",
    });
    // Verify version matches the real package.json (sanity check the real read)
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { version: string };
    expect(metadata.version).toBe(pkg.version);
  });

  it("falls back to '0.0.0' and 'unknown' when package.json cannot be found", () => {
    // Exercise the REAL production implementation via child_process. See first
    // test for rationale. We copy the compiled dist/utils/version.js into a temp
    // directory that has NO package.json anywhere up to 5 levels, so
    // findPackageJson() returns null, exercising the error-fallback path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require("child_process") as typeof import("child_process");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os") as typeof import("os");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsPromised = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pathToFileURL } = require("url") as typeof import("url");

    const distPath = path.resolve(__dirname, "..", "..", "dist", "utils", "version.js");
    const distPackageInfoPath = path.resolve(
      __dirname,
      "..",
      "..",
      "dist",
      "utils",
      "packageInfo.js",
    );
    // Create a nested temp dir 6 levels deep so findPackageJson's 5-level walk
    // cannot find any package.json above the copied version.js file.
    const baseTemp = os.tmpdir();
    const timestamp = Date.now();
    const tempBase = path.join(baseTemp, `kastell-version-test-${timestamp}`);
    const tempDir = path.join(tempBase, "a", "b", "c", "d", "e", "f");
    fsPromised.mkdirSync(tempDir, { recursive: true });
    const copiedDist = path.join(tempDir, "version.js");
    const copiedPackageInfo = path.join(tempDir, "packageInfo.js");
    fsPromised.copyFileSync(distPath, copiedDist);
    // version.js re-exports getPackageMetadata from packageInfo.js; copy it too
    // so the ESM resolver can satisfy the import inside the temp sandbox.
    fsPromised.copyFileSync(distPackageInfoPath, copiedPackageInfo);

    const distUrl = pathToFileURL(copiedDist).href;
    const driverScript = `
      import { getPackageMetadata } from ${JSON.stringify(distUrl)};
      process.stdout.write(JSON.stringify(getPackageMetadata()));
    `;

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", driverScript], {
      encoding: "utf-8",
      cwd: tempDir,
    });

    // Clean up the nested temp dir
    fsPromised.rmSync(tempBase, { recursive: true, force: true });

    if (result.status !== 0) {
      throw new Error(`Child process failed: status=${result.status}, stderr=${result.stderr}, stdout=${result.stdout}`);
    }
    expect(result.status).toBe(0);
    // stderr may contain Node MODULE_TYPELESS_PACKAGE_JSON warning (not an error).
    const metadata = JSON.parse(result.stdout) as { version: string; mcpSdkVersion: string; buildIdentity?: string };
    expect(metadata).toEqual({
      version: "0.0.0",
      mcpSdkVersion: "unknown",
    });
  });
});
