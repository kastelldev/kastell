/**
 * AUD-TMP-MODE-ACTIVE — Plugin API v3 Active Probe lifecycle example.
 *
 * Demonstrates a deterministic, session-scoped /tmp file mode round-trip on
 * the REMOTE Linux server reached through the controlled SSH surface. The
 * probe never touches the local test runner's temp directory.
 *
 * Lifecycle:
 *   prepare  -> derive one session-scoped path under /tmp; confirm it
 *               does not already exist (rejects reuse of an existing file).
 *   execute  -> create only that file with mode 0600 and a non-secret
 *               marker derived from the UUID session ID.
 *   verify   -> confirm ownership, mode, and marker through the controlled
 *               SSH surface.
 *   rollback -> idempotently remove only the prepared session-scoped path.
 *
 * No top-level side effects: importing this module must not invoke any
 * shell commands. The probe is documentation/example code only; no
 * production dispatcher calls it.
 */

import { createHash } from "node:crypto";

const REMOTE_TMP_DIR = "/tmp";
const PROBE_FILE_PREFIX = "kastell-probe-";
const PROBE_FILE_MODE = "0600";
const PROBE_MARKER_PREFIX = "kastell-probe-marker:";

/**
 * Derive a deterministic, session-scoped file path under /tmp.
 * Only the session ID participates in the digest; the result is reproducible
 * across the four lifecycle calls for the same session.
 */
function deriveSessionPath(sessionId) {
  const digest = createHash("sha256")
    .update(sessionId)
    .digest("hex")
    .slice(0, 24);
  return `${REMOTE_TMP_DIR}/${PROBE_FILE_PREFIX}${digest}.tmp`;
}

function deriveMarker(sessionId) {
  const digest = createHash("sha256")
    .update(sessionId)
    .digest("hex")
    .slice(0, 32);
  return `${PROBE_MARKER_PREFIX}${digest}`;
}

async function pathExists(ssh, path) {
  const result = await ssh(`test -e ${path} && echo present || echo absent`, {
    timeoutMs: 5_000,
  });
  return result.code === 0 && result.stdout.trim() === "present";
}

async function readMode(ssh, path) {
  const result = await ssh(`stat -c %a ${path}`, { timeoutMs: 5_000 });
  if (result.code !== 0) return null;
  return result.stdout.trim();
}

async function readOwner(ssh, path) {
  const result = await ssh(`stat -c %U:%G ${path}`, { timeoutMs: 5_000 });
  if (result.code !== 0) return null;
  return result.stdout.trim();
}

async function readMarker(ssh, path) {
  const result = await ssh(`cat ${path}`, { timeoutMs: 5_000 });
  if (result.code !== 0) return null;
  return result.stdout.trim();
}

export async function prepare(ctx) {
  const path = deriveSessionPath(ctx.sessionId);
  const exists = await pathExists(ctx.ssh, path);
  if (exists) {
    throw new Error(
      `probe path already exists; refusing to clobber ${path} (sessionId=${ctx.sessionId})`,
    );
  }
  return { path, marker: deriveMarker(ctx.sessionId) };
}

export async function execute(ctx, prepared) {
  if (!prepared || typeof prepared.path !== "string") {
    throw new Error("execute: missing prepared.path from prepare()");
  }
  const { path, marker } = prepared;
  // create only that file with mode 0600 + non-secret marker derived from UUID session ID
  const createResult = await ctx.ssh(
    `printf '%s' '${marker.replace(/'/g, "'\\''")}' > ${path} && chmod ${PROBE_FILE_MODE} ${path}`,
    { timeoutMs: 10_000 },
  );
  if (createResult.code !== 0) {
    throw new Error(
      `execute: failed to create ${path} (code=${createResult.code}, stderr=${createResult.stderr.trim()})`,
    );
  }
  return { path, marker };
}

export async function verify(ctx, prepared, executed) {
  const { path, marker } = executed ?? prepared;
  const owner = await readOwner(ctx.ssh, path);
  const mode = await readMode(ctx.ssh, path);
  const observedMarker = await readMarker(ctx.ssh, path);
  const passed =
    owner !== null && mode === PROBE_FILE_MODE && observedMarker === marker;
  return {
    passed,
    summary: passed
      ? `probe ${path} mode=${mode} owner=${owner} marker=match`
      : `probe ${path} mode=${mode} owner=${owner} marker=${observedMarker ?? "<missing>"}`,
    data: { path, owner, mode, expectedMode: PROBE_FILE_MODE, marker },
  };
}

export async function rollback(ctx, prepared, executed) {
  const target = executed?.path ?? prepared?.path;
  if (typeof target !== "string" || !target.startsWith(`${REMOTE_TMP_DIR}/${PROBE_FILE_PREFIX}`)) {
    return {
      success: false,
      summary: "rollback: refusing to remove unexpected path",
      data: { attempted: target ?? null },
    };
  }
  const result = await ctx.ssh(`rm -f ${target}`, { timeoutMs: 5_000 });
  return {
    success: result.code === 0,
    summary: result.code === 0 ? `removed ${target}` : `failed to remove ${target}: ${result.stderr.trim()}`,
    data: { path: target },
  };
}
