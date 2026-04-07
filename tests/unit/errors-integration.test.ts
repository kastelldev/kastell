/**
 * Integration tests: verify that core/ and providers/ throw points
 * produce KastellError subclass instances, not plain Errors.
 */
import axios from "axios";
import {
  KastellError,
  TransientError,
  BusinessError,
  PermissionError,
  ValidationError,
} from "../../src/utils/errors.js";
import { assertValidServerId, withProviderErrorHandling } from "../../src/providers/base.js";
import { buildInstallCronCommand } from "../../src/core/backupSchedule.js";
import { buildSetFqdnCommand } from "../../src/core/domain.js";
import { buildInstallGuardCronCommand } from "../../src/core/guard.js";
import { sanitizeServerName } from "../../src/core/scheduleManager.js";

// ─── providers/base.ts ────────────────────────────────────────────────────────

describe("assertValidServerId", () => {
  it("throws ValidationError for an invalid server ID", () => {
    expect(() => assertValidServerId("invalid!@#")).toThrow(ValidationError);
  });

  it("ValidationError is a KastellError", () => {
    let err: unknown;
    try {
      assertValidServerId("bad id");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KastellError);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).hint).toMatch(/alphanumeric/i);
  });

  it("does not throw for a valid server ID", () => {
    expect(() => assertValidServerId("abc-123")).not.toThrow();
    expect(() => assertValidServerId("linode/ubuntu22.04")).not.toThrow();
  });
});

describe("withProviderErrorHandling — categorized error types", () => {
  it("throws PermissionError on 401", async () => {
    const axiosErr = new Error("Unauthorized") as Error & { response?: { status: number; data: unknown; headers: Record<string, unknown> }; config?: unknown; request?: unknown };
    axiosErr.response = { status: 401, data: undefined, headers: {} };
    axiosErr.config = {};
    axiosErr.request = {};
    jest.spyOn(axios, "isAxiosError").mockReturnValueOnce(true);

    await expect(
      withProviderErrorHandling("test op", async () => {
        throw axiosErr;
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("throws PermissionError on 403", async () => {
    const axiosErr = new Error("Forbidden") as Error & { response?: { status: number; data: unknown; headers: Record<string, unknown> }; config?: unknown; request?: unknown };
    axiosErr.response = { status: 403, data: undefined, headers: {} };
    axiosErr.config = {};
    axiosErr.request = {};
    jest.spyOn(axios, "isAxiosError").mockReturnValueOnce(true);

    await expect(
      withProviderErrorHandling("test op", async () => {
        throw axiosErr;
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("throws BusinessError on 404", async () => {
    const axiosErr = new Error("Not Found") as Error & { response?: { status: number; data: unknown; headers: Record<string, unknown> }; config?: unknown; request?: unknown };
    axiosErr.response = { status: 404, data: undefined, headers: {} };
    axiosErr.config = {};
    axiosErr.request = {};
    jest.spyOn(axios, "isAxiosError").mockReturnValueOnce(true);

    await expect(
      withProviderErrorHandling("test op", async () => {
        throw axiosErr;
      }),
    ).rejects.toBeInstanceOf(BusinessError);
  });

  it("throws BusinessError on 409", async () => {
    const axiosErr = new Error("Conflict") as Error & { response?: { status: number; data: unknown; headers: Record<string, unknown> }; config?: unknown; request?: unknown };
    axiosErr.response = { status: 409, data: undefined, headers: {} };
    axiosErr.config = {};
    axiosErr.request = {};
    jest.spyOn(axios, "isAxiosError").mockReturnValueOnce(true);

    await expect(
      withProviderErrorHandling("test op", async () => {
        throw axiosErr;
      }),
    ).rejects.toBeInstanceOf(BusinessError);
  });

  it("throws TransientError on 500", async () => {
    const axiosErr = new Error("Server Error") as Error & { response?: { status: number; data: unknown; headers: Record<string, unknown> }; config?: unknown; request?: unknown };
    axiosErr.response = { status: 500, data: undefined, headers: {} };
    axiosErr.config = {};
    axiosErr.request = {};
    jest.spyOn(axios, "isAxiosError").mockReturnValueOnce(true);

    await expect(
      withProviderErrorHandling("test op", async () => {
        throw axiosErr;
      }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("throws TransientError for non-axios errors", async () => {
    jest.spyOn(axios, "isAxiosError").mockReturnValueOnce(false);

    await expect(
      withProviderErrorHandling("test op", async () => {
        throw new Error("random failure");
      }),
    ).rejects.toBeInstanceOf(TransientError);
  });
});

// ─── core/backupSchedule.ts ───────────────────────────────────────────────────

describe("buildInstallCronCommand", () => {
  it("throws ValidationError for invalid cron expression", () => {
    expect(() => buildInstallCronCommand("not-a-cron")).toThrow(ValidationError);
  });

  it("ValidationError includes hint about cron syntax", () => {
    let err: unknown;
    try {
      buildInstallCronCommand("* * * *"); // 4 fields — invalid
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).hint).toMatch(/cron/i);
  });
});

// ─── core/domain.ts ───────────────────────────────────────────────────────────

describe("buildSetFqdnCommand", () => {
  it("throws ValidationError for domain with special characters", () => {
    expect(() => buildSetFqdnCommand("bad domain!", true)).toThrow(ValidationError);
  });

  it("ValidationError includes hint about FQDN", () => {
    let err: unknown;
    try {
      buildSetFqdnCommand("bad domain!", true);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).hint).toMatch(/FQDN/i);
  });
});

// ─── core/guard.ts ────────────────────────────────────────────────────────────

describe("buildInstallGuardCronCommand", () => {
  it("does not throw for valid hardcoded GUARD_CRON_EXPR", () => {
    // GUARD_CRON_EXPR = "*/5 * * * *" — always valid
    expect(() => buildInstallGuardCronCommand()).not.toThrow();
  });
});

// ─── core/scheduleManager.ts ─────────────────────────────────────────────────

describe("sanitizeServerName", () => {
  it("throws ValidationError for server name with special characters", () => {
    expect(() => sanitizeServerName("my server!")).toThrow(ValidationError);
  });

  it("ValidationError includes hint about allowed characters", () => {
    let err: unknown;
    try {
      sanitizeServerName("bad name$");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).hint).toBeTruthy();
  });

  it("returns name unchanged for valid input", () => {
    expect(sanitizeServerName("my-server_01")).toBe("my-server_01");
  });
});
