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
  // 1. Resolve current Windows identity (e.g. "DOMAIN\user")
  const whoami = runSpawn("whoami", []);
  if (whoami.status !== 0) {
    const err = buildAclError(
      targetPath,
      {
        executable: "whoami",
        status: whoami.status,
        stderr: whoami.stderr,
        cause: whoami.error,
      },
      sensitivity,
    );
    handleAclFailure(err, sensitivity);
    return;
  }
  const identity = whoami.stdout.trim();
  if (!identity) {
    const err = buildAclError(
      targetPath,
      {
        executable: "whoami",
        status: 0,
        stderr: "empty identity",
      },
      sensitivity,
    );
    handleAclFailure(err, sensitivity);
    return;
  }

  const inheritance = runSpawn("icacls", [targetPath, "/inheritance:r", "/Q"]);
  if (inheritance.status !== 0) {
    const err = buildAclError(
      targetPath,
      {
        executable: "icacls",
        status: inheritance.status,
        stderr: inheritance.stderr,
        cause: inheritance.error,
      },
      sensitivity,
    );
    handleAclFailure(err, sensitivity);
    return;
  }

  const inspect = runSpawn("icacls", [targetPath]);
  if (inspect.status !== 0) {
    const err = buildAclError(
      targetPath,
      {
        executable: "icacls",
        status: inspect.status,
        stderr: inspect.stderr,
        cause: inspect.error,
      },
      sensitivity,
    );
    handleAclFailure(err, sensitivity);
    return;
  }

  let removalFailure: AclFailure | undefined;
  for (const principal of new Set(aclPrincipals(targetPath, inspect.stdout))) {
    const remove = runSpawn("icacls", [
      targetPath,
      "/remove",
      icaclsIdentity(principal),
      "/Q",
    ]);
    if (remove.status !== 0) {
      removalFailure ??= {
        executable: "icacls",
        status: remove.status,
        stderr: remove.stderr,
        cause: remove.error,
      };
    }
  }

  const grant = runSpawn("icacls", [
    targetPath,
    "/grant:r",
    `${identity}:(F)`,
    "/Q",
  ]);
  if (grant.status !== 0) {
    const err = buildAclError(
      targetPath,
      {
        executable: "icacls",
        status: grant.status,
        stderr: grant.stderr,
        cause: grant.error,
      },
      sensitivity,
    );
    handleAclFailure(err, sensitivity);
    return;
  }

  const verify = runSpawn("icacls", [targetPath]);
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
