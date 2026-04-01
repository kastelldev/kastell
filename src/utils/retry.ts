import axios from "axios";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30_000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt === maxRetries) throw error;

      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const retryAfter = error.response.headers["retry-after"];
        let delayMs: number;

        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            delayMs = Math.min(parsed * 1000, maxDelayMs);
          } else {
            // Try HTTP-date format
            const dateMs = Date.parse(retryAfter);
            if (Number.isFinite(dateMs)) {
              delayMs = Math.max(dateMs - Date.now(), 1000);
            } else {
              // Unparseable, fall back to exponential
              delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
              delayMs += Math.random() * delayMs * 0.1;
            }
          }
        } else {
          delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
          delayMs += Math.random() * delayMs * 0.1;
        }

        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw error; // Non-429 errors are not retryable
    }
  }
  throw new Error("Unreachable");
}
