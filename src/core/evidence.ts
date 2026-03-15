/**
 * Evidence collection core module.
 * Collects forensic data from a server via a single batched SSH connection.
 * Writes per-file evidence to a flat directory with SHA256 checksums.
 */

import { createHash } from "crypto";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  renameSync,
  rmSync,
} from "fs";
import { join, resolve } from "path";

import { sshExec } from "../utils/ssh.js";
import { withFileLock } from "../utils/fileLock.js";
import { CONFIG_DIR } from "../utils/config.js";
import { getErrorMessage } from "../utils/errorMapper.js";
import {
  buildEvidenceBatchCommand,
  getEvidenceSectionFilenames,
} from "./evidenceCommands.js";
import type { KastellResult } from "../types/index.js";
import { EVIDENCE_TIMEOUT_MS } from "../constants.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface EvidenceFileEntry {
  filename: string;
  sha256: string;
  sizeBytes: number;
  collectedAt: string;
  status: "collected" | "skipped";
  skipReason?: string;
}

export interface EvidenceManifest {
  schemaVersion: 1;
  server: string;
  ip: string;
  platform: string;
  collectedAt: string;
  evidenceDir: string;
  files: EvidenceFileEntry[];
}

export interface EvidenceResult {
  evidenceDir: string;
  serverName: string;
  serverIp: string;
  platform: string;
  collectedAt: string;
  totalFiles: number;
  skippedFiles: number;
  manifestPath: string;
}

export interface EvidenceOptions {
  name?: string;
  output?: string;
  lines: number;
  noDocker: boolean;
  noSysinfo: boolean;
  force: boolean;
  json: boolean;
  quiet: boolean;
}

// Section → filename mapping is now dynamic via getEvidenceSectionFilenames()
// to stay in sync with buildEvidenceBatchCommand's conditional section inclusion.

// ─── Private helpers ───────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function isEmptyOrNa(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === "" || trimmed === "N/A";
}

function writeEvidenceFile(
  dir: string,
  filename: string,
  content: string,
  collectedAt: string,
  entries: EvidenceFileEntry[],
): void {
  if (isEmptyOrNa(content)) {
    entries.push({
      filename,
      sha256: "",
      sizeBytes: 0,
      collectedAt,
      status: "skipped",
      skipReason: "No data returned (N/A or empty)",
    });
    return;
  }

  const filePath = join(dir, filename);
  writeFileSync(filePath, content, { mode: 0o600 });
  const hash = sha256(content);
  entries.push({
    filename,
    sha256: hash,
    sizeBytes: Buffer.byteLength(content, "utf-8"),
    collectedAt,
    status: "collected",
  });
}

function buildSha256Sums(entries: EvidenceFileEntry[]): string {
  return entries
    .filter((e) => e.status === "collected")
    .map((e) => `${e.sha256}  ${e.filename}`)
    .join("\n");
}

function buildDirName(opts: EvidenceOptions): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (opts.name) {
    if (/[/\\]|\.\./.test(opts.name)) {
      throw new Error("Invalid evidence name: contains path separator or traversal");
    }
    return `${date}_${opts.name}`;
  }
  return date;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Collect forensic evidence from a server via a single batched SSH connection.
 * Writes per-file evidence to a flat directory with SHA256 checksums.
 */
export async function collectEvidence(
  serverName: string,
  ip: string,
  platform: string,
  opts: EvidenceOptions,
): Promise<KastellResult<EvidenceResult>> {
  const collectedAt = new Date().toISOString();
  const dirName = buildDirName(opts);

  // Guard against path traversal via crafted server names
  if (/[/\\]|\.\./.test(serverName)) {
    return { success: false, error: "Invalid server name: contains path separator or traversal" };
  }

  // Resolve evidence directory
  let evidenceDir: string;
  if (opts.output) {
    evidenceDir = resolve(opts.output, dirName);
  } else {
    evidenceDir = join(CONFIG_DIR, "evidence", serverName, dirName);
  }

  // Check for existing directory
  if (existsSync(evidenceDir)) {
    if (!opts.force) {
      return {
        success: false,
        error: `Evidence '${dirName}' already exists. Use --force to overwrite.`,
      };
    }
    rmSync(evidenceDir, { recursive: true, force: true });
  }

  // Create evidence directory
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

  // Build SSH batch command and matching filename list
  const buildOpts = { noDocker: opts.noDocker, noSysinfo: opts.noSysinfo };
  const batchCommand = buildEvidenceBatchCommand(platform, opts.lines, buildOpts);
  const sectionFilenames = getEvidenceSectionFilenames(platform, buildOpts);

  // Execute SSH (exactly one call)
  const sshResult = await sshExec(ip, batchCommand, { timeoutMs: EVIDENCE_TIMEOUT_MS });
  if (sshResult.code !== 0) {
    rmSync(evidenceDir, { recursive: true, force: true });
    return {
      success: false,
      error: `SSH failed: ${sshResult.stderr || "non-zero exit code"}`,
    };
  }

  // Parse sections (trim each section to remove surrounding newlines from separator)
  const sections = sshResult.stdout.split("---SEPARATOR---").map((s) => s.trim());
  const entries: EvidenceFileEntry[] = [];
  const manifestPath = join(evidenceDir, "MANIFEST.json");

  try {
    for (let i = 0; i < sections.length; i++) {
      const filename = sectionFilenames[i];
      if (!filename) continue; // Beyond expected sections — skip silently
      writeEvidenceFile(evidenceDir, filename, sections[i], collectedAt, entries);
    }

    // Build manifest
    const manifest: EvidenceManifest = {
      schemaVersion: 1,
      server: serverName,
      ip,
      platform,
      collectedAt,
      evidenceDir,
      files: entries,
    };

    const sha256SumsContent = buildSha256Sums(entries);
    const sha256SumsPath = join(evidenceDir, "SHA256SUMS");

    // Write manifest and SHA256SUMS atomically under file lock
    await withFileLock(manifestPath, () => {
      const manifestTmp = manifestPath + ".tmp";
      const sha256SumsTmp = sha256SumsPath + ".tmp";
      writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
      renameSync(manifestTmp, manifestPath);
      writeFileSync(sha256SumsTmp, sha256SumsContent, { mode: 0o600 });
      renameSync(sha256SumsTmp, sha256SumsPath);
    });
  } catch (err: unknown) {
    rmSync(evidenceDir, { recursive: true, force: true });
    return {
      success: false,
      error: `Failed to write evidence files: ${getErrorMessage(err)}`,
    };
  }

  const collectedCount = entries.filter((e) => e.status === "collected").length;

  return {
    success: true,
    data: {
      evidenceDir,
      serverName,
      serverIp: ip,
      platform,
      collectedAt,
      totalFiles: collectedCount,
      skippedFiles: entries.length - collectedCount,
      manifestPath,
    },
  };
}
