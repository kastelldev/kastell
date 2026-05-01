import { z } from "zod";
import semver from "semver";
import { ValidationError } from "../utils/errors.js";
import { KASTELL_VERSION } from "../utils/version.js";
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

  const range = semver.validRange(parsed.data.kastell);
  if (!range) {
    throw new ValidationError(
      `Invalid kastell version range: "${parsed.data.kastell}"`,
    );
  }

  if (!semver.satisfies(KASTELL_VERSION, parsed.data.kastell)) {
    throw new ValidationError(
      `Plugin requires Kastell ${parsed.data.kastell}, current: ${KASTELL_VERSION}`,
    );
  }

  return parsed.data;
}
