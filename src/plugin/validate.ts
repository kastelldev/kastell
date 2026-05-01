import { z } from "zod";
import { ValidationError } from "../utils/errors.js";
import type { PluginManifest } from "./sdk/types.js";

const PluginManifestSchema = z
  .object({
    name: z.string().regex(/^kastell-plugin-[a-z0-9-]+$/, "Name must match kastell-plugin-<lowercase>"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (X.Y.Z)"),
    apiVersion: z.literal("1"),
    kastell: z.string().min(1, "Kastell version range required"),
    capabilities: z.tuple([z.literal("audit")]),
    checkPrefix: z.string().regex(/^[A-Z]{2,6}$/, "checkPrefix must be 2-6 uppercase letters"),
    entry: z.string().min(1, "Entry point required"),
  })
  .strict();

export function validateManifest(manifest: unknown): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ValidationError(`Invalid plugin manifest: ${parsed.error.message}`);
  }
  return parsed.data;
}
