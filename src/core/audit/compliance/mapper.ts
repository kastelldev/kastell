/**
 * Compliance mapping data — maps check IDs to framework controls.
 * Barrel export: re-exports from category files + FRAMEWORK_VERSIONS + helpers.
 * Populated in Phase 50 for CIS Ubuntu 22.04 v2.0.0, PCI-DSS v4.0, HIPAA.
 */

export {
  FRAMEWORK_VERSIONS,
  cis,
  pci,
  hipaa,
} from "./helpers.js";

export type { FrameworkKey } from "./helpers.js";

export { COMPLIANCE_MAP } from "./categories/index.js";
