import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["dist/mcp/index.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/mcp-bundle.mjs",
  external: ["@napi-rs/keyring"],
  minify: false,
  sourcemap: false,
  banner: {
    js: [
      "// Kastell MCP Server — esbuild bundle (all deps included)",
      "import { createRequire } from 'module';",
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log("MCP bundle created: dist/mcp-bundle.mjs");
