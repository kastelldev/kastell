import { z } from "zod";

export const DoctorFindingSchema = z.object({
  id: z.string(),
  severity: z.string(),
  description: z.string(),
  command: z.string(),
  fixCommand: z.string().optional(),
});

export const HealthStatusSchema = z.object({
  status: z.string(),
  checks: z.record(z.string(), z.unknown()).optional(),
});

export type DoctorFinding = z.infer<typeof DoctorFindingSchema>;
