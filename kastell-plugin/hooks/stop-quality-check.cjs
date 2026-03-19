#!/usr/bin/env node
// Stop hook: Warn if TypeScript errors, missing CHANGELOG entry, or stale README

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// MANDATORY stdin guard — exit silently if stdin unavailable (e.g. after /clear)
if (!process.stdin || process.stdin.destroyed || !process.stdin.readable) {
  process.exit(0);
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 1500);
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => process.exit(0));
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const cwd = process.cwd();

    // Kastell project guard
    const isKastell = fs.existsSync(path.join(cwd, 'src', 'mcp')) &&
                      fs.existsSync(path.join(cwd, 'package.json'));
    if (!isKastell) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
        if (pkg.name !== 'kastell') process.exit(0);
      } catch { process.exit(0); }
    }

    const warnings = [];

    // Check 1: TypeScript build
    try {
      execSync('npx tsc --noEmit 2>&1', { cwd, timeout: 30000, stdio: 'pipe', windowsHide: true });
    } catch {
      warnings.push('TypeScript errors detected - run `npm run build` to see details');
    }

    // Check 2: CHANGELOG version entry
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      const changelog = fs.readFileSync(path.join(cwd, 'CHANGELOG.md'), 'utf8');
      if (!changelog.includes(`## [${pkg.version}]`) && !changelog.includes(`## ${pkg.version}`)) {
        warnings.push(`CHANGELOG.md missing entry for v${pkg.version}`);
      }
    } catch {}

    // Check 3: README staleness (compare last commit timestamps)
    try {
      const srcFiles = execSync('git log -1 --format=%ct -- src/', {
        cwd, encoding: 'utf8', timeout: 5000, windowsHide: true,
      }).trim();
      const readmeCommit = execSync('git log -1 --format=%ct -- README.md', {
        cwd, encoding: 'utf8', timeout: 5000, windowsHide: true,
      }).trim();
      if (srcFiles && readmeCommit && parseInt(srcFiles) > parseInt(readmeCommit)) {
        warnings.push('README.md may be stale - src/ has newer commits');
      }
    } catch {}

    // Output warnings to stderr — Stop hooks CANNOT block execution
    for (const w of warnings) {
      process.stderr.write(`WARNING: ${w}\n`);
    }
  } catch {}

  // Always exit 0 — Stop hooks must never fail session end
  process.exit(0);
});
