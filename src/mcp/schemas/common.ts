import { z } from "zod";

export const SuggestedActionSchema = z.object({
  command: z.string(),
  reason: z.string(),
});

export const ServerIdentitySchema = z.object({
  server: z.string(),
  ip: z.string(),
});

export const SuccessMessageSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
export type ServerIdentity = z.infer<typeof ServerIdentitySchema>;
