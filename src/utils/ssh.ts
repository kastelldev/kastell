import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";

/** Default SSH connect timeout in seconds */
const SSH_CONNECT_TIMEOUT = 10;
/** Default SSH command execution timeout in milliseconds (30s) */
const SSH_EXEC_TIMEOUT_MS = 30_000;
/** Max stdout/stderr buffer size in bytes (1MB) */
const MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * Returns the SSH StrictHostKeyChecking policy.
 * Set KASTELL_STRICT_HOST_KEY=true to reject unknown host keys (more secure, requires manual key management).
 * Default: "accept-new" (TOFU — trust on first use, verify on subsequent connections).
 */
export function getHostKeyPolicy(): string {
  return process.env.KASTELL_STRICT_HOST_KEY === "true" ? "yes" : "accept-new";
}

let cachedSshPath: string | null = null;

export function resolveSshPath(): string {
  if (cachedSshPath) return cachedSshPath;

  // Try default PATH first
  try {
    execSync("ssh -V", { stdio: "pipe" });
    cachedSshPath = "ssh";
    return cachedSshPath;
  } catch {
    // Not in PATH, try common locations
  }

  // Windows common SSH locations
  if (process.platform === "win32") {
    const candidates = [
      join(process.env.SystemRoot || "C:\\Windows", "System32", "OpenSSH", "ssh.exe"),
      join(process.env.ProgramFiles || "C:\\Program Files", "OpenSSH", "ssh.exe"),
      join(process.env.LOCALAPPDATA || "", "Programs", "Git", "usr", "bin", "ssh.exe"),
      join(process.env.ProgramFiles || "C:\\Program Files", "Git", "usr", "bin", "ssh.exe"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        cachedSshPath = candidate;
        return cachedSshPath;
      }
    }
  }

  // Fallback — return "ssh" and let it fail with a clearer error
  cachedSshPath = "ssh";
  return cachedSshPath;
}

export function resolveScpPath(): string {
  const sshPath = resolveSshPath();
  if (sshPath === "ssh") return "scp";
  // Derive SCP binary from SSH binary path (sibling in same directory)
  const dir = dirname(sshPath);
  const ext = sshPath.endsWith(".exe") ? ".exe" : "";
  return join(dir, `scp${ext}`);
}

export function checkSshAvailable(): boolean {
  try {
    const sshBin = resolveSshPath();
    execSync(`"${sshBin}" -V`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function assertValidIp(ip: string): void {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new Error(`Invalid IP address format`);
  }
  const parts = ip.split(".");
  // Reject leading zeros to prevent octal interpretation (e.g., 010 = 8)
  if (parts.some((p) => p.length > 1 && p.startsWith("0"))) {
    throw new Error(`Invalid IP address: leading zeros not allowed`);
  }
  const octets = parts.map(Number);
  if (octets.some((o) => o < 0 || o > 255)) {
    throw new Error(`Invalid IP address: octets must be 0-255`);
  }
}

export function sanitizedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (
      upper.includes("TOKEN") ||
      upper.includes("SECRET") ||
      upper.includes("PASSWORD") ||
      upper.includes("CREDENTIAL")
    ) {
      delete env[key];
    }
  }
  return env;
}

/**
 * Removes stale host key entry for the given IP from known_hosts.
 * Silently ignores errors (ssh-keygen not available or no entry).
 * IP is validated before use to prevent command injection.
 */
export function removeStaleHostKey(ip: string): void {
  assertValidIp(ip);
  try {
    execSync(`ssh-keygen -R "${ip}"`, { stdio: "ignore", env: sanitizedEnv() });
  } catch {
    // Silently ignore — ssh-keygen may not be available or no entry exists
  }
}

export const HOST_KEY_PATTERN = /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i;

export function isHostKeyMismatch(stderr: string): boolean {
  return HOST_KEY_PATTERN.test(stderr);
}

export function sshConnect(ip: string): Promise<number> {
  assertValidIp(ip);
  const sshBin = resolveSshPath();
  return new Promise((resolve) => {
    const child = spawn(
      sshBin,
      [
        "-o", `StrictHostKeyChecking=${getHostKeyPolicy()}`,
        "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
        `root@${ip}`,
      ],
      {
        stdio: "inherit",
        env: sanitizedEnv(),
      },
    );
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });
}

function sshStreamInner(ip: string, command: string, retried: boolean): Promise<number> {
  const sshBin = resolveSshPath();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };

    const child = spawn(
      sshBin,
      [
        "-o", `StrictHostKeyChecking=${getHostKeyPolicy()}`,
        "-o", "BatchMode=yes",
        "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
        `root@${ip}`,
        command,
      ],
      {
        // stdin "ignore" — streaming commands don't need user input.
        // Also prevents MCP stdin (JSON-RPC) from leaking into SSH.
        stdio: ["ignore", "inherit", "pipe"],
        env: sanitizedEnv(),
      },
    );

    // Process-level timeout for stream operations (longer: 120s for interactive use)
    const timer = setTimeout(() => {
      killChild(child);
      finish(1);
    }, 120_000);

    let stderr = "";
    child.stderr?.on("data", (data: Buffer) => {
      // Cap stderr buffer — only need enough for host key pattern detection
      if (stderr.length < 4096) {
        stderr += data.toString();
      }
    });
    child.on("close", (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0 && !retried && isHostKeyMismatch(stderr)) {
        removeStaleHostKey(ip);
        clearTimeout(timer);
        settled = true;
        resolve(sshStreamInner(ip, command, true));
      } else {
        finish(exitCode);
      }
    });
    child.on("error", () => finish(1));
  });
}

export function sshStream(ip: string, command: string): Promise<number> {
  assertValidIp(ip);
  return sshStreamInner(ip, command, false);
}

function killChild(child: ChildProcess): void {
  try {
    child.kill("SIGTERM");
    // Force kill after 2s if still alive
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, 2000);
  } catch { /* already dead */ }
}

function sshExecInner(
  ip: string,
  command: string,
  retried: boolean,
  timeoutMs: number = SSH_EXEC_TIMEOUT_MS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const sshBin = resolveSshPath();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(
      sshBin,
      [
        "-o", `StrictHostKeyChecking=${getHostKeyPolicy()}`,
        "-o", "BatchMode=yes",
        "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
        `root@${ip}`,
        command,
      ],
      {
        // stdin must be "ignore" — not "inherit". MCP uses stdin for JSON-RPC transport;
        // inheriting it would let SSH read MCP messages, causing silent failures.
        stdio: ["ignore", "pipe", "pipe"],
        env: sanitizedEnv(),
      },
    );

    // Process-level timeout — kill SSH if it takes too long
    const timer = setTimeout(() => {
      killChild(child);
      finish({ code: 1, stdout, stderr: stderr || `SSH command timed out after ${timeoutMs / 1000}s` });
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data: Buffer) => {
      if (stdout.length < MAX_BUFFER_SIZE) {
        stdout += data.toString();
      }
    });
    child.stderr?.on("data", (data: Buffer) => {
      if (stderr.length < MAX_BUFFER_SIZE) {
        stderr += data.toString();
      }
    });
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !retried && isHostKeyMismatch(stderr)) {
        removeStaleHostKey(ip);
        clearTimeout(timer);
        settled = true;
        resolve(sshExecInner(ip, command, true, timeoutMs));
      } else {
        finish({ code: exitCode, stdout, stderr });
      }
    });
    child.on("error", (err) => finish({ code: 1, stdout: "", stderr: err.message }));
  });
}

export function sshExec(
  ip: string,
  command: string,
  opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  assertValidIp(ip);
  return sshExecInner(ip, command, false, opts?.timeoutMs ?? SSH_EXEC_TIMEOUT_MS);
}
