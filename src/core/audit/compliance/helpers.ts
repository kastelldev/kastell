/**
 * Compliance helper functions — factory functions for framework references.
 */

import type { ComplianceRef, ComplianceCoverage } from "../types.js";

export const FRAMEWORK_VERSIONS = {
  CIS: "CIS Ubuntu 22.04 v2.0.0",
  "PCI-DSS": "PCI-DSS v4.0",
  HIPAA: "HIPAA §164.312",
} as const;

export type FrameworkKey = keyof typeof FRAMEWORK_VERSIONS;

/** Helper: build CIS ref with optional level (default L1) */
export function cis(
  controlId: string,
  description: string,
  coverage: ComplianceCoverage,
  level: "L1" | "L2" = "L1",
): ComplianceRef {
  return {
    framework: "CIS",
    controlId,
    version: FRAMEWORK_VERSIONS.CIS,
    description,
    coverage,
    level,
  };
}

/** Helper: build PCI-DSS ref */
export function pci(
  controlId: string,
  description: string,
  coverage: ComplianceCoverage,
): ComplianceRef {
  return {
    framework: "PCI-DSS",
    controlId,
    version: FRAMEWORK_VERSIONS["PCI-DSS"],
    description,
    coverage,
  };
}

/** Helper: build HIPAA ref */
export function hipaa(
  controlId: string,
  description: string,
  coverage: ComplianceCoverage,
): ComplianceRef {
  return {
    framework: "HIPAA",
    controlId,
    version: FRAMEWORK_VERSIONS.HIPAA,
    description,
    coverage,
  };
}