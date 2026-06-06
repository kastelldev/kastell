import { jest } from "@jest/globals";

describe("keychain decrypt handling", () => {
  beforeEach(() => {
    jest.resetModules();
    // Clear encryption key cache between tests
    const encryption = require("../../src/utils/encryption.js") as typeof import("../../src/utils/encryption.js");
    // @ts-ignore - module-level cache
    encryption._cachedKey = null;
  });

  test("decrypt fail does not throw, returns empty list", () => {
    // Mock keyring to be unavailable so readTokensFile path is taken
    jest.doMock("../../src/utils/keyring.js", () => ({
      IS_ANDROID: false,
      loadKeyring: () => null, // force fallback path
      isKeychainAvailable: () => false,
      getKeychainEntry: () => null,
    }));

    // Mock getMachineKey to throw decrypt error
    jest.doMock("../../src/utils/encryption.js", () => {
      const original = jest.requireActual("../../src/utils/encryption.js") as typeof import("../../src/utils/encryption.js");
      return {
        ...original,
        getMachineKey: () => {
          throw new Error("decrypt failed");
        },
      };
    });

    const { listStoredProviders } = require("../../src/core/auth.js");
    const result = listStoredProviders();
    expect(result).toEqual([]);
  });
});
