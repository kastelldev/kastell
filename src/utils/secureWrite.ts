import { writeFileSync, appendFileSync, mkdirSync, chmodSync } from "fs";
import { spawnSync } from "child_process";
import { isWindows } from "./platform.js";
import { logger } from "./logger.js";

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  flag?: string;
}

// ─── Sensitivity classification (P142 Task 6) ─────────────────────────────────
//
// "secret" — credential material, machine keys, encrypted payloads.
//             ACL failure must THROW so the caller knows secrets were written
//             with insufficient protection.
// "state"  — non-secret metadata (channel flags, machine ID fallback file,
//             log/audit data). ACL failure WARNS — the file is still written
//             and the operation is best-effort durable.
export type PermissionSensitivity = "state" | "secret";

export interface SecureWriteOptions extends WriteFileOptions {
  sensitivity?: PermissionSensitivity;
}

const securedDirs = new Set<string>();

export function clearCache(): void {
  securedDirs.clear();
}

function stripSensitivity(opts: SecureWriteOptions | undefined): WriteFileOptions | undefined {
  if (!opts) return opts;
  // sensitivity is consumed by secureWrite — never forwarded to fs
  const { sensitivity: _sensitivity, ...rest } = opts;
  void _sensitivity;
  if (Object.keys(rest).length === 0) return undefined;
  return rest;
}

// ─── POSIX permission application (existing) ─────────────────────────────────

function applyPosixPermissions(targetPath: string, mode: 0o600 | 0o700): void {
  chmodSync(targetPath, mode);
}

// ─── Windows ACL application (P142 Task 6) ────────────────────────────────────
//
// Use spawnSync with array args (NO shell, NO command string concat) to:
//   1. Resolve current Windows identity via `whoami`
//   2. Disable inheritance
//   3. Remove every explicit DACL principal
//   4. Add one current-user full-control rule and verify the result
//
// Failure policy is controlled by the caller via the `sensitivity` argument:
//   - "secret" → THROWS (caller must know secrets are weakly protected)
//   - "state"  → WARNS  (file is still written, ACL hardening is best-effort)

interface AclFailure {
  executable: string;
  status: number | null;
  stderr: string;
  cause?: unknown;
}

function buildAclError(
  targetPath: string,
  failure: AclFailure,
  sensitivity: PermissionSensitivity,
): Error {
  const action =
    sensitivity === "secret"
      ? `Cannot write secret file ${targetPath} without owner-only ACL`
      : `Failed to harden ACL on ${targetPath}`;
  const detail = `${failure.executable} exited with status ${failure.status ?? "null"}: ${failure.stderr}`;
  const err = new Error(`${action} — ${detail}`);
  // preserve-caught-error: keep the original process error as cause
  if (failure.cause !== undefined) {
    (err as unknown as { cause?: unknown }).cause = failure.cause;
  }
  return err;
}

function runSpawn(executable: string, args: string[]): { status: number | null; stdout: string; stderr: string; error?: unknown } {
  // Argument-safe invocation: array args, no shell, no command string concat.
  const result = spawnSync(executable, args, { encoding: "utf8" });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    error: result.error,
  };
}

// ─── Cached Windows identity (P143-F Task 8) ──────────────────────────────────
//
// `whoami` is the first ACL step in `applyWindowsAcl`. Spawning a child
// process on every secure write is wasteful; resolve once per process
// lifetime. The cache is process-local (module-level) and exposed with a
// test-only reset hook so unit tests can observe the first-call / cached
// boundary cleanly.

let cachedIdentity: string | null = null;

/**
 * Resolve the current Windows identity (`DOMAIN\user` form) using `whoami`.
 * The result is cached for the process lifetime — the first call invokes
 * the binary, subsequent calls return the cached value. Throws on the
 * first call if `whoami` exits non-zero so the caller can dispatch the
 * failure via the sensitivity policy.
 */
export function getCurrentWindowsIdentity(): string {
  if (cachedIdentity === null) {
    const result = runSpawn("whoami", []);
    if (result.status !== 0) {
      throw new Error(`whoami failed with status ${result.status ?? "null"}: ${result.stderr}`);
    }
    cachedIdentity = result.stdout.trim();
  }
  return cachedIdentity;
}

/**
 * Reset the cached Windows identity. Test-only hook — production code
 * must not call this.
 */
export function resetWindowsIdentityCacheForTesting(): void {
  cachedIdentity = null;
}

// ─── ACL step helper (P143-F Task 8) ─────────────────────────────────────────
//
// Centralises the argument-safe spawn + failure-policy dispatch that every
// `applyWindowsAcl` substep shares. On success, the spawn result is returned.
// On failure, the error is built and dispatched by sensitivity:
//   - "secret" → THROW (caller must know secrets were written weakly)
//   - "state"  → WARN  (file is still written, ACL hardening is best-effort)

interface AclStepResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: unknown;
}

function runAclStep(
  executable: string,
  args: readonly string[],
  targetPath: string,
  sensitivity: PermissionSensitivity,
): AclStepResult {
  const result = runSpawn(executable, [...args]);
  if (result.status === 0) return result;
  handleAclFailure(
    buildAclError(targetPath, {
      executable,
      status: result.status,
      stderr: result.stderr,
      cause: result.error,
    }, sensitivity),
    sensitivity,
  );
  return result;
}

function aclPrincipals(targetPath: string, output: string): string[] {
  const normalizedTarget = targetPath.toLowerCase();
  const principals: string[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.toLowerCase().startsWith(normalizedTarget)) {
      line = line.slice(targetPath.length).trim();
    }
    const match = /^(.+?):\(/.exec(line);
    if (match) principals.push(match[1].trim());
  }

  return principals;
}

function icaclsIdentity(identity: string): string {
  const logonSession = /\\LogonSessionId_(\d+)_(\d+)$/i.exec(identity);
  if (logonSession) {
    return `*S-1-5-5-${logonSession[1]}-${logonSession[2]}`;
  }
  return /^S-\d(?:-\d+)+$/i.test(identity) ? `*${identity}` : identity;
}

function applyWindowsAcl(
  targetPath: string,
  sensitivity: PermissionSensitivity,
): void {
  // 1. Resolve current Windows identity (e.g. "DOMAIN\user") — cached.
  let identity: string;
  try {
    identity = getCurrentWindowsIdentity();
  } catch (cause) {
    // First whoami call failed; surface as ACL error with the original
    // spawn error preserved as cause.
    const whoami = runSpawn("whoami", []);
    handleAclFailure(
      buildAclError(
        targetPath,
        {
          executable: "whoami",
          status: whoami.status,
          stderr: whoami.stderr || "empty identity",
          cause: whoami.error ?? cause,
        },
        sensitivity,
      ),
      sensitivity,
    );
    return;
  }
  if (!identity) {
    handleAclFailure(
      buildAclError(
        targetPath,
        { executable: "whoami", status: 0, stderr: "empty identity" },
        sensitivity,
      ),
      sensitivity,
    );
    return;
  }

  // 2. Disable inheritance.
  if (runAclStep("icacls", [targetPath, "/inheritance:r", "/Q"], targetPath, sensitivity).status !== 0) {
    return;
  }

  // 3. Inspect current principals.
  const inspect = runAclStep("icacls", [targetPath], targetPath, sensitivity);
  if (inspect.status !== 0) {
    return;
  }

  // 4. Remove every existing principal.
  let removalFailure: AclFailure | undefined;
  for (const principal of new Set(aclPrincipals(targetPath, inspect.stdout))) {
    const remove = runAclStep(
      "icacls",
      [targetPath, "/remove", icaclsIdentity(principal), "/Q"],
      targetPath,
      sensitivity,
    );
    if (remove.status !== 0) {
      removalFailure ??= {
        executable: "icacls",
        status: remove.status,
        stderr: remove.stderr,
        cause: remove.error,
      };
    }
  }

  // 5. Grant current user full control.
  if (
    runAclStep(
      "icacls",
      [targetPath, "/grant:r", `${identity}:(F)`, "/Q"],
      targetPath,
      sensitivity,
    ).status !== 0
  ) {
    return;
  }

  // 6. Verify the resulting ACL is owner-only.
  const verify = runAclStep("icacls", [targetPath], targetPath, sensitivity);
  const principals = aclPrincipals(targetPath, verify.stdout);
  if (
    verify.status !== 0 ||
    principals.length !== 1 ||
    principals[0].toLowerCase() !== identity.toLowerCase() ||
    !verify.stdout.toLowerCase().includes(`${identity.toLowerCase()}:(f)`)
  ) {
    const err = buildAclError(
      targetPath,
      {
        executable: "icacls",
        status: verify.status,
        stderr:
          verify.stderr ||
          removalFailure?.stderr ||
          "owner-only ACL verification failed",
        cause: verify.error ?? removalFailure?.cause,
      },
      sensitivity,
    );
    handleAclFailure(err, sensitivity);
  }
}

function handleAclFailure(err: Error, sensitivity: PermissionSensitivity): never | void {
  if (sensitivity === "secret") {
    throw err;
  }
  // state sensitivity: warn, preserve cause on the internal error, return normally
  logger.warning(err.message);
}

function applyPermissions(
  targetPath: string,
  mode: 0o600 | 0o700,
  sensitivity: PermissionSensitivity,
): void {
  if (isWindows()) {
    applyWindowsAcl(targetPath, sensitivity);
    return;
  }
  applyPosixPermissions(targetPath, mode);
}

export function ensureSecureDir(dirPath: string): void {
  if (securedDirs.has(dirPath)) {
    return;
  }
  applyPermissions(dirPath, 0o700, "state");
  securedDirs.add(dirPath);
}

export function secureWriteFileSync(
  filePath: string,
  data: string,
  options?: SecureWriteOptions,
): void {
  const sensitivity: PermissionSensitivity = options?.sensitivity ?? "state";
  const fsOptions = stripSensitivity(options);
  writeFileSync(filePath, data, fsOptions);
  applyPermissions(filePath, 0o600, sensitivity);
}

export function secureAppendFileSync(
  filePath: string,
  data: string,
  options?: SecureWriteOptions,
): void {
  // mode is applied on create by the kernel; subsequent appends preserve
  // the existing inode mode. Avoids a chmodSync syscall per log line.
  const fsOptions = stripSensitivity(options);
  appendFileSync(filePath, data, { ...fsOptions, mode: 0o600 });
}

export function secureMkdirSync(
  dirPath: string,
  options?: { recursive?: boolean },
): void {
  mkdirSync(dirPath, { recursive: options?.recursive ?? true });
  ensureSecureDir(dirPath);
}
