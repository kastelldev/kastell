/**
 * Tests for isSafeMode() dual env var support:
 * - KASTELL_SAFE_MODE (primary)
 * - QUICKLIFY_SAFE_MODE (backward compat with deprecation warning)
 */

// We need to test the actual implementation, not mocked.
// Because isSafeMode has module-level state (_safeModeWarningShown),
// we need to re-import for each test group that needs a fresh flag.

const originalEnv = process.env;
let stderrSpy: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.KASTELL_SAFE_MODE;
  delete process.env.QUICKLIFY_SAFE_MODE;
  stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
  process.env = originalEnv;
});

describe("isSafeMode — dual env var support", () => {
  // We need a fresh module for each test to reset _safeModeWarningShown
  function freshImport(): { isSafeMode: () => boolean } {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../src/core/manage");
  }

  it("should return false when neither env var is set", () => {
    const { isSafeMode } = freshImport();
    expect(isSafeMode()).toBe(false);
  });

  it("should return true when KASTELL_SAFE_MODE=true", () => {
    process.env.KASTELL_SAFE_MODE = "true";
    const { isSafeMode } = freshImport();
    expect(isSafeMode()).toBe(true);
  });

  it("should return false when KASTELL_SAFE_MODE=false", () => {
    process.env.KASTELL_SAFE_MODE = "false";
    const { isSafeMode } = freshImport();
    expect(isSafeMode()).toBe(false);
  });

  it("should return true when only QUICKLIFY_SAFE_MODE=true (backward compat)", () => {
    process.env.QUICKLIFY_SAFE_MODE = "true";
    const { isSafeMode } = freshImport();
    expect(isSafeMode()).toBe(true);
  });

  it("should show deprecation warning when QUICKLIFY_SAFE_MODE is used alone", () => {
    process.env.QUICKLIFY_SAFE_MODE = "true";
    const { isSafeMode } = freshImport();
    isSafeMode();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("QUICKLIFY_SAFE_MODE is deprecated"),
    );
  });

  it("should show deprecation warning only once per process", () => {
    process.env.QUICKLIFY_SAFE_MODE = "true";
    const { isSafeMode } = freshImport();
    isSafeMode();
    isSafeMode();
    isSafeMode();
    // Filter stderr calls that contain our deprecation message
    const deprecationCalls = stderrSpy.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("QUICKLIFY_SAFE_MODE is deprecated"),
    );
    expect(deprecationCalls).toHaveLength(1);
  });

  it("should NOT show deprecation warning when KASTELL_SAFE_MODE is set (takes precedence)", () => {
    process.env.KASTELL_SAFE_MODE = "true";
    process.env.QUICKLIFY_SAFE_MODE = "true";
    const { isSafeMode } = freshImport();
    isSafeMode();
    const deprecationCalls = stderrSpy.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes("QUICKLIFY_SAFE_MODE is deprecated"),
    );
    expect(deprecationCalls).toHaveLength(0);
  });

  it("KASTELL_SAFE_MODE takes precedence when both are set", () => {
    process.env.KASTELL_SAFE_MODE = "false";
    process.env.QUICKLIFY_SAFE_MODE = "true";
    const { isSafeMode } = freshImport();
    // KASTELL_SAFE_MODE=false should win
    expect(isSafeMode()).toBe(false);
  });

  it("should return false for non-'true' values of QUICKLIFY_SAFE_MODE", () => {
    process.env.QUICKLIFY_SAFE_MODE = "1";
    const { isSafeMode } = freshImport();
    expect(isSafeMode()).toBe(false);
  });
});
