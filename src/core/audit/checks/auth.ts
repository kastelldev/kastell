/**
 * Authentication & Authorization check parser.
 * Parses sudoers/passwd/shadow output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

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
    id: CHECK_IDS.AUTH.AUTH_NO_NOPASSWD_ALL,
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
    safeToAutoFix: "SAFE",
    explain: "NOPASSWD: ALL allows any sudo command without password, defeating privilege separation.",
  };

  // AUTH-PASSWORD-AGING: Password aging configured
  const passMaxMatch = output.match(/PASS_MAX_DAYS\s+(\d+)/);
  const passMaxDays = passMaxMatch ? parseInt(passMaxMatch[1], 10) : null;
  const auth02: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_PASSWORD_AGING,
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
    safeToAutoFix: "SAFE",
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
    id: CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS,
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
    id: CHECK_IDS.AUTH.AUTH_ROOT_LOGIN_RESTRICTED,
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
    safeToAutoFix: "SAFE",
    explain: "Disabling direct root login forces use of sudo, providing an audit trail.",
  };

  // AUTH-PWD-QUALITY: PAM config has password quality module
  const hasPwQuality = /pam_pwquality/i.test(output) || /pam_cracklib/i.test(output);
  const auth05: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_PWD_QUALITY,
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
    safeToAutoFix: "SAFE",
    explain: "Password quality modules enforce complexity requirements, preventing weak passwords.",
  };

  // NEW CHECKS: expanded auth hardening from authSection() new commands

  // AUTH-FAILLOCK-CONFIGURED: pam_faillock or pam_tally2 configured
  const hasFaillock = /pam_faillock|pam_tally2/i.test(output);
  const auth06: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED,
    category: "Auth",
    name: "Account Lockout Configured",
    severity: "warning",
    passed: isNA ? false : hasFaillock,
    currentValue: isNA
      ? "Unable to determine"
      : hasFaillock
        ? "pam_faillock or pam_tally2 configured"
        : "No account lockout module found in PAM config",
    expectedValue: "pam_faillock or pam_tally2 in PAM config",
    fixCommand: "apt install -y libpam-modules && pam-auth-update  # enable faillock",
    safeToAutoFix: "SAFE",
    explain: "Account lockout after failed logins prevents brute-force password attacks.",
  };

  // AUTH-SHADOW-PERMISSIONS: /etc/shadow permissions 640 or stricter
  const shadowStatMatch = output.match(/^(000|600|640)$/m);
  const shadowPerms = shadowStatMatch ? shadowStatMatch[1] : null;
  const shadowSecure = shadowPerms !== null && ["000", "600", "640"].includes(shadowPerms);
  const auth07: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS,
    category: "Auth",
    name: "/etc/shadow Permissions",
    severity: "critical",
    passed: isNA ? false : shadowSecure,
    currentValue: isNA
      ? "Unable to determine"
      : shadowPerms !== null
        ? `Mode: ${shadowPerms}`
        : "Unable to determine /etc/shadow permissions",
    expectedValue: "/etc/shadow mode 640 or stricter (000 or 600)",
    fixCommand: "chmod 640 /etc/shadow && chown root:shadow /etc/shadow",
    safeToAutoFix: "SAFE",
    explain: "/etc/shadow stores hashed passwords; world-readable access enables offline password cracking.",
  };

  // AUTH-SUDO-LOG: sudo logging configured
  const hasSudoLog = /log_output|syslog/i.test(output);
  const auth08: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_SUDO_LOG,
    category: "Auth",
    name: "Sudo Logging Configured",
    severity: "warning",
    passed: isNA ? false : hasSudoLog,
    currentValue: isNA
      ? "Unable to determine"
      : hasSudoLog
        ? "Sudo logging configured (log_output or syslog)"
        : "Sudo logging not configured",
    expectedValue: "Defaults log_output or Defaults syslog in sudoers",
    fixCommand: "echo 'Defaults log_output' >> /etc/sudoers.d/kastell-logging",
    safeToAutoFix: "SAFE",
    explain: "Sudo command logging provides an audit trail for privileged operations.",
  };

  // AUTH-SUDO-REQUIRETTY: requiretty in sudoers
  const hasRequiretty = /requiretty/i.test(output);
  const auth09: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_SUDO_REQUIRETTY,
    category: "Auth",
    name: "Sudo requiretty Configured",
    severity: "info",
    passed: isNA ? false : hasRequiretty,
    currentValue: isNA
      ? "Unable to determine"
      : hasRequiretty
        ? "requiretty configured in sudoers"
        : "requiretty not configured in sudoers",
    expectedValue: "Defaults requiretty in sudoers",
    fixCommand: "echo 'Defaults requiretty' >> /etc/sudoers.d/kastell-requiretty",
    safeToAutoFix: "SAFE",
    explain: "requiretty prevents sudo from being run from non-interactive shell sessions like cron or scripts.",
  };

  // AUTH-NO-UID0-DUPS: Only root should have UID 0
  // awk output from `awk -F: '($3 == 0) {print $1}' /etc/passwd` lists usernames with UID 0
  // We check for "toor" or any non-root username that could be a UID 0 alias
  const hasOnlyRoot = !output.includes("toor") && !output.match(/^(?!root)[a-z_][a-z0-9_-]{0,31}\s*$/m);
  const auth10: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS,
    category: "Auth",
    name: "No Duplicate UID 0 Accounts",
    severity: "critical",
    passed: isNA ? false : hasOnlyRoot,
    currentValue: isNA
      ? "Unable to determine"
      : hasOnlyRoot
        ? "Only root has UID 0"
        : "Multiple accounts with UID 0 detected",
    expectedValue: "Only root account has UID 0",
    fixCommand: "awk -F: '($3 == 0) {print $1}' /etc/passwd  # review and remove duplicates",
    safeToAutoFix: "SAFE",
    explain: "Multiple UID 0 accounts create hidden backdoor root accounts that bypass normal access controls.",
  };

  // AUTH-PASS-MIN-DAYS: PASS_MIN_DAYS >= 1
  const passMinMatch = output.match(/PASS_MIN_DAYS\s+(\d+)/);
  const passMinDays = passMinMatch ? parseInt(passMinMatch[1], 10) : null;
  const auth11: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_PASS_MIN_DAYS,
    category: "Auth",
    name: "Minimum Password Age",
    severity: "info",
    passed: isNA ? false : passMinDays !== null && passMinDays >= 1,
    currentValue: isNA
      ? "Unable to determine"
      : passMinDays !== null
        ? `PASS_MIN_DAYS = ${passMinDays}`
        : "PASS_MIN_DAYS not configured",
    expectedValue: "PASS_MIN_DAYS >= 1",
    fixCommand: "sed -i 's/^PASS_MIN_DAYS.*/PASS_MIN_DAYS 1/' /etc/login.defs",
    safeToAutoFix: "SAFE",
    explain: "Setting a minimum password age prevents users from immediately reverting to old passwords.",
  };

  // AUTH-PASS-WARN-AGE: PASS_WARN_AGE >= 7
  const passWarnMatch = output.match(/PASS_WARN_AGE\s+(\d+)/);
  const passWarnAge = passWarnMatch ? parseInt(passWarnMatch[1], 10) : null;
  const auth12: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_PASS_WARN_AGE,
    category: "Auth",
    name: "Password Expiry Warning",
    severity: "info",
    passed: isNA ? false : passWarnAge !== null && passWarnAge >= 7,
    currentValue: isNA
      ? "Unable to determine"
      : passWarnAge !== null
        ? `PASS_WARN_AGE = ${passWarnAge}`
        : "PASS_WARN_AGE not configured",
    expectedValue: "PASS_WARN_AGE >= 7",
    fixCommand: "sed -i 's/^PASS_WARN_AGE.*/PASS_WARN_AGE 7/' /etc/login.defs",
    safeToAutoFix: "SAFE",
    explain: "Password expiry warnings give users time to change credentials before they expire.",
  };

  // AUTH-INACTIVE-LOCK: INACTIVE account lock after expiry
  const inactiveMatch = output.match(/INACTIVE\s*=?\s*(\d+)/i);
  const inactiveDays = inactiveMatch ? parseInt(inactiveMatch[1], 10) : null;
  const inactiveConfigured = inactiveDays !== null && inactiveDays >= 0 && inactiveDays <= 90;
  const auth13: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK,
    category: "Auth",
    name: "Inactive Account Auto-Lock",
    severity: "info",
    passed: isNA ? false : inactiveConfigured,
    currentValue: isNA
      ? "Unable to determine"
      : inactiveDays !== null
        ? `INACTIVE = ${inactiveDays} days`
        : "INACTIVE not configured",
    expectedValue: "INACTIVE set to a value between 0 and 90",
    fixCommand: "sed -i 's/^#\\?INACTIVE.*/INACTIVE=30/' /etc/default/useradd",
    safeToAutoFix: "SAFE",
    explain: "Automatically disabling inactive accounts reduces the attack surface from stale credentials.",
  };

  // AUTH-SUDO-WHEEL-ONLY: sudo group has limited members (<= 3)
  // Parse the sudo group line: "sudo:x:27:admin,user1"
  const sudoGroupMatch = output.match(/sudo:x:\d+:([^\n]*)/);
  const sudoMembers = sudoGroupMatch
    ? sudoGroupMatch[1].split(",").map((m) => m.trim()).filter(Boolean)
    : [];
  const auth14: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_SUDO_WHEEL_ONLY,
    category: "Auth",
    name: "Limited Sudo Group Members",
    severity: "info",
    passed: isNA ? false : sudoMembers.length <= 3,
    currentValue: isNA
      ? "Unable to determine"
      : sudoMembers.length > 0
        ? `${sudoMembers.length} sudo member(s): ${sudoMembers.join(", ")}`
        : "No sudo group members found",
    expectedValue: "3 or fewer accounts in sudo group",
    fixCommand: "gpasswd -d username sudo  # remove unnecessary sudo members",
    safeToAutoFix: "SAFE",
    explain: "Limiting sudo group membership to essential accounts reduces privilege escalation exposure.",
  };

  // AUTH-MFA-PRESENT: MFA package installed
  const hasMFA = /libpam-google-authenticator|libpam-oath/i.test(output);
  const auth15: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_MFA_PRESENT,
    category: "Auth",
    name: "MFA Package Installed",
    severity: "info",
    passed: isNA ? false : hasMFA,
    currentValue: isNA
      ? "Unable to determine"
      : hasMFA
        ? "MFA package detected (libpam-google-authenticator or libpam-oath)"
        : "No MFA package installed",
    expectedValue: "libpam-google-authenticator or libpam-oath installed",
    fixCommand: "apt install -y libpam-google-authenticator  # then configure per-user with google-authenticator",
    safeToAutoFix: "SAFE",
    explain: "Multi-factor authentication significantly reduces account compromise risk from stolen passwords.",
  };

  // AUTH-SU-RESTRICTED: su restricted to wheel group via pam_wheel
  const hasPamWheel = /pam_wheel/i.test(output);
  const auth16: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_SU_RESTRICTED,
    category: "Auth",
    name: "su Restricted to Wheel Group",
    severity: "info",
    passed: isNA ? false : hasPamWheel,
    currentValue: isNA
      ? "Unable to determine"
      : hasPamWheel
        ? "pam_wheel configured in /etc/pam.d/su"
        : "pam_wheel not found in /etc/pam.d/su",
    expectedValue: "pam_wheel configured in /etc/pam.d/su",
    fixCommand: "echo 'auth required pam_wheel.so use_uid' >> /etc/pam.d/su",
    safeToAutoFix: "SAFE",
    explain: "Restricting su to the wheel group prevents unprivileged users from attempting root password guesses.",
  };

  // AUTH-PASS-MAX-DAYS-SET: PASS_MAX_DAYS configured and reasonable
  const passMaxDaysSetMatch = output.match(/PASS_MAX_DAYS\s+(\d+)/);
  const passMaxDaysSet = passMaxDaysSetMatch ? parseInt(passMaxDaysSetMatch[1], 10) : null;
  const auth17: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_PASS_MAX_DAYS_SET,
    category: "Auth",
    name: "Password Maximum Age Configured",
    severity: "info",
    passed: isNA ? false : passMaxDaysSet !== null && passMaxDaysSet <= 365 && passMaxDaysSet > 0,
    currentValue: isNA
      ? "Unable to determine"
      : passMaxDaysSet !== null
        ? `PASS_MAX_DAYS = ${passMaxDaysSet}`
        : "PASS_MAX_DAYS not configured",
    expectedValue: "PASS_MAX_DAYS > 0 and <= 365",
    fixCommand: "sed -i 's/^PASS_MAX_DAYS.*/PASS_MAX_DAYS 90/' /etc/login.defs",
    safeToAutoFix: "SAFE",
    explain: "Password maximum age ensures credentials are rotated periodically, limiting exposure from compromised passwords.",
  };

  // AUTH-GSHADOW-PERMISSIONS: /etc/gshadow permissions restrictive
  // stat -c '%a' /etc/gshadow — match a standalone permission value
  // We need to find it differently from shadow perms — look for second standalone number
  const allPermMatches = output.match(/^(000|600|640|660|644|755|750|700|770)$/gm) ?? [];
  // Shadow is first, gshadow is second (both from stat commands)
  const gshadowPerms = allPermMatches.length >= 2 ? allPermMatches[1] : null;
  const gshadowSecure = gshadowPerms !== null && ["000", "600", "640"].includes(gshadowPerms);
  const auth18: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_GSHADOW_PERMISSIONS,
    category: "Auth",
    name: "/etc/gshadow Permissions",
    severity: "warning",
    passed: isNA ? false : gshadowSecure,
    currentValue: isNA
      ? "Unable to determine"
      : gshadowPerms !== null
        ? `Mode: ${gshadowPerms}`
        : "Unable to determine /etc/gshadow permissions",
    expectedValue: "/etc/gshadow mode 640 or stricter (000 or 600)",
    fixCommand: "chmod 640 /etc/gshadow && chown root:shadow /etc/gshadow",
    safeToAutoFix: "SAFE",
    explain: "World-readable /etc/gshadow exposes group password hashes to local attackers.",
  };

  // AUTH-PWQUALITY-CONFIGURED: pam_pwquality or pam_cracklib in PAM config files
  // grep -rE 'pam_pwquality|pam_cracklib' /etc/pam.d/ output
  const hasPwqualityConfig = /pam_pwquality|pam_cracklib/i.test(output);
  const auth19: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_PWQUALITY_CONFIGURED,
    category: "Auth",
    name: "PAM Password Quality Module Configured",
    severity: "warning",
    passed: isNA ? false : hasPwqualityConfig,
    currentValue: isNA
      ? "Unable to determine"
      : hasPwqualityConfig
        ? "pam_pwquality or pam_cracklib configured in /etc/pam.d/"
        : "No password quality module in /etc/pam.d/",
    expectedValue: "pam_pwquality or pam_cracklib in /etc/pam.d/",
    fixCommand: "apt install libpam-pwquality && echo 'password requisite pam_pwquality.so retry=3 minlen=12' >> /etc/pam.d/common-password",
    safeToAutoFix: "SAFE",
    explain: "PAM password quality modules enforce minimum complexity requirements, preventing trivially guessable passwords.",
  };

  // AUTH-UMASK-LOGIN-DEFS: UMASK in /etc/login.defs is 027 or 022
  const umaskMatch = output.match(/^UMASK\s+(\d+)/m);
  const umaskValue = umaskMatch ? umaskMatch[1] : null;
  const umaskSecure = umaskValue !== null && (umaskValue === "027" || umaskValue === "022");
  const auth20: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_UMASK_LOGIN_DEFS,
    category: "Auth",
    name: "Default UMASK Configured Securely",
    severity: "info",
    passed: isNA ? false : umaskSecure,
    currentValue: isNA
      ? "Unable to determine"
      : umaskValue !== null
        ? `UMASK = ${umaskValue}`
        : "UMASK not set in /etc/login.defs",
    expectedValue: "UMASK 027 or 022 in /etc/login.defs",
    fixCommand: "sed -i 's/^UMASK.*/UMASK 027/' /etc/login.defs",
    safeToAutoFix: "SAFE",
    explain: "Default UMASK in login.defs controls file permissions for newly created user files, preventing world-readable defaults.",
  };

  // AUTH-SHA512-HASH: ENCRYPT_METHOD is SHA512 or YESCRYPT
  const encryptMethodMatch = output.match(/^ENCRYPT_METHOD\s+(\S+)/m);
  const encryptMethod = encryptMethodMatch ? encryptMethodMatch[1].toUpperCase() : null;
  const encryptSecure = encryptMethod === "SHA512" || encryptMethod === "YESCRYPT";
  const auth21: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_SHA512_HASH,
    category: "Auth",
    name: "Strong Password Hash Algorithm",
    severity: "warning",
    passed: isNA ? false : encryptSecure,
    currentValue: isNA
      ? "Unable to determine"
      : encryptMethod !== null
        ? `ENCRYPT_METHOD = ${encryptMethod}`
        : "ENCRYPT_METHOD not configured",
    expectedValue: "ENCRYPT_METHOD SHA512 or YESCRYPT",
    fixCommand: "sed -i 's/^ENCRYPT_METHOD.*/ENCRYPT_METHOD SHA512/' /etc/login.defs",
    safeToAutoFix: "SAFE",
    explain: "SHA512 or yescrypt password hashing is computationally expensive, making offline brute-force attacks significantly harder.",
  };

  // AUTH-PWQUALITY-MINLEN: minlen >= 12 in /etc/security/pwquality.conf
  const pwqualityMinlenMatch = output.match(/\bminlen\s*=\s*(\d+)/i);
  const pwqualityMinlen = pwqualityMinlenMatch ? parseInt(pwqualityMinlenMatch[1], 10) : null;
  const minlenSecure = pwqualityMinlen !== null && pwqualityMinlen >= 12;
  const auth22: AuditCheck = {
    id: CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN,
    category: "Auth",
    name: "Password Minimum Length Configured",
    severity: "warning",
    passed: isNA ? false : minlenSecure,
    currentValue: isNA
      ? "Unable to determine"
      : pwqualityMinlen !== null
        ? `minlen = ${pwqualityMinlen}`
        : "minlen not configured in pwquality.conf",
    expectedValue: "minlen >= 12 in /etc/security/pwquality.conf",
    fixCommand: "echo 'minlen = 14' >> /etc/security/pwquality.conf",
    safeToAutoFix: "SAFE",
    explain: "Minimum password length of 12+ characters exponentially increases brute-force difficulty.",
  };

  return [auth01, auth02, auth03, auth04, auth05, auth06, auth07, auth08, auth09, auth10, auth11, auth12, auth13, auth14, auth15, auth16, auth17, auth18, auth19, auth20, auth21, auth22];
};
