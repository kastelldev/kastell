import { getServers } from "../../utils/config.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

export function hardenPrompt(args: { server: string }): GetPromptResult {
  return {
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Execute the full hardening workflow for server "${args.server}":

1. Run \`server_lock\` with \`{ server: "${args.server}", production: true }\` to apply 24-step production hardening (SSH + fail2ban + UFW + sysctl + auditd + AIDE + Docker daemon).

2. After lock completes, run \`server_audit\` with \`{ server: "${args.server}", format: "summary" }\` to get the security score.

3. If the audit score is below 70, run \`server_fix\` with \`{ server: "${args.server}", dryRun: false }\` to apply safe auto-fixes, then re-audit.

4. Report the final score and any remaining findings that need manual attention.`,
      },
    }],
  };
}

export function diagnosePrompt(args: { server: string; service?: string }): GetPromptResult {
  const svc = args.service ?? "coolify";
  return {
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Diagnose issues on server "${args.server}":

1. Run \`server_doctor\` with \`{ server: "${args.server}", fresh: true }\` to check health (disk, swap, stale packages, audit regression).

2. Run \`server_logs\` with \`{ server: "${args.server}", action: "logs", service: "${svc}", lines: 100 }\` to check recent logs. For bare servers use service "system", for Coolify servers use "coolify".

3. If doctor or logs reveal issues, run \`server_audit\` with \`{ server: "${args.server}", format: "summary" }\` to get a security overview.

4. Summarize findings: health status, log anomalies, and audit score. Suggest remediation steps.`,
      },
    }],
  };
}

export function setupPrompt(args: { name: string }): GetPromptResult {
  return {
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Set up a new server named "${args.name}":

1. Run \`server_provision\` with \`{ name: "${args.name}" }\` to deploy the server. The tool will ask for provider, region, and size if not specified.

2. Wait for the server to be fully initialized (3-5 minutes). Check status with \`server_info { action: "health", server: "${args.name}" }\`.

3. Run \`server_lock\` with \`{ server: "${args.name}", production: true }\` to apply full production hardening.

4. Run \`server_audit\` with \`{ server: "${args.name}", format: "summary" }\` to verify the security score.

5. Report the final server details (IP, provider, mode) and audit score.`,
      },
    }],
  };
}

export function getServerNameCompletions(partial: string): { values: string[]; hasMore: boolean; total: number } {
  const servers = getServers();
  const matching = servers
    .filter((s) => s.name.startsWith(partial))
    .map((s) => s.name);

  return {
    values: matching.slice(0, 20),
    hasMore: matching.length > 20,
    total: matching.length,
  };
}
