jest.mock("../../src/core/auth");

import { authListAction } from "../../src/commands/auth";
import { listStoredProviders } from "../../src/core/auth";

const mockListStoredProviders = listStoredProviders as jest.MockedFunction<typeof listStoredProviders>;

describe("auth list warning dedup", () => {
  let consoleOutput: unknown[];
  let stderrOutput: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    consoleOutput = [];
    stderrOutput = [];
    jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      consoleOutput.push(...args);
    });
    jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrOutput.push(args.map(a => String(a)).join(" "));
    });
    mockListStoredProviders.mockImplementation(() => {
      throw new Error("decrypt");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("decrypt failure produces single warning with re-entry hint", async () => {
    await authListAction();

    const allWarnings = [
      ...consoleOutput.map(o => String(o)),
      ...stderrOutput
    ].filter(w => w.includes("Token decryption failed"));

    expect(allWarnings.length).toBe(1);
    expect(allWarnings[0]).toMatch(/re-enter/);
  });

  test("decrypt failure warning lists all supported providers (CQS-07 8c)", async () => {
    await authListAction();

    const allWarnings = [
      ...consoleOutput.map(o => String(o)),
      ...stderrOutput
    ].filter(w => w.includes("Token decryption failed"));

    expect(allWarnings.length).toBe(1);
    // CQS-07 8c: warning must list every SUPPORTED_PROVIDER so user knows which tokens to re-enter
    expect(allWarnings[0]).toMatch(/hetzner, digitalocean, vultr, linode/);
  });
});
