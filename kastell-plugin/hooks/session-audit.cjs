#!/usr/bin/env node
// SessionStart hook: Run kastell audit --score-only on first configured server, inject score

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SERVERS_FILE = path.join(os.homedir(), '.kastell', 'servers.json');

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

    // Read servers list — exit silently if unavailable or empty
    let servers;
    try {
      servers = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
    } catch {
      process.exit(0);
    }
    if (!Array.isArray(servers) || servers.length === 0) {
      process.exit(0);
    }

    const server = servers[0];

    // Redirect stderr to null — Windows vs Unix
    const devNull = process.platform === 'win32' ? '2>NUL' : '2>/dev/null';

    // Run audit with --score-only flag
    let output;
    try {
      output = execSync(`npx kastell audit ${server.name} --score-only ${devNull}`, {
        cwd,
        timeout: 45000,
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      });
    } catch {
      // Timeout or audit failure — exit silently, never block SessionStart
      process.exit(0);
    }

    // Parse score from output — expected format: "72/100"
    const match = (output || '').trim().match(/^(\d+)\/100$/);
    if (match) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: `[Kastell Audit] Score: ${match[1]}/100 (${server.name})`,
      }));
    }
  } catch {}

  // Always exit 0 — SessionStart MUST NOT fail
  process.exit(0);
});
