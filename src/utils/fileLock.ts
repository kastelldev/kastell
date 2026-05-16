import { mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { hostname } from "os";

const STALE_THRESHOLD_MS = 30_000;
// Reclaim even when probeProcess reports "alive" (guards against clock drift, zombies, PID reuse).
const HARD_CEILING_MS = 60_000;

/** Module-local wrapper for testability — DO NOT inline `process.kill`. */
export function probeProcess(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    return "unknown";
  }
}

interface ParsedPidFile {
  pid: number;
  host: string;
}

function readPidFile(lockDir: string): ParsedPidFile | null {
  try {
    const raw = readFileSync(join(lockDir, "owner.pid"), "utf-8");
    const parts = raw.split("@");
    if (parts.length !== 3) return null;
    const pid = parseInt(parts[0], 10);
    if (isNaN(pid) || pid <= 0) return null;
    return { pid, host: parts[1] };
  } catch {
    return null;
  }
}

type ProbeFn = (pid: number) => "alive" | "dead" | "unknown";

function shouldReclaimStaleLock(lockDir: string, probe: ProbeFn): boolean {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockDir).mtimeMs;
  } catch {
    return false; // lock disappeared between checks
  }
  const age = Date.now() - mtimeMs;
  const parsed = readPidFile(lockDir);

  if (parsed && parsed.host === hostname()) {
    const liveness = probe(parsed.pid);
    if (liveness === "dead") return true;
    if (liveness === "alive") return age > HARD_CEILING_MS;
    // "unknown" → mtime fallback (aggressive: STALE_THRESHOLD_MS)
  }
  // farklı hostname, parse fail, PID file yok, veya "unknown" → mtime fallback
  return age > STALE_THRESHOLD_MS;
}

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
  probe: ProbeFn = probeProcess,
): Promise<T> {
  const lockDir = filePath + ".lock";
  const maxRetries = 10;
  const retryDelay = 200;

  mkdirSync(dirname(lockDir), { recursive: true });

  for (let i = 0; i < maxRetries; i++) {
    try {
      mkdirSync(lockDir);
      try {
        try {
          writeFileSync(
            join(lockDir, "owner.pid"),
            `${process.pid}@${hostname()}@${Date.now()}`,
            { encoding: "utf-8" },
          );
        } catch {
          /* best effort — if PID write fails, mtime fallback still protects */
        }
        return await fn();
      } finally {
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        if (shouldReclaimStaleLock(lockDir, probe)) {
          try {
            rmSync(lockDir, { recursive: true, force: true });
          } catch {
            /* best effort, retry */
          }
          continue;
        }
        await new Promise((r) => setTimeout(r, retryDelay));
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Could not acquire lock on ${filePath} after ${maxRetries} retries`,
  );
}

/** Warn on stderr if a caught error is a permission issue. Returns true if it was a permission error. */
export function warnIfPermissionError(err: unknown, label: string): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") {
    process.stderr.write(`Warning: cannot read ${label} — ${code}\n`);
    return true;
  }
  return false;
}
