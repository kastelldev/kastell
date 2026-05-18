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
    jest.spyOn(process.stderr, "write").mockImplementation((msg: string | Uint8Array) => {
      stderrOutput.push(String(msg));
      return true;
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
});
