#!/usr/bin/env node
/**
 * Port inline fs mocks to createFsMock factory.
 * Uses require-inside-callback pattern to avoid TDZ with ESM imports.
 */

const fs = require("fs");
const path = require("path");

function findTestFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

const allTestFiles = findTestFiles("tests");

const oldPattern = /jest\.mock\s*\(\s*['"]fs['"]\s*,\s*\(\)\s*=>\s*\(\s*\{/;
const portFiles = allTestFiles.filter(f => {
  const c = fs.readFileSync(f, "utf8");
  return oldPattern.test(c);
});

console.log("Files to port:", portFiles.length);

let ported = 0;

for (const file of portFiles) {
  let content = fs.readFileSync(file, "utf8");

  // Compute correct relative require path to helpers
  const relPath = file.replace(/\\/g, "/").split("tests/")[1];
  const depth = relPath.split("/").length - 1;
  const rel = "../".repeat(depth) + "helpers/fsMock.js";

  console.log("PORTING:", file, "depth:", depth, "rel:", rel);

  // Replace old inline object mock with require-inside-callback pattern
  // Note: regex captures up to the ) closing the mock call, so replacement ends with });
  // (not });; which would be the case if we included the ; in the match)
  content = content.replace(
    /jest\.mock\s*\(\s*['"]fs['"]\s*,\s*\(\)\s*=>\s*\(\s*\{[\s\S]*?\}\s*\)\s*\)/g,
    `jest.mock("fs", () => {\n  const { createFsMock } = require("${rel}");\n  return createFsMock();\n});`
  );

  fs.writeFileSync(file, content, "utf8");
  ported++;
}

console.log(`\nPorted: ${ported}`);