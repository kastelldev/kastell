jest.mock("../../src/utils/version.js", () => ({
  getPackageMetadata: jest.fn(() => ({
    version: "2.2.7",
    mcpSdkVersion: "1.27.1",
  })),
  getKastellVersion: jest.fn(() => "2.2.7"),
  KASTELL_VERSION: "2.2.7",
  clearVersionCache: jest.fn(),
}));

import { formatMcpStartupDiagnostic } from "../../src/mcp/startupDiagnostic.js";

describe("formatMcpStartupDiagnostic", () => {
  it("formats line with version, SDK, and SAFE_MODE when no buildIdentity", () => {
    const result = formatMcpStartupDiagnostic("true", {
      version: "2.3.0",
      mcpSdkVersion: "1.27.1",
    });
    expect(result).toBe("kastell-mcp v2.3.0 started (sdk=1.27.1, SAFE_MODE=true)");
  });

  it("includes buildIdentity segment when buildIdentity is present", () => {
    const result = formatMcpStartupDiagnostic("false", {
      version: "2.3.0",
      mcpSdkVersion: "1.27.1",
      buildIdentity: "ci-abc123",
    });
    expect(result).toBe(
      "kastell-mcp v2.3.0 started (sdk=1.27.1, build=ci-abc123, SAFE_MODE=false)",
    );
  });

  it("handles unset SAFE_MODE", () => {
    const result = formatMcpStartupDiagnostic("unset", {
      version: "2.3.0",
      mcpSdkVersion: "1.27.1",
    });
    expect(result).toBe("kastell-mcp v2.3.0 started (sdk=1.27.1, SAFE_MODE=unset)");
  });
});
