import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * MCP SDK isolation guard.
 *
 * Statically traces import statements from src/index.ts (and its non-mcp
 * transitive imports) and asserts that no file in the main CLI dependency
 * tree imports from @modelcontextprotocol/sdk or src/mcp/.
 *
 * This test prevents accidental future regressions where an MCP import
 * leaks into the main CLI entry point, causing all users to pay the cost
 * of 179 transitive MCP dependencies.
 */

const SRC_ROOT = resolve(__dirname, "../../src");

/** Extract bare import specifiers from a TypeScript file. */
function extractImports(filePath: string): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const importPattern = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(content)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

/** Resolve a relative import specifier to an absolute file path. */
function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null; // external package
  const base = dirname(from);
  // Try .ts first, then /index.ts
  const candidates = [
    resolve(base, specifier.replace(/\.js$/, ".ts")),
    resolve(base, specifier.replace(/\.js$/, "") + ".ts"),
    resolve(base, specifier.replace(/\.js$/, ""), "index.ts"),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Collect all transitive imports starting from entryFile,
 * only following files inside srcRoot (not node_modules).
 * Returns both the visited file paths and all external package specifiers.
 */
function collectTransitiveImports(entryFile: string, srcRoot: string): {
  files: Set<string>;
  externalPackages: Set<string>;
} {
  const visited = new Set<string>();
  const externalPackages = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const imports = extractImports(current);
    for (const specifier of imports) {
      if (specifier.startsWith(".")) {
        const resolved = resolveImport(current, specifier);
        if (resolved && resolved.startsWith(srcRoot) && !visited.has(resolved)) {
          queue.push(resolved);
        }
      } else {
        externalPackages.add(specifier);
      }
    }
  }

  return { files: visited, externalPackages };
}

describe("MCP SDK isolation guard", () => {
  const entryFile = resolve(SRC_ROOT, "index.ts");

  it("src/index.ts is readable and valid", () => {
    const content = readFileSync(entryFile, "utf-8");
    expect(content).toContain("commander");
  });

  it("main CLI entry (src/index.ts) does NOT import from src/mcp/ directory", () => {
    const { files } = collectTransitiveImports(entryFile, SRC_ROOT);

    const mcpFiles = [...files].filter((f) => f.includes("/mcp/") || f.includes("\\mcp\\"));

    expect(mcpFiles).toHaveLength(0);
  });

  it("main CLI entry does NOT have @modelcontextprotocol/sdk as a transitive external package", () => {
    const { externalPackages } = collectTransitiveImports(entryFile, SRC_ROOT);

    const mcpPackages = [...externalPackages].filter((p) =>
      p.startsWith("@modelcontextprotocol"),
    );

    expect(mcpPackages).toHaveLength(0);
  });

  it("none of the non-mcp source directories import from @modelcontextprotocol", () => {
    const dirsToCheck = ["commands", "core", "utils", "types", "providers", "adapters", "cli"];

    for (const dir of dirsToCheck) {
      const dirPath = resolve(SRC_ROOT, dir);
      // Collect all imports from files in this directory
      let dirFiles: string[] = [];
      try {
        const { readdirSync } = require("fs");
        dirFiles = readdirSync(dirPath)
          .filter((f: string) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
          .map((f: string) => resolve(dirPath, f));
      } catch {
        // Directory may not exist in all environments
        continue;
      }

      for (const file of dirFiles) {
        const imports = extractImports(file);
        const mcpImports = imports.filter((i) => i.startsWith("@modelcontextprotocol") || i.includes("/mcp/"));
        expect(mcpImports).toHaveLength(0);
      }
    }
  });
});
