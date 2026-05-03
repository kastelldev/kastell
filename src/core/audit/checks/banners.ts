/**
 * Banners security check parser.
 * Checks login banners, MOTD, SSH banner, and OS info disclosure.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface BannersCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const BANNERS_CHECKS: BannersCheckDef[] = [
  {
    id: CHECK_IDS.BANNERS.BANNER_ISSUE_EXISTS,
    name: "/etc/issue Login Banner Exists",
    severity: "info",
    check: (output) => {
      const hasBanner = output.includes("/etc/issue") ||
        (!output.includes("MISSING") && output.length > 10 && !/^\s*\\[rsnmvl]/i.test(output.trim()));
      // Check if the content is more than just escape sequences
      const content = output.replace(/\\[rsnmvl]/g, "").trim();
      const exists = hasBanner && content.length > 0;
      return {
        passed: exists,
        currentValue: exists
          ? "/etc/issue contains a login banner"
          : "/etc/issue is empty or missing",
      };
    },
    expectedValue: "/etc/issue contains a warning banner",
    fixCommand:
      "echo 'Authorized access only. All activity is monitored and logged.' > /etc/issue",
    safeToAutoFix: "SAFE",
    explain:
      "A login banner provides legal notice to potential intruders, which may be required for prosecution in some jurisdictions.",
  },
  {
    id: CHECK_IDS.BANNERS.BANNER_ISSUE_NET_EXISTS,
    name: "/etc/issue.net Banner Exists",
    severity: "info",
    check: (output) => {
      const hasIssueNet = /issue\.net/i.test(output);
      const content = output.replace(/\\[rsnmvl]/g, "").trim();
      const exists = hasIssueNet && !output.includes("MISSING") && content.length > 5;
      return {
        passed: exists,
        currentValue: exists
          ? "/etc/issue.net contains a network banner"
          : "/etc/issue.net is empty or missing",
      };
    },
    expectedValue: "/etc/issue.net contains a network login banner",
    fixCommand:
      "echo 'Authorized access only. All activity is monitored and logged.' > /etc/issue.net",
    safeToAutoFix: "SAFE",
    explain:
      "The issue.net file provides a pre-login banner for network services like SSH, serving as a legal deterrent.",
  },
  {
    id: CHECK_IDS.BANNERS.BANNER_MOTD_EXISTS,
    name: "/etc/motd Message of the Day Exists",
    severity: "info",
    check: (output) => {
      const hasMotd = /motd/i.test(output) && !output.includes("MISSING");
      return {
        passed: hasMotd,
        currentValue: hasMotd
          ? "/etc/motd is configured"
          : "/etc/motd is empty or missing",
      };
    },
    expectedValue: "/etc/motd contains a message for authenticated users",
    fixCommand:
      "echo 'This system is for authorized use only.' > /etc/motd",
    safeToAutoFix: "SAFE",
    explain:
      "The message of the day is shown after login and can remind users of security policies and acceptable use.",
  },
  {
    id: CHECK_IDS.BANNERS.BANNER_SSH_BANNER,
    name: "SSH Warning Banner Configured",
    severity: "info",
    check: (output) => {
      // grep -i '^Banner' from sshd_config or sshd -T
      const bannerMatch = output.match(/(?:^|\n)\s*[Bb]anner\s+(.+)/);
      if (!bannerMatch) return { passed: false, currentValue: "SSH Banner not configured" };
      const bannerPath = bannerMatch[1].trim();
      const passed = bannerPath !== "none" && bannerPath !== "" && bannerPath !== "/dev/null";
      return {
        passed,
        currentValue: passed
          ? `SSH Banner: ${bannerPath}`
          : "SSH Banner set to none or /dev/null",
      };
    },
    expectedValue: "SSH Banner points to a file (e.g., /etc/issue.net)",
    fixCommand:
      "echo 'Banner /etc/issue.net' >> /etc/ssh/sshd_config && systemctl restart sshd",
    safeToAutoFix: "GUARDED",
    explain:
      "An SSH banner displays a warning message before authentication, providing legal notice and deterring unauthorized access.",
  },
  {
    id: CHECK_IDS.BANNERS.BANNER_NO_OS_INFO,
    name: "Banners Hide OS Version Info",
    severity: "info",
    check: (output) => {
      const osPatterns =
        /\b(Ubuntu|Debian|CentOS|Red Hat|RHEL|Fedora|AlmaLinux|Rocky|SUSE|Arch)\b/i;
      const hasOsInfo = osPatterns.test(output);
      return {
        passed: !hasOsInfo,
        currentValue: hasOsInfo
          ? "Banner discloses OS distribution information"
          : "Banners do not reveal OS distribution",
      };
    },
    expectedValue: "No OS version info in /etc/issue or /etc/issue.net",
    fixCommand:
      "echo 'Authorized access only.' > /etc/issue && echo 'Authorized access only.' > /etc/issue.net",
    safeToAutoFix: "SAFE",
    explain:
      "OS version disclosure in banners helps attackers identify specific vulnerabilities for the server's distribution and version.",
  },
  {
    id: CHECK_IDS.BANNERS.BNR_ISSUE_NET_SET,
    name: "/etc/issue.net Contains a Warning Banner",
    severity: "info",
    check: (output) => {
      // The banners section has: cat /etc/issue.net output
      // Fail if MISSING, too short, or contains OS identifiers
      const isMissing = output.includes("MISSING");
      const osIdentifiers = /\b(Ubuntu|Debian|CentOS|Red Hat|RHEL|Fedora|AlmaLinux|Rocky|SUSE|Arch)\b/i;
      const content = output.replace(/MISSING/g, "").trim();
      const passed = !isMissing && content.length > 10 && !osIdentifiers.test(content);
      return {
        passed,
        currentValue: passed
          ? "/etc/issue.net contains a generic warning banner"
          : isMissing
            ? "/etc/issue.net is missing"
            : content.length <= 10
              ? "/etc/issue.net content is too short"
              : "/etc/issue.net discloses OS version information",
      };
    },
    expectedValue: "/etc/issue.net has a warning banner without OS version identifiers",
    fixCommand: "echo 'Authorized users only. All activity may be monitored.' > /etc/issue.net",
    safeToAutoFix: "SAFE",
    explain:
      "A network login banner provides legal notice to unauthorized users and is required by many compliance frameworks.",
  },
];

export const parseBannersChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return BANNERS_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Banners",
        name: def.name,
        severity: def.severity,
        passed: false,
        currentValue: "Unable to determine",
        expectedValue: def.expectedValue,
        fixCommand: def.fixCommand,
        safeToAutoFix: def.safeToAutoFix,
        explain: def.explain,
      };
    }
    const { passed, currentValue } = def.check(output);
    return {
      id: def.id,
      category: "Banners",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      safeToAutoFix: def.safeToAutoFix,
      explain: def.explain,
    };
  });
};
