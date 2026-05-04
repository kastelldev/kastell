import { z } from "zod";

export const ServerRecordSchema = z.object({
  name: z.string(),
  ip: z.string(),
  provider: z.string(),
  region: z.string().optional(),
  size: z.string().optional(),
  id: z.string().optional(),
  mode: z.string().optional(),
  createdAt: z.string().optional(),
});

export const ScorePairSchema = z.object({
  before: z.number(),
  after: z.number(),
});

export type ServerRecord = z.infer<typeof ServerRecordSchema>;
export type ScorePair = z.infer<typeof ScorePairSchema>;