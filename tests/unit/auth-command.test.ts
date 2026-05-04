jest.mock("../../src/core/auth");

import {
  setToken,
  removeToken,
  listStoredProviders,
  isKeychainAvailable,
} from "../../src/core/auth";
import inquirer from "inquirer";

const mockSetToken = setToken as jest.MockedFunction<typeof setToken>;
const mockRemoveToken = removeToken as jest.MockedFunction<typeof removeToken>;
const mockListStoredProviders = listStoredProviders as jest.MockedFunction<typeof listStoredProviders>;
const mockIsKeychainAvailable = isKeychainAvailable as jest.MockedFunction<typeof isKeychainAvailable>;
const mockPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

// We import after mocks are set up
import {
  authSetAction,
  authRemoveAction,
  authListAction,
} from "../../src/commands/auth";

describe("auth commands", () => {
  let consoleLogs: string[];
  let consoleErrors: string[];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogs = [];
    consoleErrors = [];
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));
    mockIsKeychainAvailable.mockReturnValue(true);
    mockSetToken.mockReturnValue(true);
    mockRemoveToken.mockReturnValue(true);
    mockListStoredProviders.mockReturnValue([]);
  });

  afterAll(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  describe("authSetAction", () => {
    it("should prompt for token and call setToken on success", async () => {
      mockPrompt.mockResolvedValue({ token: "my-secret-token" });
      await authSetAction("hetzner");
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(mockSetToken).toHaveBeenCalledWith("hetzner", "my-secret-token");
      const output = consoleLogs.join(" ");
      expect(output).toContain("Hetzner Cloud");
    });

    it("should show error for invalid provider", async () => {
      await authSetAction("aws");
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(mockSetToken).not.toHaveBeenCalled();
      const output = consoleLogs.join(" ");
      expect(output).toContain("Invalid provider");
    });

    it("should show error when keychain is unavailable", async () => {
      mockIsKeychainAvailable.mockReturnValue(false);
      await authSetAction("hetzner");
      expect(mockPrompt).not.toHaveBeenCalled();
      const output = consoleLogs.join(" ");
      expect(output).toContain("keychain");
    });

    it("should show error when setToken fails", async () => {
      mockPrompt.mockResolvedValue({ token: "my-token" });
      mockSetToken.mockReturnValue(false);
      await authSetAction("hetzner");
      const output = consoleLogs.join(" ");
      expect(output).toContain("Failed");
    });

    it("should trim token before storing", async () => {
      mockPrompt.mockResolvedValue({ token: "  spaced-token  " });
      await authSetAction("hetzner");
      expect(mockSetToken).toHaveBeenCalledWith("hetzner", "spaced-token");
    });

    it("should never show token value in output", async () => {
      mockPrompt.mockResolvedValue({ token: "super-secret-123" });
      await authSetAction("hetzner");
      const allOutput = [...consoleLogs, ...consoleErrors].join(" ");
      expect(allOutput).not.toContain("super-secret-123");
    });
  });

  describe("authRemoveAction", () => {
    it("should call removeToken and show success", async () => {
      await authRemoveAction("hetzner");
      expect(mockRemoveToken).toHaveBeenCalledWith("hetzner");
      const output = consoleLogs.join(" ");
      expect(output).toContain("Hetzner Cloud");
    });

    it("should show error for invalid provider", async () => {
      await authRemoveAction("aws");
      expect(mockRemoveToken).not.toHaveBeenCalled();
      const output = consoleLogs.join(" ");
      expect(output).toContain("Invalid provider");
    });

    it("should show failure message when removeToken returns false", async () => {
      mockRemoveToken.mockReturnValue(false);
      await authRemoveAction("hetzner");
      const output = consoleLogs.join(" ");
      expect(output).toContain("No token found");
    });
  });

  describe("authListAction", () => {
    it("should show providers with stored tokens", async () => {
      mockListStoredProviders.mockReturnValue(["hetzner", "vultr"]);
      await authListAction();
      const output = consoleLogs.join("\n");
      expect(output).toContain("Hetzner Cloud");
      expect(output).toContain("Vultr");
    });

    it("should show 'No tokens stored' when empty", async () => {
      mockListStoredProviders.mockReturnValue([]);
      await authListAction();
      const output = consoleLogs.join(" ");
      expect(output).toContain("No tokens stored");
    });

    it("should never show actual token values", async () => {
      mockListStoredProviders.mockReturnValue(["hetzner"]);
      await authListAction();
      const allOutput = [...consoleLogs, ...consoleErrors].join(" ");
      // Token values should not appear in output
      expect(allOutput).not.toMatch(/[a-zA-Z0-9]{20,}/);
    });

    it("should show hint about env var tokens", async () => {
      mockListStoredProviders.mockReturnValue(["hetzner"]);
      await authListAction();
      const output = consoleLogs.join(" ");
      expect(output).toContain("environment");
    });
  });
});
