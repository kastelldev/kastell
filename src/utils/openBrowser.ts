import { execFile } from "child_process";
import { sanitizedEnv } from "./ssh.js";

const SAFE_URL_PATTERN = /^https?:\/\/[\d.]+(?::\d+)?\/?$/;

function isHeadlessEnvironment(): boolean {
  // CI environments
  if (process.env.CI || process.env.GITHUB_ACTIONS) return true;
  // Docker / containers
  if (process.env.DOCKER_CONTAINER || process.env.container) return true;
  // SSH sessions
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return true;
  // Linux without display
  if (
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY
  ) {
    return true;
  }
  return false;
}

function getOpenCommand(): string | null {
  switch (process.platform) {
    case "darwin":
      return "open";
    case "win32":
      return "start";
    case "linux":
      return "xdg-open";
    default:
      return null;
  }
}

export function isValidBrowserUrl(url: string): boolean {
  if (!SAFE_URL_PATTERN.test(url)) return false;
  // Reject placeholder/unassigned IP addresses
  if (url.includes("://0.0.0.0")) return false;
  return true;
}

export function canOpenBrowser(): boolean {
  if (isHeadlessEnvironment()) return false;
  return getOpenCommand() !== null;
}

export function openBrowser(url: string): void {
  if (!isValidBrowserUrl(url)) return;
  if (!canOpenBrowser()) return;

  const command = getOpenCommand();
  /* istanbul ignore next */
  if (!command) return;

  // Use execFile to avoid shell interpretation (no injection risk)
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];
  const bin = process.platform === "win32" ? "cmd" : command;

  execFile(bin, args, { env: sanitizedEnv() }, () => {
    // Silent failure by design — browser open is best-effort
  });
}
