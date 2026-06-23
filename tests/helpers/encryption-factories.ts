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

// ─── Probe-specific payload helpers ─────────────────────────────────────────
//
// These mock encryptData / decryptData with a deterministic hex-roundtrip so
// the Probe payload tests can exercise serialize/encrypt/decrypt without
// depending on Node crypto, while still verifying envelope structure and
// authentication-failure paths via the corruption helpers below.

/** Deterministic encrypt mock used by probe-payload tests. */
export const PROBE_MOCK_IV = "1122334455667788990011aa";
export const PROBE_MOCK_TAG = "00112233445566778899aabbccddeeff";

export function createProbeEncryptionMock() {
  const tagState: { value: string } = { value: PROBE_MOCK_TAG };
  return {
    encryptData: jest.fn((plaintext: string) => ({
      encrypted: true as const,
      version: 1 as const,
      iv: PROBE_MOCK_IV,
      data: Buffer.from(plaintext, "utf8").toString("hex"),
      tag: tagState.value,
    })),
    decryptData: jest.fn((payload: { data: string; tag: string }) => {
      if (payload.tag !== tagState.value) {
        throw new Error("Authentication failed (mock)");
      }
      return Buffer.from(payload.data, "hex").toString("utf8");
    }),
    getMachineKey: jest.fn(() => MOCK_KEY),
    isEncryptedPayload: jest.fn((obj: unknown) => {
      if (obj === null || obj === undefined || typeof obj !== "object") return false;
      return (obj as Record<string, unknown>).encrypted === true;
    }),
  };
}

/**
 * Produce a payload envelope whose auth tag has been corrupted.
 * Used to verify Probe decrypt fails closed.
 */
export function withCorruptedAuthTag<T extends { tag: string }>(envelope: T): T {
  return {
    ...envelope,
    tag: "AA" + envelope.tag.slice(2),
  };
}
