import axios from "axios";
import { withRetry } from "../../src/utils/retry.js";
import { withProviderErrorHandling } from "../../src/providers/base.js";

// Mock axios — must provide create() since base.ts calls it at module level
jest.mock("axios", () => {
  const mockInstance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockInstance),
      isAxiosError: (e: unknown): boolean => !!(e && typeof e === "object" && (e as Record<string, unknown>).isAxiosError),
    },
    isAxiosError: (e: unknown): boolean => !!(e && typeof e === "object" && (e as Record<string, unknown>).isAxiosError),
  };
});

function make429Error(retryAfter?: string): Error {
  const error = new Error("Request failed with status code 429") as Error & {
    isAxiosError: boolean;
    response: { status: number; headers: Record<string, string>; data: unknown };
    config: Record<string, unknown>;
    toJSON: () => Record<string, unknown>;
  };
  error.isAxiosError = true;
  (error as unknown as Record<string, unknown>).config = {};
  (error as unknown as Record<string, unknown>).toJSON = () => ({});
  error.response = {
    status: 429,
    headers: retryAfter ? { "retry-after": retryAfter } : {},
    data: { error: { message: "Rate limit exceeded" } },
  };
  // Make axios.isAxiosError recognize it
  Object.defineProperty(error, "__CANCEL__", { value: false });
  return error;
}

function make500Error(): Error {
  const error = new Error("Request failed with status code 500") as Error & {
    isAxiosError: boolean;
    response: { status: number; headers: Record<string, string>; data: unknown };
    config: Record<string, unknown>;
    toJSON: () => Record<string, unknown>;
  };
  error.isAxiosError = true;
  (error as unknown as Record<string, unknown>).config = {};
  (error as unknown as Record<string, unknown>).toJSON = () => ({});
  error.response = {
    status: 500,
    headers: {},
    data: { error: { message: "Internal Server Error" } },
  };
  return error;
}

describe("withRetry + withProviderErrorHandling composition", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns result when fn succeeds on first call", async () => {
    const fn = jest.fn().mockResolvedValue({ id: "123", status: "running" });

    const result = await withProviderErrorHandling("get server details", () =>
      withRetry(fn),
    );

    expect(result).toEqual({ id: "123", status: "running" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and returns result on success", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(make429Error())
      .mockResolvedValue({ id: "123", status: "running" });

    const promise = withProviderErrorHandling("get server details", () =>
      withRetry(fn, { baseDelayMs: 100, maxDelayMs: 1000 }),
    );

    // Advance timers to allow retry delay
    await jest.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toEqual({ id: "123", status: "running" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After header value as delay", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(make429Error("2"))
      .mockResolvedValue({ id: "456" });

    const promise = withProviderErrorHandling("get server details", () =>
      withRetry(fn),
    );

    // Retry-After: 2 means 2000ms delay
    await jest.advanceTimersByTimeAsync(2100);

    const result = await promise;
    expect(result).toEqual({ id: "456" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("wraps final 429 error in provider error format after exhausting retries", async () => {
    const error429 = make429Error();
    const fn = jest.fn().mockRejectedValue(error429);

    let caughtError: Error | undefined;
    const promise = withProviderErrorHandling("get server details", () =>
      withRetry(fn, { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 500 }),
    ).catch((e: Error) => { caughtError = e; });

    // Advance through all retry delays (each retry needs time to resolve)
    for (let i = 0; i < 10; i++) {
      await jest.advanceTimersByTimeAsync(1000);
    }

    await promise;
    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain("Failed to get server details");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry non-429 errors", async () => {
    const fn = jest.fn().mockRejectedValue(make500Error());

    const promise = withProviderErrorHandling("get server details", () =>
      withRetry(fn),
    );

    await expect(promise).rejects.toThrow("Failed to get server details");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
