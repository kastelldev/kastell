import {
  mapProviderError,
  getProviderDisplayName,
  getErrorMessage,
  mapSshError,
  mapFileSystemError,
} from "../../src/utils/errorMapper";

function createAxiosError(
  status: number | undefined,
  code?: string,
): Record<string, unknown> & Error {
  const error = new Error("Request failed") as Error & Record<string, unknown>;
  if (status !== undefined) {
    error.response = {
      status,
      statusText: "Error",
      data: {},
      headers: {},
      config: { headers: {} },
    };
  }
  if (code) {
    error.code = code;
  }
  error.config = { headers: {} };
  return error;
}

describe("errorMapper", () => {
  describe("getProviderDisplayName", () => {
    it("should return Hetzner Cloud for hetzner", () => {
      expect(getProviderDisplayName("hetzner")).toBe("Hetzner Cloud");
    });

    it("should return DigitalOcean for digitalocean", () => {
      expect(getProviderDisplayName("digitalocean")).toBe("DigitalOcean");
    });

    it("should return Vultr for vultr", () => {
      expect(getProviderDisplayName("vultr")).toBe("Vultr");
    });

    it("should return Linode (Akamai) for linode", () => {
      expect(getProviderDisplayName("linode")).toBe("Linode (Akamai)");
    });

    it("should return raw name for unknown provider", () => {
      expect(getProviderDisplayName("aws")).toBe("aws");
    });
  });

  describe("mapProviderError", () => {
    describe("HTTP 401/403 - Auth errors", () => {
      it("should suggest new token for 401 on hetzner", () => {
        const error = createAxiosError(401);
        const result = mapProviderError(error, "hetzner");
        expect(result).toContain("invalid or expired");
        expect(result).toContain("console.hetzner.cloud");
      });

      it("should suggest new token for 403 on digitalocean", () => {
        const error = createAxiosError(403);
        const result = mapProviderError(error, "digitalocean");
        expect(result).toContain("invalid or expired");
        expect(result).toContain("cloud.digitalocean.com");
      });

      it("should suggest new token for 401 on vultr", () => {
        const error = createAxiosError(401);
        const result = mapProviderError(error, "vultr");
        expect(result).toContain("my.vultr.com");
      });

      it("should suggest new token for 403 on linode", () => {
        const error = createAxiosError(403);
        const result = mapProviderError(error, "linode");
        expect(result).toContain("cloud.linode.com");
      });
    });

    describe("HTTP 402 - Billing errors", () => {
      it("should suggest adding funds for 402 on hetzner", () => {
        const error = createAxiosError(402);
        const result = mapProviderError(error, "hetzner");
        expect(result).toContain("Insufficient account balance");
        expect(result).toContain("console.hetzner.cloud/billing");
      });

      it("should suggest adding funds for 402 on digitalocean", () => {
        const error = createAxiosError(402);
        const result = mapProviderError(error, "digitalocean");
        expect(result).toContain("Insufficient account balance");
        expect(result).toContain("cloud.digitalocean.com/account/billing");
      });
    });

    describe("HTTP 404 - Not found", () => {
      it("should return not found message", () => {
        const error = createAxiosError(404);
        const result = mapProviderError(error, "hetzner");
        expect(result).toContain("not found");
      });
    });

    describe("HTTP 409 - Conflict", () => {
      it("should return conflict message", () => {
        const error = createAxiosError(409);
        const result = mapProviderError(error, "vultr");
        expect(result).toContain("conflict");
      });
    });

    describe("HTTP 422 - Validation", () => {
      it("should return validation message", () => {
        const error = createAxiosError(422);
        const result = mapProviderError(error, "digitalocean");
        expect(result).toContain("Invalid request parameters");
      });
    });

    describe("HTTP 429 - Rate limit", () => {
      it("should return rate limit message with provider name", () => {
        const error = createAxiosError(429);
        const result = mapProviderError(error, "hetzner");
        expect(result).toContain("rate limit");
        expect(result).toContain("Hetzner Cloud");
      });
    });

    describe("HTTP 5xx - Server errors", () => {
      it("should return server error message for 500", () => {
        const error = createAxiosError(500);
        const result = mapProviderError(error, "vultr");
        expect(result).toContain("experiencing issues");
        expect(result).toContain("Vultr");
      });

      it("should return server error message for 503", () => {
        const error = createAxiosError(503);
        const result = mapProviderError(error, "linode");
        expect(result).toContain("experiencing issues");
        expect(result).toContain("HTTP 503");
      });
    });

    describe("Network errors", () => {
      it("should return connection refused message", () => {
        const error = createAxiosError(undefined, "ECONNREFUSED");
        const result = mapProviderError(error, "hetzner");
        expect(result).toContain("Cannot reach");
        expect(result).toContain("Hetzner Cloud");
      });

      it("should return DNS not found message", () => {
        const error = createAxiosError(undefined, "ENOTFOUND");
        const result = mapProviderError(error, "digitalocean");
        expect(result).toContain("Cannot reach");
      });

      it("should return timeout message", () => {
        const error = createAxiosError(undefined, "ETIMEDOUT");
        const result = mapProviderError(error, "vultr");
        expect(result).toContain("timed out");
      });

      it("should return timeout message for ECONNABORTED", () => {
        const error = createAxiosError(undefined, "ECONNABORTED");
        const result = mapProviderError(error, "linode");
        expect(result).toContain("timed out");
      });

      it("should return generic network error for unknown code", () => {
        const error = createAxiosError(undefined, "UNKNOWN");
        const result = mapProviderError(error, "hetzner");
        expect(result).toContain("Network error");
      });
    });

    describe("Message pattern matching", () => {
      it("should detect insufficient balance in error message", () => {
        const error = new Error("Insufficient balance on your account");
        const result = mapProviderError(error, "hetzner");
        expect(result).toContain("Insufficient account balance");
        expect(result).toContain("billing");
      });

      it("should detect insufficient funds in error message", () => {
        const error = new Error("Insufficient funds");
        const result = mapProviderError(error, "digitalocean");
        expect(result).toContain("Insufficient account balance");
      });

      it("should detect unavailable server type", () => {
        const error = new Error("Server type not available in this region");
        const result = mapProviderError(error, "vultr");
        expect(result).toContain("not available");
      });

      it("should detect sold out", () => {
        const error = new Error("Server type sold out");
        const result = mapProviderError(error, "hetzner");
        expect(result).toContain("not available");
      });
    });

    describe("Non-matching errors", () => {
      it("should return empty string for unrecognized error", () => {
        const error = new Error("Something went wrong");
        const result = mapProviderError(error, "hetzner");
        expect(result).toBe("");
      });

      it("should return empty string for non-error input", () => {
        const result = mapProviderError("some string error", "hetzner");
        expect(result).toBe("");
      });
    });

    describe("Unknown provider", () => {
      it("should handle unknown provider for 401", () => {
        const error = createAxiosError(401);
        const result = mapProviderError(error, "unknown_provider");
        expect(result).toContain("invalid or expired");
        expect(result).toContain("your provider dashboard");
      });

      it("should handle unknown provider for 402", () => {
        const error = createAxiosError(402);
        const result = mapProviderError(error, "unknown_provider");
        expect(result).toContain("Insufficient");
        expect(result).toContain("your provider billing page");
      });
    });
  });

  describe("getErrorMessage", () => {
    it("should extract message from Error instance", () => {
      expect(getErrorMessage(new Error("test error"))).toBe("test error");
    });

    it("should return string directly", () => {
      expect(getErrorMessage("raw string")).toBe("raw string");
    });

    it("should convert undefined to string", () => {
      expect(getErrorMessage(undefined)).toBe("undefined");
    });

    it("should convert null to string", () => {
      expect(getErrorMessage(null)).toBe("null");
    });

    it("should convert number to string", () => {
      expect(getErrorMessage(42)).toBe("42");
    });
  });

  describe("mapSshError", () => {
    it("should map Connection refused", () => {
      const result = mapSshError(new Error("ssh: connect to host 1.2.3.4 port 22: Connection refused"));
      expect(result).toContain("SSH connection refused");
      expect(result).toContain("kastell status");
    });

    it("should map Permission denied with IP", () => {
      const result = mapSshError(new Error("Permission denied (publickey)"), "1.2.3.4");
      expect(result).toContain("SSH authentication failed");
      expect(result).toContain("ssh-copy-id root@1.2.3.4");
    });

    it("should map Permission denied without IP", () => {
      const result = mapSshError(new Error("Permission denied"));
      expect(result).toContain("ssh-copy-id root@<server-ip>");
    });

    it("should map Host key verification failed with IP", () => {
      const result = mapSshError(new Error("Host key verification failed."), "5.6.7.8");
      expect(result).toContain("ssh-keygen -R 5.6.7.8");
    });

    it("should map No route to host", () => {
      const result = mapSshError(new Error("No route to host"));
      expect(result).toContain("Cannot reach server");
    });

    it("should map Network is unreachable", () => {
      const result = mapSshError(new Error("Network is unreachable"));
      expect(result).toContain("Cannot reach server");
    });

    it("should map Connection timed out", () => {
      const result = mapSshError(new Error("Connection timed out"));
      expect(result).toContain("timed out");
      expect(result).toContain("port 22");
    });

    it("should map Operation timed out", () => {
      const result = mapSshError(new Error("Operation timed out"));
      expect(result).toContain("timed out");
    });

    it("should map Connection reset", () => {
      const result = mapSshError(new Error("Connection reset by peer"));
      expect(result).toContain("SSH connection reset");
      expect(result).toContain("rebooting");
    });

    it("should map Could not resolve hostname", () => {
      const result = mapSshError(new Error("Could not resolve hostname"));
      expect(result).toContain("resolve hostname");
    });

    it("should map dpkg lock error", () => {
      const result = mapSshError(new Error("Could not get lock /var/lib/dpkg/lock-frontend"));
      expect(result).toContain("dpkg lock active");
      expect(result).toContain("1-2 minutes");
    });

    it("should map dpkg lock error variant", () => {
      const result = mapSshError(new Error("dpkg: error: another process has the lock"));
      expect(result).toContain("dpkg lock active");
    });

    it("should map command not found", () => {
      const result = mapSshError(new Error("bash: pg_dump: command not found"));
      expect(result).toContain("command not found");
      expect(result).toContain("installed");
    });

    it("should map No space left on device", () => {
      const result = mapSshError(new Error("No space left on device"));
      expect(result).toContain("disk is full");
    });

    it("should map Broken pipe", () => {
      const result = mapSshError(new Error("Broken pipe"));
      expect(result).toContain("connection dropped");
    });

    it("should return empty string for unrecognized SSH error", () => {
      expect(mapSshError(new Error("Something unexpected"))).toBe("");
    });

    it("should handle non-Error input", () => {
      expect(mapSshError("Connection refused")).toContain("SSH connection refused");
    });
  });

  describe("mapFileSystemError", () => {
    it("should map ENOENT", () => {
      const error = new Error("no such file") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      expect(mapFileSystemError(error)).toContain("File or directory not found");
    });

    it("should map EACCES", () => {
      const error = new Error("permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      expect(mapFileSystemError(error)).toContain("Permission denied");
    });

    it("should map EPERM", () => {
      const error = new Error("operation not permitted") as NodeJS.ErrnoException;
      error.code = "EPERM";
      expect(mapFileSystemError(error)).toContain("Permission denied");
    });

    it("should map ENOSPC", () => {
      const error = new Error("no space") as NodeJS.ErrnoException;
      error.code = "ENOSPC";
      expect(mapFileSystemError(error)).toContain("Disk full");
    });

    it("should return empty string for unknown code", () => {
      const error = new Error("unknown") as NodeJS.ErrnoException;
      error.code = "UNKNOWN";
      expect(mapFileSystemError(error)).toBe("");
    });

    it("should return empty string for non-Error input", () => {
      expect(mapFileSystemError("just a string")).toBe("");
    });

    it("should return empty string for Error without code", () => {
      expect(mapFileSystemError(new Error("no code"))).toBe("");
    });
  });
});
