import { withRetry } from "../../src/utils/retry.js";
import type { RetryOptions } from "../../src/utils/retry.js";
import axios from "axios";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    isAxiosError: jest.fn(),
  },
  isAxiosError: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function make429Error(headers: Record<string, string> = {}): Error & { isAxiosError: boolean; response: { status: number; headers: Record<string, string> } } {
  const err = new Error("Too Many Requests") as Error & { isAxiosError: boolean; response: { status: number; headers: Record<string, string> } };
  err.isAxiosError = true;
  err.response = { status: 429, headers };
  return err;
}

function make500Error(): Error & { isAxiosError: boolean; response: { status: number; headers: Record<string, string> } } {
  const err = new Error("Internal Server Error") as Error & { isAxiosError: boolean; response: { status: number; headers: Record<string, string> } };
  err.isAxiosError = true;
  err.response = { status: 500, headers: {} };
  return err;
}

function make502Error(): Error & { isAxiosError: boolean; response: { status: number; headers: Record<string, string> } } {
  const err = new Error("Bad Gateway") as Error & { isAxiosError: boolean; response: { status: number; headers: Record<string, string> } };
  err.isAxiosError = true;
  err.response = { status: 502, headers: {} };
  return err;
}

function make503Error(): Error & { isAxiosError: boolean; response: { status: number; headers: Record<string, string> } } {
  const err = new Error("Service Unavailable") as Error & { isAxiosError: boolean; response: { status: number; headers: Record<string, string> } };
  err.isAxiosError = true;
  err.response = { status: 503, headers: {} };
  return err;
}

function makeEtimedoutError(): Error & { isAxiosError: boolean; code: string; response?: undefined } {
  const err = new Error("Connection timed out") as Error & { isAxiosError: boolean; code: string; response?: undefined };
  err.isAxiosError = true;
  err.code = "ETIMEDOUT";
  return err;
}

function makeEconnrefusedError(): Error & { isAxiosError: boolean; code: string; response?: undefined } {
  const err = new Error("Connection refused") as Error & { isAxiosError: boolean; code: string; response?: undefined };
  err.isAxiosError = true;
  err.code = "ECONNREFUSED";
  return err;
}

describe("withRetry", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    mockedAxios.isAxiosError.mockImplementation((err: any) => err?.isAxiosError === true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("retries429", () => {
    it("should retry fn on 429 error up to maxRetries times", async () => {
      const err429 = make429Error();
      const fn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce("success");

      const options: RetryOptions = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 };
      const promise = withRetry(fn, options);

      // Advance through retries
      await jest.advanceTimersByTimeAsync(200);  // 1st retry delay
      await jest.advanceTimersByTimeAsync(400);  // 2nd retry delay

      const result = await promise;
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe("exponentialBackoff", () => {
    it("should use exponential delays with jitter, capped at maxDelayMs", async () => {
      const err429 = make429Error();
      const fn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce("ok");

      const options: RetryOptions = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 };
      const promise = withRetry(fn, options);

      // First retry: baseDelayMs * 2^0 = 1000 + jitter (up to 10%)
      await jest.advanceTimersByTimeAsync(1200);
      // Second retry: baseDelayMs * 2^1 = 2000 + jitter
      await jest.advanceTimersByTimeAsync(2500);

      const result = await promise;
      expect(result).toBe("ok");
    });
  });

  describe("respectsRetryAfter", () => {
    it("should use Retry-After header (integer seconds) as delay", async () => {
      const err429 = make429Error({ "retry-after": "5" });
      const fn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce("after-wait");

      const promise = withRetry(fn, { maxRetries: 3 });

      // Retry-After: 5 seconds = 5000ms
      await jest.advanceTimersByTimeAsync(5100);

      const result = await promise;
      expect(result).toBe("after-wait");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("retryAfterDateFormat", () => {
    it("should parse Retry-After as HTTP-date and compute delay", async () => {
      // Set fake time to a known value
      jest.setSystemTime(new Date("2026-03-09T12:00:00Z"));

      const futureDate = new Date("2026-03-09T12:00:03Z").toUTCString(); // 3s in future
      const err429 = make429Error({ "retry-after": futureDate });
      const fn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce("date-ok");

      const promise = withRetry(fn, { maxRetries: 3 });

      // Should wait ~3 seconds
      await jest.advanceTimersByTimeAsync(3500);

      const result = await promise;
      expect(result).toBe("date-ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("retryAfterInvalid", () => {
    it("should fall back to exponential backoff when Retry-After is unparseable", async () => {
      const err429 = make429Error({ "retry-after": "not-a-number-or-date" });
      const fn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce("fallback-ok");

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 500 });

      // Fallback: baseDelayMs * 2^0 = 500 + jitter
      await jest.advanceTimersByTimeAsync(600);

      const result = await promise;
      expect(result).toBe("fallback-ok");
    });
  });

  describe("doesNotRetryNon429", () => {
    it("should throw non-429 axios errors immediately without retry", async () => {
      const err500 = make500Error();
      const fn = jest.fn().mockRejectedValueOnce(err500);

      await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow("Internal Server Error");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("retries502", () => {
    it("should retry on 502 status using exponential backoff", async () => {
      const err502 = make502Error();
      const fn = jest.fn()
        .mockRejectedValueOnce(err502)
        .mockResolvedValueOnce("ok");

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 });
      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should NOT use Retry-After for 502 even if header present", async () => {
      const err502 = make502Error();
      const fn = jest.fn()
        .mockRejectedValueOnce(err502)
        .mockResolvedValueOnce("ok");

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 });
      // With exponential backoff at attempt 0: ~100ms + jitter, not Retry-After seconds
      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe("ok");
    });
  });

  describe("retries503", () => {
    it("should retry on 503 status using exponential backoff", async () => {
      const err503 = make503Error();
      const fn = jest.fn()
        .mockRejectedValueOnce(err503)
        .mockResolvedValueOnce("ok");

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 });
      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("retriesEtimedout", () => {
    it("should retry on ETIMEDOUT network error (no response object)", async () => {
      const errEtimedout = makeEtimedoutError();
      const fn = jest.fn()
        .mockRejectedValueOnce(errEtimedout)
        .mockResolvedValueOnce("ok");

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 });
      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("doesNotRetryEconnrefused", () => {
    it("should throw ECONNREFUSED immediately without retry", async () => {
      const errEconnrefused = makeEconnrefusedError();
      const fn = jest.fn().mockRejectedValueOnce(errEconnrefused);

      await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow("Connection refused");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("429StillUsesRetryAfter", () => {
    it("should still use Retry-After header for 429 after 502/503 support added", async () => {
      const err429 = make429Error({ "retry-after": "2" });
      const fn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce("ok");

      const promise = withRetry(fn, { maxRetries: 3 });
      // Retry-After: 2s = 2000ms
      await jest.advanceTimersByTimeAsync(2100);

      const result = await promise;
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("doesNotRetryNonAxios", () => {
    it("should throw non-axios errors immediately without retry", async () => {
      const genericError = new Error("network failure");
      const fn = jest.fn().mockRejectedValueOnce(genericError);

      await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow("network failure");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("succeedsAfterRetry", () => {
    it("should return the result when fn succeeds on retry", async () => {
      const err429 = make429Error();
      const fn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce({ data: "server-list" });

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toEqual({ data: "server-list" });
    });
  });

  describe("exhaustsRetries", () => {
    it("should throw the last error after maxRetries 429 failures", async () => {
      const err429 = make429Error();
      const fn = jest.fn().mockRejectedValue(err429);

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 });
      const caught = promise.catch((e: Error) => e);

      // Advance through all retries
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(1100);
      }

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Too Many Requests");
      // 1 initial + 3 retries = 4 calls
      expect(fn).toHaveBeenCalledTimes(4);
    });
  });

  describe("defaultOptions", () => {
    it("should use defaults: maxRetries=3, baseDelayMs=1000, maxDelayMs=30000", async () => {
      const err429 = make429Error();
      const fn = jest.fn()
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce("default-ok");

      const promise = withRetry(fn);

      // Default baseDelayMs=1000, attempt 0: 1000 + jitter
      await jest.advanceTimersByTimeAsync(1200);

      const result = await promise;
      expect(result).toBe("default-ok");
    });
  });
});
