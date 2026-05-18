#!/usr/bin/env node
/**
 * Fix import paths and placement for createFsMock.
 */

const fs = require("fs");
const { execSync } = require("child_process");

const files = execSync(
  'grep -rl "createFsMock" tests/ | grep -v fsMock\\.ts',
  { encoding: "utf8" }
).split("\n").filter(Boolean);

let fixed = 0;

for (const file of files) {
  let c = fs.readFileSync(file, "utf8");

  // Remove all wrong import patterns
  const wrongPatterns = [
    /import \{ createFsMock \} from "\.\.\/helpers\/fsMock\.js";/g,
    /import \{ createFsMock \} from "\.\/helpers\/fsMock\.js";/g,
    /import \{ createFsMock \} from "\.\.\/\.\.\/helpers\/fsMock\.js";/g,
    /import \{ createFsMock \} from "\.\.\/\.\.\/\.\.\/helpers\/fsMock\.js";/g,
  ];

  for (const p of wrongPatterns) {
    c = c.replace(p, "___REMOVE___");
  }

  // Remove lines that are wrong imports (not at top level)
  const lines = c.split("\n");
  const newLines = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let inTemplateLiteral = false;

  for (const line of lines) {
    if (line.includes("\`")) inTemplateLiteral = !inTemplateLiteral;
    if (inTemplateLiteral) {
      newLines.push(line);
      continue;
    }

    // Track brace and paren depth to detect wrong placement
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
      if (ch === "(") parenDepth++;
      if (ch === ")") parenDepth--;
    }

    // Skip import line that ends up in weird position (indented, inside braces, etc.)
    const trimmed = line.trim();
    const isWrongImport = trimmed === "import { createFsMock } from \"../helpers/fsMock.js\";" ||
                          trimmed === "import { createFsMock } from \"../../helpers/fsMock.js\";" ||
                          trimmed === "import { createFsMock } from \"../../../helpers/fsMock.js\";" ||
                          trimmed.startsWith("import { createFsMock } from");

    // If line is indented (not at top level of file) or inside brackets, skip
    const isIndented = line.match(/^\s+\S/);
    if (isWrongImport && (isIndented || braceDepth !== 0 || parenDepth !== 0)) {
      continue;
    }

    newLines.push(line);
  }

  c = newLines.join("\n").replace(/___REMOVE___/g, "").replace(/\n{3,}/g, "\n\n");

  // Now add correct import at top
  const pathParts = file.replace(/\\/g, "/").split("tests/")[1].split("/");
  const depth = pathParts.length - 1;
  const rel = "../".repeat(depth) + "helpers/fsMock.js";
  const correctImport = `import { createFsMock } from "${rel}";`;

  // Find last top-level import line
  const finalLines = c.split("\n");
  const lastImportIdx = finalLines
    .map((l, i) => (l.match(/^import /) && !l.includes("from \"..")) ? i : -1)
    .filter(i => i >= 0)
    .pop() ?? -1;

  finalLines.splice(lastImportIdx + 1, 0, correctImport);
  c = finalLines.join("\n");

  fs.writeFileSync(file, c, "utf8");
  console.log("FIXED:", file, "-> rel:", rel);
  fixed++;
}

console.log("\nTotal fixed:", fixed);