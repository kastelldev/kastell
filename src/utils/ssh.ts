import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import type { SshCommand } from "./sshCommand.js";
import { sanitizeStderr } from "./errorMapper.js";

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

/**
 * Resolve ssh-keygen binary path from the resolved SSH path.
 */
function resolveSshKeygenPath(): string {
  const sshPath = resolveSshPath();
  if (sshPath === "ssh") return "ssh-keygen";
  const dir = dirname(sshPath);
  const ext = sshPath.endsWith(".exe") ? ".exe" : "";
  return join(dir, `ssh-keygen${ext}`);
}

/**
 * Remove stale host key for an IP from known_hosts.
 * Best-effort — failures are silently ignored.
 */
export function clearKnownHostKey(ip: string): void {
  assertValidIp(ip);
  spawnSync(resolveSshKeygenPath(), ["-R", ip], { stdio: "ignore", env: sanitizedEnv() });
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
  // Use resolved path — bare "ssh-keygen" may not be on PATH in MCP environments.
  // spawnSync with separate args prevents shell injection (defense-in-depth).
  spawnSync(resolveSshKeygenPath(), ["-R", ip], { stdio: "ignore", env: sanitizedEnv() });
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
  command: SshCommand,
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
  command: SshCommand,
  retried: boolean,
  timeoutMs: number = SSH_EXEC_TIMEOUT_MS,
  useStdin: boolean = false,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const effectiveTimeout = timeoutMs > 0 ? timeoutMs : SSH_EXEC_TIMEOUT_MS;
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
    // ControlMaster args are injected when a master connection is active for this IP.
    const sshArgs = [
      "-o", `StrictHostKeyChecking=${getHostKeyPolicy()}`,
      "-o", "BatchMode=yes",
      "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
      ...getControlArgs(ip),
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
      finish({ code: 1, stdout, stderr: stderr || `SSH command timed out after ${effectiveTimeout / 1000}s` });
    }, effectiveTimeout);

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
      // Some Windows SSH binaries return non-zero when SSH banners are present
      // even though the command succeeded. If stdout has content and stderr is
      // only a banner (no error keywords), treat as success.
      let exitCode = code ?? 1;
      if (exitCode !== 0 && stdout.trim().length > 0 && stderr.length > 0
        && !stderr.includes("Permission denied") && !stderr.includes("Connection refused")
        && !stderr.includes("Host key") && !stderr.includes("No route")
        && !stderr.includes("timed out") && !stderr.includes("REMOTE HOST IDENTIFICATION")) {
        exitCode = 0;
      }
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
        }).catch((err: Error) => resolve({ code: 1, stdout: "", stderr: sanitizeStderr(err.message) }));
      } else {
        finish({ code: exitCode, stdout, stderr });
      }
    });
    child.on("error", (err) => finish({ code: 1, stdout: "", stderr: sanitizeStderr(err.message) }));
  });
}

export function sshExec(
  ip: string,
  command: SshCommand,
  opts?: { timeoutMs?: number; useStdin?: boolean },
): Promise<{ code: number; stdout: string; stderr: string }> {
  assertValidIp(ip);
  return sshExecInner(ip, command, false, opts?.timeoutMs ?? SSH_EXEC_TIMEOUT_MS, opts?.useStdin ?? false);
}

// ─── SSH ControlMaster (connection multiplexing) ─────────────────────────────

/** Active master socket paths keyed by IP */
const activeMasters = new Map<string, string>();

function controlSocketPath(ip: string): string {
  // Use /tmp on Unix and Git Bash (Windows). SSH ControlPath requires
  // Unix-style paths — Node's os.tmpdir() returns Windows backslash paths
  // which SSH cannot use as socket paths.
  const dir = process.platform === "win32" ? "/tmp/kastell-ssh" : join(tmpdir(), "kastell-ssh");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return `${dir}/master-${ip}`;
}

/**
 * Open a persistent SSH master connection for the given IP.
 * Subsequent sshExec calls to the same IP will reuse this connection
 * instead of opening new TCP+SSH handshakes (prevents MaxStartups exhaustion).
 */
export async function sshMasterOpen(ip: string): Promise<boolean> {
  assertValidIp(ip);
  if (activeMasters.has(ip)) return true;

  const socketPath = controlSocketPath(ip);
  const sshBin = resolveSshPath();

  // Clean up stale socket from previous run (existsSync unreliable for sockets on Windows)
  spawnSync(sshBin, ["-o", `ControlPath=${socketPath}`, "-O", "exit", `root@${ip}`],
    { stdio: "ignore", timeout: 3000, env: sanitizedEnv() });

  return new Promise((resolve) => {
    const child = spawn(sshBin, [
      "-o", `StrictHostKeyChecking=${getHostKeyPolicy()}`,
      "-o", "BatchMode=yes",
      "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
      "-o", "ControlMaster=yes",
      "-o", `ControlPath=${socketPath}`,
      "-o", "ControlPersist=300",
      "-N",
      `root@${ip}`,
    ], {
      stdio: "ignore",
      detached: true,
      env: sanitizedEnv(),
    });

    let spawnFailed = false;
    child.on("error", () => { spawnFailed = true; });
    // Note: child.on("close") fires when the parent SSH forks into background (exit 0).
    // This does NOT mean the master failed — it means it daemonized. Only trust -O check.

    // Give master time to establish, then verify with -O check
    setTimeout(() => {
      if (spawnFailed) { resolve(false); return; }

      // Verify master is alive via -O check (existsSync fails for Unix sockets on Windows)
      const check = spawnSync(sshBin, [
        "-o", `ControlPath=${socketPath}`,
        "-O", "check",
        `root@${ip}`,
      ], { stdio: "pipe", timeout: 5000, env: sanitizedEnv() });

      if (check.status === 0) {
        activeMasters.set(ip, socketPath);
        child.unref();
        resolve(true);
      } else {
        killChild(child);
        resolve(false);
      }
    }, 3000);
  });
}

/**
 * Close the SSH master connection for the given IP.
 */
export function sshMasterClose(ip: string): void {
  const socketPath = activeMasters.get(ip);
  if (!socketPath) return;

  try {
    const sshBin = resolveSshPath();
    spawnSync(sshBin, [
      "-o", `ControlPath=${socketPath}`,
      "-O", "exit",
      `root@${ip}`,
    ], { stdio: "ignore", timeout: 5000, env: sanitizedEnv() });
  } catch {
    // Best-effort cleanup
  }
  activeMasters.delete(ip);
}

/** Returns ControlPath args if a master is active for this IP */
export function getControlArgs(ip: string): string[] {
  const socketPath = activeMasters.get(ip);
  if (!socketPath) return [];
  return ["-o", "ControlMaster=no", "-o", `ControlPath=${socketPath}`];
}
