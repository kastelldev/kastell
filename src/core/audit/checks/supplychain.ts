/**
 * Supply Chain Integrity security check parser.
 * Parses APT repository HTTPS enforcement, trusted GPG key presence,
 * unsigned package detection, apt-key deprecation, repo signature
 * verification, and unauthorized source detection.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface SupplyChainCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const SUPPLY_CHECKS: SupplyChainCheckDef[] = [
  {
    id: "SUPPLY-APT-HTTPS-REPOS",
    name: "APT Repositories Use HTTPS",
    severity: "critical",
    check: (output) => {
      // Detect http:// URLs in apt-cache policy or sources.list output
      // Exclude https:// matches — only plain http:// is a finding
      const httpMatch = output.match(/\bhttp:\/\/[^\s]+/g);
      const hasInsecureRepos = httpMatch !== null && httpMatch.length > 0;
      if (hasInsecureRepos) {
        return {
          passed: false,
          currentValue: `APT repos using unencrypted HTTP: ${httpMatch!.slice(0, 3).join(", ")}`,
        };
      }
      return { passed: true, currentValue: "All detected APT repositories use HTTPS" };
    },
    expectedValue: "All APT repository URLs begin with https://",
    fixCommand:
      "# Edit /etc/apt/sources.list and /etc/apt/sources.list.d/*.list: replace http:// with https://\nsed -i 's|http://|https://|g' /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null",
    explain:
      "APT repositories using plain HTTP (not HTTPS) are vulnerable to man-in-the-middle attacks that could inject malicious packages. An attacker between the server and the mirror can replace legitimate packages with trojaned versions.",
  },
  {
    id: "SUPPLY-GPG-KEYS-TRUSTED",
    name: "APT Trusted GPG Keys Present",
    severity: "warning",
    check: (output) => {
      const keysPresent = output.includes("KEYS_PRESENT");
      const noKeys = output.includes("NO_KEYS");
      if (keysPresent) {
        return { passed: true, currentValue: "Trusted APT GPG keys present in /etc/apt/trusted.gpg.d/" };
      }
      if (noKeys) {
        return { passed: false, currentValue: "No trusted GPG keys found in /etc/apt/trusted.gpg.d/" };
      }
      // Fallback: check for .gpg or .asc files in output
      const hasKeyFiles = /\.gpg|\.asc/.test(output);
      return {
        passed: hasKeyFiles,
        currentValue: hasKeyFiles
          ? "GPG key files detected in trusted.gpg.d/"
          : "No GPG key files detected in trusted.gpg.d/",
      };
    },
    expectedValue: "APT trusted.gpg.d/ contains at least one GPG key",
    fixCommand:
      "# Add missing GPG key for your repository:\ncurl -fsSL https://packages.example.com/gpg | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/example.gpg",
    explain:
      "APT package signature verification relies on trusted GPG keys in /etc/apt/trusted.gpg.d/. Without trusted keys, package authenticity cannot be verified and apt may install unsigned or improperly signed packages silently.",
  },
  {
    id: "SUPPLY-NO-UNSIGNED-PACKAGES",
    name: "No Unsigned APT Packages Installed",
    severity: "critical",
    check: (output) => {
      const noUnsigned = output.includes("NO_UNSIGNED_PACKAGES");
      const hasUnsigned = output.includes("UNSIGNED_PACKAGES");
      if (noUnsigned) {
        return { passed: true, currentValue: "No unsigned packages detected via dpkg/apt audit" };
      }
      if (hasUnsigned) {
        return { passed: false, currentValue: "Unsigned packages found — these bypass signature verification" };
      }
      // If "Listing..." present without unsigned markers, treat as pass
      const hasListingOutput = output.includes("Listing...");
      return {
        passed: hasListingOutput,
        currentValue: hasListingOutput
          ? "APT package list available, no unsigned packages detected"
          : "Unable to determine unsigned package status",
      };
    },
    expectedValue: "All installed packages are GPG-signed by their repository",
    fixCommand:
      "# Remove unsigned packages and re-install from trusted repos:\napt-get install --reinstall $(dpkg-query -W --showformat='${Package}\\n' 2>/dev/null | head -50)",
    explain:
      "Unsigned packages bypass APT's GPG verification, meaning they were not authenticated by any trusted key. Malicious actors could substitute unsigned packages during download or through compromised mirrors without detection.",
  },
  {
    id: "SUPPLY-APT-KEY-DEPRECATED",
    name: "apt-key Not Used (Deprecated)",
    severity: "warning",
    check: (output) => {
      // apt-key deprecated warning appears in combined stderr+stdout output
      // Ubuntu 22.04+ shows "Warning: apt-key is deprecated" message
      const hasDeprecatedWarning = /deprecated/i.test(output) && !/APT_KEY_UNAVAIL/.test(output) && !/NO_APT_KEY_DEPRECATED/.test(output);
      const isUnavail = output.includes("APT_KEY_UNAVAIL");
      if (isUnavail) {
        // apt-key not installed = not deprecated = pass
        return { passed: true, currentValue: "apt-key not installed (not applicable)" };
      }
      if (hasDeprecatedWarning) {
        return { passed: false, currentValue: "apt-key in use — deprecated and scheduled for removal" };
      }
      return { passed: true, currentValue: "No apt-key deprecation warning detected" };
    },
    expectedValue: "GPG keys managed via /etc/apt/trusted.gpg.d/ (not apt-key)",
    fixCommand:
      "# Migrate keys from legacy apt-key keyring to trusted.gpg.d/:\napt-key list 2>/dev/null | grep -E '^pub' -A2 | grep -oP '(?<=/)[0-9A-F]{8,}' | while read keyid; do apt-key export $keyid | gpg --dearmor > /etc/apt/trusted.gpg.d/$keyid.gpg; done; apt-key del $keyid",
    explain:
      "apt-key is deprecated in Ubuntu 22.04+ and will be removed in future releases. It stores all keys in a single shared keyring (/etc/apt/trusted.gpg), meaning any trusted key can sign any package. Per-repository keys in trusted.gpg.d/ provide isolation.",
  },
  {
    id: "SUPPLY-REPOS-SIGNED",
    name: "APT Repository Metadata Is Signed",
    severity: "warning",
    check: (output) => {
      const hasSigned = output.includes("REPOS_HAVE_SIGNATURES");
      const hasUnsigned = output.includes("REPOS_NO_SIGNATURES");
      if (hasSigned) {
        return { passed: true, currentValue: "APT repository metadata appears signed" };
      }
      if (hasUnsigned) {
        return { passed: false, currentValue: "APT repository metadata signature not verified" };
      }
      return { passed: true, currentValue: "Repository signature status indeterminate" };
    },
    expectedValue: "APT repository Release/InRelease files are GPG-signed",
    fixCommand:
      "# Ensure repositories have signed Release files:\napt-get update --allow-unauthenticated 2>&1 | grep -i 'NO_PUBKEY\\|EXPKEYSIG' | awk '{print $NF}' | xargs -I{} apt-key adv --recv-keys {}",
    explain:
      "APT verifies repository metadata (Release/InRelease files) against GPG signatures before downloading package indexes. Unsigned or unverified repository metadata allows a compromised mirror to serve malicious package lists.",
  },
  {
    id: "SUPPLY-GPG-VERIFY-OK",
    name: "GPG Signature Verification Operational",
    severity: "info",
    check: (output) => {
      const verifyOk = output.includes("GPG_VERIFY_OK");
      const verifyFail = output.includes("GPG_VERIFY_FAIL");
      if (verifyOk) {
        return { passed: true, currentValue: "GPG signature verification is operational" };
      }
      if (verifyFail) {
        return { passed: false, currentValue: "GPG signature verification reported failures" };
      }
      return { passed: true, currentValue: "GPG verification status indeterminate" };
    },
    expectedValue: "GPG signature verification succeeds for installed packages",
    fixCommand:
      "# Re-import missing GPG keys:\napt-get update 2>&1 | grep 'NO_PUBKEY' | awk '{print $NF}' | sort -u | xargs -I{} sudo apt-key adv --keyserver keyserver.ubuntu.com --recv-keys {}",
    explain:
      "GPG verification operational status confirms that package signature checks are functioning correctly. Failed verification may indicate expired keys, missing keyrings, or a compromised keyring configuration.",
  },
  {
    id: "SUPPLY-NO-UNAUTH-SOURCES",
    name: "No Unauthorized Package Sources",
    severity: "warning",
    check: (output) => {
      const hasUnauth = output.includes("UNAUTH_SOURCES_FOUND");
      const noUnauth = output.includes("NO_UNAUTH_SOURCES");
      if (noUnauth) {
        return { passed: true, currentValue: "No unauthorized package sources detected in sources.list" };
      }
      if (hasUnauth) {
        return { passed: false, currentValue: "Unauthorized or unknown package sources found in APT configuration" };
      }
      return { passed: true, currentValue: "Package source authorization status indeterminate" };
    },
    expectedValue: "All APT sources are official distribution or known third-party repos",
    fixCommand:
      "# Review and remove unauthorized sources:\ncat /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null | grep -v '^#' | grep '^deb'",
    explain:
      "Unauthorized or unexpected package sources in APT configuration may indicate a supply chain compromise or misconfiguration. All package sources should be intentional, official, and properly signed by known keys.",
  },
  {
    id: "SUPPLY-DPKG-AUDIT-CLEAN",
    name: "dpkg Audit Finds No Broken Packages",
    severity: "info",
    check: (output) => {
      // Check for dpkg audit output or apt-get check output
      const isClean = /Listing\.\.\.\s*$/.test(output.trim()) || output.includes("NO_DPKG_ERRORS");
      const hasBroken = output.includes("DPKG_ERRORS") || /broken package/.test(output);
      if (hasBroken) {
        return { passed: false, currentValue: "dpkg audit detected broken or partially installed packages" };
      }
      if (isClean) {
        return { passed: true, currentValue: "dpkg audit clean — no broken packages" };
      }
      return { passed: true, currentValue: "dpkg audit status indeterminate" };
    },
    expectedValue: "dpkg --audit returns no broken or partially installed packages",
    fixCommand:
      "dpkg --configure -a && apt-get install -f -y",
    explain:
      "Broken or partially installed packages may indicate interrupted updates, package conflicts, or attempted supply chain attacks. dpkg --audit identifies packages in inconsistent states that could be leveraged by attackers or cause service failures.",
  },
  {
    id: "SUPPLY-NO-INSECURE-REPOS",
    name: "No AllowInsecureRepositories or AllowUnauthenticated in APT Config",
    severity: "warning",
    check: (output) => {
      // apt-config dump returns lines or "NONE"
      if (output.includes("NONE")) {
        return { passed: true, currentValue: "No insecure APT configuration options found" };
      }
      // Check for dangerous settings being set to true
      const hasInsecure = /AllowUnauthenticated\s*"?true"?/i.test(output) ||
        /AllowInsecureRepositories\s*"?true"?/i.test(output);
      return {
        passed: !hasInsecure,
        currentValue: hasInsecure
          ? "APT configured to allow unauthenticated or insecure repositories"
          : "No AllowUnauthenticated/AllowInsecureRepositories settings detected",
      };
    },
    expectedValue: "No AllowUnauthenticated or AllowInsecureRepositories set to true in apt config",
    fixCommand: "Remove AllowUnauthenticated and AllowInsecureRepositories from apt configuration",
    explain:
      "Allowing unauthenticated or insecure repositories enables package tampering via man-in-the-middle attacks.",
  },
  {
    id: "SUPPLY-GPG-KEYS-PRESENT",
    name: "GPG Keys Present for Repository Verification",
    severity: "info",
    check: (output) => {
      // ls /etc/apt/trusted.gpg.d/ returns filenames or "NONE"
      const hasKeyFiles = /\.gpg\b|\.asc\b/.test(output);
      const isNone = output.trim() === "NONE" || output.trim() === "";
      return {
        passed: hasKeyFiles && !isNone,
        currentValue: hasKeyFiles
          ? "GPG key files found in /etc/apt/trusted.gpg.d/"
          : "No GPG key files in /etc/apt/trusted.gpg.d/",
      };
    },
    expectedValue: "At least one .gpg or .asc file in /etc/apt/trusted.gpg.d/",
    fixCommand: "# Add GPG key: curl -fsSL https://packages.example.com/gpg | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/example.gpg",
    explain:
      "GPG keys in the trusted keyring ensure package integrity verification during apt operations.",
  },
  {
    id: "SUPPLY-PACKAGE-VERIFY-CLEAN",
    name: "dpkg Package File Integrity Verified",
    severity: "warning",
    check: (output) => {
      // dpkg --verify | wc -l output — count of modified package files
      const match = output.match(/\b(\d+)\b/);
      if (!match) return { passed: false, currentValue: "Unable to determine modified package file count" };
      const count = parseInt(match[1], 10);
      return {
        passed: count <= 5,
        currentValue: `${count} modified package file(s) detected by dpkg --verify`,
      };
    },
    expectedValue: "5 or fewer modified package files (small intentional modifications are normal)",
    fixCommand: "dpkg --verify — investigate modified files and reinstall affected packages",
    explain:
      "Modified package files may indicate rootkit installation or unauthorized system tampering.",
  },
  {
    id: "SUPPLY-DEBSUMS-INSTALLED",
    name: "debsums Package Integrity Tool Installed",
    severity: "info",
    check: (output) => {
      // which debsums output — path or NOT_INSTALLED
      const isInstalled = !output.includes("NOT_INSTALLED") && /debsums/.test(output);
      return {
        passed: isInstalled,
        currentValue: isInstalled ? "debsums is installed" : "debsums is not installed",
      };
    },
    expectedValue: "debsums is installed on the system",
    fixCommand: "apt install debsums",
    explain:
      "debsums verifies installed package file integrity against known checksums, detecting unauthorized file modifications.",
  },
];

export const parseSupplyChainChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return SUPPLY_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Supply Chain",
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
      category: "Supply Chain",
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
