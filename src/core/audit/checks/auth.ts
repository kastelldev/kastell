/**
 * Authentication & Authorization check parser.
 * Parses sudoers/passwd/shadow output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";

export const parseAuthChecks: CheckParser = (sectionOutput: string, _platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  // Output sections from commands.ts authSection():
  // - PAM config (common-auth first 20 lines)
  // - sudo group members
  // - Password aging policy (PASS_MAX_DAYS, PASS_MIN_DAYS, PASS_WARN_AGE)
  // - Users with empty passwords (awk on shadow)

  // AUTH-NO-NOPASSWD-ALL: No NOPASSWD: ALL in sudoers
  const hasNopasswdAll = /NOPASSWD:\s*ALL/i.test(output);
  const auth01: AuditCheck = {
    id: "AUTH-NO-NOPASSWD-ALL",
    category: "Auth",
    name: "No Passwordless Sudo (ALL)",
    severity: "critical",
    passed: isNA ? false : !hasNopasswdAll,
    currentValue: isNA
      ? "Unable to determine"
      : hasNopasswdAll
        ? "NOPASSWD: ALL found in sudo config"
        : "No NOPASSWD: ALL rules found",
    expectedValue: "No NOPASSWD: ALL in sudoers",
    fixCommand: "visudo  # Remove NOPASSWD: ALL entries",
    explain: "NOPASSWD: ALL allows any sudo command without password, defeating privilege separation.",
  };

  // AUTH-PASSWORD-AGING: Password aging configured
  const passMaxMatch = output.match(/PASS_MAX_DAYS\s+(\d+)/);
  const passMaxDays = passMaxMatch ? parseInt(passMaxMatch[1], 10) : null;
  const auth02: AuditCheck = {
    id: "AUTH-PASSWORD-AGING",
    category: "Auth",
    name: "Password Aging Policy",
    severity: "info",
    passed: isNA ? false : passMaxDays !== null,
    currentValue: isNA
      ? "Unable to determine"
      : passMaxDays !== null
        ? `PASS_MAX_DAYS = ${passMaxDays}`
        : "Password aging not configured",
    expectedValue: "PASS_MAX_DAYS configured",
    fixCommand: "sed -i 's/^PASS_MAX_DAYS.*/PASS_MAX_DAYS 90/' /etc/login.defs",
    explain: "Password aging forces periodic credential rotation, limiting exposure from compromised passwords.",
  };

  // AUTH-NO-EMPTY-PASSWORDS: No empty password accounts
  // The shadow awk output lists usernames with empty passwords
  // If output is N/A or empty for that section, no empty passwords
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  // Find lines that look like usernames (no special chars, not config lines)
  const emptyPwUsers: string[] = [];
  for (const line of lines) {
    // Skip config lines, status lines, group lines
    if (line.includes("=") || line.includes(":x:") || line.includes("pam_") ||
        line.includes("PASS_") || line.includes("auth ") || line.includes("password ") ||
        line === "N/A" || line.includes("sudo") || line.includes("requisite") ||
        line.includes("session") || line.includes("account") || line.includes("include") ||
        line.includes("optional") || line.includes("required") || line.includes("sufficient") ||
        line.includes("nullok") || line.includes("common") || line.includes("substack")) {
      continue;
    }
    // Simple username pattern (alphanumeric, no spaces, short)
    if (/^[a-z_][a-z0-9_-]{0,31}$/i.test(line)) {
      emptyPwUsers.push(line);
    }
  }
  const auth03: AuditCheck = {
    id: "AUTH-NO-EMPTY-PASSWORDS",
    category: "Auth",
    name: "No Empty Password Accounts",
    severity: "critical",
    passed: isNA ? false : emptyPwUsers.length === 0,
    currentValue: isNA
      ? "Unable to determine"
      : emptyPwUsers.length > 0
        ? `Empty password account(s): ${emptyPwUsers.join(", ")}`
        : "No accounts with empty passwords",
    expectedValue: "No accounts with empty passwords",
    fixCommand: emptyPwUsers.length > 0
      ? `passwd -l ${emptyPwUsers[0]}`
      : "awk -F: '($2 == \"\") {print $1}' /etc/shadow",
    explain: "Accounts with empty passwords can be accessed by anyone without credentials.",
  };

  // AUTH-ROOT-LOGIN-RESTRICTED: Root direct login disabled
  // Check for PermitRootLogin in SSH context or root password status
  const rootDirectLogin = /^root$/m.test(output) && !output.includes("prohibit-password");
  const auth04: AuditCheck = {
    id: "AUTH-ROOT-LOGIN-RESTRICTED",
    category: "Auth",
    name: "Root Direct Login Restricted",
    severity: "warning",
    passed: isNA ? false : !rootDirectLogin,
    currentValue: isNA
      ? "Unable to determine"
      : rootDirectLogin
        ? "Root direct login may be enabled"
        : "Root direct login restricted",
    expectedValue: "Root direct login disabled or key-only",
    fixCommand: "passwd -l root",
    explain: "Disabling direct root login forces use of sudo, providing an audit trail.",
  };

  // AUTH-PWD-QUALITY: PAM config has password quality module
  const hasPwQuality = /pam_pwquality/i.test(output) || /pam_cracklib/i.test(output);
  const auth05: AuditCheck = {
    id: "AUTH-PWD-QUALITY",
    category: "Auth",
    name: "Password Quality Module",
    severity: "info",
    passed: isNA ? false : hasPwQuality,
    currentValue: isNA
      ? "Unable to determine"
      : hasPwQuality
        ? "Password quality module configured"
        : "No password quality module found",
    expectedValue: "pam_pwquality or pam_cracklib configured",
    fixCommand: "apt install -y libpam-pwquality && pam-auth-update",
    explain: "Password quality modules enforce complexity requirements, preventing weak passwords.",
  };

  return [auth01, auth02, auth03, auth04, auth05];
};
