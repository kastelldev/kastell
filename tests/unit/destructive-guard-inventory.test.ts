/**
 * P142 Task 9 — Destructive Guard Inventory
 *
 * Table-driven policy inventory. For each command path that performs an
 * effectful mutation (cloud deletion, server reboot, restore, snapshot, etc.)
 * the source MUST adopt `confirmOrCancel()` so the 4-case matrix is enforced:
 *
 *   - TTY + no force  -> prompts user
 *   - TTY + force     -> bypasses prompt (source: "force")
 *   - non-TTY + no force -> refuses before mutation, exit code 1
 *   - non-TTY + force -> reaches the mutation
 *
 * `--force` is the explicit non-TTY opt-in. `--dry-run` does not require force.
 *
 * Typed-name second confirmations are kept only for interactive
 * destroy / restore / snapshot destruction. Other commands do not need them.
 *
 * Explicitly OUT OF SCOPE for the destructive guard (see Plan L769-776):
 *   - evidence overwrite convenience
 *   - backup selection lists (the picker, not the restore step)
 *   - package installation and setup prompts
 *   - add / auth / init / config collection prompts
 *   - read-only status / list operations
 *   - MCP handlers
 */

import * as fs from "fs";
import * as path from "path";

interface GuardEntry {
  command: string;
  sourceFile: string;
  guardedEffect: string;
  expectImport: boolean;
  notes?: string;
}

const INVENTORY: GuardEntry[] = [
  {
    command: "destroy",
    sourceFile: "src/commands/destroy.ts",
    guardedEffect: "cloud deletion",
    expectImport: true,
    notes: "keeps typed-name second confirmation after first TTY confirm",
  },
  {
    command: "remove",
    sourceFile: "src/commands/remove.ts",
    guardedEffect: "local server-record deletion",
    expectImport: true,
  },
  {
    command: "restart",
    sourceFile: "src/commands/restart.ts",
    guardedEffect: "server reboot",
    expectImport: true,
  },
  {
    command: "restore",
    sourceFile: "src/commands/restore.ts",
    guardedEffect: "backup overwrite / restore",
    expectImport: true,
    notes: "keeps typed-name second confirmation after first TTY confirm",
  },
  {
    command: "snapshot create",
    sourceFile: "src/commands/snapshot.ts",
    guardedEffect: "billable cloud mutation",
    expectImport: true,
  },
  {
    command: "snapshot delete",
    sourceFile: "src/commands/snapshot.ts",
    guardedEffect: "cloud snapshot deletion",
    expectImport: true,
  },
  {
    command: "snapshot restore",
    sourceFile: "src/commands/snapshot.ts",
    guardedEffect: "cloud restore mutation",
    expectImport: true,
    notes: "keeps typed-name second confirmation after first TTY confirm",
  },
  {
    command: "update",
    sourceFile: "src/commands/update.ts",
    guardedEffect: "platform update",
    expectImport: true,
  },
  {
    command: "backup cleanup",
    sourceFile: "src/commands/backup.ts",
    guardedEffect: "local backup deletion",
    expectImport: true,
  },
  {
    command: "firewall remove",
    sourceFile: "src/commands/firewall.ts",
    guardedEffect: "firewall rule deletion",
    expectImport: true,
  },
  {
    command: "guard start",
    sourceFile: "src/commands/guard.ts",
    guardedEffect: "remote daemon install",
    expectImport: true,
  },
  {
    command: "guard stop",
    sourceFile: "src/commands/guard.ts",
    guardedEffect: "remote daemon removal",
    expectImport: true,
  },
  {
    command: "lock production",
    sourceFile: "src/commands/lock.ts",
    guardedEffect: "remote hardening mutation",
    expectImport: true,
  },
  {
    command: "fix live apply",
    sourceFile: "src/commands/fix.ts",
    guardedEffect: "remote configuration mutation",
    expectImport: true,
    notes: "live-apply + rollback + rollback-all + rollback-to share one guard",
  },
  {
    command: "fix rollback",
    sourceFile: "src/commands/fix.ts",
    guardedEffect: "remote configuration restoration",
    expectImport: true,
  },
  {
    command: "fix rollback-all",
    sourceFile: "src/commands/fix.ts",
    guardedEffect: "remote configuration restoration",
    expectImport: true,
  },
  {
    command: "fix rollback-to",
    sourceFile: "src/commands/fix.ts",
    guardedEffect: "remote configuration restoration",
    expectImport: true,
  },
  {
    command: "maintain single",
    sourceFile: "src/commands/maintain.ts",
    guardedEffect: "platform update and optional server reboot",
    expectImport: true,
    notes: "guard placement: BEFORE token collection + snapshot-cost calls",
  },
  {
    command: "maintain --all",
    sourceFile: "src/commands/maintain.ts",
    guardedEffect: "platform update and optional server reboot",
    expectImport: true,
    notes: "guard placement: BEFORE token collection + snapshot-cost calls",
  },
];

const EXCLUDED_FILES = [
  "src/commands/evidence.ts",
  "src/commands/add.ts",
  "src/commands/auth.ts",
  "src/commands/init.ts",
  "src/commands/config.ts",
  "src/commands/list.ts",
  "src/commands/status.ts",
  "src/commands/info.ts",
];

function readSource(relativePath: string): string {
  const abs = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
}

describe("P142 Task 9 — destructive guard inventory", () => {
  it("has an inventory entry for every documented command path", () => {
    expect(INVENTORY.length).toBeGreaterThanOrEqual(12);
    const commands = INVENTORY.map((e) => e.command);
    for (const required of [
      "destroy",
      "remove",
      "restart",
      "restore",
      "snapshot create",
      "snapshot delete",
      "snapshot restore",
      "update",
      "backup cleanup",
      "firewall remove",
      "guard start",
      "guard stop",
      "lock production",
      "fix live apply",
      "fix rollback",
      "fix rollback-all",
      "fix rollback-to",
      "maintain single",
      "maintain --all",
    ]) {
      expect(commands).toContain(required);
    }
  });

  describe.each(INVENTORY)("$command ($sourceFile — $guardedEffect)", (entry) => {
    let source: string;
    beforeAll(() => {
      source = readSource(entry.sourceFile);
    });

    it("imports confirmOrCancel from utils/prompts", () => {
      if (!entry.expectImport) return;
      expect(source).toMatch(
        /import\s*\{\s*confirmOrCancel[^}]*\}\s*from\s*["']\.\.\/\.\.\/utils\/prompts\.js["']/,
      );
    });

    it("calls confirmOrCancel at least once", () => {
      if (!entry.expectImport) return;
      const calls = source.match(/confirmOrCancel\s*\(/g) ?? [];
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("excluded prompt scope discipline (Plan L769-776)", () => {
    for (const rel of EXCLUDED_FILES) {
      it(`${rel} does not use confirmOrCancel (out of scope for destructive guard)`, () => {
        if (!fs.existsSync(path.resolve(process.cwd(), rel))) {
          return;
        }
        const source = readSource(rel);
        expect(source).not.toMatch(/confirmOrCancel\s*\(/);
      });
    }
  });
});
