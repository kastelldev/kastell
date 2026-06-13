import { renderForbiddenBlock } from "../../src/commands/fix.js";
import type { FixPreview } from "../../src/core/audit/fix.js";

const mk = (checkId: string, command: string, reason = "test reason"): FixPreview =>
  ({ checkId, command, tier: "FORBIDDEN", forbiddenReason: reason });

describe("renderForbiddenBlock", () => {
  it("returns empty string when includeForbidden is false", () => {
    expect(renderForbiddenBlock([mk("X", "rm -rf /")], false)).toBe("");
  });

  it("returns empty string when forbiddenFixes is empty", () => {
    expect(renderForbiddenBlock([], true)).toBe("");
  });

  it("renders header and indexed list when populated", () => {
    const out = renderForbiddenBlock([mk("CHECK-A", "echo a"), mk("CHECK-B", "echo b")], true);
    expect(out).toContain("=== FORBIDDEN fixes");
    expect(out).toContain("[F1] CHECK-A — echo a");
    expect(out).toContain("[F2] CHECK-B — echo b");
  });

  it("truncates commands longer than 80 chars with ellipsis", () => {
    const longCmd = "sed -i 's/PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && systemctl restart sshd";
    const out = renderForbiddenBlock([mk("SSH-ROOT", longCmd)], true);
    expect(out).toContain("…");
    const line = out.split("\n").find((l) => l.includes("SSH-ROOT"))!;
    const cmdPart = line.split(" — ")[1];
    expect(cmdPart.length).toBeLessThanOrEqual(80);
    expect(cmdPart.endsWith("…")).toBe(true);
  });

  it("does not truncate commands shorter than 80 chars", () => {
    const shortCmd = "ufw default deny incoming";
    const out = renderForbiddenBlock([mk("UFW-DENY", shortCmd)], true);
    expect(out).toContain(`[F1] UFW-DENY — ${shortCmd}`);
    expect(out).not.toContain("…");
  });

  it("[P142 Task 10] renders [F1] CHECK-ID — command — reason: <forbiddenReason>", () => {
    const out = renderForbiddenBlock([mk("SSH-PWD-AUTH", "sed -i ...", "Disabling password auth may lock out operators without key-based access")], true);
    expect(out).toContain("[F1] SSH-PWD-AUTH — sed -i ... — reason: Disabling password auth may lock out operators without key-based access");
  });
});
