/**
 * Shared encryption mock factory for tests that import auth.ts or notifyStore.ts.
 *
 * Usage in jest.mock:
 *   jest.mock("../../src/utils/encryption.js", () => createEncryptionMock());
 *
 * The mock uses hex encoding as a transparent stand-in for AES-256-GCM,
 * so tests can verify encrypted payload structure without real crypto.
 */

export const MOCK_KEY = Buffer.alloc(32, 0xab);
export const MOCK_IV = "aabbccddee001122334455";
export const MOCK_TAG = "00112233445566778899aabbccddeeff";

export function createEncryptionMock() {
  return {
    encryptData: jest.fn((plaintext: string) => ({
      encrypted: true,
      version: 1,
      iv: MOCK_IV,
      data: Buffer.from(plaintext).toString("hex"),
      tag: MOCK_TAG,
    })),
    decryptData: jest.fn((payload: { data: string }) =>
      Buffer.from(payload.data, "hex").toString("utf8"),
    ),
    getMachineKey: jest.fn(() => MOCK_KEY),
    isEncryptedPayload: jest.fn((obj: unknown) => {
      if (obj === null || obj === undefined || typeof obj !== "object") return false;
      return (obj as Record<string, unknown>).encrypted === true;
    }),
  };
}

/**
 * Restore encryption mock implementations after jest.resetAllMocks().
 * Call in beforeEach when using resetAllMocks.
 */
export function restoreEncryptionMock(
  encMod: Record<string, jest.Mock>,
  originals: Record<string, ((...args: unknown[]) => unknown) | undefined>,
): void {
  for (const [key, impl] of Object.entries(originals)) {
    if (impl) encMod[key].mockImplementation(impl);
  }
}
