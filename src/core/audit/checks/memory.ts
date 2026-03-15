/**
 * Memory/Processes security check parser.
 * Parses kernel memory policies, overcommit settings, zombie processes,
 * core dump restrictions, and process limits into 7 security checks.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface MemoryCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const MEMORY_CHECKS: MemoryCheckDef[] = [
  {
    id: "MEM-OVERCOMMIT-POLICY",
    name: "Memory Overcommit Controlled",
    severity: "info",
    check: (output) => {
      const match = output.match(/vm\.overcommit_memory\s*=\s*(\d+)/);
      if (!match) {
        return { passed: false, currentValue: "vm.overcommit_memory not found" };
      }
      const value = parseInt(match[1], 10);
      // 0 = heuristic overcommit (default, acceptable)
      // 1 = always overcommit (risky)
      // 2 = strict overcommit (most controlled)
      const passed = value === 0 || value === 2;
      return {
        passed,
        currentValue: passed
          ? `vm.overcommit_memory = ${value} (controlled)`
          : `vm.overcommit_memory = ${value} (always overcommit)`,
      };
    },
    expectedValue: "vm.overcommit_memory = 0 or 2 (not 1)",
    fixCommand: "sysctl -w vm.overcommit_memory=2 && echo 'vm.overcommit_memory=2' >> /etc/sysctl.conf",
    explain:
      "vm.overcommit_memory=1 (always overcommit) allows any memory allocation regardless of available memory, increasing OOM kill risk and potential denial-of-service conditions.",
  },
  {
    id: "MEM-NO-ZOMBIE-EXCESS",
    name: "No Excessive Zombie Processes",
    severity: "warning",
    check: (output) => {
      // ps aux | grep -c ' Z ' output — a number on its own line
      // grep -c counts matching lines, so even with no zombies it returns "0"
      const lines = output.split("\n");
      let zombieCount = -1;
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          if (zombieCount === -1) {
            zombieCount = val;
          }
        }
      }
      if (zombieCount === -1) {
        return { passed: false, currentValue: "Zombie count not determinable" };
      }
      const passed = zombieCount < 10;
      return {
        passed,
        currentValue: passed
          ? `${zombieCount} zombie processes (acceptable)`
          : `${zombieCount} zombie processes (excessive)`,
      };
    },
    expectedValue: "Zombie process count < 10",
    fixCommand: "# Kill zombie parent processes: kill -s SIGCHLD <parent_pid>",
    explain:
      "Excessive zombie processes indicate a parent process is not properly reaping children, suggesting a software fault. Large numbers can exhaust process table entries causing system-wide failures.",
  },
  {
    id: "MEM-CORE-DUMP-RESTRICTED",
    name: "Core Dumps Restricted (SUID)",
    severity: "warning",
    check: (output) => {
      const match = output.match(/fs\.suid_dumpable\s*=\s*(\d+)/);
      if (!match) {
        return { passed: false, currentValue: "fs.suid_dumpable not found" };
      }
      const value = parseInt(match[1], 10);
      const passed = value === 0;
      return {
        passed,
        currentValue: passed
          ? "fs.suid_dumpable = 0 (core dumps restricted)"
          : `fs.suid_dumpable = ${value} (SUID processes can dump core)`,
      };
    },
    expectedValue: "fs.suid_dumpable = 0",
    fixCommand: "sysctl -w fs.suid_dumpable=0 && echo 'fs.suid_dumpable=0' >> /etc/sysctl.conf",
    explain:
      "fs.suid_dumpable=0 prevents SUID/SGID programs from generating core dumps, protecting against leaking privileged process memory (credentials, keys) to disk.",
  },
  {
    id: "MEM-OOM-KILL-POLICY",
    name: "OOM Killer Policy Configured",
    severity: "info",
    check: (output) => {
      const match = output.match(/vm\.oom_kill_allocating_task\s*=\s*(\d+)/);
      if (!match) {
        return { passed: false, currentValue: "vm.oom_kill_allocating_task not found" };
      }
      const value = match[1];
      return {
        passed: true,
        currentValue: `vm.oom_kill_allocating_task = ${value} (configured)`,
      };
    },
    expectedValue: "vm.oom_kill_allocating_task has any configured value",
    fixCommand: "sysctl -w vm.oom_kill_allocating_task=1 && echo 'vm.oom_kill_allocating_task=1' >> /etc/sysctl.conf",
    explain:
      "The OOM killer policy controls which process is terminated when memory runs out. Having it explicitly configured ensures predictable behavior during memory pressure events.",
  },
  {
    id: "MEM-HUGEPAGES-CONFIG",
    name: "Transparent Hugepages Configured",
    severity: "info",
    check: (output) => {
      // /sys/kernel/mm/transparent_hugepage/enabled output contains [always], [madvise], or [never]
      const hasHugepages = /\[(always|madvise|never)\]/.test(output);
      if (!hasHugepages) {
        // Check for any hugepage-related content (not N/A)
        const hasContent = output.includes("always") || output.includes("madvise") || output.includes("never");
        return {
          passed: hasContent,
          currentValue: hasContent ? "Transparent hugepages configured" : "Transparent hugepages not configured",
        };
      }
      const mode = output.match(/\[(always|madvise|never)\]/)?.[1] ?? "unknown";
      return {
        passed: true,
        currentValue: `Transparent hugepages: ${mode}`,
      };
    },
    expectedValue: "Transparent hugepages setting present in /sys/kernel/mm/transparent_hugepage/enabled",
    fixCommand: "echo madvise > /sys/kernel/mm/transparent_hugepage/enabled",
    explain:
      "Transparent hugepages configuration affects memory management performance and fragmentation. Having it explicitly configured is a sign of deliberate memory tuning.",
  },
  {
    id: "MEM-PID-MAX-REASONABLE",
    name: "PID Max Configured",
    severity: "info",
    check: (output) => {
      // /proc/sys/kernel/pid_max — should be a standalone number
      const match = output.match(/(?:^|\n)(\d{4,})(?:\n|$)/);
      if (!match) {
        return { passed: false, currentValue: "pid_max value not found" };
      }
      const pidMax = parseInt(match[1], 10);
      const passed = pidMax > 4096;
      return {
        passed,
        currentValue: passed
          ? `pid_max = ${pidMax} (configured)`
          : `pid_max = ${pidMax} (too low)`,
      };
    },
    expectedValue: "pid_max > 4096 (configured for adequate process capacity)",
    fixCommand: "sysctl -w kernel.pid_max=32768 && echo 'kernel.pid_max=32768' >> /etc/sysctl.conf",
    explain:
      "The pid_max value limits how many processes can run simultaneously. Values above 4096 indicate the system is configured for normal multi-process operation.",
  },
  {
    id: "MEM-ULIMIT-NOFILE",
    name: "Open Files Limit Configured",
    severity: "warning",
    check: (output) => {
      // Match both "open files" and "nofile" format variants
      // ulimit -a format: "open files                      (-n) 1024" or "nofile (-n) 1024"
      const match = output.match(/(?:open files|nofile)\s+.*?(?:\(-n\)\s*)?(-?\d+|unlimited)\s*$/im);
      if (!match) {
        return { passed: false, currentValue: "Open files limit not found in ulimit output" };
      }
      const value = match[1];
      const isUnlimited = value === "unlimited" || value === "-1";
      return {
        passed: !isUnlimited,
        currentValue: isUnlimited
          ? "Open files limit: unlimited (not configured)"
          : `Open files limit: ${value}`,
      };
    },
    expectedValue: "ulimit open files is a finite numeric value (not unlimited)",
    fixCommand: "echo '* soft nofile 65536\n* hard nofile 65536' >> /etc/security/limits.conf",
    explain:
      "An unlimited open files ulimit allows a single process to consume all available file descriptors, potentially causing denial-of-service by exhausting system resources.",
  },
  {
    id: "MEM-SWAP-ENCRYPTED",
    name: "Swap Encrypted or Disabled",
    severity: "info",
    check: (output) => {
      // swapon --show=NAME,TYPE output or NO_SWAP
      const noSwap = /NO_SWAP/.test(output);
      if (noSwap) {
        return { passed: true, currentValue: "No swap configured" };
      }
      // Check if swap is on an encrypted volume (dm-crypt/LUKS)
      const hasEncryptedSwap = /crypto|crypt|dm-/i.test(output);
      return {
        passed: noSwap || hasEncryptedSwap,
        currentValue: noSwap
          ? "No swap configured"
          : hasEncryptedSwap
            ? "Swap on encrypted volume"
            : "Unencrypted swap detected",
      };
    },
    expectedValue: "No swap, or swap on encrypted volume",
    fixCommand: "# See: cryptsetup luksFormat /dev/sdX && mkswap /dev/mapper/swap — or disable swap: swapoff -a",
    explain:
      "Unencrypted swap can contain sensitive data like passwords and encryption keys that persist after power loss.",
  },
  {
    id: "MEM-SWAPPINESS-REASONABLE",
    name: "Swappiness Value Reasonable",
    severity: "info",
    check: (output) => {
      // /proc/sys/vm/swappiness — standalone number
      const lines = output.split("\n");
      let swappiness: number | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        // Look for a standalone small number (0-200) — swappiness range
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          if (val >= 0 && val <= 200) {
            swappiness = val;
            break;
          }
        }
      }
      if (swappiness === null) {
        return { passed: false, currentValue: "vm.swappiness not found" };
      }
      const passed = swappiness <= 60;
      return {
        passed,
        currentValue: passed
          ? `vm.swappiness = ${swappiness} (reasonable)`
          : `vm.swappiness = ${swappiness} (high — increases sensitive data in swap)`,
      };
    },
    expectedValue: "vm.swappiness <= 60",
    fixCommand: "sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf",
    explain:
      "High swappiness increases the chance of sensitive memory pages being written to potentially unencrypted swap.",
  },
  {
    id: "MEM-HUGEPAGES-NOT-EXCESSIVE",
    name: "Transparent Hugepages Not Always Mode",
    severity: "info",
    check: (output) => {
      // /sys/kernel/mm/transparent_hugepage/enabled output contains [always], [madvise], or [never]
      const alwaysMode = /\[always\]/.test(output);
      const hasConfig = /\[(always|madvise|never)\]/.test(output);
      if (!hasConfig) {
        return { passed: true, currentValue: "Transparent hugepages configuration not available" };
      }
      const mode = output.match(/\[(always|madvise|never)\]/)?.[1] ?? "unknown";
      return {
        passed: !alwaysMode,
        currentValue: alwaysMode
          ? "Transparent hugepages: always (may cause latency)"
          : `Transparent hugepages: ${mode} (acceptable)`,
      };
    },
    expectedValue: "Transparent hugepages set to 'madvise' or 'never', not 'always'",
    fixCommand: "echo madvise > /sys/kernel/mm/transparent_hugepage/enabled",
    explain:
      "Transparent hugepages set to 'always' can cause memory fragmentation and latency spikes; 'madvise' gives application control.",
  },
];

export const parseMemoryChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return MEMORY_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Memory",
        name: def.name,
        severity: def.severity,
        passed: false,
        currentValue: "Unable to determine",
        expectedValue: def.expectedValue,
        fixCommand: def.fixCommand,
        explain: def.explain,
      };
    }
    const { passed, currentValue } = def.check(output);
    return {
      id: def.id,
      category: "Memory",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      explain: def.explain,
    };
  });
};
