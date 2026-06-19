import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { ValidationError } from "../utils/errors.js";
import type {
  ActiveProbeModule,
  NormalizedActiveProbe,
} from "./sdk/types.js";

/**
 * The validated Active Probe module is the runtime identity a Kastell
 * instance holds for a plugin-authored probe. It is the only handle
 * permitted to invoke probe lifecycle methods; consumers receive the
 * `RegisteredActiveProbe` shape (definition + module) from the registry.
 */
export interface ValidatedActiveProbeModule {
  prepare: ActiveProbeModule["prepare"];
  execute: ActiveProbeModule["execute"];
  verify: ActiveProbeModule["verify"];
  rollback: ActiveProbeModule["rollback"];
  absolutePath: string;
  sha256: string;
}

/**
 * Pairs the normalized author metadata (`definition`) with the validated
 * callable module. Audit consumers receive only the ordered `checks` /
 * `readChecks` indexes; this richer shape is reserved for runtime code
 * that intentionally executes probes.
 */
export interface RegisteredActiveProbe {
  definition: NormalizedActiveProbe;
  module: ValidatedActiveProbeModule;
}

const LIFECYCLE_NAMES = ["prepare", "execute", "verify", "rollback"] as const;

/**
 * Resolve, contain, hash, and import an Active Probe module.
 *
 * The traversal check is performed against the realpath-resolved absolute
 * paths so symlinks/junctions that resolve outside the plugin directory
 * are rejected BEFORE the module is imported. Lifecycle exports are
 * type-checked but not invoked during this function.
 */
export async function loadActiveProbeModule(
  pluginDir: string,
  handlerPath: string,
  importer: (url: string) => Promise<unknown> = (url) => import(url),
): Promise<ValidatedActiveProbeModule> {
  const root = realpathSync(pluginDir);
  const candidate = resolve(root, handlerPath);
  // First pass: lexical escape check on the unresolved candidate so traversal
  // attempts fail with a clear error before we stat the file (or miss an
  // intentional ENOENT path). This rejects "../../etc/passwd" even if the
  // file doesn't exist.
  const lexicalRelative = relative(root, candidate);
  if (
    lexicalRelative === "" ||
    lexicalRelative.startsWith(`..${sep}`) ||
    lexicalRelative === ".." ||
    isAbsolute(lexicalRelative)
  ) {
    throw new ValidationError(
      `Active Probe handler escapes plugin directory: ${handlerPath}`,
    );
  }
  const absolutePath = realpathSync(candidate);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath === "" ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new ValidationError(
      `Active Probe handler escapes plugin directory: ${handlerPath}`,
    );
  }
  const sha256 = createHash("sha256")
    .update(readFileSync(absolutePath))
    .digest("hex");
  const namespace = (await importer(pathToFileURL(absolutePath).href)) as
    | Record<string, unknown>
    | undefined;
  const ns = (namespace ?? {}) as Record<string, unknown>;
  // ESM default export, then CJS `module.exports`, then namespace fallback.
  const mod = (ns.default ?? ns["module.exports"] ?? ns) as Partial<
    Record<(typeof LIFECYCLE_NAMES)[number], unknown>
  >;
  for (const name of LIFECYCLE_NAMES) {
    if (typeof mod[name] !== "function") {
      throw new ValidationError(
        `Active Probe module ${handlerPath} must export ${name}()`,
      );
    }
  }
  return {
    prepare: mod.prepare as ActiveProbeModule["prepare"],
    execute: mod.execute as ActiveProbeModule["execute"],
    verify: mod.verify as ActiveProbeModule["verify"],
    rollback: mod.rollback as ActiveProbeModule["rollback"],
    absolutePath,
    sha256,
  };
}
