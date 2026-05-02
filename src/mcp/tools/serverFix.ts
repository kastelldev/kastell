import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { runAudit } from "../../core/audit/index.js";
import {
  previewSafeFixes,
  runPostFixReAudit,
  isFixCommandAllowed,
  resolveTier,
  sortChecksByImpact,
  selectChecksForTop,
  selectChecksForTarget,
  fixCommandsFromChecks,
} from "../../core/audit/fix.js";
import { tryHandlerDispatch, type CollectedDiff } from "../../core/audit/handlers/index.js";
import { buildImpactContext } from "../../core/audit/scoring.js";
import { filterChecksByProfile, isValidProfile, listAllProfileNames } from "../../core/audit/profiles.js";
import { writeFixReport } from "../../utils/fixReport.js";
import { backupServer } from "../../core/backup.js";
import { isSafeMode } from "../../core/manage.js";
import { logSafeModeBlock } from "../../utils/safeMode.js";
import { sshExec, sshMasterOpen, sshMasterClose } from "../../utils/ssh.js";
import { raw } from "../../utils/sshCommand.js";
import {
  loadFixHistory,
  saveFixHistory,
  saveRollbackEntry,
  generateFixId,
  backupFilesBeforeFix,
  rollbackFix,
  backupRemoteCleanup,
  rollbackAllFixes,
  rollbackToFix,
} from "../../core/audit/fix-history.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  mcpLog,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import { saveBaselineSafe, loadBaseline, checkRegression, extractPassedCheckIds, shouldUpdateBaseline, hasRegression } from "../../core/audit/regression.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const serverFixSchema = {
  server: z
    .string()
    .optional()
    .describe(
      "Server name or IP. Auto-selected if only one server exists.",
    ),
  action: z
    .enum(["apply", "rollback", "history", "rollback-all", "rollback-to"])
    .default("apply")
    .describe(
      "apply: run fixes (default), rollback: restore single fix, rollback-all: revert all applied fixes, rollback-to: revert down to specific fix-id, history: list fix operations",
    ),
  dryRun: z
    .boolean()
    .default(true)
    .describe(
      "Preview fixes without applying. Defaults to true. Forced to true when KASTELL_SAFE_MODE=true.",
    ),
  rollbackId: z
    .string()
    .optional()
    .describe(
      "Fix ID to rollback (e.g. fix-2026-03-29-001) or 'last'",
    ),
  checks: z
    .array(z.string())
    .optional()
    .describe(
      "Specific check IDs to fix (e.g. ['KERN-SYNCOOKIES']). AND-filtered with category if both provided.",
    ),
  category: z
    .string()
    .optional()
    .describe(
      "Category name to filter fixes (e.g. 'Kernel'). AND-filtered with checks if both provided.",
    ),
  top: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Apply top N highest-impact SAFE fixes. Requires action:'apply'. Mutually exclusive with target.",
    ),
  target: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Apply SAFE fixes until score reaches this value (1-100). Requires action:'apply'. Mutually exclusive with top.",
    ),
  profile: z
    .string()
    .optional()
    .describe("Server profile to filter applicable checks (built-in: web-server, database, mail-server; or custom profile name)"),
  diff: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include per-fix diff preview in results"),
  report: z
    .boolean()
    .optional()
    .default(false)
    .describe("Generate markdown fix report file in current directory"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe("Bypass regression gate and force baseline update"),
};

/** Severity ordering for display (critical first) */
const SEVERITY_ORDER: Array<"critical" | "warning" | "info"> = [
  "critical",
  "warning",
  "info",
];

export async function handleServerFix(
  params: {
    server?: string;
    action?: "apply" | "rollback" | "history" | "rollback-all" | "rollback-to";
    dryRun?: boolean;
    rollbackId?: string;
    checks?: string[];
    category?: string;
    top?: number;
    target?: number;
    profile?: string;
    diff?: boolean;
    report?: boolean;
    force?: boolean;
  },
  mcpServer?: McpServer,
): Promise<McpResponse> {
  try {
    // ── Server resolution ──────────────────────────────────────────────────
    const servers = getServers();
    if (servers.length === 0) {
      return mcpError("No servers found", undefined, [
        { command: "kastell add", reason: "Add a server first" },
      ]);
    }

    const server = resolveServerForMcp(params, servers);
    if (!server) {
      if (params.server) {
        return mcpError(
          `Server not found: ${params.server}`,
          `Available servers: ${servers.map((s) => s.name).join(", ")}`,
        );
      }
      return mcpError(
        "Multiple servers found. Specify which server to fix.",
        `Available: ${servers.map((s) => s.name).join(", ")}`,
      );
    }

    const platform = server.platform ?? server.mode ?? "bare";

    // ── HISTORY action (FIXPRO-02, D-09) ─────────────────────────────────
    if (params.action === "history") {
      const entries = loadFixHistory(server.ip);
      return mcpSuccess({
        action: "history",
        server: { name: server.name, ip: server.ip },
        entries: entries.slice(-20),
        totalEntries: entries.length,
      });
    }

    // ── ROLLBACK action (FIXPRO-01, D-06, D-07, D-09) ───────────────────
    if (params.action === "rollback") {
      const guard = guardRollbackSafeMode();
      if (guard) return guard;

      if (!params.rollbackId) {
        return mcpError("rollbackId is required for rollback action");
      }

      const entries = loadFixHistory(server.ip);

      let fixId = params.rollbackId;
      if (fixId === "last") {
        const applied = entries.filter((e) => e.status === "applied");
        if (applied.length === 0) {
          return mcpError("No applied fixes found for this server");
        }
        fixId = applied[applied.length - 1].fixId;
      }

      const entry = entries.find(
        (e) => e.fixId === fixId && e.status === "applied",
      );
      if (!entry) {
        return mcpError(`Fix not found or already rolled back: ${fixId}`);
      }

      // Execute rollback
      if (!entry.backupPath) {
        throw new Error(`${fixId}: cannot roll back — no backup path (doctor fix entry)`);
      }
      await mcpLog(mcpServer, `Rolling back ${fixId}...`);
      const { restored, errors: rollbackErrors } = await rollbackFix(
        server.ip,
        entry.backupPath,
      );

      // Post-rollback score (optional)
      let scoreAfter: number | null = null;
      if (restored.length > 0) {
        await mcpLog(mcpServer, "Verifying score...");
        const auditRes = await runAudit(server.ip, server.name, platform);
        if (auditRes.success && auditRes.data) {
          scoreAfter = auditRes.data.overallScore;
        }
      }

      await saveRollbackEntry(entry, scoreAfter);

      return mcpSuccess({
        action: "rollback",
        fixId,
        restored,
        errors: rollbackErrors,
        scoreBefore: entry.scoreAfter ?? entry.scoreBefore,
        scoreAfter,
      });
    }

    // ── ROLLBACK-ALL action (FIX-01) ─────────────────────────────────────
    if (params.action === "rollback-all") {
      const guard = guardRollbackSafeMode();
      if (guard) return guard;

      await mcpLog(mcpServer, "Rolling back all fixes...");
      const { rolledBack, errors: rbErrors } = await rollbackAllFixes(server.ip);
      const scoreAfter = await auditScoreAfterRollback(server, platform, mcpServer, rolledBack.length);

      return mcpSuccess({
        action: "rollback-all",
        rolledBack,
        errors: rbErrors,
        scoreAfter,
      });
    }

    // ── ROLLBACK-TO action (FIX-02) ──────────────────────────────────────
    if (params.action === "rollback-to") {
      const guard = guardRollbackSafeMode();
      if (guard) return guard;

      if (!params.rollbackId) {
        return mcpError("rollbackId is required for rollback-to action");
      }

      await mcpLog(mcpServer, `Rolling back to ${params.rollbackId}...`);
      const { rolledBack, errors: rbErrors } = await rollbackToFix(server.ip, params.rollbackId);
      const scoreAfter = await auditScoreAfterRollback(server, platform, mcpServer, rolledBack.length);

      return mcpSuccess({
        action: "rollback-to",
        targetFixId: params.rollbackId,
        rolledBack,
        errors: rbErrors,
        scoreAfter,
      });
    }

    // ── top/target mutual exclusion validation (D-08) ─────────────────────
    if (params.top !== undefined && params.target !== undefined) {
      return mcpError("top and target are mutually exclusive. Use one or the other.");
    }

    // ── SAFE_MODE + dryRun resolution ─────────────────────────────────────
    const effectiveDryRun = (params.dryRun ?? true) || isSafeMode();
    const safeModeForcedDryRun =
      params.dryRun === false && isSafeMode() ? true : undefined;

    // ── Run audit ─────────────────────────────────────────────────────────
    await mcpLog(mcpServer, `Running audit on ${server.name}...`);
    const result = await runAudit(server.ip, server.name, platform);
    if (!result.success || !result.data) {
      return mcpError(result.error ?? "Audit failed", result.hint);
    }
    const auditResult = result.data;

    const baseline = loadBaseline(auditResult.serverIp);
    const preFixPassedIds = extractPassedCheckIds(auditResult);
    const regression = baseline ? checkRegression(baseline, auditResult, preFixPassedIds) : null;
    const baselineRegression = regression;

    const scoreDropped = regression ? regression.currentScore < regression.baselineScore : false;
    const regressionWarning = regression && hasRegression(regression) && !params.force
      ? {
          regressions: regression.regressions,
          scoreRegressed: scoreDropped,
          message: `Regression detected: ${regression.regressions.length} check(s) regressed, score ${scoreDropped ? "dropped" : "stable"}. Use force:true to override.`,
        }
      : undefined;

    // ── Build check index for O(1) lookups (used by FORBIDDEN rejection + affectedCats) ──
    const checkIndex = new Map<string, { categoryName: string }>();
    for (const cat of auditResult.categories) {
      for (const ch of cat.checks) {
        checkIndex.set(ch.id, { categoryName: cat.name });
      }
    }

    // ── FORBIDDEN rejection for user-supplied check IDs (FIX-08) ─────────
    const rejectedChecks: Array<{ id: string; reason: string }> = [];
    if (params.checks && params.checks.length > 0) {
      for (const checkId of params.checks) {
        const entry = checkIndex.get(checkId);
        if (!entry) {
          rejectedChecks.push({
            id: checkId,
            reason: "Check ID not found in audit results",
          });
          continue;
        }
        const check = auditResult.categories
          .find((c) => c.name === entry.categoryName)!
          .checks.find((ch) => ch.id === checkId)!;
        const tier = resolveTier(check, entry.categoryName);
        if (tier === "FORBIDDEN") {
          rejectedChecks.push({
            id: checkId,
            reason:
              "FORBIDDEN tier — SSH/Firewall/Docker categories never auto-fixed",
          });
        }
      }
    }

    // ── Get SAFE plan + AND filter ────────────────────────────────────────
    const { safePlan, guardedCount, forbiddenCount } =
      previewSafeFixes(auditResult);
    let filteredChecks = safePlan.groups.flatMap((g) => g.checks);

    if (params.category) {
      filteredChecks = filteredChecks.filter(
        (c) => c.category === params.category,
      );
    }
    if (params.checks && params.checks.length > 0) {
      // Remove rejected IDs from the working set
      const allowedIdSet = new Set(
        params.checks.filter(
          (id) => !rejectedChecks.some((r) => r.id === id),
        ),
      );
      filteredChecks = filteredChecks.filter((c) => allowedIdSet.has(c.id));
    }

    // Profile filter (D-05): applied after category/checks AND filters
    if (params.profile) {
      if (!isValidProfile(params.profile)) {
        return mcpError(`Unknown profile: "${params.profile}". Available: ${listAllProfileNames().join(", ")}`);
      }
      filteredChecks = filterChecksByProfile(filteredChecks, params.profile);
    }

    // ── Early exit if no SAFE fixes after filter ──────────────────────────
    if (filteredChecks.length === 0) {
      return mcpSuccess({
        dryRun: effectiveDryRun,
        ...(safeModeForcedDryRun ? { safeModeForcedDryRun } : {}),
        applied: [],
        message: "No matching SAFE fixes available",
        rejectedChecks,
        guardedCount,
        forbiddenCount,
        scoreBefore: auditResult.overallScore,
      });
    }

    // ── Prioritization: sort + select by top/target (D-03, D-06, D-07) ───
    const impactCtx = buildImpactContext(auditResult.categories);
    const sortedChecks = sortChecksByImpact(filteredChecks, impactCtx);
    let selectedChecks = sortedChecks;

    if (params.top !== undefined) {
      selectedChecks = selectChecksForTop(sortedChecks, params.top);
    } else if (params.target !== undefined) {
      if (auditResult.overallScore >= params.target) {
        return mcpSuccess({
          dryRun: effectiveDryRun,
          applied: [],
          message: `Current score ${auditResult.overallScore} already meets target ${params.target} — no fixes needed.`,
          scoreBefore: auditResult.overallScore,
          scoreAfter: auditResult.overallScore,
          guardedCount,
          forbiddenCount,
        });
      }
      selectedChecks = selectChecksForTarget(sortedChecks, auditResult.overallScore, params.target);
    }

    // ── DRY RUN response ──────────────────────────────────────────────────
    if (effectiveDryRun) {
      const previewGroups = SEVERITY_ORDER.map((sev) => ({
        severity: sev,
        checks: selectedChecks.filter((c) => c.severity === sev),
      })).filter((g) => g.checks.length > 0);

      return mcpSuccess({
        dryRun: true,
        ...(safeModeForcedDryRun ? { safeModeForcedDryRun } : {}),
        preview: { groups: previewGroups },
        rejectedChecks,
        guardedCount,
        forbiddenCount,
        scoreBefore: auditResult.overallScore,
        ...(baselineRegression ? { baselineRegression } : {}),
        ...(regressionWarning ? { regressionWarning } : {}),
      }, { largeResult: true });
    }

    // ── LIVE FIX — backup first (D-02, hard abort on failure) ────────────
    await mcpLog(mcpServer, "Creating backup...");
    const backup = await backupServer(server);
    if (!backup.success) {
      return mcpError(
        `Backup failed: ${backup.error ?? "unknown error"}`,
        backup.hint,
      );
    }

    // ── LIVE FIX — remote file backup + fix ID (D-01, D-03) ──────────────
    const fixId = generateFixId(server.ip);
    const fixCommands = fixCommandsFromChecks(selectedChecks);
    await mcpLog(mcpServer, "Creating remote file backup...");
    const remoteBackupPath = await backupFilesBeforeFix(
      server.ip,
      fixId,
      fixCommands,
    );

    // ── LIVE FIX — execute ────────────────────────────────────────────────
    await mcpLog(mcpServer, `Applying ${selectedChecks.length} safe fix(es)...`);

    // Open SSH master connection to prevent MaxStartups exhaustion (D-23)
    await sshMasterOpen(server.ip);

    const applied: string[] = [];
    const errors: string[] = [];
    const collectedDiffs: CollectedDiff[] = [];

    for (const check of selectedChecks) {
      try {
        if (check.preCondition) {
          const preCheck = await sshExec(server.ip, raw(check.preCondition));
          if (preCheck.code !== 0) {
            errors.push(`${check.id}: pre-condition failed`);
            continue;
          }
        }
        // Handler dispatch — bypasses shell metachar guard (D-05, D-06)
        const dispatch = await tryHandlerDispatch(server.ip, check, applied, errors);
        if (dispatch.handled) {
          collectedDiffs.push({ checkId: check.id, category: check.category, severity: check.severity, diff: dispatch.diff });
          continue;
        }
        if (!isFixCommandAllowed(check.fixCommand)) {
          errors.push(`${check.id}: fix command rejected`);
          continue;
        }
        const sshResult = await sshExec(server.ip, raw(check.fixCommand));
        if (sshResult.code !== 0) {
          errors.push(`${check.id}: command failed (exit ${sshResult.code})`);
        } else {
          applied.push(check.id);
          collectedDiffs.push({ checkId: check.id, category: check.category, severity: check.severity });
        }
      } catch (err) {
        errors.push(`${check.id}: ${getErrorMessage(err)}`);
      }
    }

    // Close SSH master connection (D-23)
    sshMasterClose(server.ip);

    // ── LIVE FIX — score delta ────────────────────────────────────────────
    let scoreAfter: number | null = null;
    let postFixResult: Awaited<ReturnType<typeof runPostFixReAudit>> = null;
    if (applied.length > 0) {
      await mcpLog(mcpServer, "Verifying score...");
      const affectedCats = [
        ...new Set(
          applied
            .map((id) => checkIndex.get(id)?.categoryName)
            .filter((n): n is string => n !== undefined),
        ),
      ];
      postFixResult = await runPostFixReAudit(
        server.ip,
        platform,
        auditResult,
        affectedCats,
      );
      scoreAfter = postFixResult?.overallScore ?? null;
    }

    // ── LIVE FIX — save history entry (FIXPRO-02) ────────────────────────
    await saveFixHistory({
      fixId,
      serverIp: server.ip,
      serverName: server.name,
      timestamp: new Date().toISOString(),
      checks: applied,
      scoreBefore: auditResult.overallScore,
      scoreAfter,
      status: applied.length > 0 ? "applied" : "failed",
      backupPath: remoteBackupPath,
    });

    // Only save when fixes were applied — a no-op fix run should not overwrite the baseline
    if (applied.length > 0) {
      const resultToSave = postFixResult ?? auditResult;
      const passedIdsToSave = postFixResult ? extractPassedCheckIds(postFixResult) : preFixPassedIds;
      const finalRegression = postFixResult && baseline
        ? checkRegression(baseline, resultToSave, passedIdsToSave)
        : regression;

      if (shouldUpdateBaseline(finalRegression, Boolean(params.force))) {
        await saveBaselineSafe(resultToSave, undefined, passedIdsToSave);
      }
    }

    // ── LIVE FIX — prune old backups ──────────────────────────────────────
    await backupRemoteCleanup(server.ip);

    // D-06: target unreachable warning
    const targetWarning =
      params.target !== undefined && scoreAfter !== null && scoreAfter < params.target
        ? `Target ${params.target} not reached (got ${scoreAfter}). Remaining fixes are GUARDED/FORBIDDEN tier.`
        : undefined;

    // Build diff summary if requested
    const diffSummary = params.diff
      ? collectedDiffs
          .filter((d) => d.diff !== undefined)
          .map((d) => `[${d.diff!.handlerType}] ${d.diff!.key}: ${d.diff!.before} -> ${d.diff!.after}`)
      : undefined;

    // Generate fix report if requested (FIXPRO-07)
    let reportFile: string | undefined;
    if (params.report) {
      reportFile = writeFixReport({
        collectedDiffs, applied, errors,
        server: { name: server.name, ip: server.ip },
        scoreBefore: auditResult.overallScore,
        scoreAfter,
        skipped: [],
        profile: params.profile,
        dryRun: false,
      });
    }

    return mcpSuccess({
      dryRun: false,
      applied,
      errors,
      rejectedChecks,
      scoreBefore: auditResult.overallScore,
      scoreAfter,
      ...(targetWarning ? { targetWarning } : {}),
      ...(diffSummary ? { diffSummary } : {}),
      ...(reportFile ? { reportFile } : {}),
      ...(baselineRegression ? { baselineRegression } : {}),
      ...(regressionWarning ? { regressionWarning } : {}),
    }, { largeResult: true });
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}

function guardRollbackSafeMode(): ReturnType<typeof mcpError> | null {
  if (isSafeMode()) {
    logSafeModeBlock("fix-rollback", { category: "destructive" });
    return mcpError(
      "Rollback blocked: KASTELL_SAFE_MODE=true",
      "Set SAFE_MODE=false to allow rollback operations",
    );
  }
  return null;
}

async function auditScoreAfterRollback(
  server: { ip: string; name: string },
  platform: string,
  mcpServer: McpServer | undefined,
  rolledBackCount: number,
): Promise<number | null> {
  if (rolledBackCount === 0) return null;
  await mcpLog(mcpServer, "Verifying score...");
  const auditRes = await runAudit(server.ip, server.name, platform);
  return auditRes.success && auditRes.data ? auditRes.data.overallScore : null;
}
