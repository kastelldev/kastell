import axios from "axios";
import {
  ValidationError,
  PermissionError,
  TransientError,
  BusinessError,
} from "./errors.js";
import { extractReason } from "./errors.js";
import { PROVIDER_DISPLAY_NAMES } from "../constants.js";

interface ProviderUrls {
  token: string;
  billing: string;
}

const PROVIDER_URLS: Record<string, ProviderUrls> = {
  hetzner: {
    token: "https://console.hetzner.cloud/projects → API Tokens",
    billing: "https://console.hetzner.cloud/billing",
  },
  digitalocean: {
    token: "https://cloud.digitalocean.com/account/api/tokens",
    billing: "https://cloud.digitalocean.com/account/billing",
  },
  vultr: {
    token: "https://my.vultr.com/settings/#settingsapi",
    billing: "https://my.vultr.com/billing",
  },
  linode: {
    token: "https://cloud.linode.com/profile/tokens",
    billing: "https://cloud.linode.com/account/billing",
  },
};

export function getProviderDisplayName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider as keyof typeof PROVIDER_DISPLAY_NAMES] || provider;
}

export function mapProviderError(error: unknown, provider: string): string {
  const urls = PROVIDER_URLS[provider];
  const displayName = getProviderDisplayName(provider);

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;

    if (status === 401 || status === 403) {
      const tokenUrl = urls?.token || "your provider dashboard";
      return `API token is invalid or expired. Generate a new Read & Write token from ${tokenUrl}`;
    }

    if (status === 402) {
      const billingUrl = urls?.billing || "your provider billing page";
      return `Insufficient account balance. Add funds at ${billingUrl}`;
    }

    if (status === 404) {
      return "Resource not found. The server may have been deleted or the ID is incorrect.";
    }

    if (status === 409) {
      return "Resource conflict. This name or resource may already be in use.";
    }

    if (status === 422) {
      return "Invalid request parameters. Please check your input and try again.";
    }

    if (status === 429) {
      return `${displayName} rate limit exceeded. Wait a moment and try again.`;
    }

    if (status && status >= 500) {
      return `${displayName} API is experiencing issues (HTTP ${status}). Try again later.`;
    }

    // Network errors (no response, only for actual axios errors with a code)
    if (!error.response && error.code) {
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        return `Cannot reach ${displayName} API. Check your internet connection.`;
      }
      if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
        return `${displayName} API request timed out. Check your connection and try again.`;
      }
      return `Network error connecting to ${displayName}. Check your internet connection.`;
    }
  }

  // Check for common error message patterns
  const message = extractReason(error);

  if (/insufficient.*(balance|fund|credit)/i.test(message)) {
    const billingUrl = urls?.billing || "your provider billing page";
    return `Insufficient account balance. Add funds at ${billingUrl}`;
  }

  if (/unavailable|not available|sold out/i.test(message)) {
    return "This server type is not available in the selected region. Try a different size or region.";
  }

  return "";
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

const SSH_ERROR_PATTERNS: { pattern: RegExp; message: (ip?: string) => string }[] = [
  {
    pattern: /Connection refused/i,
    message: () => "SSH connection refused. Is the server running? Check: kastell status",
  },
  {
    pattern: /Permission denied/i,
    message: (ip) =>
      `SSH authentication failed. Verify SSH key: ssh-copy-id root@${ip || "<server-ip>"}`,
  },
  {
    pattern: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i,
    message: (ip) => `Host key changed. Run: ssh-keygen -R ${ip || "<server-ip>"} then retry.`,
  },
  {
    pattern: /No route to host|Network is unreachable/i,
    message: () => "Cannot reach server. Check your internet connection and server IP.",
  },
  {
    pattern: /Connection timed out|Operation timed out/i,
    message: () =>
      "SSH connection timed out. Server may be down or port 22 is blocked by firewall.",
  },
  {
    pattern: /Connection reset/i,
    message: () => "SSH connection reset. The server may be rebooting. Try again shortly.",
  },
  {
    pattern: /Could not resolve hostname/i,
    message: () => "Could not resolve hostname. Check the server IP address.",
  },
  {
    pattern: /dpkg.*lock|locked.*dpkg|Could not get lock/i,
    message: () =>
      "Server is still initializing (dpkg lock active). Wait 1-2 minutes and retry.",
  },
  {
    pattern: /command not found/i,
    message: () => "Required command not found on server. Is the software installed?",
  },
  {
    pattern: /No space left on device/i,
    message: () => "Server disk is full. Free up space or check: kastell monitor",
  },
  {
    pattern: /Broken pipe/i,
    message: () => "SSH connection dropped. The server may be overloaded. Try again.",
  },
];

export function mapSshError(error: unknown, ip?: string): string {
  const message = getErrorMessage(error);
  for (const { pattern, message: getMessage } of SSH_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return getMessage(ip);
    }
  }
  return "";
}

const SENSITIVE_PATTERNS = [
  /\/home\/[^\s/]+/g,        // Home directory paths
  /\/root\/[^\s]+/g,         // Root paths
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // IP addresses in stderr
  /password[=:]\S+/gi,       // Password values
  /token[=:]\S+/gi,          // Token values
  /secret[=:]\S+/gi,         // Secret values
];

export function sanitizeStderr(stderr: string, maxLength: number = 200): string {
  if (!stderr) return "";
  let sanitized = stderr;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + "...";
  }
  return sanitized.trim();
}

const FS_ERROR_CODES: Record<string, string> = {
  ENOENT: "File or directory not found. Check the path and try again.",
  EACCES: "Permission denied. Check file permissions or run with elevated privileges.",
  EPERM: "Permission denied. Check file permissions or run with elevated privileges.",
  ENOSPC: "Disk full. Free up space and try again.",
};

export interface ClassifiedError {
  message: string;
  hint?: string;
  isTyped: boolean;
}

export function classifyError(error: unknown): ClassifiedError {
  if (error == null) return { message: "Unknown error", isTyped: false };
  if (error instanceof ValidationError) {
    return { message: error.hint ?? error.message, isTyped: true };
  }
  if (error instanceof PermissionError) {
    return { message: error.message, hint: 'Check API token permissions or server access', isTyped: true };
  }
  if (error instanceof TransientError) {
    return { message: error.message, hint: 'This may be temporary — retry in a few minutes', isTyped: true };
  }
  if (error instanceof BusinessError) {
    return { message: error.message, hint: error.hint, isTyped: true };
  }
  return { message: getErrorMessage(error), isTyped: false };
}

export function mapFileSystemError(error: unknown): string {
  if (error instanceof Error && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code in FS_ERROR_CODES) {
      return FS_ERROR_CODES[code];
    }
  }
  return "";
}
