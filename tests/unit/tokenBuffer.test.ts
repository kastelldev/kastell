import { storeToken, readToken, clearAllTokens, registerCleanupHandlers } from "../../src/core/tokenBuffer";

describe("tokenBuffer", () => {
  afterEach(() => {
    clearAllTokens();
  });

  describe("storeToken / readToken", () => {
    it("should store and read a token", () => {
      storeToken("HETZNER_TOKEN", "my-token");
      expect(readToken("HETZNER_TOKEN")).toBe("my-token");
    });

    it("should return undefined for non-existent key", () => {
      expect(readToken("MISSING_KEY")).toBeUndefined();
    });

    it("should overwrite existing entry and zero old buffer", () => {
      storeToken("HETZNER_TOKEN", "old-token");
      const oldBuf = readToken("HETZNER_TOKEN");
      expect(oldBuf).toBe("old-token");

      storeToken("HETZNER_TOKEN", "new-token");
      expect(readToken("HETZNER_TOKEN")).toBe("new-token");
    });
  });

  describe("clearAllTokens", () => {
    it("should zero all buffers and clear the map", () => {
      storeToken("KEY_A", "token-a");
      storeToken("KEY_B", "token-b");

      clearAllTokens();

      expect(readToken("KEY_A")).toBeUndefined();
      expect(readToken("KEY_B")).toBeUndefined();
    });

    it("should be safe to call when empty", () => {
      expect(() => clearAllTokens()).not.toThrow();
    });
  });

  describe("registerCleanupHandlers", () => {
    it("should register process event handlers", () => {
      const onSpy = jest.spyOn(process, "on");
      registerCleanupHandlers();

      const registeredEvents = onSpy.mock.calls.map((call) => call[0]);
      expect(registeredEvents).toContain("exit");
      expect(registeredEvents).toContain("SIGINT");
      expect(registeredEvents).toContain("SIGTERM");

      onSpy.mockRestore();
    });

    it("should not register handlers twice", () => {
      const onSpy = jest.spyOn(process, "on");
      const initialCalls = onSpy.mock.calls.length;

      // Second call should be a no-op (handlers already registered from previous test)
      registerCleanupHandlers();
      expect(onSpy.mock.calls.length).toBe(initialCalls);

      onSpy.mockRestore();
    });
  });
});
