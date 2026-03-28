#!/usr/bin/env node
// SessionStart hook: Show last audit score from cache (no SSH, instant)

const fs = require('fs');
const path = require('path');
const os = require('os');

const HISTORY_FILE = path.join(os.homedir(), '.kastell', 'audit-history.json');

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

    // Read audit history from cache — no SSH needed
    let history;
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch {
      // No history file — exit silently
      process.exit(0);
    }

    // Find the most recent audit entry across all servers
    let latest = null;
    let latestTime = 0;

    if (typeof history === 'object' && !Array.isArray(history)) {
      // Format: { "ip": [ { overallScore, serverName, timestamp } ] }
      for (const entries of Object.values(history)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const ts = new Date(entry.timestamp || entry.date || 0).getTime();
          if (ts > latestTime) {
            latestTime = ts;
            latest = entry;
          }
        }
      }
    } else if (Array.isArray(history)) {
      // Format: [ { overallScore, serverName, timestamp } ]
      for (const entry of history) {
        const ts = new Date(entry.timestamp || entry.date || 0).getTime();
        if (ts > latestTime) {
          latestTime = ts;
          latest = entry;
        }
      }
    }

    if (latest && typeof latest.overallScore === 'number') {
      const serverName = latest.serverName || latest.server || 'unknown';
      const date = (latest.timestamp || latest.date || '').split('T')[0];
      const ageMs = Date.now() - latestTime;
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      const stale = ageDays > 7 ? ` (${ageDays} days ago — consider re-running)` : '';

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: `[Kastell Audit] Last score: ${latest.overallScore}/100 (${serverName}, ${date})${stale}`,
      }));
    }
  } catch {}

  // Always exit 0 — SessionStart MUST NOT fail
  process.exit(0);
});
