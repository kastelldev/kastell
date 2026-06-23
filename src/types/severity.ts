export type Severity = "critical" | "warning" | "info";
export type FixTier = "SAFE" | "GUARDED" | "FORBIDDEN";

/**
 * Doctor finding weight per severity. Lives in types/ so both
 * `src/core/doctor.ts` and `src/core/probe/diagnostics.ts` can import
 * without creating a circular dependency.
 */
export const DOCTOR_SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 10,
  warning: 5,
  info: 1,
};
