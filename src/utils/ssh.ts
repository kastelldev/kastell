import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import type { SshCommand } from "./sshCommand.js";

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

  // Try default PATH first (spawnSync avoids shell invocation)
  const probe = spawnSync("ssh", ["-V"], { stdio: "pipe" });
  if (probe.status === 0) {
    cachedSshPath = "ssh";
    return cachedSshPath;
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
  const sshBin = resolveSshPath();
  // spawnSync avoids shell invocation — pass binary and args separately
  const result = spawnSync(sshBin, ["-V"], { stdio: "pipe" });
  return result.status === 0;
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
  // Always block loopback and special addresses
  if (ip === "0.0.0.0" || ip.startsWith("127.")) {
    throw new Error(`Reserved IP address not allowed`);
  }
  // Block private/reserved ranges unless explicitly allowed (homelab, dev)
  if (process.env.KASTELL_ALLOW_PRIVATE_IPS !== "true") {
    if (
      ip.startsWith("10.") ||
      ip.startsWith("192.168.") ||
      ip.startsWith("169.254.") ||
      octets[0] === 224 ||
      octets[0] >= 240
    ) {
      throw new Error(`Private/reserved IP address not allowed. Set KASTELL_ALLOW_PRIVATE_IPS=true to allow.`);
    }
    // 172.16.0.0 - 172.31.255.255 (RFC 1918)
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      throw new Error(`Private/reserved IP address not allowed. Set KASTELL_ALLOW_PRIVATE_IPS=true to allow.`);
    }
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
  // spawnSync with separate args prevents shell injection of ip (defense-in-depth,
  // even though assertValidIp() already validates the format above)
  spawnSync("ssh-keygen", ["-R", ip], { stdio: "ignore", env: sanitizedEnv() });
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

function sshStreamInner(
  ip: string,
  command: string | SshCommand,
  retried: boolean,
  useStdin: boolean = false,
): Promise<number> {
  const sshBin = resolveSshPath();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };

    // When useStdin is true, pipe the command via stdin to avoid Windows
    // argument escaping issues (same pattern as sshExecInner).
    const sshArgs = [
      "-o", `StrictHostKeyChecking=${getHostKeyPolicy()}`,
      "-o", "BatchMode=yes",
      "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
      `root@${ip}`,
      ...(useStdin ? ["bash", "-s"] : [command]),
    ];

    const child = spawn(
      sshBin,
      sshArgs,
      {
        // stdin: "pipe" when useStdin (we write the command), otherwise "ignore".
        // "ignore" prevents MCP stdin (JSON-RPC) from leaking into SSH.
        stdio: [useStdin ? "pipe" : "ignore", "inherit", "pipe"],
        env: sanitizedEnv(),
      },
    );

    if (useStdin) {
      child.stdin?.write(command);
      child.stdin?.end();
    }

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
        resolve(sshStreamInner(ip, command, true, useStdin));
      } else {
        finish(exitCode);
      }
    });
    child.on("error", () => finish(1));
  });
}

export function sshStream(
  ip: string,
  command: string | SshCommand,
  opts?: { useStdin?: boolean },
): Promise<number> {
  assertValidIp(ip);
  return sshStreamInner(ip, command, false, opts?.useStdin ?? false);
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
  command: string | SshCommand,
  retried: boolean,
  timeoutMs: number = SSH_EXEC_TIMEOUT_MS,
  useStdin: boolean = false,
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

    // When useStdin is true, pipe the command via stdin to avoid Windows
    // argument escaping that corrupts long multi-line commands with special chars.
    // SSH receives "bash -s" as remote command, actual script arrives via stdin.
    const sshArgs = [
      "-o", `StrictHostKeyChecking=${getHostKeyPolicy()}`,
      "-o", "BatchMode=yes",
      "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
      `root@${ip}`,
      ...(useStdin ? ["bash", "-s"] : [command]),
    ];

    const child = spawn(
      sshBin,
      sshArgs,
      {
        // stdin: "pipe" when useStdin (we write the command), otherwise "ignore".
        // "ignore" prevents MCP stdin (JSON-RPC) from leaking into SSH.
        stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
        env: sanitizedEnv(),
      },
    );

    if (useStdin) {
      child.stdin?.write(command);
      child.stdin?.end();
    }

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
        // Retry once after clearing stale key; if retry fails, append remediation hint
        sshExecInner(ip, command, true, timeoutMs, useStdin).then((retryResult) => {
          if (retryResult.code !== 0 && isHostKeyMismatch(retryResult.stderr)) {
            retryResult.stderr += `\nHint: Run "ssh-keygen -R ${ip}" to remove the stale host key, then retry.`;
          }
          resolve(retryResult);
        });
      } else {
        finish({ code: exitCode, stdout, stderr });
      }
    });
    child.on("error", (err) => finish({ code: 1, stdout: "", stderr: err.message }));
  });
}

export function sshExec(
  ip: string,
  command: string | SshCommand,
  opts?: { timeoutMs?: number; useStdin?: boolean },
): Promise<{ code: number; stdout: string; stderr: string }> {
  assertValidIp(ip);
  return sshExecInner(ip, command, false, opts?.timeoutMs ?? SSH_EXEC_TIMEOUT_MS, opts?.useStdin ?? false);
}
